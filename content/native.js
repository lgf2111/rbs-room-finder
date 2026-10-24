/*
 * content/native.js
 *
 * The API + parsing layer for RBS Room Finder.
 *
 * Everything meaningful here is a PURE function so it can run in both the
 * browser (as a content script) and in Node (for `node --test tests/`).
 *
 * RBS exposes two JSON endpoints that the content script hits directly as
 * same-origin POSTs (no postback, no VIEWSTATE, no page navigation):
 *
 *   1) POST /SRB001/SearchSRB001List
 *        -> JSON array of rooms for a date/window/type/building/capacity.
 *   2) POST /SRB001/GetTimeSlotListByresidNdatetime
 *        -> JSON array of 30-minute slots for ONE room on a date/window.
 *
 * Both are sent with
 *   Content-Type: application/x-www-form-urlencoded; charset=UTF-8
 *   X-Requested-With: XMLHttpRequest
 * and carry a fresh `__RequestVerificationToken` read from the hidden input on
 * the page right before each call.
 *
 * Performance facts that dictate the architecture (measured on the live site):
 *   - SearchSRB001List: ~1.8-2.3 s.
 *   - GetTimeSlotListByresidNdatetime: ~2.1-2.2 s PER ROOM.
 *   - Requests DO NOT parallelise: the server serialises per session, so 6
 *     concurrent slot calls took ~13.7 s while 2 sequential took ~4.3 s.
 *     => exactly ONE slot request in flight at any time. Never Promise.all.
 *
 * This file provides the pure building blocks. panel.js owns the DOM, the
 * single-flight queue, the cache, the generation counter and the Book action.
 */

'use strict';

/** The native control ids the extension reads from. */
const RBS_CONTROL_IDS = Object.freeze({
  resourceType: 'resourceType',
  date: 'searchSlotDate',
  start: 'SearchHoursFrom',
  end: 'SearchHoursTo',
  status: 'bookingstatus',
  capacity: 'srcCapacity',
  capacityOperator: 'srcCapacityOperator',
  campus: 'campus',
  building: 'building',
  facilities: 'facilities',
  searchButton: 'btnBookingMainSearch',
});

/** The two JSON endpoints (same-origin paths). */
const RBS_ENDPOINTS = Object.freeze({
  searchList: '/SRB001/SearchSRB001List',
  slotList: '/SRB001/GetTimeSlotListByresidNdatetime',
});

/** Default day window used by the board. */
const DEFAULT_WINDOW = Object.freeze({ start: '07:00', end: '22:30' });

/** SLT_STATUS mapping, verified live: 1 = free, 3 = taken, else unknown. */
// Live mapping: 1 = free, 3 = booked, 7 = unavailable for this user (quota /
// permission / not bookable) - verified against the site. Everything else unknown.
const SLOT_STATUS = Object.freeze({ FREE: 1, TAKEN: 3, UNAVAILABLE: 7 });
// 7 is NOT "booked" - it is "not open for booking" (past/weekend/permission).
// Rendering it as taken painted whole closed days red.

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Format a Date as the RBS date-input format, e.g. "24 Oct 2026".
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error('formatDate: expected a valid Date');
  }
  const day = date.getDate();
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

/**
 * Format a time window for display, e.g. "07:00–22:30" (en dash).
 * @param {string} start "HH:MM"
 * @param {string} end   "HH:MM"
 * @returns {string}
 */
function formatWindow(start, end) {
  return `${start}\u2013${end}`;
}

/**
 * Convert a "HH:MM" string to minutes since midnight. Returns NaN if malformed.
 * @param {string} hhmm
 * @returns {number}
 */
function timeToMinutes(hhmm) {
  if (typeof hhmm !== 'string') return NaN;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return NaN;
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (hours > 23 || mins > 59) return NaN;
  return hours * 60 + mins;
}

/**
 * Convert minutes-since-midnight to a zero-padded "HH:MM" label.
 * @param {number} mins
 * @returns {string}
 */
function minutesToTime(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return `${h}:${mm}`;
}

/**
 * Collapse whitespace in a string and trim.
 * @param {string} s
 * @returns {string}
 */
