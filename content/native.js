/*
 * content/native.js
 *
 * The WebForms driving + parsing layer for RBS Room Finder.
 *
 * Everything meaningful here is a PURE function so it can run in both the
 * browser (as a content script) and in Node (for `node --test tests/`).
 *
 * RBS is an ASP.NET WebForms app. Search is a POSTBACK: clicking
 * `#btnBookingMainSearch` posts the whole form (with __VIEWSTATE) and the
 * server re-renders the page. These helpers describe HOW to drive the native
 * controls and HOW to parse the re-rendered DOM. The actual DOM mutation and
 * clicking lives in panel.js, which consumes buildSearchPlan() output.
 *
 * Native page contract (verified on the live site), do NOT weaken:
 *   #resourceType       option values are GUIDs -> select by option TEXT
 *   #searchSlotDate     text input, format "22 Oct 2026"
 *   #SearchHoursFrom    option values are indices -> select by option TEXT ("14:00")
 *   #SearchHoursTo      same
 *   #bookingstatus      "All" / "Available"
 *   #srcCapacity        leave blank; filter rows after parsing
 *   #btnBookingMainSearch  click it
 */

'use strict';

/** The native control ids the extension depends on. */
const RBS_CONTROL_IDS = Object.freeze({
  resourceType: 'resourceType',
  date: 'searchSlotDate',
  start: 'SearchHoursFrom',
  end: 'SearchHoursTo',
  status: 'bookingstatus',
  capacity: 'srcCapacity',
  capacityOperator: 'srcCapacityOperator',
  searchButton: 'btnBookingMainSearch',
});

/** Milliseconds to wait after each control change so the postback re-renders. */
const POSTBACK_SETTLE_MS = 1200;

/** Ceiling for waiting on a Search postback to re-render (ms). */
const RESULTS_POLL_TIMEOUT_MS = 15000;

/** How often to poll for the re-rendered results (ms). */
const RESULTS_POLL_INTERVAL_MS = 250;

/** The persistent "nothing free" toast text (rule 5: it lies across searches). */
const NO_RESULTS_RE = /No resources with available time slots found/i;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Format a Date as the RBS date-input format, e.g. "22 Oct 2026".
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
 * Format a time window for display, e.g. "14:00–16:00" (en dash).
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
 * Build the ordered list of control mutations to apply before clicking Search.
 *
 * The order matters: each mutation triggers a postback and the caller must wait
 * POSTBACK_SETTLE_MS between them, then re-read all values before clicking.
 *
 * @param {object} opts
 * @param {string} opts.roomType     option TEXT for #resourceType (e.g. "Discussion Room")
 * @param {string} opts.date         e.g. "22 Oct 2026"
 * @param {string} opts.start        option TEXT for #SearchHoursFrom (e.g. "14:00")
 * @param {string} opts.end          option TEXT for #SearchHoursTo (e.g. "16:00")
 * @param {number|string} [opts.minCapacity] optional, filtered after parse (not a mutation)
 * @param {string[]} [opts.knownRoomTypes] option texts read from #resourceType; validated if provided
 * @param {string} [opts.status]     "Available" (default) or "All"
 * @returns {{mutations: Array, settleMs: number, minCapacity: number, status: string}}
 */
function buildSearchPlan(opts) {
  opts = opts || {};
  const { roomType, date, start, end } = opts;

  if (!roomType || typeof roomType !== 'string') {
    throw new Error('buildSearchPlan: roomType is required');
  }
  if (Array.isArray(opts.knownRoomTypes) && opts.knownRoomTypes.length > 0) {
    if (!opts.knownRoomTypes.includes(roomType)) {
      throw new Error(
        `Unknown room type "${roomType}". Available: ${opts.knownRoomTypes.join(', ')}`
      );
    }
  }
  if (!date || typeof date !== 'string') {
    throw new Error('buildSearchPlan: date is required');
  }

  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  if (isNaN(startMin)) {
    throw new Error(`buildSearchPlan: invalid start time "${start}"`);
  }
  if (isNaN(endMin)) {
    throw new Error(`buildSearchPlan: invalid end time "${end}"`);
  }
  if (endMin <= startMin) {
    throw new Error(`End time (${end}) must be after start time (${start})`);
  }

  const status = opts.status === 'All' ? 'All' : 'Available';

  let minCapacity = Number(opts.minCapacity);
  if (!Number.isFinite(minCapacity) || minCapacity < 0) {
    minCapacity = 0;
  }

  // Ordered mutations. Each is a {id, kind, by, value}:
  //  - kind "select-by-text": set a <select> to the option whose TEXT === value
  //  - kind "set-text":       set an <input> value
  const mutations = [
    { id: RBS_CONTROL_IDS.resourceType, kind: 'select-by-text', value: roomType },
    { id: RBS_CONTROL_IDS.date, kind: 'set-text', value: date },
    { id: RBS_CONTROL_IDS.start, kind: 'select-by-text', value: start },
    { id: RBS_CONTROL_IDS.end, kind: 'select-by-text', value: end },
    { id: RBS_CONTROL_IDS.status, kind: 'select-by-text', value: status },
  ];

  return {
    mutations,
    settleMs: POSTBACK_SETTLE_MS,
    minCapacity,
    status,
  };
}

