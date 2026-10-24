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

// Globals published by content/native.js (see its export block) and the bridge
// published by content/panel.js.
declare global {
  interface Window {
    RBS_CONTROL_IDS?: RbsControlIds;
    DEFAULT_WINDOW?: DefaultWindow;
    buildDateChips?: (start: Date, count: number) => DateChip[];
    __rbsBridge?: RbsBridge;
  }
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
