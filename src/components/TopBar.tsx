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

/** Read the live page state, preferring the bridge and falling back to DOM. */
function readPageState(): PageState {
  const bridge = getBridge();
  if (bridge) {
    const s = bridge.readState();
    return { buildings: s.buildings, roomTypes: s.roomTypes, windowOpts: s.windowOptions };
  }
  return { buildings: readBuildings(), roomTypes: readRoomTypes(), windowOpts: readWindowOptions() };
}

export interface TopBarProps {
  /** Emitted whenever the form changes (and once on mount). The Nova board
   *  consumes this; the engine fetches on its own, so no native reload fires. */
  onForm: (form: BoardForm) => void;
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
export function TopBar({ onForm, statusLine, onRevealNative, searchRef }: TopBarProps) {
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

  // Subscribe to native control changes: re-read the live options and reconcile
  // the current selection against them (e.g. a building cascade repopulating
  // room types / window options).
  React.useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    const unsub = bridge.subscribe(() => {
      const next = readPageState();
      setPage(next);
      setState((s) => {
        const typeStillThere = s.roomType === ALL_ROOMS || next.roomTypes.some((t) => (t.value || t.text) === s.roomType);
        const startStillThere = next.windowOpts.from.includes(s.windowStart);
        const endStillThere = next.windowOpts.to.includes(s.windowEnd);
        return {
          ...s,
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
    });
    return unsub;
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
  }

  return (
    <div
      data-testid="nova-topbar"
      className="flex flex-col gap-2 border-b border-border bg-card px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* Building */}
        <Field label="Building">
          <Select
            value={state.building}
            onValueChange={(v) => drive({ building: v === ALL_BUILDINGS ? ALL_BUILDINGS : v })}
          >
            <SelectTrigger className="w-[150px]" data-testid="nova-building">
              <SelectValue placeholder="Building" />
            </SelectTrigger>
            <SelectContent>
              {buildings.map((b) => (
                <SelectItem key={b.value || b.text} value={b.value || ALL_BUILDINGS}>
                  {b.text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {/* Room type */}
        <Field label="Type">
          <Select value={state.roomType} onValueChange={(v) => drive({ roomType: v })}>
            <SelectTrigger className="w-[160px]" data-testid="nova-roomtype">
              <SelectValue placeholder="All rooms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ROOMS}>All rooms</SelectItem>
              {roomTypes.map((t) => (
                <SelectItem key={t.value || t.text} value={t.value || t.text}>
                  {t.text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {/* Capacity */}
        <Field label="Min cap">
          <Input
            type="number"
            min={0}
            value={state.capacity}
            onChange={(e) => drive({ capacity: e.target.value })}
            className="w-[72px] nova-mono"
            data-testid="nova-capacity"
          />
        </Field>

        {/* Free-text search */}
        <Field label="Find">
          <Input
            ref={searchRef}
            type="text"
            placeholder="room name"
            value={state.search}
            onChange={(e) => drive({ search: e.target.value })}
            className="w-[160px]"
            data-testid="nova-search"
          />
        </Field>

        {/* Window start / end */}
        <Field label="Window">
          <div className="flex items-center gap-1">
            <Select value={state.windowStart} onValueChange={(v) => drive({ windowStart: v })}>
              <SelectTrigger className="w-[88px] nova-mono" data-testid="nova-window-start">
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
              <SelectTrigger className="w-[88px] nova-mono" data-testid="nova-window-end">
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

        {/* Sort */}
        <Field label="Sort">
          <Select value={state.sort} onValueChange={(v) => drive({ sort: v })}>
            <SelectTrigger className="w-[150px]" data-testid="nova-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Room name</SelectItem>
              <SelectItem value="capacity">Capacity (desc)</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={onRevealNative} data-testid="nova-native-btn">
            Native UI
          </Button>
          <Button onClick={onSearch} data-testid="nova-search-btn">
            <Search className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Date chips */}
      <div className="flex flex-wrap items-center gap-1" data-testid="nova-datechips">
        {dateChips.map((chip, i) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => drive({ dateIndex: i })}
            className={cn(
              'flex h-control min-w-[44px] flex-col items-center justify-center rounded-md border px-2 text-[11px] leading-tight transition-colors',
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
      >
        <span className="nova-mono">{dateChips[state.dateIndex]?.label ?? '—'}</span>
        <span>·</span>
        <span>{state.roomType === ALL_ROOMS ? 'All rooms' : state.roomType}</span>
        <span>·</span>
        <span className="nova-mono">
          {state.windowStart}–{state.windowEnd}
        </span>
        <span>·</span>
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