/**
 * Collapse whitespace in a string and trim.
 * @param {string} s
 * @returns {string}
 */
function normalizeText(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/**
 * Build a full room record from a composed "NAME/TYPE" string and a capacity.
 * Splits on the FIRST "/": room = before, type = after (both trimmed).
 * Returns null if the shape is unusable or the name would carry "Capacity:".
 *
 * @param {string} nameText  e.g. "E2-03-07-DR209/Discussion Room"
 * @param {number} capacity
 * @returns {{name: string, room: string, type: string, capacity: number}|null}
 */
function makeRoomRecord(nameText, capacity) {
  const name = normalizeText(nameText);
  if (!name) return null;
  if (name.indexOf('/') === -1) return null;
  if (!Number.isFinite(capacity)) return null;
  // Never let a parsed name carry "Capacity:" into the name column.
  if (/Capacity:/i.test(name)) return null;

  const slash = name.indexOf('/');
  const room = normalizeText(name.slice(0, slash));
  const type = normalizeText(name.slice(slash + 1));
  if (!room) return null;

  return { name, room, type, capacity };
}

/**
 * Parse a single candidate row's inline text into a room record, or null.
 *
 * This is the FALLBACK path for text-only rows where the whole thing lives in
 * one text node, e.g. "E2-05-12/ICT Laboratory Capacity: 81 Name". The room
 * name is taken as "NAME/TYPE" up to (but not including) "Capacity:".
 *
 * The live site does NOT use this shape (see parseCardsFromHtml), but we keep
 * it working so text-only captures still parse.
 *
 * @param {string} rawText
 * @returns {{name: string, room: string, type: string, capacity: number}|null}
 */
function parseRowText(rawText) {
  const text = normalizeText(rawText);
  if (!text) return null;

  // Must contain both a "/" and "Capacity:" to be a full inline row.
  if (text.indexOf('/') === -1) return null;
  const capMatch = /Capacity:\s*(\d+)/.exec(text);
  if (!capMatch) return null;

  const capacity = parseInt(capMatch[1], 10);
  if (!Number.isFinite(capacity)) return null;

  // "NAME/TYPE" is everything before "Capacity:".
  const nameText = normalizeText(text.slice(0, capMatch.index));
  return makeRoomRecord(nameText, capacity);
}

/**
 * Parse the PRIMARY (live-site) Bootstrap-card shape from an HTML string.
 *
 * Each room is a card where the name lives in `div.resourceName`
 * ("NAME/TYPE") and the capacity lives in a following sibling element as
 * "Capacity: N". We locate each `resourceName`, then search the HTML AFTER it
 * for the first "Capacity: N" (which belongs to that card). Rooms are returned
 * in document order.
 *
 * @param {string} src
 * @returns {Array<{name:string,room:string,type:string,capacity:number}>}
 */
function parseCardsFromHtml(src) {
  const out = [];
  // Match the text inside each <div class="... resourceName ...">...</div>.
  // class attribute may contain other tokens, so match on the token.
  const nameRe =
    /<div\b[^>]*class="[^"]*\bresourceName\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = nameRe.exec(src)) !== null) {
    const nameText = normalizeText(m[1].replace(/<[^>]*>/g, ' '));
    if (!nameText || nameText.indexOf('/') === -1) continue;

    // Capacity belongs to this card: the first "Capacity: N" appearing AFTER
    // this resourceName in document order.
    const after = src.slice(nameRe.lastIndex);
    const capMatch = /Capacity:\s*(\d+)/.exec(after);
    if (!capMatch) continue;
    const capacity = parseInt(capMatch[1], 10);

    const rec = makeRoomRecord(nameText, capacity);
    if (rec) out.push(rec);
  }
  return out;
}

/**
 * Extract candidate inline-row texts (FALLBACK path) from an HTML string.
 *
 * Grabs the text of each <tr>...</tr> and standalone <a>...</a>. We gather a
 * superset and let parseRowText() reject non-rows.
 *
 * @param {string} html
 * @returns {string[]}
 */
