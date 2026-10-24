/*
 * src/components/SelectionDrawer.tsx
 *
 * The selection CART. The board supports multi-slot selection (click, shift for
 * a contiguous range in one room, cmd/ctrl for another range in any room, click
 * a selected cell to remove its range). This drawer lists EVERY selected
 * room+range as a cart line — its time window, duration, and free/booked counts
 * — each with a remove control, plus a total summary across all lines.
 *
 * The confirm button is intentionally DISABLED with a visible note: the booking
 * endpoint is not mapped, so Nova will not fake a booking and will not fall back
 * to clicking a native submit. Selection is as far as Nova goes.
 */
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface CartItem {
  /** Stable range id (from selection.ts) for list keys / removal. */
  id: string;
  roomId: string;
  roomName: string;
  roomCode: string;
  roomType: string;
  capacity: number;
  window: { start: string; end: string; count: number };
  durationMinutes: number;
  freeCount: number;
  bookedCount: number;
  conflict: boolean;
}

export interface CartModel {
  date: string;
  items: CartItem[];
  totalSlots: number;
  totalMinutes: number;
  totalFree: number;
  totalBooked: number;
}

/** "90 min" / "1 h" / "1 h 30 min" — compact human duration. */
function formatDuration(mins: number): string {
  if (mins <= 0) return '0 min';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function SelectionDrawer({
  model,
  onRemove,
  onClear,
}: {
  model: CartModel | null;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  if (!model || model.items.length === 0) return null;

  return (
    <aside
      data-testid="nova-drawer"
      className="fixed right-0 top-0 z-40 flex h-full w-[320px] flex-col gap-3 border-l border-border bg-card p-4 shadow-lg"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold text-foreground">Selected slots</div>
          <div className="text-xs text-muted-foreground" data-testid="nova-cart-count">
            {model.items.length} {model.items.length === 1 ? 'room' : 'rooms'} · {model.totalSlots} slot(s)
          </div>
        </div>
        <button
          type="button"
          aria-label="Clear all"
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>

      {model.date && (
        <div className="nova-mono text-[11px] text-muted-foreground" data-testid="nova-cart-date">
          {model.date}
        </div>
      )}

      {/* Cart lines: one per selected room+range. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto" data-testid="nova-cart-list">
        {model.items.map((item) => (
          <div
            key={item.id}
            data-testid="nova-cart-item"
            data-room-id={item.roomId}
            className="rounded-md border border-border bg-secondary p-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="nova-mono truncate text-[12px] font-medium text-foreground" title={item.roomName}>
                  {item.roomCode}
                </div>
                <div className="truncate text-[10px] text-muted-foreground" title={item.roomType}>
                  {item.roomType} · cap {item.capacity}
                </div>
              </div>
              <button
                type="button"
                aria-label={`Remove ${item.roomCode} ${item.window.start}–${item.window.end}`}
                onClick={() => onRemove(item.id)}
                data-testid="nova-cart-remove"
                className="shrink-0 rounded px-1 text-muted-foreground hover:text-destructive"
              >
                ✕
              </button>
            </div>
            <div
              className="nova-mono mt-1 text-[12px] text-foreground"
              data-testid="nova-cart-window"
            >
              {item.window.start} – {item.window.end}
            </div>
            <div className="text-[10px] text-muted-foreground" data-testid="nova-cart-duration">
              {item.window.count} slot(s) · {formatDuration(item.durationMinutes)}
            </div>
            <div
              className={cn(
                'mt-1 text-[10px]',
                item.conflict ? 'text-destructive' : 'text-muted-foreground'
              )}
              data-testid="nova-cart-counts"
            >
              {item.freeCount} free · {item.bookedCount} booked
              {item.conflict ? ' — contains booked slots' : ''}
            </div>
          </div>
        ))}
      </div>

      {/* Total summary across all lines. */}
      <div
        className="rounded-md border border-border p-2 text-[11px] text-muted-foreground"
        data-testid="nova-cart-total"
      >
        <div className="flex justify-between">
          <span>Total</span>
          <span className="nova-mono text-foreground">
            {model.totalSlots} slot(s) · {formatDuration(model.totalMinutes)}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Across rooms</span>
          <span className="nova-mono">
            {model.totalFree} free · {model.totalBooked} booked
          </span>
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <Button disabled data-testid="nova-confirm-btn" aria-disabled="true">
          Confirm booking
        </Button>
        <div className="text-[11px] text-destructive" data-testid="nova-confirm-note">
          The booking endpoint is not mapped yet, so Nova cannot confirm this.
          Nothing is booked.
        </div>
        <Button variant="outline" onClick={onClear} data-testid="nova-cart-clear">
          Clear all
        </Button>
      </div>
    </aside>
  );
}
