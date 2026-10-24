/*
 * src/components/Board.tsx
 *
 * The availability board, in React. One shared time-axis grid template is
 * computed once (axisGridTemplate: "200px repeat(N, minmax(0,1fr))") and is
 * consumed by BOTH the sticky header and every row grid, so a header cell and
 * the cell beneath it always share left/width. The room-label column is its
 * own first track; the header renders exactly N+1 cells (room label + N slot
 * labels), fixing the off-by-one that put every label a slot left of its cells.
 */
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { RoomThumbnail } from '@/components/RoomThumbnail';
import { cn } from '@/lib/utils';
import {
  axisGridTemplate,
  rangeHasConflict,
  rangeToWindow,
  timeToMinutes,
  type BoardForm,
  type Room,
  type Slot,
} from '@/lib/native-bridge';
import type { CartItem, CartModel } from '@/components/SelectionDrawer';
import { findRangeAt, totalSlots, type SlotRange } from '@/lib/selection';
import type { BoardModel, BoardRow } from '@/lib/useBoard';

/** The board's selection is now a list of ranges (the cart). */
export type Selection = SlotRange[];

/** Minutes-since-midnight -> "HH:MM" (for a slot's end label). */
function minutesToLabel(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

interface BoardProps {
  model: BoardModel;
  form: BoardForm;
  /** rsrcId -> data: URI photo (harvested from the native cards). Missing ids
   *  render a neutral placeholder thumbnail of the same size. */
  images: Record<string, string>;
  cursorIndex: number;
  selection: Selection;
  onCellClick: (roomId: string, idx: number, mods: { shift: boolean; meta: boolean }) => void;
  registerRowRef: (roomId: string, el: HTMLElement | null) => void;
}

/** The sticky header: one room-label cell + one cell per axis label (N+1). The
 *  header sticks to the top; its room cell also sticks to the left so the
 *  top-left corner stays put while both axes scroll. Every label is monospace
 *  and the grid tracks are reserved up front, so no layout shift occurs when
 *  slot data streams in. */
function AxisHeader({ axis, template }: { axis: string[]; template: string }) {
  return (
    <div
      data-testid="nova-board-header"
      role="row"
      className="nova-header grid border-b border-border bg-card text-[10px] text-muted-foreground"
      style={{ gridTemplateColumns: template }}
    >
      {/* Track 0: the room-label column header (sticky top-left corner). */}
      <div
        role="columnheader"
        data-testid="nova-header-cell"
        data-col="room"
        className="nova-header-roomcell flex items-center border-r border-border bg-card px-2 font-medium uppercase tracking-wide"
        style={{ height: 'var(--nova-header-h)' }}
      >
        Room
      </div>
      {/* Tracks 1..N: one header cell per axis label, aligned to the row cells.
          Every half-hour tick carries its monospace time label. */}
      {axis.map((label, i) => {
        const isHour = /:00$/.test(label);
        return (
          <div
            key={label}
            role="columnheader"
            data-testid="nova-header-cell"
            data-col={String(i)}
            className={cn(
              'nova-mono flex items-center justify-center overflow-hidden',
              isHour ? 'border-r border-muted-foreground/40 text-foreground' : 'text-muted-foreground/60'
            )}
            style={{ height: 'var(--nova-header-h)' }}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
}

function RoomCell({ room, cursor, photo }: { room: Room; cursor: boolean; photo: string }) {
  const roomCode = room.serial || room.name;
  return (
    <div role="rowheader" className={cn('nova-roomcol', cursor && 'nova-roomcol--cursor')}>
      <RoomThumbnail src={photo} roomCode={roomCode} />
      <span className="nova-mono truncate font-medium text-foreground" title={room.name}>
        {roomCode}
      </span>
      <span className="truncate text-[10px] text-muted-foreground" title={room.type}>
        {room.type}
      </span>
      <span
        className="nova-mono nova-cap text-[11px]"
        title={`Capacity ${room.capacity}`}
        aria-label={`capacity ${room.capacity}`}
      >
        {room.capacity}
      </span>
    </div>
  );
}

/** Human state word used in titles / aria-labels. */
function stateWord(skeleton: boolean, slot: Slot | null): string {
  if (skeleton) return 'loading';
  if (!slot) return 'no data';
  if (slot.state === 'free') return 'free';
  if (slot.state === 'taken') return 'booked';
  if (slot.state === 'closed') return 'closed';
  return `unknown (status ${slot.status})`;
}

const SlotCell = React.memo(function SlotCell({
  slot,
  roomCode,
  label,
  endLabel,
  outside,
  selected,
  skeleton,
  onClick,
}: {
  slot: Slot | null;
  roomCode: string;
  label: string;
  endLabel: string;
  outside: boolean;
  selected: boolean;
  skeleton: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const isHour = /:30$/.test(label); // the cell before the next hour marks a boundary
  const word = stateWord(skeleton, slot);
  let stateClass = 'nova-cell--unknown';
  if (skeleton) stateClass = 'nova-cell--skeleton';
  else if (!slot) stateClass = 'nova-cell--unknown';
  else if (slot.state === 'free') stateClass = 'nova-cell--free';
  else if (slot.state === 'taken') stateClass = 'nova-cell--booked';
  else if (slot.state === 'closed') stateClass = 'nova-cell--closed';

  // Visual state name: 'taken' is rendered/reported as 'booked'.
  const dataState = skeleton
    ? 'skeleton'
    : !slot
      ? 'unknown'
      : slot.state === 'taken'
        ? 'booked'
        : slot.state;

  // Accessible label: "DR209 14:00-14:30 free" (room, half-hour range, state).
  const ariaLabel = `${roomCode} ${label}-${endLabel} ${word}`;

  return (
    <div
      role="gridcell"
      aria-label={skeleton ? undefined : ariaLabel}
      aria-busy={skeleton || undefined}
      tabIndex={skeleton ? -1 : 0}
      data-testid="nova-cell"
      data-state={dataState}
      data-label={label}
      title={`${roomCode} ${label}-${endLabel} — ${word}`}
      onClick={skeleton ? undefined : onClick}
      onKeyDown={
        skeleton
          ? undefined
          : (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick(e as unknown as React.MouseEvent);
              }
            }
      }
      className={cn(
        'nova-cell',
        stateClass,
        isHour && 'nova-cell--hour',
        outside && 'nova-cell--outside',
        selected && 'nova-cell--sel'
      )}
    />
  );
});

function Row({
  row,
  axis,
  template,
  zebra,
  cursor,
  photo,
  selection,
  windowStart,
  windowEnd,
  onCellClick,
  onRetry,
  registerRowRef,
}: {
  row: BoardRow;
  axis: string[];
  template: string;
  zebra: boolean;
  cursor: boolean;
  photo: string;
  selection: Selection;
  windowStart: number;
  windowEnd: number;
  onCellClick: (roomId: string, idx: number, e: React.MouseEvent) => void;
  onRetry: (roomId: string) => void;
  registerRowRef: (roomId: string, el: HTMLElement | null) => void;
}) {
  const ref = React.useCallback(
    (el: HTMLDivElement | null) => registerRowRef(row.room.id, el),
    [registerRowRef, row.room.id]
  );
  const cells = row.state.kind === 'loaded' ? row.state.cells : null;
  const skeleton = row.state.kind === 'skeleton';
  const roomCode = row.room.serial || row.room.name;

  return (
    <div
      ref={ref}
      role="row"
      data-testid="nova-row"
      data-room-id={row.room.id}
      className={cn('nova-row grid', zebra && 'nova-row--zebra')}
      style={{ gridTemplateColumns: template }}
    >
      <RoomCell room={row.room} cursor={cursor} photo={photo} />
      {row.state.kind === 'failed' ? (
        <div
          role="gridcell"
          className="flex items-center gap-2 px-2 text-[11px] text-destructive"
          style={{ gridColumn: `2 / span ${axis.length}`, height: 'var(--nova-row-h)' }}
        >
          <span>failed — {row.state.error}</span>
          <Button size="sm" variant="outline" onClick={() => onRetry(row.room.id)}>
            retry
          </Button>
        </div>
      ) : (
        axis.map((label, i) => {
          const mins = timeToMinutes(label);
          const outside = mins < windowStart || mins >= windowEnd;
          const selected = findRangeAt(selection, row.room.id, i) !== -1;
          const endLabel = minutesToLabel(mins + 30);
          return (
            <SlotCell
              key={label}
              slot={cells ? cells[i] : null}
              roomCode={roomCode}
              label={label}
              endLabel={endLabel}
              outside={outside}
              selected={selected}
              skeleton={skeleton}
              onClick={(e) => onCellClick(row.room.id, i, e)}
            />
          );
        })
      )}
    </div>
  );
}

export function Board({
  model,
  form,
  images,
  cursorIndex,
  selection,
  onCellClick,
  registerRowRef,
}: BoardProps) {
  const { axis, rows } = model;
  const template = React.useMemo(() => axisGridTemplate(axis), [axis]);
  const windowStart = timeToMinutes(form.window.start);
  const windowEnd = timeToMinutes(form.window.end);

  const cellClick = React.useCallback(
    (roomId: string, idx: number, e: React.MouseEvent) => {
      onCellClick(roomId, idx, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
    },
    [onCellClick]
  );

  // ERROR state: the room-list fetch failed. Name the failing endpoint and
  // offer Retry. The previous board (if any) stays intact; this panel only
  // takes over when there are no rows to show.
  if (model.status.error && rows.length === 0) {
    return (
      <div
        className="flex flex-col items-start gap-3 p-6 text-sm"
        data-testid="nova-board-error"
        role="alert"
      >
        <div className="font-semibold text-destructive">Could not load the board</div>
        <div className="text-muted-foreground">{model.status.error}</div>
        <div className="nova-mono text-[11px] text-muted-foreground">
          endpoint: POST {model.endpoints.searchList}
        </div>
        <Button variant="outline" onClick={model.reload} data-testid="nova-board-retry">
          Retry
        </Button>
      </div>
    );
  }

  // EMPTY state: the request succeeded but no room matched the filters.
  if (model.status.done && rows.length === 0 && !model.status.error) {
    return (
      <div
        className="flex flex-col items-start gap-2 p-6 text-sm"
        data-testid="nova-board-empty"
      >
        <div className="font-semibold text-foreground">No rooms match these filters</div>
        <div className="text-muted-foreground">
          Try a different building, room type, or a lower minimum capacity.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <Legend />
      <div
        data-testid="nova-board"
        role="grid"
        aria-label="Room availability board"
        aria-rowcount={rows.length + 1}
        className="nova-board-scroll min-h-0 w-full flex-1"
      >
        <AxisHeader axis={axis} template={template} />
        <div role="rowgroup">
          {rows.map((row, i) => (
            <Row
              key={row.room.id}
              row={row}
              axis={axis}
              template={template}
              zebra={i % 2 === 1}
              cursor={i === cursorIndex}
              photo={images[row.room.id] ?? ''}
              selection={selection}
              windowStart={windowStart}
              windowEnd={windowEnd}
              onCellClick={cellClick}
              onRetry={model.retryRoom}
              registerRowRef={registerRowRef}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The board legend: names all three slot states + the selection outline, each
 *  with a swatch that matches the cell fill (luminance + pattern), so it reads
 *  for colour-blind users too. */
function Legend() {
  return (
    <div
      data-testid="nova-legend"
      className="flex flex-wrap items-center gap-4 border-b border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground"
      aria-label="Legend"
    >
      <span className="flex items-center gap-1.5">
        <span className="nova-legend-sw nova-legend-sw--free" /> Free
      </span>
      <span className="flex items-center gap-1.5">
        <span className="nova-legend-sw nova-legend-sw--booked" /> Booked
      </span>
      <span className="flex items-center gap-1.5">
        <span className="nova-legend-sw nova-legend-sw--closed" /> Closed
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="nova-legend-sw"
          style={{ background: 'transparent', boxShadow: 'inset 0 0 0 2px var(--nova-sel)' }}
        />{' '}
        Selected
      </span>
    </div>
  );
}

/** Build one cart line for a single selected range (pure; native.js helpers). */
function buildCartItem(axis: string[], rows: BoardRow[], range: SlotRange): CartItem | null {
  const row = rows.find((r) => r.room.id === range.roomId) ?? null;
  if (!row) return null;
  const win = rangeToWindow(axis, range.start, range.end);
  const cells = row.state.kind === 'loaded' ? row.state.cells : [];
  const conflict = rangeHasConflict(cells, range.start, range.end);

  let freeCount = 0;
  let bookedCount = 0;
  for (let i = range.start; i <= range.end; i++) {
    const c = cells[i];
    if (!c) continue;
    if (c.state === 'free') freeCount++;
    else if (c.state === 'taken') bookedCount++;
  }

  return {
    id: range.id,
    roomId: row.room.id,
    roomName: row.room.name,
    roomCode: row.room.serial || row.room.name,
    roomType: row.room.type,
    capacity: row.room.capacity,
    window: win,
    durationMinutes: win.count * 30,
    freeCount,
    bookedCount,
    conflict,
  };
}

/**
 * Derive the whole cart model from the current multi-range selection (pure).
 * Each range becomes a line; the totals sum across every line. Ranges whose
 * room is no longer present (e.g. after a re-filter) are dropped.
 */
export function buildCart(
  axis: string[],
  rows: BoardRow[],
  selection: Selection,
  date: string
): CartModel {
  const items: CartItem[] = [];
  for (const range of selection) {
    const item = buildCartItem(axis, rows, range);
    if (item) items.push(item);
  }
  let totalFree = 0;
  let totalBooked = 0;
  for (const it of items) {
    totalFree += it.freeCount;
    totalBooked += it.bookedCount;
  }
  const slots = totalSlots(items.map((it) => ({ id: it.id, roomId: it.roomId, start: 0, end: it.window.count - 1 })));
  return {
    date,
    items,
    totalSlots: slots,
    totalMinutes: slots * 30,
    totalFree,
    totalBooked,
  };
}