function extractCandidateRowTexts(html) {
  const out = [];
  const src = String(html == null ? '' : html);

  const stripTags = (chunk) => normalizeText(chunk.replace(/<[^>]*>/g, ' '));

  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(src)) !== null) {
    out.push(stripTags(m[1]));
  }

  const aRe = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = aRe.exec(src)) !== null) {
    out.push(stripTags(m[1]));
  }

  return out;
}

/**
 * Dedupe room records by `room` code, preserving first-seen (document) order.
 * On a collision keep the larger capacity (defensive; should match).
 * @param {Array} records
 * @returns {Array}
 */
function dedupeRooms(records) {
  const byRoom = new Map();
  for (const rec of records) {
    const existing = byRoom.get(rec.room);
    if (!existing) {
      byRoom.set(rec.room, rec);
    } else if (rec.capacity > existing.capacity) {
      // Replace value but keep original insertion order.
      byRoom.set(rec.room, rec);
    }
  }
  return Array.from(byRoom.values());
}

/**
 * Parse results HTML into the unique list of rooms, in document order.
 *
 * The PRIMARY path is the live Bootstrap-card shape (div.resourceName + a
 * following "Capacity: N"). If no cards are found we fall back to the
 * inline-text/table-row shape for text-only captures. Finally we dedupe by
 * the `room` code.
 *
 * @param {string} html
 * @returns {Array<{name:string,room:string,type:string,capacity:number}>}
 */
function parseResults(html) {
  const src = String(html == null ? '' : html);

  // Primary: Bootstrap cards (the real site).
  let records = parseCardsFromHtml(src);

  // Fallback: inline text rows / anchors (text-only captures).
  if (records.length === 0) {
    const candidates = extractCandidateRowTexts(src);
    records = [];
    for (const text of candidates) {
      const rec = parseRowText(text);
      if (rec) records.push(rec);
    }
  }

  return dedupeRooms(records);
}

/**
 * Filter rooms by minimum capacity and sort by capacity descending.
 * @param {Array<{name:string,capacity:number}>} rooms
 * @param {number} minCapacity
 * @returns {Array<{name:string,capacity:number}>}
 */
function filterAndSortRooms(rooms, minCapacity) {
  const min = Number.isFinite(Number(minCapacity)) ? Number(minCapacity) : 0;
  return rooms
    .filter((r) => r.capacity >= min)
    .sort(
      (a, b) =>
        b.capacity - a.capacity ||
        String(a.room || a.name).localeCompare(String(b.room || b.name))
    );
}

/**
 * Decide what an empty "Available" result means — STRICTLY.
 *
 * The RBS "No resources ... found" toast persists across searches (rule 5), so
 * we decide from row counts, not the toast. BUT a zero-row count is only
 * meaningful if that read was confirmed AFTER the postback re-rendered. A zero
 * that came from a read that timed out (results never rendered) must NEVER be
 * turned into "all booked" or "no such rooms" — that is the confident-wrong-
 * answer failure. Such a case returns "unconfirmed".
 *
 * We re-run the same window with bookingstatus=All: if that has rows, the
 * category/date HAS rooms but they are taken for the window -> "all booked".
 * If even All has zero (confirmed) rows, the category/date has nothing ->
 * "no such rooms".
 *
 * @param {object} counts
 * @param {number}  counts.rowsWithAll        rooms found with bookingstatus=All
 * @param {number}  counts.rowsAvailable      rooms found with bookingstatus=Available
 * @param {boolean} [counts.availableConfirmed=true] the Available read rendered
 * @param {boolean} [counts.allConfirmed=true]       the All read rendered
 * @returns {"has availability"|"all booked"|"no such rooms"|"unconfirmed"}
 */
function classifyEmpty(counts) {
  counts = counts || {};
  const rowsWithAll = Number(counts.rowsWithAll) || 0;
  const rowsAvailable = Number(counts.rowsAvailable) || 0;

  // Default to confirmed only when explicitly true or omitted (back-compat),
  // but treat an explicit false as untrusted.
  const availableConfirmed = counts.availableConfirmed !== false;
  const allConfirmed = counts.allConfirmed !== false;

  if (rowsAvailable > 0) return 'has availability';

  // A zero from an unconfirmed Available read is not a real "none free".
  if (!availableConfirmed) return 'unconfirmed';

  if (rowsWithAll > 0) return 'all booked';

  // Zero on All, but only trust it if the All read was confirmed.
  if (!allConfirmed) return 'unconfirmed';
  return 'no such rooms';
}

/**
 * Does the given text contain the persistent "no resources" marker?
 * @param {string} text
 * @returns {boolean}
 */
function hasNoResultsText(text) {
  return NO_RESULTS_RE.test(String(text == null ? '' : text));
}