function normalizeText(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

// --- Payload builders --------------------------------------------------------

/**
 * Build the exact x-www-form-urlencoded field object for
 * POST /SRB001/SearchSRB001List.
 *
 * Every documented key is present; empty string is allowed. `ResourceType` is
 * the option TEXT (e.g. "Discussion Room"); `''` means all types.
 * `bookingstatus` AND `BookingStatus` are BOTH set and equal.
 *
 * @param {object} fields
 * @param {string} fields.token           __RequestVerificationToken (fresh)
 * @param {string} [fields.capacityOperator]
 * @param {string} [fields.singleCapacity]
 * @param {string} [fields.minCapacity]
 * @param {string} [fields.maxCapacity]
 * @param {string} [fields.campusID]
 * @param {string} [fields.buildingID]
 * @param {string} [fields.status]        "All" | "Available"
 * @param {string} [fields.facilities]
 * @param {string} [fields.search]        free-text substring
 * @param {string} fields.resourceType    option TEXT, '' for all
 * @param {string} fields.date            "24 Oct 2026"
 * @param {string} fields.start           "HH:MM"
 * @param {string} fields.end             "HH:MM"
 * @returns {Object<string,string>}
 */
function buildSearchPayload(fields) {
  fields = fields || {};
  const str = (v) => (v == null ? '' : String(v));
  const status = fields.status === 'All' ? 'All' : fields.status === 'Available' ? 'Available' : str(fields.status);

  return {
    __RequestVerificationToken: str(fields.token),
    CapacityOperator: str(fields.capacityOperator),
    SingleCapacity: str(fields.singleCapacity),
    MinCapacity: str(fields.minCapacity),
    MaxCapacity: str(fields.maxCapacity),
    campusID: str(fields.campusID),
    buildingID: str(fields.buildingID),
    bookingstatus: status,
    BookingStatus: status,
    faciequip: str(fields.facilities),
    Search: str(fields.search),
    ResourceType: str(fields.resourceType),
    Location: '',
    LocationID: '',
    SearchDate: str(fields.date),
    SearchStartTime: str(fields.start),
    SearchEndTime: str(fields.end),
  };
}

/**
 * Build the exact field object for
 * POST /SRB001/GetTimeSlotListByresidNdatetime for ONE room.
 *
 * `BKG_RUL` and `IS_SLD_Resource` come from the room record. `bookingstatus`
 * is always `All` (it returns every slot with a status).
 *
 * @param {object} room   parseRooms() record ({id, typeId, isBkgrul, isSld, ...})
 * @param {string} date   "24 Oct 2026"
 * @param {{start:string,end:string}} window
 * @param {string} [status]  defaults to 'All'
 * @param {string} [token]   __RequestVerificationToken (fresh)
 * @returns {Object<string,string>}
 */
function buildSlotPayload(room, date, window, status, token) {
  room = room || {};
  window = window || {};
  const str = (v) => (v == null ? '' : String(v));
  const boolStr = (v) => (v === true ? 'true' : v === false ? 'false' : str(v));

  return {
    __RequestVerificationToken: str(token),
    rsrcID: str(room.id),
    rsrctypID: str(room.typeId),
    bookingstatus: status === 'Available' ? 'Available' : 'All',
    SearchDate: str(date),
    SearchStartTime: str(window.start),
    SearchEndTime: str(window.end),
    BKG_RUL: boolStr(room.isBkgrul),
    IS_SLD_Resource: boolStr(room.isSld),
  };
}

/**
 * Encode a field object as an application/x-www-form-urlencoded body string.
 * @param {Object<string,string>} fields
 * @returns {string}
 */
function encodeForm(fields) {
  return Object.keys(fields)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(fields[k] == null ? '' : fields[k]))
    .join('&');
}

// --- Response parsers --------------------------------------------------------

/**
 * Parse the room-search JSON into the fields the board needs, in API order.
 *
 * @param {Array|string} json  parsed array or a JSON string
 * @returns {Array<{id:string,name:string,type:string,capacity:number,
 *   building:string,isBkgrul:boolean,isSld:boolean,bookable:boolean,
 *   permitted:boolean,typeId:string}>}
 */
