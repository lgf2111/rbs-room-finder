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
  readBuildings,
  readDateChips,
  readRoomTypes,
  readWindowOptions,
  type DateChip,
  type NativeOption,
} from '@/lib/native-bridge';

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

/**
 * Phase 1 shadcn top bar. Reads real page state through the content/native.js
 * helpers (room types, window options, date chips, buildings) and holds its
 * selections in local React state.
 */
export function TopBar() {
  // Snapshot native page state once on mount. Phase 2 should make this reactive
  // to native building changes.
  const buildings = React.useMemo<NativeOption[]>(() => readBuildings(), []);
  const roomTypes = React.useMemo<NativeOption[]>(() => readRoomTypes(), []);
  const windowOpts = React.useMemo(() => readWindowOptions(), []);
  const dateChips = React.useMemo<DateChip[]>(() => readDateChips(14), []);

  const [state, setState] = React.useState<TopBarState>(() => ({
    // Prefer the first concrete building; the native "All buildings" ("") maps
    // to the ALL_BUILDINGS sentinel (Radix forbids a "" item value).
    building: buildings.find((b) => b.value)?.value ?? ALL_BUILDINGS,
    roomType: roomTypes[0]?.value ?? ALL_ROOMS,
    capacity: '0',
    search: '',
    dateIndex: dateChips.findIndex((c) => c.isToday) >= 0 ? dateChips.findIndex((c) => c.isToday) : 0,
    windowStart: windowOpts.from.includes(DEFAULT_WINDOW.start) ? DEFAULT_WINDOW.start : windowOpts.from[0] ?? '',
    windowEnd: windowOpts.to.includes(DEFAULT_WINDOW.end) ? DEFAULT_WINDOW.end : windowOpts.to[windowOpts.to.length - 1] ?? '',
    sort: 'name',
  }));

  const patch = (p: Partial<TopBarState>) => setState((s) => ({ ...s, ...p }));

  function onSearch() {
    // TODO(phase 2): wire this to content/panel.js `requestReload(form)` — it is
    // private to the panel.js IIFE and not reachable from this bundle. Until a
    // clean seam exists, this renders with local state only and performs no
    // network search. Do NOT silently click #btnBookingMainSearch here.
    const form = {
      building: state.building === ALL_BUILDINGS ? '' : state.building,
      roomType: state.roomType === ALL_ROOMS ? '' : state.roomType,
      minCapacity: Number(state.capacity) || 0,
      search: state.search,
      date: dateChips[state.dateIndex]?.label ?? '',
      window: { start: state.windowStart, end: state.windowEnd },
      sort: state.sort,
    };
    // eslint-disable-next-line no-console
    console.info('[nova] search requested (phase 1, not wired):', form);
  }

  return (
    <div
      data-testid="nova-topbar"
      className="flex flex-col gap-2 border-b border-border bg-card px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* Building */}
        <Field label="Building">
          <Select value={state.building} onValueChange={(v) => patch({ building: v })}>
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
          <Select value={state.roomType} onValueChange={(v) => patch({ roomType: v })}>
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
            onChange={(e) => patch({ capacity: e.target.value })}
            className="w-[72px] nova-mono"
            data-testid="nova-capacity"
          />
        </Field>

        {/* Free-text search */}
        <Field label="Find">
          <Input
            type="text"
            placeholder="room name"
            value={state.search}
            onChange={(e) => patch({ search: e.target.value })}
            className="w-[160px]"
            data-testid="nova-search"
          />
        </Field>

        {/* Window start / end */}
        <Field label="Window">
          <div className="flex items-center gap-1">
            <Select value={state.windowStart} onValueChange={(v) => patch({ windowStart: v })}>
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
            <Select value={state.windowEnd} onValueChange={(v) => patch({ windowEnd: v })}>
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
          <Select value={state.sort} onValueChange={(v) => patch({ sort: v })}>
            <SelectTrigger className="w-[150px]" data-testid="nova-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Room name</SelectItem>
              <SelectItem value="capacity">Capacity (desc)</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <div className="ml-auto">
          <Button onClick={onSearch} data-testid="nova-search-btn">
            <Search className="h-3.5 w-3.5" />
            Search
          </Button>
        </div>
      </div>

      {/* Date chips */}
      <div className="flex flex-wrap items-center gap-1" data-testid="nova-datechips">
        {dateChips.map((chip, i) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => patch({ dateIndex: i })}
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

      {/* Status bar line */}
      <StatusBar state={state} dateChips={dateChips} />
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

function StatusBar({ state, dateChips }: { state: TopBarState; dateChips: DateChip[] }) {
  const date = dateChips[state.dateIndex]?.label ?? '—';
  const type = state.roomType === ALL_ROOMS ? 'All rooms' : state.roomType;
  return (
    <div
      data-testid="nova-statusbar"
      className="flex items-center gap-2 border-t border-border pt-1.5 text-[11px] text-muted-foreground"
    >
      <span className="nova-mono">{date}</span>
      <span>·</span>
      <span>{type}</span>
      <span>·</span>
      <span className="nova-mono">
        {state.windowStart}–{state.windowEnd}
      </span>
      <span>·</span>
      <span>phase 1 preview — search not yet wired to the board</span>
    </div>
  );
}
