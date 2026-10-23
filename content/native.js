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
 * Parse a single candidate row's text into a room record, or null if it is not
 * a real full room row.
 *
 * Rule 4: real rows match /<type> Capacity: N/ and contain BOTH a "/" and
 * "Capacity:". A bare "Capacity: 81" fragment (no "/") is a nested badge and
 * must be rejected BEFORE deduping.
 *
 * A full row looks like: "E2-05-12/ICT Laboratory Capacity: 81 Name"
 * We take the room name as everything up to the first "/", and the capacity as
 * the integer following "Capacity:".
 *
 * @param {string} rawText
 * @returns {{name: string, capacity: number}|null}
 */
function parseRowText(rawText) {
  const text = normalizeText(rawText);
  if (!text) return null;

  // Must contain both a "/" and "Capacity:" to be a full row (rule 4).
  if (text.indexOf('/') === -1) return null;
  const capMatch = /Capacity:\s*(\d+)/.exec(text);
  if (!capMatch) return null;

  const capacity = parseInt(capMatch[1], 10);
  if (!Number.isFinite(capacity)) return null;

  // Room name is the token before the first "/".
  const name = normalizeText(text.split('/')[0]);
  if (!name) return null;

  // Defensive: never let a parsed name carry "Capacity:" into the name column.
  if (/Capacity:/i.test(name)) return null;

  return { name, capacity };
}

/**
 * Extract candidate row texts from a results HTML string.
 *
 * In the browser this would walk the live DOM; for portability (Node tests) we
 * accept an HTML string and extract the text of each table row / anchor row.
 * We intentionally gather a superset and let parseRowText() reject non-rows.
 *
 * @param {string} html
 * @returns {string[]}
 */
function extractCandidateRowTexts(html) {
  const out = [];
  const src = String(html == null ? '' : html);

  // Grab the inner text of each <tr>...</tr> and each standalone <a>...</a>.
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
 * Parse results HTML into the unique list of rooms.
 *
 * Steps (order matters, rule 4):
 *   1. Extract candidate row texts.
 *   2. Keep only rows that parse as a full room row (have "/" and "Capacity:").
 *   3. Dedupe by room name (keeps the first / largest-capacity seen per name).
 *
 * @param {string} html
 * @returns {Array<{name: string, capacity: number}>}
 */
function parseResults(html) {
  const candidates = extractCandidateRowTexts(html);

  const parsed = [];
  for (const text of candidates) {
    const row = parseRowText(text);
    if (row) parsed.push(row);
  }

  // Dedupe by name. If the same name appears twice, keep the max capacity
  // (defensive; capacities for the same room should match).
  const byName = new Map();
  for (const row of parsed) {
    const existing = byName.get(row.name);
    if (!existing || row.capacity > existing.capacity) {
      byName.set(row.name, row);
    }
  }

  return Array.from(byName.values());
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
    .sort((a, b) => b.capacity - a.capacity || a.name.localeCompare(b.name));
}

/**
 * Decide what an empty "Available" result means.
 *
 * The RBS "No resources ... found" toast persists across searches (rule 5), so
 * we must decide from row counts only. We re-run the same window with
 * bookingstatus=All: if that has rows, the category/date HAS rooms but they are
 * taken for the window -> "all booked". If even All has zero rows, the
 * category/date simply has nothing -> "no such rooms".
 *
 * @param {object} counts
 * @param {number} counts.rowsWithAll     rooms found with bookingstatus=All
 * @param {number} counts.rowsAvailable   rooms found with bookingstatus=Available
 * @returns {"all booked"|"no such rooms"|"has availability"}
 */
function classifyEmpty(counts) {
  counts = counts || {};
  const rowsWithAll = Number(counts.rowsWithAll) || 0;
  const rowsAvailable = Number(counts.rowsAvailable) || 0;

  if (rowsAvailable > 0) return 'has availability';
  if (rowsWithAll > 0) return 'all booked';
  return 'no such rooms';
}

// --- Exports: browser (globalThis) AND Node (module.exports, guarded) --------

const RBS_NATIVE = {
  RBS_CONTROL_IDS,
  POSTBACK_SETTLE_MS,
  formatDate,
  formatWindow,
  timeToMinutes,
  buildSearchPlan,
  parseRowText,
  extractCandidateRowTexts,
  parseResults,
  filterAndSortRooms,
  classifyEmpty,
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
