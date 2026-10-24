import * as React from 'react';
import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  CONTROL_IDS,
  DEFAULT_WINDOW,
  getBridge,
  readBuildings,
  readDateChips,
  readRoomTypes,
  readWindowOptions,
  type BridgeForm,
  type DateChip,
  type NativeOption,
} from '@/lib/native-bridge';

import type { BoardForm } from '@/lib/native-bridge';

const ALL_ROOMS = '__all__'; // Radix Select cannot use "" as an item value.
const ALL_BUILDINGS = '__all_buildings__'; // same: "" is reserved by Radix.

export interface TopBarState {
  building: string;
  roomType: string;
  capacity: string;
  search: string;
  dateIndex: number;
  windowStart: string;
  windowEnd: string;
  sort: string;
}

type WindowOptions = { from: string[]; to: string[] };

/** Shape of the live native page state the top bar renders from. */
interface PageState {
  buildings: NativeOption[];
  roomTypes: NativeOption[];
  windowOpts: WindowOptions;
}

/**
 * Read the live page state straight from the native DOM.
 *
 * We deliberately do NOT use bridge.readState() for the option lists: the
 * panel.js bridge returns room types as bare strings (including the "Resource
 * Type" placeholder) while returning buildings as {value,text} objects, so the
 * two shapes disagree — rendering those strings as NativeOptions produced empty
 * labels and an off-by-one count. native-bridge's readBuildings / readRoomTypes
 * / readWindowOptions are consistent NativeOption readers that also drop
 * placeholders, so reading the DOM directly is both correct and bridge-agnostic
 * (it works whether or not panel.js wired the native cascade).
 */
function readPageState(): PageState {
  return { buildings: readBuildings(), roomTypes: readRoomTypes(), windowOpts: readWindowOptions() };
}

export interface TopBarProps {
  /** Emitted whenever the form changes (and once on mount). The Nova board
   *  consumes this; the engine fetches on its own, so no native reload fires. */
  onForm: (form: BoardForm) => void;
  /** Force a reload with the current form (the explicit Search button), even
   *  when no filter value changed. Without this, clicking Search on an
   *  unchanged form would be a no-op (zero POSTs) — the reported defect. */
  onForceReload?: () => void;
  /** Rendered into the status line (live rooms/failures/in-flight/elapsed). */
  statusLine?: React.ReactNode;
  /** Reveal the native page (hide the app). */
  onRevealNative?: () => void;
  /** Focus hook so the "/" shortcut can focus the search box. */
  searchRef?: React.RefObject<HTMLInputElement>;
}

/**
 * Phase 2B shadcn top bar. Reads real page state through the panel bridge
 * (content/panel.js `window.__rbsBridge`) to populate its selects, and also
 * pushes the form into the bridge so the native controls stay in sync for the
 * booking handoff. The Nova board owns fetching, so this bar does NOT trigger a
 * native reload — it emits a normalised BoardForm through `onForm`.
 */
