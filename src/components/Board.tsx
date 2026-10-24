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
import type { BoardModel, BoardRow } from '@/lib/useBoard';

export interface Selection {
  roomId: string;
  startIdx: number;
  endIdx: number;
}

interface BoardProps {
  model: BoardModel;
  form: BoardForm;
  cursorIndex: number;
  selection: Selection | null;
  onSelectRange: (roomId: string, startIdx: number, endIdx: number, extend: boolean) => void;
  registerRowRef: (roomId: string, el: HTMLElement | null) => void;
}

/** The sticky header: one room-label cell + one cell per axis label (N+1). */
function AxisHeader({ axis, template }: { axis: string[]; template: string }) {
  return (
    <div
      data-testid="nova-board-header"
      className="sticky top-0 z-10 grid border-b border-border bg-card text-[10px] text-muted-foreground"
      style={{ gridTemplateColumns: template }}
    >
      {/* Track 0: the room-label column header. */}
      <div
        data-testid="nova-header-cell"
        data-col="room"
        className="flex h-6 items-center border-r border-border px-2 font-medium uppercase tracking-wide"
      >
        Room
      </div>
      {/* Tracks 1..N: one header cell per axis label, aligned to the row cells. */}
      {axis.map((label, i) => {
        const isHour = /:00$/.test(label);
        return (
          <div
            key={label}
            data-testid="nova-header-cell"
            data-col={String(i)}
            className={cn(
              'nova-mono flex h-6 items-center justify-center overflow-hidden',
              isHour ? 'border-r border-muted-foreground/40 text-foreground' : 'text-muted-foreground/70'
            )}
          >
            {isHour ? label : ''}
          </div>
        );
      })}
    </div>
  );
}

function RoomCell({ room, cursor }: { room: Room; cursor: boolean }) {
  return (
    <div className={cn('nova-roomcol', cursor && 'bg-accent')}>
      <span className="nova-mono truncate font-medium text-foreground" title={room.name}>
        {room.serial || room.name}
      </span>
      <span className="truncate text-[10px] text-muted-foreground" title={room.type}>
        {room.type}
      </span>
      <span className="nova-mono ml-auto text-[10px] text-muted-foreground">{room.capacity}</span>
    </div>
  );
}

const SlotCell = React.memo(function SlotCell({
  slot,
  label,
  outside,
  selected,
  skeleton,
  onClick,
}: {
  slot: Slot | null;
  label: string;
  outside: boolean;
  selected: boolean;
  skeleton: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const isHour = /:30$/.test(label); // the cell before the next hour marks a boundary
  let stateClass = 'nova-cell--unknown';
  let title = `${label} — no data`;
  if (skeleton) {
    stateClass = 'nova-cell--skeleton';
    title = `${label} — loading`;
  } else if (!slot) {
    stateClass = 'nova-cell--unknown';
    title = `${label} — no data`;
  } else if (slot.state === 'free') {
    stateClass = 'nova-cell--free';
    title = `${label} — free`;
  } else if (slot.state === 'taken') {
    stateClass = 'nova-cell--booked';
    title = `${label} — booked`;
  } else if (slot.state === 'closed') {
    stateClass = 'nova-cell--closed';
    title = `${label} — not open for booking`;
  } else {
    title = `${label} — unknown (status ${slot.status})`;
  }
  // Visual state name: 'taken' is rendered/reported as 'booked'.
  const dataState = skeleton
    ? 'skeleton'
    : !slot
      ? 'unknown'
      : slot.state === 'taken'
        ? 'booked'
        : slot.state;
  return (
    <div
      role="gridcell"
      data-testid="nova-cell"
      data-state={dataState}
      data-label={label}
      title={title}
      onClick={skeleton ? undefined : onClick}
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
  selection: Selection | null;
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

  return (
    <div
      ref={ref}
      role="row"
      data-testid="nova-row"
      data-room-id={row.room.id}
      className={cn('grid', zebra && 'nova-row--zebra')}
      style={{ gridTemplateColumns: template }}
    >
      <RoomCell room={row.room} cursor={cursor} />
      {row.state.kind === 'failed' ? (
        <div
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
          const selected =
            !!selection &&
            selection.roomId === row.room.id &&
            i >= Math.min(selection.startIdx, selection.endIdx) &&
            i <= Math.max(selection.startIdx, selection.endIdx);
          return (
            <SlotCell
              key={label}
              slot={cells ? cells[i] : null}
              label={label}
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
  cursorIndex,
  selection,
  onSelectRange,
  registerRowRef,
}: BoardProps) {
  const { axis, rows } = model;
  const template = React.useMemo(() => axisGridTemplate(axis), [axis]);
  const windowStart = timeToMinutes(form.window.start);
  const windowEnd = timeToMinutes(form.window.end);

  const onCellClick = React.useCallback(
    (roomId: string, idx: number, e: React.MouseEvent) => {
      const extend = e.shiftKey && !!selection && selection.roomId === roomId;
      if (extend && selection) onSelectRange(roomId, selection.startIdx, idx, true);
      else onSelectRange(roomId, idx, idx, false);
    },
    [onSelectRange, selection]
  );

  if (model.status.error && rows.length === 0) {
    return (
      <div className="p-4 text-sm text-destructive" data-testid="nova-board-error">
        {model.status.error}
      </div>
    );
  }

  if (model.status.done && rows.length === 0 && !model.status.error) {
    return (
      <div className="p-4 text-sm text-muted-foreground" data-testid="nova-board-empty">
        No rooms match these filters.
      </div>
    );
  }

  return (
    <div
      data-testid="nova-board"
      role="grid"
      aria-label="Room availability board"
      className="min-h-0 w-full overflow-auto"
    >
      <AxisHeader axis={axis} template={template} />
      <div>
        {rows.map((row, i) => (
          <Row
            key={row.room.id}
            row={row}
            axis={axis}
            template={template}
            zebra={i % 2 === 1}
            cursor={i === cursorIndex}
            selection={selection}
            windowStart={windowStart}
            windowEnd={windowEnd}
            onCellClick={onCellClick}
            onRetry={model.retryRoom}
            registerRowRef={registerRowRef}
          />
        ))}
      </div>
    </div>
  );
}

/** Derive the drawer's window + conflict for a selection (pure, from native.js). */
export function selectionSummary(
  axis: string[],
  rows: BoardRow[],
  selection: Selection
): { room: Room | null; window: { start: string; end: string; count: number }; conflict: boolean } {
  const row = rows.find((r) => r.room.id === selection.roomId) ?? null;
  const win = rangeToWindow(axis, selection.startIdx, selection.endIdx);
  const cells = row && row.state.kind === 'loaded' ? row.state.cells : [];
  const conflict = rangeHasConflict(cells, selection.startIdx, selection.endIdx);
  return { room: row?.room ?? null, window: win, conflict };
}
