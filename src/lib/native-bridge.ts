/*
 * src/lib/native-bridge.ts
 *
 * Read-only bridge to the tested data layer (content/native.js) and the native
 * RBS page DOM. content/native.js assigns every export onto globalThis, so in
 * the content-script isolated world (and in the CDP harness, which injects
 * native.js first) these are plain globals.
 *
 * `readRoomTypes` / `readWindowOptions` are private to content/panel.js and NOT
 * exported, so we re-read them from the DOM here using the exported
 * RBS_CONTROL_IDS. We deliberately do not touch content/native.js.
 */

type WindowOptions = { from: string[]; to: string[] };

interface RbsControlIds {
  resourceType: string;
  date: string;
  start: string;
  end: string;
  status: string;
  capacity: string;
  building: string;
  campus: string;
  searchButton: string;
  [k: string]: string;
}

interface DefaultWindow {
  start: string;
  end: string;
}

/**
 * A form the Nova skin hands to the panel engine via the bridge. Every field is
 * optional: the panel only applies the ones that are present.
 */
export interface BridgeForm {
  building?: string;
  roomType?: string;
  minCapacity?: number;
  search?: string;
  date?: string;
  window?: { start: string; end: string };
  sort?: string;
}

/** Live native page state the bridge reports back to the skin. */
export interface BridgeState {
  roomTypes: NativeOption[];
  windowOptions: WindowOptions;
  buildings: NativeOption[];
  building: string;
  buildingName: string;
  date: string;
}

/**
 * The ONE narrow seam content/panel.js exposes for Nova. It is created inside
 * panel.js's IIFE before Nova mounts, so it is present whenever the skin runs.
 */
export interface RbsBridge {
  version: number;
  readState(): BridgeState;
  applyForm(form: BridgeForm): void;
  requestReload(reason?: string): void;
  subscribe(fn: (e: { reason: string; state: BridgeState }) => void): () => void;
  eventName: string;
}

/** A parsed room record (content/native.js parseRooms output, fields we use). */
export interface Room {
  id: string;
  name: string;
  serial: string;
  capacity: number;
  typeId: string;
  type: string;
  building: string;
  isBkgrul: boolean;
  isSld: boolean;
  bookable: boolean;
  permitted: boolean;
}

/** A parsed slot record (content/native.js parseSlots output). */
export interface Slot {
  time: string;
  status: number;
  state: 'free' | 'taken' | 'closed' | 'unknown';
  sltId: string;
  dateTime: string;
  quota: number;
}

/** The form the board engine consumes. */
export interface BoardForm {
  building: string;
  roomType: string;
  minCapacity: number;
  search: string;
  date: string;
  window: { start: string; end: string };
  sort: string;
}

// Globals published by content/native.js (see its export block) and the bridge
// published by content/panel.js. content/native.js assigns every export onto
// globalThis, so in the isolated world (and the CDP harness, which injects
// native.js first) these are plain globals we read through here.
declare global {
  interface Window {
    RBS_CONTROL_IDS?: RbsControlIds;
    RBS_ENDPOINTS?: { searchList: string; slotList: string };
    DEFAULT_WINDOW?: DefaultWindow;
    buildDateChips?: (start: Date, count: number) => DateChip[];
    __rbsBridge?: RbsBridge;

    // Pure data-layer helpers from content/native.js.
    buildSearchPayload?: (fields: Record<string, unknown>) => Record<string, string>;
    buildSlotPayload?: (
      room: unknown,
      date: string,
      window: { start: string; end: string },
      status: string,
      token: string
    ) => Record<string, string>;
    encodeForm?: (fields: Record<string, string>) => string;
    parseRooms?: (json: unknown) => Room[];
    parseSlots?: (json: unknown) => Slot[];
    buildSlotAxis?: (start: string, end: string) => string[];
    alignSlots?: (axis: string[], slots: Slot[]) => (Slot | null)[];
    slotCacheKey?: (roomId: string, date: string, window: unknown, status: string) => string;
    axisGridTemplate?: (axis: string[]) => string;
    buildAxisHeaderCells?: (axis: string[]) => { isHour: boolean; label: string }[];
    rangeToWindow?: (
      axis: string[],
      fromIdx: number,
      toIdx: number
    ) => { start: string; end: string; count: number };
    rangeHasConflict?: (slots: (Slot | null)[], fromIdx: number, toIdx: number) => boolean;
    keyToAction?: (key: string, ctx: { inInput?: boolean }) => string | null;
    filterRooms?: (
      rooms: Room[],
      roomType: string,
      minCapacity: number,
      facilityTypes: string[]
    ) => Room[];
    queueStatus?: (s: {
      loaded?: number;
      total?: number;
      inFlight?: number;
      failed?: number;
    }) => string;
    timeToMinutes?: (hhmm: string) => number;
    createSlotQueue?: (opts: unknown) => SlotQueue;
    NATIVE_HIDE_SELECTORS?: string[];
    FORBIDDEN_CLICK_IDS?: string[];
  }
}