function parseRooms(json) {
  const arr = typeof json === 'string' ? JSON.parse(json) : json;
  if (!Array.isArray(arr)) return [];
  return arr.map((r) => ({
    id: String(r.RSRC_ID == null ? '' : r.RSRC_ID),
    name: normalizeText(r.RSRC_NAME),
    serial: normalizeText(r.SERIAL_NUM),
    capacity: Number(r.CAPACITY) || 0,
    typeId: String(r.RSRC_TYP_ID == null ? '' : r.RSRC_TYP_ID),
    type: normalizeText(r.RSRC_TYP_NAME),
    building: normalizeText(r.BLDNG_NAME),
    isBkgrul: r.IS_BKGRUL === true,
    isSld: r.IS_SLD === true,
    bookable: r.IS_BOOKABLE === true,
    permitted: r.IS_PERMITTED === true,
    eventType: r.Event_Type,
    paragraph: normalizeText(r.Paragraph),
    disclaimer: normalizeText(r.DISCLAIMER),
  }));
}

/**
 * Classify a single SLT_STATUS value. 1 = free, 3 = taken, else unknown.
 * @param {number} status
 * @returns {"free"|"taken"|"unknown"}
 */
function classifySlotStatus(status) {
  const n = Number(status);
  if (n === SLOT_STATUS.FREE) return 'free';
  if (n === SLOT_STATUS.TAKEN) return 'taken';
  if (n === SLOT_STATUS.UNAVAILABLE) return 'closed';
  return 'unknown';
}

/**
 * Parse the slot JSON for one room into normalized slot records.
 *
 * `canBooked` is intentionally ignored (it was false on every live probe).
 *
 * @param {Array|string} json
 * @returns {Array<{time:string,status:number,state:string,sltId:string,
 *   dateTime:string,quota:number}>}
 */
function parseSlots(json) {
  const arr = typeof json === 'string' ? JSON.parse(json) : json;
  if (!Array.isArray(arr)) return [];
  return arr.map((s) => {
    const status = Number(s.SLT_STATUS);
    // SLT_Desc is the "HH:MM" label; fall back to SLT_Time ("1400" -> "14:00").
    let time = normalizeText(s.SLT_Desc);
    if (!/^\d{2}:\d{2}$/.test(time)) {
      const raw = String(s.SLT_Time == null ? '' : s.SLT_Time).padStart(4, '0');
      time = raw.slice(0, 2) + ':' + raw.slice(2);
    }
    return {
      time,
      status,
      state: classifySlotStatus(status),
      sltId: String(s.SLT_ID == null ? '' : s.SLT_ID),
      dateTime: String(s.SLT_Date_Time == null ? '' : s.SLT_Date_Time),
      quota: Number(s.Quota) || 0,
    };
  });
}

// --- Axis + alignment --------------------------------------------------------

/**
 * Build the shared half-hour time axis for a day window.
 *
 * For "07:00"-"22:30" this returns 30 labels starting "07:00" and ending
 * "21:30" (the last 30-minute slot BEGINS at 21:30 and runs to 22:00; the end
 * bound is exclusive of a slot that starts at it, matching the live API which
 * returned 30 entries for 07:00-22:30).
 *
 * @param {string} start "HH:MM"
 * @param {string} end   "HH:MM"
 * @returns {string[]}
 */
function buildSlotAxis(start, end) {
  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  if (isNaN(startMin)) throw new Error(`buildSlotAxis: invalid start "${start}"`);
  if (isNaN(endMin)) throw new Error(`buildSlotAxis: invalid end "${end}"`);
  // The axis labels are slot START times. The final slot starts one hour before
  // the window end: the API returns 30 slots for 07:00-22:30 and the last one
  // begins at 21:30 (runs 21:30-22:00). So the last label is `end - 60 min`.
  const out = [];
  for (let m = startMin; m <= endMin - 60; m += 30) {
    out.push(minutesToTime(m));
  }
  return out;
}