/**
 * Build a comparable signature of the current results region.
 *
 * Used to detect when a Search postback has actually re-rendered: the card
 * count AND the concatenated room names must change (or the no-results marker
 * must appear) relative to the pre-click signature.
 *
 * @param {object} snap
 * @param {number} snap.cardCount        number of .resourceName cards
 * @param {string[]} [snap.names]        the room-name texts, in order
 * @param {boolean} snap.noResults       is the no-resources marker present?
 * @returns {string}
 */
function resultsSignature(snap) {
  snap = snap || {};
  const count = Number(snap.cardCount) || 0;
  const names = Array.isArray(snap.names) ? snap.names : [];
  const noRes = snap.noResults ? '1' : '0';
  return `${count}|${noRes}|${names.join('\u241f')}`;
}

/**
 * Poll for a re-rendered results region after a Search click.
 *
 * Pure and testable: all side effects are injected.
 *  - read():  returns a snapshot
 *             { cardCount, names, noResults, readyComplete, searchDisabled }
 *  - now():   returns a millisecond timestamp (monotonic enough for tests)
 *  - sleep(ms): resolves after ms (tests pass an instant stub)
 *
 * Resolution rules:
 *  - "rendered": the card signature differs from the pre-click signature AND
 *    there is at least one card. (Cards appeared / changed.)
 *  - "empty-confirmed": the no-results marker is present AND the page has
 *    finished re-rendering (readyComplete && !searchDisabled), with zero cards.
 *  - "timedOut": neither happened before timeoutMs. The caller must treat this
 *    as UNTRUSTED — never as a real zero.
 *
 * @param {object} deps
 * @param {() => object} deps.read
 * @param {() => number} deps.now
 * @param {(ms:number)=>Promise<void>} deps.sleep
 * @param {string} deps.preSignature            signature taken BEFORE the click
 * @param {number} [deps.timeoutMs]
 * @param {number} [deps.pollMs]
 * @returns {Promise<{status:string, snapshot:object, signature:string, waitedMs:number, rendered:boolean, emptyConfirmed:boolean, timedOut:boolean}>}
 */
async function pollForResults(deps) {
  deps = deps || {};
  const read = deps.read;
  const now = deps.now;
  const sleep = deps.sleep;
  const preSignature = deps.preSignature == null ? '' : String(deps.preSignature);
  const timeoutMs = Number.isFinite(deps.timeoutMs) ? deps.timeoutMs : RESULTS_POLL_TIMEOUT_MS;
  const pollMs = Number.isFinite(deps.pollMs) ? deps.pollMs : RESULTS_POLL_INTERVAL_MS;

  if (typeof read !== 'function' || typeof now !== 'function' || typeof sleep !== 'function') {
    throw new Error('pollForResults: read(), now() and sleep() are required');
  }

  const start = now();
  let snapshot = read();
  let signature = resultsSignature(snapshot);

  const settled = (snap, sig) => {
    const pageDone = snap.readyComplete !== false && snap.searchDisabled !== true;
    const cardCount = Number(snap.cardCount) || 0;

    // Cards appeared or changed => rendered.
    if (cardCount > 0 && sig !== preSignature) {
      return { status: 'rendered', rendered: true, emptyConfirmed: false };
    }
    // No-results marker present AND page finished => empty, confirmed.
    if (snap.noResults && pageDone) {
      return { status: 'empty-confirmed', rendered: false, emptyConfirmed: true };
    }
    return null;
  };

  // Check immediately once (covers already-rendered pages in tests).
  let verdict = settled(snapshot, signature);
  while (!verdict) {
    if (now() - start >= timeoutMs) {
      return {
        status: 'timedOut',
        snapshot,
        signature,
        waitedMs: now() - start,
        rendered: false,
        emptyConfirmed: false,
        timedOut: true,
      };
    }
    await sleep(pollMs);
    snapshot = read();
    signature = resultsSignature(snapshot);
    verdict = settled(snapshot, signature);
  }

  return {
    status: verdict.status,
    snapshot,
    signature,
    waitedMs: now() - start,
    rendered: verdict.rendered,
    emptyConfirmed: verdict.emptyConfirmed,
    timedOut: false,
  };
}

// --- Exports: browser (globalThis) AND Node (module.exports, guarded) --------

const RBS_NATIVE = {
  RBS_CONTROL_IDS,
  POSTBACK_SETTLE_MS,
  RESULTS_POLL_TIMEOUT_MS,
  RESULTS_POLL_INTERVAL_MS,
  NO_RESULTS_RE,
  formatDate,
  formatWindow,
  timeToMinutes,
  buildSearchPlan,
  makeRoomRecord,
  parseRowText,
  parseCardsFromHtml,
  extractCandidateRowTexts,
  dedupeRooms,
  parseResults,
  filterAndSortRooms,
  classifyEmpty,
  hasNoResultsText,
  resultsSignature,
  pollForResults,
  normalizeText,
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