/** The single-flight slot queue created by content/native.js createSlotQueue. */
export interface SlotQueue {
  enqueue(rooms: Room[] | Room): void;
  prioritize(roomId: string): void;
  bumpGeneration(): number;
  run(): Promise<void>;
  cache: Map<string, Slot[]>;
  stats: { maxInFlight: number; fetches: number };
  readonly generation: number;
  readonly inFlight: number;
  readonly remaining: number;
}

const g = globalThis as unknown as Window;

/** The two JSON endpoints (same-origin paths), from content/native.js. */
export const ENDPOINTS = g.RBS_ENDPOINTS ?? {
  searchList: '/SRB001/SearchSRB001List',
  slotList: '/SRB001/GetTimeSlotListByresidNdatetime',
};

/** The board's always-drawn axis; the chosen window only dims cells outside it. */
export const DAY_WINDOW: DefaultWindow = { start: '07:00', end: '22:30' };

/** Convert "HH:MM" to minutes since midnight (native.js, with a fallback). */
export function timeToMinutes(hhmm: string): number {
  if (typeof g.timeToMinutes === 'function') return g.timeToMinutes(hhmm);
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Build the shared half-hour axis for a window (native.js buildSlotAxis). */
export function buildSlotAxis(start: string, end: string): string[] {
  if (typeof g.buildSlotAxis === 'function') return g.buildSlotAxis(start, end);
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  const out: string[] = [];
  for (let m = s; m <= e - 60; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}

/** The grid-template-columns shared by header and rows (room column + N tracks). */
export function axisGridTemplate(axis: string[]): string {
  if (typeof g.axisGridTemplate === 'function') return g.axisGridTemplate(axis);
  return `200px repeat(${axis.length}, minmax(0, 1fr))`;
}

/**
 * One classified axis cell, shared by BOTH the sticky header and every data
 * row so a header cell and the cell beneath it always agree on their divider
 * weight (defect A).
 *
 * The axis runs 07:00, 07:30, 08:00, ... in 30-minute steps. An "hour block"
 * is the pair {:00, :30}; the STRONG (thick) divider belongs at the END of each
 * block — i.e. on the `:30` cell — so blocks read as 07:00|07:30 ‖ 08:00|08:30.
 * The `:00` cell gets only a THIN divider (the inner split of a block).
 *
 *   - blockEnd: true on a `:30` cell -> thick border-right (end of the hour).
 *   - label / isHourStart: the `:00` start of a block, used only for the header
 *     label emphasis (not the divider).
 *
 * We deliberately do NOT use content/native.js buildAxisHeaderCells here: it
 * marks `:00` as the hour cell (the OLD, wrong boundary) and content/native.js
 * is frozen for this task. This shared reader is the single source of truth the
 * header and rows both consume.
 */
export interface AxisCell {
  label: string;
  /** Start of an hour block (label ends in ":00"). */
  isHourStart: boolean;
  /** End of an hour block (label ends in ":30"): the STRONG divider cell. */
  blockEnd: boolean;
}

export function axisCells(axis: string[]): AxisCell[] {
  if (!Array.isArray(axis)) return [];
  return axis.map((label) => ({
    label,
    isHourStart: /:00$/.test(label),
    blockEnd: /:30$/.test(label),
  }));
}

/** Align a room's slots onto the axis (native.js alignSlots). */
export function alignSlots(axis: string[], slots: Slot[]): (Slot | null)[] {
  if (typeof g.alignSlots === 'function') return g.alignSlots(axis, slots);
  const by = new Map<string, Slot>();
  for (const s of slots || []) if (s && !by.has(s.time)) by.set(s.time, s);
  return axis.map((l) => (by.has(l) ? by.get(l)! : null));
}

/** Cache key for one room's slots: rsrcId|date|window|status (native.js). */
export function slotCacheKey(
  roomId: string,
  date: string,
  window: { start: string; end: string },
  status: string
): string {
  if (typeof g.slotCacheKey === 'function') return g.slotCacheKey(roomId, date, window, status);
  return `${roomId}|${date}|${window ? `${window.start}-${window.end}` : ''}|${status}`;
}

/** rangeToWindow / rangeHasConflict / keyToAction / queueStatus from native.js. */
export function rangeToWindow(
  axis: string[],
  fromIdx: number,
  toIdx: number
): { start: string; end: string; count: number } {
  return g.rangeToWindow
    ? g.rangeToWindow(axis, fromIdx, toIdx)
    : { start: axis[fromIdx] ?? '', end: axis[toIdx] ?? '', count: Math.abs(toIdx - fromIdx) + 1 };
}
export function rangeHasConflict(slots: (Slot | null)[], fromIdx: number, toIdx: number): boolean {
  return g.rangeHasConflict ? g.rangeHasConflict(slots, fromIdx, toIdx) : false;
}
export function keyToAction(key: string, ctx: { inInput?: boolean }): string | null {
  return g.keyToAction ? g.keyToAction(key, ctx) : null;
}
export function queueStatus(s: {
  loaded?: number;
  total?: number;
  inFlight?: number;
  failed?: number;
}): string {
  return g.queueStatus ? g.queueStatus(s) : `${s.loaded ?? 0}/${s.total ?? 0} rooms`;
}

// --- Live API layer: same-origin POSTs, mirroring content/panel.js ----------

/** Read the FRESH anti-forgery token before each request. */
function readToken(): string {
  const input = document.querySelector('input[name=__RequestVerificationToken]') as HTMLInputElement | null;
  return input ? input.value || '' : '';
}

/** Read a native control's current value by id. */
function readIdValue(id: string): string {
  const node = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  return node ? node.value || '' : '';
}

/** Error carrying the HTTP status so the UI can report "HTTP n". */
export class ApiError extends Error {
  httpStatus: number;
  /** True when the response was the RBS 'Session Timeout/Error!' page (HTML at
   *  HTTP 200, or the session-dialog markup) returned instead of JSON — i.e. the
   *  SIT session expired mid-use. The board renders a dedicated recovery state
   *  for this, never a generic 'unparseable JSON' or a zero-room 'No rooms'. */
  sessionExpired: boolean;
  constructor(message: string, httpStatus: number, sessionExpired = false) {
    super(message);
    this.name = 'ApiError';
    this.httpStatus = httpStatus;
    this.sessionExpired = sessionExpired;
  }
}

/**
 * Does this response body look like the RBS 'Session Timeout/Error!' page
 * rather than data? RBS answers an expired session with that page as HTML at
 * HTTP 200 (the availability POSTs stop returning JSON). We match either a raw
 * HTML document or the session-dialog markers in its body.
 */
export function bodyIsSessionError(text: string): boolean {
  if (!text) return false;
  if (/^\s*<(!doctype|html)/i.test(text)) return true;
  if (/Session\s*Timeout\/Error!/i.test(text)) return true;
  if (/sessiontimeout/i.test(text)) return true;
  return false;
}

async function postForm(endpoint: string, fields: Record<string, string>): Promise<unknown> {
  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      // Never serve a stale (expired) response from the HTTP cache: a Reload
      // after signing back in must hit the live backend.
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: g.encodeForm ? g.encodeForm(fields) : new URLSearchParams(fields).toString(),
    });
  } catch {
    throw new ApiError('network error contacting RBS', 0);
  }
  if (!resp.ok) throw new ApiError(`the RBS API returned an error (HTTP ${resp.status})`, resp.status);
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    // A 200 (or any status) carrying the RBS error page instead of JSON means
    // the SIT session expired mid-use. Tag it so the board can show a dedicated
    // 'Session expired' recovery state instead of a confusing parse error.
    if (bodyIsSessionError(text)) {
      throw new ApiError(
        'Your SIT session has expired, so RBS returned its sign-in page instead of data.',
        resp.status,
        true
      );
    }
    throw new ApiError('the RBS API returned an error (unparseable JSON)', resp.status);
  }
}