/**
 * Align parsed slots onto an axis: exactly one cell per axis label, in axis
 * order. A label with no matching slot becomes `null` (API returned nothing
 * for it). The axis length is never changed.
 *
 * @param {string[]} axis   labels from buildSlotAxis
 * @param {Array<{time:string}>} slots  parseSlots output (any order)
 * @returns {Array<object|null>}
 */
function alignSlots(axis, slots) {
  const byTime = new Map();
  for (const s of Array.isArray(slots) ? slots : []) {
    if (s && typeof s.time === 'string' && !byTime.has(s.time)) {
      byTime.set(s.time, s);
    }
  }
  return (Array.isArray(axis) ? axis : []).map((label) =>
    byTime.has(label) ? byTime.get(label) : null
  );
}

/**
 * Build block models for rendering: one per room, in the order given, each
 * carrying its aligned cells (or all-null skeleton cells when slots are not yet
 * loaded for that room).
 *
 * @param {Array} rooms                 parseRooms output
 * @param {Object<string,Array>} slotsByRoomId  rsrcId -> parseSlots output
 * @param {string[]} axis               buildSlotAxis output
 * @returns {Array<{id,name,type,capacity,building,isBkgrul,loaded,cells}>}
 */
function buildBoardModel(rooms, slotsByRoomId, axis) {
  slotsByRoomId = slotsByRoomId || {};
  const safeAxis = Array.isArray(axis) ? axis : [];
  return (Array.isArray(rooms) ? rooms : []).map((room) => {
    const slots = slotsByRoomId[room.id];
    const loaded = Array.isArray(slots);
    const cells = loaded
      ? alignSlots(safeAxis, slots)
      : safeAxis.map(() => null);
    return {
      id: room.id,
      name: room.name,
      type: room.type,
      capacity: room.capacity,
      building: room.building,
      isBkgrul: room.isBkgrul,
      loaded,
      cells,
    };
  });
}

/**
 * Decide what an empty-ish board means, from counts.
 *
 *   - 0 rooms from the search              -> "no rooms match these filters"
 *   - rooms exist but every cell is taken  -> "all slots taken in this window"
 *   - otherwise                            -> "has availability"
 *
 * `cells` may be given as a count of free cells, or as an array/matrix of cell
 * states; we only need to know whether ANY cell is free.
 *
 * @param {object} arg
 * @param {number} arg.rooms           number of rooms returned
 * @param {number|Array|string} [arg.cells]  free-cell signal (see above)
 * @returns {"no rooms match these filters"|"all slots taken in this window"|"has availability"}
 */
function classifyEmpty(arg) {
  arg = arg || {};
  const rooms = Number(arg.rooms) || 0;
  if (rooms <= 0) return 'no rooms match these filters';

  const anyFree = hasAnyFreeCell(arg.cells);
  if (!anyFree) return 'all slots taken in this window';
  return 'has availability';
}

/**
 * True if the given cells signal contains at least one free cell.
 * Accepts: a number (free-cell count), a flat array of cells/states, or a
 * nested array (per-room rows) of cells/states.
 * @param {number|Array|undefined} cells
 * @returns {boolean}
 */
function hasAnyFreeCell(cells) {
  if (typeof cells === 'number') return cells > 0;
  if (!Array.isArray(cells)) return false;
  for (const item of cells) {
    if (Array.isArray(item)) {
      if (hasAnyFreeCell(item)) return true;
    } else if (isFreeCell(item)) {
      return true;
    }
  }
  return false;
}

/** Is a single cell (object, state string, or status number) free? */
function isFreeCell(cell) {
  if (cell == null) return false;
  if (typeof cell === 'string') return cell === 'free';
  if (typeof cell === 'number') return cell === SLOT_STATUS.FREE;
  if (typeof cell === 'object') return cell.state === 'free' || cell.status === SLOT_STATUS.FREE;
  return false;
}

// --- Single-flight slot-loading queue ---------------------------------------

/**
 * Build the cache key for one room's slots: `rsrcId|date|window|status`.
 * @param {string} roomId
 * @param {string} date
 * @param {{start:string,end:string}} window
 * @param {string} status
 * @returns {string}
 */