export function TopBar({ onForm, onForceReload, statusLine, searchRef }: TopBarProps) {
  const dateChips = React.useMemo<DateChip[]>(() => readDateChips(14), []);

  // Live native page state, refreshed whenever the native cascade moves.
  const [page, setPage] = React.useState<PageState>(() => readPageState());
  const { buildings, roomTypes, windowOpts } = page;

  const [state, setState] = React.useState<TopBarState>(() => {
    const init = readPageState();
    return {
      building: init.buildings.find((b) => b.value)?.value ?? ALL_BUILDINGS,
      roomType: init.roomTypes[0]?.value ?? ALL_ROOMS,
      capacity: '0',
      search: '',
      dateIndex: dateChips.findIndex((c) => c.isToday) >= 0 ? dateChips.findIndex((c) => c.isToday) : 0,
      windowStart: init.windowOpts.from.includes(DEFAULT_WINDOW.start)
        ? DEFAULT_WINDOW.start
        : init.windowOpts.from[0] ?? '',
      windowEnd: init.windowOpts.to.includes(DEFAULT_WINDOW.end)
        ? DEFAULT_WINDOW.end
        : init.windowOpts.to[init.windowOpts.to.length - 1] ?? '',
      sort: 'name',
    };
  });

  // Keep the nova selects in sync with the native option lists AFTER load.
  //
  // On the real page the native building / room-type lists are not final at
  // mount: a change cascade populates them ~1s later. A one-time mount snapshot
  // therefore shows only placeholders and looks unselectable (the reported
  // defect). We re-read the native options whenever they move, by BOTH:
  //   - listening for `change` on the native control ids, AND
  //   - polling until the option lists are stable (a ~3s budget), since the
  //     cascade may append options without firing a `change` we can see.
  // Each refresh repopulates the nova selects while KEEPING the current
  // selection whenever it still exists in the new list.
  React.useEffect(() => {
    let cancelled = false;

    // Re-read live options and reconcile the current selection against them.
    const refresh = () => {
      if (cancelled) return;
      const next = readPageState();
      setPage(next);
      setState((s) => {
        const typeStillThere =
          s.roomType === ALL_ROOMS || next.roomTypes.some((t) => (t.value || t.text) === s.roomType);
        const buildingStillThere =
          s.building === ALL_BUILDINGS || next.buildings.some((b) => b.value === s.building);
        const startStillThere = next.windowOpts.from.includes(s.windowStart);
        const endStillThere = next.windowOpts.to.includes(s.windowEnd);
        return {
          ...s,
          building: buildingStillThere ? s.building : ALL_BUILDINGS,
          roomType: typeStillThere ? s.roomType : next.roomTypes[0]?.value ?? ALL_ROOMS,
          windowStart: startStillThere
            ? s.windowStart
            : next.windowOpts.from.includes(DEFAULT_WINDOW.start)
              ? DEFAULT_WINDOW.start
              : next.windowOpts.from[0] ?? '',
          windowEnd: endStillThere
            ? s.windowEnd
            : next.windowOpts.to.includes(DEFAULT_WINDOW.end)
              ? DEFAULT_WINDOW.end
              : next.windowOpts.to[next.windowOpts.to.length - 1] ?? '',
        };
      });
    };

    // The bridge fires on native `change` when panel.js wired it; harmless when
    // it did not. We also attach our OWN listeners so nova does not depend on
    // panel.js having wired the cascade.
    const bridge = getBridge();
    const unsub = bridge ? bridge.subscribe(refresh) : () => {};

    const NATIVE_IDS = [
      CONTROL_IDS.campus,
      CONTROL_IDS.building,
      CONTROL_IDS.resourceType,
      CONTROL_IDS.start,
      CONTROL_IDS.end,
    ];
    const onNativeChange = () => refresh();
    const nodes: HTMLElement[] = [];
    for (const id of NATIVE_IDS) {
      const node = document.getElementById(id);
      if (node) {
        node.addEventListener('change', onNativeChange);
        nodes.push(node);
      }
    }
    // The native page may dispatch a one-shot "ready" signal when the cascade
    // settles; listen for it too (cheap, optional).
    document.addEventListener('rbs:ready', onNativeChange);

    // Poll until the option counts stop changing, within a ~3s budget. This
    // catches cascades that append options without a `change` event we hear.
    const signature = () => {
      const s = readPageState();
      return `${s.buildings.length}|${s.roomTypes.length}|${s.windowOpts.from.length}|${s.windowOpts.to.length}`;
    };
    let lastSig = signature();
    let stableTicks = 0;
    const POLL_MS = 150;
    const BUDGET_MS = 3000;
    let elapsed = 0;
    const timer = setInterval(() => {
      if (cancelled) return;
      elapsed += POLL_MS;
      const sig = signature();
      if (sig !== lastSig) {
        lastSig = sig;
        stableTicks = 0;
        refresh();
      } else {
        stableTicks += 1;
      }
      // Stop once the lists have been stable for a few ticks or the budget ran
      // out, so the poll never runs indefinitely.
      if (elapsed >= BUDGET_MS || stableTicks >= 4) clearInterval(timer);
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      unsub();
      for (const node of nodes) node.removeEventListener('change', onNativeChange);
      document.removeEventListener('rbs:ready', onNativeChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Translate the local Nova state into the BridgeForm (to keep native controls
  // in sync for the booking handoff) and the BoardForm the Nova engine fetches
  // from. Both share the same normalised values.
  const toForm = React.useCallback(
    (s: TopBarState): BoardForm => ({
      building: s.building === ALL_BUILDINGS ? '' : s.building,
      roomType: s.roomType === ALL_ROOMS ? '' : s.roomType,
      minCapacity: Number(s.capacity) || 0,
      search: s.search,
      date: dateChips[s.dateIndex]?.label ?? '',
      window: { start: s.windowStart, end: s.windowEnd },
      sort: s.sort,
    }),
    [dateChips]
  );

  // Emit the initial form once on mount so the board loads immediately.
  const emitted = React.useRef(false);
  React.useEffect(() => {
    if (emitted.current) return;
    emitted.current = true;
    const form = toForm(state);
    getBridge()?.applyForm(form as BridgeForm);
    onForm(form);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply a patch, mirror it into the native controls (for the handoff), and
  // emit the new BoardForm so the Nova board reloads. No native reload fires.
  const drive = React.useCallback(
    (patch: Partial<TopBarState>) => {
      setState((prev) => {
        const nextState = { ...prev, ...patch };
        const form = toForm(nextState);
        getBridge()?.applyForm(form as BridgeForm);
        onForm(form);
        return nextState;
      });
    },
    [toForm, onForm]
  );

  function onSearch() {
    const form = toForm(state);
    getBridge()?.applyForm(form as BridgeForm);
    onForm(form);
    // Explicit Search always re-runs the search, even if no value changed, so
    // the button is never a no-op.
    onForceReload?.();
  }

  return (
    <div
      data-testid="nova-topbar"
      className="flex flex-col gap-2 border-b border-border bg-card px-3 py-2"
    >
      {/* Control row: FILTERS on the left (building · type · capacity · find),
          the QUERY on the right (window · sort · Native UI · Search). Every
          control sits on the same 32px baseline via `items-end` + h-control. */}
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        {/* LEFT GROUP — what to show */}
        <div
          className="flex flex-wrap items-end gap-2"
          data-testid="nova-group-filters"
          role="group"
          aria-label="Filters"
        >
          <Field label="Building">
            <Select
              value={state.building}
              onValueChange={(v) => drive({ building: v === ALL_BUILDINGS ? ALL_BUILDINGS : v })}
            >
              <SelectTrigger className="h-control w-[150px]" data-testid="nova-building">
                <SelectValue placeholder="Building" />
              </SelectTrigger>
              <SelectContent>
                {buildings.map((b, i) => (
                  <SelectItem key={`${b.value || b.text}-${i}`} value={b.value || ALL_BUILDINGS}>
                    {b.text}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Type">
            <Select value={state.roomType} onValueChange={(v) => drive({ roomType: v })}>
              <SelectTrigger className="h-control w-[160px]" data-testid="nova-roomtype">
                <SelectValue placeholder="All rooms" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ROOMS}>All rooms</SelectItem>
                {roomTypes.map((t, i) => (
                  <SelectItem key={`${t.value || t.text}-${i}`} value={t.value || t.text}>
                    {t.text}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Min cap">
            <Input
              type="number"
              min={0}
              value={state.capacity}
              onChange={(e) => drive({ capacity: e.target.value })}
              className="h-control w-[72px] nova-mono"
              data-testid="nova-capacity"
            />
          </Field>

          <Field label="Find">
            <Input
              ref={searchRef}
              type="text"
              placeholder="room name"
              value={state.search}
              onChange={(e) => drive({ search: e.target.value })}
              className="h-control w-[150px]"
              data-testid="nova-search"
            />
          </Field>
        </div>

        {/* RIGHT GROUP — the query + its one primary action */}
        <div
          className="ml-auto flex flex-wrap items-end gap-2"
          data-testid="nova-group-query"
          role="group"
          aria-label="Query"
        >
          <Field label="Window">
            <div className="flex h-control items-center gap-1">
              <Select value={state.windowStart} onValueChange={(v) => drive({ windowStart: v })}>
                <SelectTrigger className="h-control w-[88px] nova-mono" data-testid="nova-window-start">
                  <SelectValue placeholder="start" />
                </SelectTrigger>
                <SelectContent>
                  {windowOpts.from.map((t) => (
                    <SelectItem key={t} value={t} className="nova-mono">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">–</span>
              <Select value={state.windowEnd} onValueChange={(v) => drive({ windowEnd: v })}>
                <SelectTrigger className="h-control w-[88px] nova-mono" data-testid="nova-window-end">
                  <SelectValue placeholder="end" />
                </SelectTrigger>
                <SelectContent>
                  {windowOpts.to.map((t) => (
                    <SelectItem key={t} value={t} className="nova-mono">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Field>

          <Field label="Sort">
            <Select value={state.sort} onValueChange={(v) => drive({ sort: v })}>
              <SelectTrigger className="h-control w-[150px]" data-testid="nova-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Room name</SelectItem>
                <SelectItem value="capacity">Capacity (desc)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {/* The ONE primary (accent) action. The persistent "Native UI"
              escape hatch lives in the app shell (App.tsx), present on every
              route, so it is not duplicated here. */}
          <Button className="h-control" onClick={onSearch} data-testid="nova-search-btn">
            <Search className="h-3.5 w-3.5" />
            Search
          </Button>
        </div>
      </div>

      {/* Date strip (14-day). Today is preselected; the chosen chip uses the
          accent sparingly — only the selected date, not every chip. */}
      <div className="flex flex-wrap items-center gap-1" data-testid="nova-datechips">
        {dateChips.map((chip, i) => (
          <button
            key={chip.label}
            type="button"
            aria-pressed={i === state.dateIndex}
            onClick={() => drive({ dateIndex: i })}
            className={cn(
              'flex h-control min-w-[44px] flex-col items-center justify-center rounded-md border px-2 text-[11px] leading-tight transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              i === state.dateIndex
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-secondary text-foreground hover:bg-accent'
            )}
          >
            <span className="opacity-70">{chip.weekday}</span>
            <span className="nova-mono">{chip.label.replace(/ \d{4}$/, '')}</span>
          </button>
        ))}
      </div>

      {/* Status bar line (live counts supplied by the board engine) */}
      <div
        data-testid="nova-statusbar"
        className="flex items-center gap-2 border-t border-border pt-1.5 text-[11px] text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <span className="nova-mono">{dateChips[state.dateIndex]?.label ?? '—'}</span>
        <span aria-hidden>·</span>
        <span>{state.roomType === ALL_ROOMS ? 'All rooms' : state.roomType}</span>
        <span aria-hidden>·</span>
        <span className="nova-mono">
          {state.windowStart}–{state.windowEnd}
        </span>
        <span aria-hidden>·</span>
        {statusLine}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}