/** Fetch the room list for a form. Returns parseRooms() output.
 *
 * Every filter the top bar can set is driven straight from `form` into the POST
 * body, so a control change is actually applied on the wire — not read back
 * from the (now hidden) native DOM, which nova never mutates. Only `campusID`
 * still comes from the native page, since nova exposes no campus control and
 * the native campus value is the single source of truth for it.
 *
 * The chosen min capacity is sent as the server's MinCapacity bound; the free
 * text goes in Search. Both are ALSO applied client-side (applyClientFilters)
 * so the board stays correct even against a server that ignores them. */
export async function fetchRooms(form: BoardForm): Promise<Room[]> {
  const minCap = form.minCapacity > 0 ? String(form.minCapacity) : '';
  const fields = (g.buildSearchPayload as NonNullable<Window['buildSearchPayload']>)({
    token: readToken(),
    capacityOperator: 'between',
    minCapacity: minCap,
    maxCapacity: '',
    singleCapacity: '',
    campusID: readIdValue(CONTROL_IDS.campus),
    // Building comes from the form (the nova control), NOT the native select —
    // nova owns the page and never writes the native #building, so reading it
    // back would always be '' and every control would be cosmetic.
    buildingID: form.building ? String(form.building) : '',
    facilities: 'facilities',
    status: 'All',
    search: form.search ? String(form.search) : '',
    resourceType: form.roomType ? String(form.roomType).replace(/_/g, ' ') : '',
    date: form.date,
    start: DAY_WINDOW.start,
    end: DAY_WINDOW.end,
  });
  // Keep the native #building in sync (best-effort) so the booking handoff,
  // which clicks the native room card, stays consistent with the nova filter.
  syncNativeBuilding(form.building ?? '');
  const json = await postForm(ENDPOINTS.searchList, fields);
  return g.parseRooms ? g.parseRooms(json) : [];
}