function slotCacheKey(roomId, date, window, status) {
  const w = window ? `${window.start}-${window.end}` : '';
  return `${roomId}|${date}|${w}|${status}`;
}

/**
 * Create a single-flight slot-loading queue.
 *
 * This is the CORE of the feature and is kept pure/injectable so it can be
 * tested under Node without a DOM:
 *   - `fetcher(room)` -> Promise resolving to that room's slots (already
 *     parsed). It is the ONLY place a network call happens. The queue
 *     guarantees at most ONE fetcher call is in flight at any moment (the
 *     server serialises per session, so parallelism only hurts).
 *   - responses are cached by `slotCacheKey`; a cached room is NEVER re-fetched.
 *   - a generation counter: bumping it abandons in-flight/queued work so stale
 *     responses are discarded instead of painted.
 *
 * @param {object} opts
 * @param {(room:object)=>Promise<Array>} opts.fetcher
 * @param {string} opts.date
 * @param {{start:string,end:string}} opts.window
 * @param {string} opts.status
 * @param {(roomId:string, slots:Array)=>void} [opts.onLoaded]   painted (fresh gen) only
 * @param {(roomId:string, error:Error)=>void} [opts.onError]
 * @param {(done:number, total:number)=>void} [opts.onProgress]
 * @param {Map} [opts.cache]   shared cache (created if omitted)
 * @returns {{enqueue, prioritize, bumpGeneration, generation, run, cache, stats}}
 */
function createSlotQueue(opts) {
  opts = opts || {};
  const fetcher = opts.fetcher;
  if (typeof fetcher !== 'function') {
    throw new Error('createSlotQueue: fetcher is required');
  }
  const date = opts.date;
  const window = opts.window;
  const status = opts.status || 'All';
  const cache = opts.cache instanceof Map ? opts.cache : new Map();
  const onLoaded = typeof opts.onLoaded === 'function' ? opts.onLoaded : () => {};
  const onError = typeof opts.onError === 'function' ? opts.onError : () => {};
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const onDone = typeof opts.onDone === 'function' ? opts.onDone : () => {};

  let generation = 0;
  let inFlight = 0; // concurrency gauge; MUST never exceed 1
  let running = false;
  let queue = []; // room objects, DOM order
  let total = 0;
  let done = 0;

  const stats = { maxInFlight: 0, fetches: 0 };

  function enqueue(rooms) {
    for (const r of Array.isArray(rooms) ? rooms : [rooms]) {
      queue.push(r);
      total += 1;
    }
  }

  // Move a room (by id) to the front of the queue so a viewport block jumps it.
  function prioritize(roomId) {
    const idx = queue.findIndex((r) => r.id === roomId);
    if (idx > 0) {
      const [r] = queue.splice(idx, 1);
      queue.unshift(r);
    }
  }

  function bumpGeneration() {
    generation += 1;
    // Abandon everything queued: a fresh load must be re-enqueued by the caller.
    queue = [];
    total = done;
    return generation;
  }

  function key(room) {
    return slotCacheKey(room.id, date, window, status);
  }

  // Drain the queue one request at a time. Safe to call repeatedly; it no-ops
  // if already draining.
  async function run() {
    if (running) return;
    running = true;
    const myGen = generation;

    try {
      while (queue.length > 0) {
        // Generation changed out from under us -> abandon this drain.
        if (generation !== myGen) return;

        const room = queue.shift();
        const k = key(room);

        // Cache hit: never re-fetch.
        if (cache.has(k)) {
          done += 1;
          onProgress(done, total);
          onLoaded(room.id, cache.get(k));
          continue;
        }

        // Single-flight: exactly one fetcher invocation at a time.
        inFlight += 1;
        if (inFlight > stats.maxInFlight) stats.maxInFlight = inFlight;
        stats.fetches += 1;

        let slots = null;
        let err = null;
        try {
          slots = await fetcher(room);
        } catch (e) {
          err = e instanceof Error ? e : new Error(String(e));
        } finally {
          inFlight -= 1;
        }

        // If the generation moved while this request was in flight, the
        // response is STALE: cache it (still valid data) but do NOT paint.
        const stale = generation !== myGen;

        if (err) {
          if (!stale) {
            done += 1;
            onProgress(done, total);
            onError(room.id, err);
          }
          continue;
        }

        cache.set(k, slots);
        if (stale) return; // abandon the rest of this drain quietly
        done += 1;
        onProgress(done, total);
        onLoaded(room.id, slots);
      }
    } finally {
      running = false;
      if (generation === myGen) onDone({ done, total });
    }
  }

  return {
    enqueue,
    prioritize,
    bumpGeneration,
    run,
    cache,
    stats,
    get generation() {
      return generation;
    },
    get inFlight() {
      return inFlight;
    },
    get remaining() {
      return queue.length;
    },
  };
}