/** Best-effort: mirror the chosen building into the native select so the
 *  booking handoff operates on the same building the nova filter shows. Never
 *  throws; the nova fetch already carries the value independently. */
function syncNativeBuilding(building: string): void {
  try {
    const sel = document.getElementById(CONTROL_IDS.building) as HTMLSelectElement | null;
    if (!sel) return;
    const want = building || '';
    if (sel.value === want) return;
    const exists = Array.from(sel.options).some((o) => o.value === want);
    if (exists) {
      sel.value = want;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } catch {
    /* non-fatal */
  }
}

/** Fetch one room's slots (always the full day window). parseSlots() output. */
export async function fetchSlots(room: Room, date: string): Promise<Slot[]> {
  const fields = (g.buildSlotPayload as NonNullable<Window['buildSlotPayload']>)(
    room,
    date,
    DAY_WINDOW,
    'All',
    readToken()
  );
  const json = await postForm(ENDPOINTS.slotList, fields);
  return g.parseSlots ? g.parseSlots(json) : [];
}

/** Create the single-flight slot queue from content/native.js. */
export function createSlotQueue(opts: {
  fetcher: (room: Room) => Promise<Slot[]>;
  date: string;
  window: { start: string; end: string };
  status: string;
  cache?: Map<string, Slot[]>;
  onLoaded?: (roomId: string, slots: Slot[]) => void;
  onError?: (roomId: string, error: Error) => void;
  onProgress?: (done: number, total: number) => void;
  onDone?: (s: { done: number; total: number }) => void;
}): SlotQueue {
  if (typeof g.createSlotQueue !== 'function') {
    throw new Error('createSlotQueue is not available (content/native.js not injected)');
  }
  return g.createSlotQueue(opts);
}

// --- Native page: hide/reveal + booking handoff (never submits) -------------

const NATIVE_HIDE_STYLE_ID = 'rbs-native-hide-nova';
const HOST_ID = 'rbs-room-finder-host';

/**
 * Is the CURRENT document an RBS error or auth page that Nova must never take
 * over? Nova owns every normal path, but the real site's own
 * 'Session Timeout/Error!' dialog and the /Account/Login page are the only way
 * back in after a session expires — hiding them would trap the user. Detect it
 * three ways, any of which is conclusive:
 *
 *   1. the pathname is /Home/ErrorPage or /Account/Login (case-insensitive,
 *      ignoring any trailing segment/query);
 *   2. the URL query carries both `code=` and `exceptionMsg=` (RBS's error
 *      redirect shape, e.g. ?code=1001&exceptionMsg=sessiontimeout);
 *   3. the document body already renders the session dialog — its visible
 *      'Session Timeout/Error!' text, or a `sessiontimeout` marker.
 *
 * Read-only: it inspects location + the DOM and never mutates anything.
 */
export function isErrorOrAuthPage(): boolean {
  try {
    const path = (location.pathname || '').toLowerCase();
    if (path.indexOf('/home/errorpage') !== -1) return true;
    if (path.indexOf('/account/login') !== -1) return true;

    const q = (location.search || '').toLowerCase();
    if (/[?&]code=/.test(q) && /[?&]exceptionmsg=/.test(q)) return true;

    const bodyText = document.body ? document.body.textContent || '' : '';
    if (/Session\s*Timeout\/Error!/i.test(bodyText)) return true;
    if (/sessiontimeout/i.test(bodyText)) return true;
  } catch {
    /* if we cannot tell, fall through — the mount guard treats unknown as safe */
  }
  return false;
}

/**
 * Hide the native RBS page chrome so the Nova app owns the ENTIRE viewport.
 *
 * Two layers, because Nova now owns every path of the origin, not just the
 * search page whose containers the committed NATIVE_HIDE_SELECTORS cover:
 *
 *  1. the known container selectors (header/nav/footer/.body-content/…) get
 *     `display:none !important` — the historical behaviour, kept verbatim;
 *  2. a generic rule hides EVERY direct child of <body> except the Nova host,
 *     and pins the host as a fixed, full-viewport, opaque overlay. This makes
 *     an UNMAPPED page (whose body is arbitrary markup the selectors miss) fully
 *     covered too. Nodes are only hidden, NEVER removed — the native postback
 *     handlers and booking popups must survive, so revealNativeUI() can restore
 *     the exact page for the current URL.
 *
 * The <html> class rbsx-native-hidden is the single on/off signal (matching the
 * repo convention); everything keys off it so revealing is a pure class removal.
 */
export function hideNativeUI(): void {
  try {
    document.documentElement.classList.add('rbsx-native-hidden');
    if (document.getElementById(NATIVE_HIDE_STYLE_ID)) return;
    const selectors = g.NATIVE_HIDE_SELECTORS ?? [
      'header',
      'nav',
      'footer',
      '.body-content',
      '#divRoomInfo',
      '#divSearchContentResult',
      '#divbtnbottom',
    ];
    const rules: string[] = [];
    // Layer 1: the known native containers.
    for (const s of selectors) {
      rules.push(`html.rbsx-native-hidden ${s} { display: none !important; }`);
    }
    // Layer 2: own the whole viewport. Hide every body child that is NOT the
    // Nova host, then make the host a fixed, opaque, full-viewport overlay so
    // no native body content (even on an unmapped page) peeks through.
    rules.push(
      `html.rbsx-native-hidden body > :not(#${HOST_ID}) { display: none !important; }`,
      `html.rbsx-native-hidden #${HOST_ID} {` +
        ' position: fixed !important; inset: 0 !important; z-index: 2147483000 !important;' +
        ' display: block !important; background: #0b0c0e !important; overflow: auto !important;' +
        ' }',
      // Keep the page from scrolling behind the overlay.
      `html.rbsx-native-hidden, html.rbsx-native-hidden body { overflow: hidden !important; margin: 0 !important; }`
    );
    const style = document.createElement('style');
    style.id = NATIVE_HIDE_STYLE_ID;
    style.textContent = rules.join('\n');
    document.head.appendChild(style);
  } catch {
    /* non-fatal */
  }
}

/** Reveal the native RBS page (used by the Native UI escape hatch, the booking
 *  handoff, and the auto-reveal on repeated failure). Removes the hide layer
 *  entirely; the native DOM was only hidden, never removed, so the exact page
 *  for the current URL reappears intact. */
export function revealNativeUI(): void {
  const style = document.getElementById(NATIVE_HIDE_STYLE_ID);
  if (style) style.remove();
  document.documentElement.classList.remove('rbsx-native-hidden');
}

/** Whether Nova is currently hiding the native page. */
export function isNativeHidden(): boolean {
  return document.documentElement.classList.contains('rbsx-native-hidden');
}

function cssEscape(s: string): string {
  const w = window as unknown as { CSS?: { escape?: (v: string) => string } };
  return w.CSS && typeof w.CSS.escape === 'function' ? w.CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

function findNativeCard(rsrcId: string): HTMLElement | null {
  return document.querySelector(`.cardinfoSingle[data-rsrcid="${cssEscape(rsrcId)}"]`);
}

function detailPopupVisible(): boolean {
  const modal = document.getElementById('Modal-detailPopup');
  if (!modal) return false;
  const style = window.getComputedStyle ? window.getComputedStyle(modal) : null;
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  return modal.offsetWidth > 0 || modal.offsetHeight > 0 || modal.classList.contains('show');
}

function selectionBadgeText(): string | null {
  const all = document.body ? document.body.textContent || '' : '';
  const m = /(\d+)\s+Facilit(?:y|ies)\s+Selected/i.exec(all);
  return m ? m[0] : null;
}

function scrollActionBarIntoView(): void {
  const anchor =
    document.getElementById('btnBooking') ||
    Array.from(document.querySelectorAll('span, div, button, a, label')).find((n) =>
      /\d+\s+Facilit(?:y|ies)\s+Selected/i.test((n.textContent || '').trim())
    );
  if (anchor && typeof (anchor as HTMLElement).scrollIntoView === 'function') {
    (anchor as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

export interface HandoffResult {
  ok: boolean;
  signal?: 'detail-popup' | 'badge';
  badge?: string;
  reason?: string;
}

const SELECT_CONFIRM_MS = 2500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Booking HANDOFF ONLY. Reveals the native page, clicks the room CARD, and
 * waits for the native detail popup OR the "N Facility Selected" badge. It
 * NEVER clicks any FORBIDDEN_CLICK_IDS submit button — selection and scroll
 * only. The app never claims success without one of the two native signals.
 */
export async function handoffToNative(room: Room): Promise<HandoffResult> {
  revealNativeUI();
  const card = findNativeCard(room.id);
  if (!card) return { ok: false, reason: 'card-not-found' };

  // Defensive: never operate on a forbidden submit target.
  const forbidden = (g.FORBIDDEN_CLICK_IDS ?? []).some(
    (id) => card.id === id || card.closest('#' + id)
  );
  if (forbidden) return { ok: false, reason: 'refused-forbidden-target' };

  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.click();

  const deadline = Date.now() + SELECT_CONFIRM_MS;
  while (Date.now() < deadline) {
    await sleep(150);
    if (detailPopupVisible()) return { ok: true, signal: 'detail-popup' };
    const badge = selectionBadgeText();
    if (badge) {
      scrollActionBarIntoView();
      return { ok: true, signal: 'badge', badge };
    }
  }
  return { ok: false, reason: 'no-signal' };
}

/** The panel bridge if present (it is installed by content/panel.js on load). */
export function getBridge(): RbsBridge | undefined {
  return (globalThis as unknown as Window).__rbsBridge;
}

export interface DateChip {
  date: Date;
  label: string;
  weekday: string;
  isToday: boolean;
}

/** The native control ids, from content/native.js (with a safe fallback). */
export const CONTROL_IDS: RbsControlIds =
  (globalThis as unknown as Window).RBS_CONTROL_IDS ??
  ({
    resourceType: 'resourceType',
    date: 'searchSlotDate',
    start: 'SearchHoursFrom',
    end: 'SearchHoursTo',
    status: 'bookingstatus',
    capacity: 'srcCapacity',
    building: 'building',
    campus: 'campus',
    searchButton: 'btnBookingMainSearch',
  } as RbsControlIds);

/** The board's default day window, from content/native.js. */
export const DEFAULT_WINDOW: DefaultWindow =
  (globalThis as unknown as Window).DEFAULT_WINDOW ?? { start: '07:00', end: '22:30' };

/** An option read from a native <select>: its TEXT and its underlying value. */
export interface NativeOption {
  value: string;
  text: string;
}

/**
 * Read concrete options from a native <select>, skipping placeholders like
 * "Resource Type", "Please select", or dashed separators. Mirrors the private
 * readOptionTexts in content/panel.js.
 */
function readOptions(id: string): NativeOption[] {
  const sel = document.getElementById(id) as HTMLSelectElement | null;
  if (!sel || !sel.options) return [];
  return Array.from(sel.options)
    .map((o) => ({ value: o.value ?? '', text: (o.textContent || '').trim() }))
    .filter((o) => o.text && !/^-+$/.test(o.text) && !/please select/i.test(o.text) && !/^Resource Type$/i.test(o.text));
}

/** Room types: option TEXTs of #resourceType. '' = "All rooms". */
export function readRoomTypes(): NativeOption[] {
  return readOptions(CONTROL_IDS.resourceType);
}

/** Buildings from #building (minus the "All buildings" placeholder). */
export function readBuildings(): NativeOption[] {
  return readOptions(CONTROL_IDS.building);
}

/** Day-window start/end option texts ("07:00" ... "22:30"). */
export function readWindowOptions(): WindowOptions {
  const isHHMM = (o: NativeOption) => /^\d{2}:\d{2}$/.test(o.text);
  return {
    from: readOptions(CONTROL_IDS.start).filter(isHHMM).map((o) => o.text),
    to: readOptions(CONTROL_IDS.end).filter(isHHMM).map((o) => o.text),
  };
}

/** Build the 14-day date strip via content/native.js buildDateChips. */
export function readDateChips(count = 14): DateChip[] {
  const fn = (globalThis as unknown as Window).buildDateChips;
  const today = new Date();
  if (typeof fn === 'function') return fn(today, count);
  // Fallback if native.js is somehow absent.
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const wd = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    return {
      date: d,
      label: `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`,
      weekday: wd[d.getDay()],
      isToday: i === 0,
    };
  });
}

/** Whether the native search controls exist on the page. */
export function nativeControlsPresent(): boolean {
  return Boolean(document.getElementById(CONTROL_IDS.resourceType));
}

/**
 * Harvest a map of rsrcId -> base64 PNG (no "data:" prefix) from the hidden
 * native result cards. The JSON room API carries no image, so the only source
 * of a room photo is the native result list: each card exposes `data-rsrcid`
 * and `data-imgpath`. Call this AFTER each search, since the native list is
 * re-rendered per query. Returns a plain object keyed by rsrcId.
 *
 * Reads only; never mutates the native DOM. Cards with no imgpath are omitted
 * so the caller can render a neutral placeholder.
 */
export function harvestRoomImages(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const cards = document.querySelectorAll('#resultList [data-rsrcid]');
    cards.forEach((card) => {
      const el = card as HTMLElement;
      const id = el.getAttribute('data-rsrcid') || '';
      if (!id) return;
      const path = (el.getAttribute('data-imgpath') || '').trim();
      if (path) out[id] = path;
    });
  } catch {
    /* non-fatal: no images is a valid state (placeholders render) */
  }
  return out;
}

/** Turn a harvested imgpath (bare base64 PNG) into a data: URI for an <img>. */
export function imgPathToDataUri(imgpath: string): string {
  const p = (imgpath || '').trim();
  if (!p) return '';
  if (/^data:/i.test(p)) return p; // already a data URI (defensive)
  return `data:image/png;base64,${p}`;
}