// --- New functions for full-page UI -----------------------------------------

/** CSS selectors for hiding native UI containers (must NOT hide modals). */
const NATIVE_HIDE_SELECTORS = Object.freeze([
  'header', 'nav', 'footer', '.body-content', '#divRoomInfo',
  '#divSearchContentResult', '#divbtnbottom',
]);

/** Forbidden click IDs — NEVER submit a booking. */
const FORBIDDEN_CLICK_IDS = Object.freeze([
  'btnBookingSave', 'btnConfirmBookingSave', 'btnBookingNext', 'btnBooking',
  'btnBookingMainClear', 'btnMultipleBookingConfirm', 'btnMultipleBookingConfirmSave',
]);

/** Weekday initials: Sun, Mon, Tue, Wed, Thu, Fri, Sat */
const WEEKDAY_INITIALS = Object.freeze(['S', 'M', 'T', 'W', 'T', 'F', 'S']);

/**
 * Build date chips for the next N days.
 * @param {Date} startDate  base date (today)
 * @param {number} count    how many chips to produce
 * @returns {Array<{date:Date,label:string,weekday:string,isToday:boolean}>}
 */
function buildDateChips(startDate, count) {
  const chips = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    const day = d.getDate();
    const month = MONTHS[d.getMonth()];
    const year = d.getFullYear();
    const weekday = WEEKDAY_INITIALS[d.getDay()];
    chips.push({
      date: d,
      label: `${day} ${month} ${year}`,
      weekday,
      isToday: i === 0,
    });
  }
  return chips;
}

/**
 * Convert a cell range (start,end indices) to a time window.
 * @param {string[]} axis    buildSlotAxis output
 * @param {number} fromIdx   inclusive start index (0-based)
 * @param {number} toIdx     inclusive end index
 * @returns {{start:string,end:string,count:number}}
 */
function rangeToWindow(axis, fromIdx, toIdx) {
  if (!Array.isArray(axis) || axis.length === 0) {
    return { start: '', end: '', count: 0 };
  }
  const startIdx = Math.max(0, Math.min(fromIdx, toIdx));
  const endIdx = Math.min(axis.length - 1, Math.max(fromIdx, toIdx));
  const start = axis[startIdx];
  let end = axis[endIdx];
  // The slot that starts at `end` runs for 30 min, so the window ends at its end time.
  const endMin = timeToMinutes(end);
  if (!isNaN(endMin)) {
    end = minutesToTime(endMin + 30);
  }
  return { start, end, count: endIdx - startIdx + 1 };
}

/**
 * Does a range contain at least one taken slot?
 * @param {Array<object|null>} slots    alignSlots output (may contain nulls)
 * @param {number} fromIdx              inclusive start index
 * @param {number} toIdx                inclusive end index
 * @returns {boolean}
 */
function rangeHasConflict(slots, fromIdx, toIdx) {
  if (!Array.isArray(slots)) return false;
  const start = Math.max(0, Math.min(fromIdx, toIdx));
  const end = Math.min(slots.length - 1, Math.max(fromIdx, toIdx));
  for (let i = start; i <= end; i++) {
    const s = slots[i];
    if (s && s.state === 'taken') return true;
  }
  return false;
}

/**
 * Map a key to an action, ignoring while an input is focused.
 * @param {string} key          lowercase key (e.g., 'j')
 * @param {object} context
 * @param {boolean} [context.inInput]  true if focus is inside an input/textarea/select
 * @returns {string|null}       action name or null for no-op
 */
function keyToAction(key, context) {
  if (context && context.inInput) return null;
  const map = {
    '/': 'focusSearch',
    'j': 'rowDown',
    'k': 'rowUp',
    'enter': 'handoff',
    'd': 'toggleNative',
    'escape': 'clear',
  };
  return map[key] || null;
}

/**
 * Should we reveal the native UI after consecutive failures?
 * @param {object} arg
 * @param {number} arg.consecutiveFailures
 * @returns {boolean}
 */
function shouldRevealNative(arg) {
  return (arg.consecutiveFailures || 0) >= 3;
}

/**
 * Should we reveal native UI based on a self-check result?
 * @param {{ok: boolean, missing: string[]}} check
 * @returns {boolean}
 */
function shouldRevealNativeOnFailure(check) {
  return check ? check.ok === false : false;
}

/**
 * Filter rooms based on capacity and equipment rules.
 * When roomType is empty (All rooms), filter out equipment:
 * - Equipment has capacity 0 AND type is not in facilityTypes list
 * - Rooms with capacity 0 BUT type in facilityTypes list are kept
 * @param {Array} rooms parseRooms output
 * @param {string} roomType selected room type (empty for All rooms)
 * @param {number} minCapacity minimum capacity filter
 * @param {Array<string>} facilityTypes list of facility types from #resourceType
 * @returns {Array} filtered rooms
 */
function filterRooms(rooms, roomType, minCapacity, facilityTypes) {
  if (!Array.isArray(rooms)) return [];
  return rooms.filter((r) => {
    // Capacity filter
    if (r.capacity < minCapacity) return false;
    
    // When room type is "All rooms", filter out equipment
    if (roomType === '') {
      // Equipment has capacity 0 AND type is not a facility type
      if (r.capacity === 0 && r.type) {
        const isFacilityType = facilityTypes.includes(r.type);
        if (!isFacilityType) {
          return false; // Filter out equipment
        }
      }
    }
    
    return true;
  });
}

// --- Axis grid helpers ------------------------------------------------------

/**
 * Return the grid-template-columns value for both header and rows.
 * @param {string[]} axis buildSlotAxis output
 * @returns {string}
 */
function axisGridTemplate(axis) {
  if (!Array.isArray(axis)) return '180px';
  return `180px repeat(${axis.length}, minmax(0, 1fr))`;
}

/**
 * Build hour axis header cells.
 * @param {string[]} axis buildSlotAxis output
 * @returns {Array<{isHour: boolean, label: string}>}
 */
function buildAxisHeaderCells(axis) {
  if (!Array.isArray(axis)) return [];
  return axis.map(label => ({
    isHour: /:00$/.test(label),
    label
  }));
}

// --- Self-check for panel.js UI references ---------------------------------

/**
 * Validate UI references object for required keys and element properties.
 * Returns {ok: boolean, missing: string[]} listing keys that are null/undefined
 * or elements missing the required properties (e.g., addEventListener).
 * @param {object} refs
 * @returns {{ok: boolean, missing: string[]}}
 */
function selfCheck(refs) {
  if (!refs || typeof refs !== 'object') {
    return { ok: false, missing: ['refs (null or non-object)'] };
  }
  
  const required = [
    'host', 'topbar', 'buildingSelect', 'typeSelect', 'capInput', 'searchInput',
    'dateChips', 'startSelect', 'endSelect', 'sortSelect', 'refreshBtn', 
    'nativeBtn', 'boardHeader', 'boardRows', 'statusBar'
  ];
  
  const missing = [];
  
  for (const key of required) {
    const val = refs[key];
    if (val == null) {
      missing.push(key);
      continue;
    }
    
    // For element references, verify they're actually DOM elements
    // Only check addEventListener for elements that need it
    if (key === 'dateChips') {
      // dateChips is a container div, doesn't need addEventListener
    } else if (key !== 'host' && key !== 'topbar' && key !== 'boardHeader' && 
        key !== 'boardRows' && key !== 'statusBar') {
      // Inputs, selects, buttons need addEventListener
      if (typeof val.addEventListener !== 'function') {
        missing.push(`${key} (not a DOM element)`);
      }
    }
  }
  
  return { ok: missing.length === 0, missing };
}

// --- New helper functions for Shoelace adoption ------------------------------

/**
 * Check if Shoelace components are available.
 * @returns {boolean}
 */
function hasShoelace() {
  if (typeof customElements === 'undefined') return false;
  // Check for sl-button as a representative component
  return typeof customElements.get('sl-button') === 'function';
}

/**
 * Determine default form values based on native page state.
 * Returns the first concrete room type and the native building when present,
 * and falls back to 'All rooms' + empty building when native state is empty.
 * @param {object} nativeState
 * @param {string[]} nativeState.roomTypes - Available room types from the page
 * @param {string} nativeState.building - Current building value from native page
 * @param {string} nativeState.buildingName - Current building name
 * @returns {{roomType: string, building: string, buildingName: string}}
 */
function defaultForm(nativeState) {
  const { roomTypes = [], building = '', buildingName = '' } = nativeState || {};
  
  // Find first concrete room type (not empty string)
  const firstConcreteType = roomTypes.find(t => t && t.trim() !== '') || '';
  
  return {
    roomType: firstConcreteType,
    building,
    buildingName
  };
}

/**
 * Generate status bar text based on loading state.
 * @param {object} state
 * @param {number} state.loaded - Number of rooms loaded
 * @param {number} state.total - Total number of rooms
 * @param {number} state.inFlight - Number of requests in flight (0 or 1)
 * @param {number} state.failed - Number of failed room loads
 * @returns {string}
 */
function queueStatus({ loaded = 0, total = 0, inFlight = 0, failed = 0 }) {
  if (total === 0) {
    return '0 rooms';
  }
  
  const parts = [];
  
  // Show total rooms and loading progress
  if (loaded + failed >= total) {
    // All rooms accounted for
    parts.push(`${loaded}/${total} rooms loaded`);
  } else {
    // Still loading
    parts.push(`${total} rooms · loading slots ${loaded}/${total}`);
  }
  
  if (inFlight > 0) {
    parts.push(`${inFlight} request${inFlight !== 1 ? 's' : ''} in flight`);
  } else if (loaded + failed >= total) {
    // All rooms accounted for (loaded or failed)
    if (failed > 0) {
      parts.push(`${failed} failed`);
    } else {
      parts.push('Done');
    }
  } else {
    // Still loading, not all rooms accounted for, no requests in flight
    parts.push('idle');
  }
  
  return parts.join(' · ');
}

// --- Exports: browser (globalThis) AND Node (module.exports, guarded) --------

const RBS_NATIVE = {
  RBS_CONTROL_IDS,
  RBS_ENDPOINTS,
  DEFAULT_WINDOW,
  SLOT_STATUS,
  NATIVE_HIDE_SELECTORS,
  FORBIDDEN_CLICK_IDS,
  WEEKDAY_INITIALS,
  formatDate,
  formatWindow,
  timeToMinutes,
  minutesToTime,
  normalizeText,
  buildSearchPayload,
  buildSlotPayload,
  encodeForm,
  parseRooms,
  parseSlots,
  classifySlotStatus,
  buildSlotAxis,
  alignSlots,
  buildBoardModel,
  classifyEmpty,
  hasAnyFreeCell,
  slotCacheKey,
  createSlotQueue,
  buildDateChips,
  rangeToWindow,
  rangeHasConflict,
  keyToAction,
  shouldRevealNative,
  shouldRevealNativeOnFailure,
  selfCheck,
  filterRooms,
  axisGridTemplate,
  buildAxisHeaderCells,
  hasShoelace,
  defaultForm,
  queueStatus,
};

// Expose each on globalThis for the content script / panel.js.
if (typeof globalThis !== 'undefined') {
  for (const [key, val] of Object.entries(RBS_NATIVE)) {
    globalThis[key] = val;
  }
  globalThis.RBS_NATIVE = RBS_NATIVE;
}

// Node / CommonJS, guarded so the browser never trips on `module`.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RBS_NATIVE;
}
