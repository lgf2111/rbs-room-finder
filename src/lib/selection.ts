/*
 * src/lib/selection.ts
 *
 * Multi-slot selection (the "cart"). The board lets the user pick SEVERAL slot
 * ranges at once:
 *   - click            -> start a fresh single-cell range in that room (clears the rest)
 *   - shift-click      -> extend the most-recent range IF it is in the same room
 *                         (a contiguous range), otherwise start one there
 *   - cmd/ctrl-click   -> add ANOTHER range (single cell) in ANY room, keeping the rest
 *   - click a cell that already sits inside a range -> remove that whole range
 *
 * Each range is one room + a contiguous [startIdx..endIdx] on the shared axis.
 * Ranges are kept normalised (start <= end) and carry a stable id so the cart
 * can list and remove them. This module is pure (no React, no DOM) so it is
 * unit-testable and shared by the board + the cart drawer.
 */

export interface SlotRange {
  /** Stable id for list keys / removal. */
  id: string;
  roomId: string;
  /** Normalised so start <= end. */
  start: number;
  end: number;
}

export interface ClickMods {
  shift: boolean;
  /** metaKey (cmd) OR ctrlKey. */
  meta: boolean;
}

let rangeSeq = 0;
function nextId(): string {
  rangeSeq += 1;
  return `r${rangeSeq}`;
}

function norm(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

/** True if cell `idx` in `roomId` falls inside this range. */
export function rangeContains(r: SlotRange, roomId: string, idx: number): boolean {
  return r.roomId === roomId && idx >= r.start && idx <= r.end;
}

/** Find the index of the range that contains a cell, or -1. */
export function findRangeAt(ranges: SlotRange[], roomId: string, idx: number): number {
  return ranges.findIndex((r) => rangeContains(r, roomId, idx));
}

/**
 * Apply a cell click to the current selection and return the next selection.
 *
 * Rules (in order):
 *  1. click on a cell already inside a range           -> remove that range
 *     (plain click: remove only if nothing else needs starting; this is the
 *      "click a selected cell to remove its range" behaviour)
 *  2. shift-click with a prior range in the SAME room  -> extend that range to idx
 *  3. cmd/ctrl-click                                   -> add a new single-cell range
 *  4. plain click                                      -> replace with one single-cell range
 */
export function applyClick(
  ranges: SlotRange[],
  roomId: string,
  idx: number,
  mods: ClickMods
): SlotRange[] {
  const hitIdx = findRangeAt(ranges, roomId, idx);

  // SHIFT: extend the most-recent range if it is in the same room; else start
  // a fresh contiguous range anchored at that cell in this room.
  if (mods.shift) {
    const last = ranges[ranges.length - 1];
    if (last && last.roomId === roomId) {
      const [start, end] = norm(last.start, idx);
      const next = ranges.slice(0, -1);
      next.push({ ...last, start, end });
      return next;
    }
    // No same-room anchor: treat shift like a fresh single-cell range (added,
    // keeping existing ranges so shift never destroys the cart).
    return [...ranges, { id: nextId(), roomId, start: idx, end: idx }];
  }

  // Clicking a cell that is already selected removes its range (toggle off),
  // whether or not a modifier is held — this is the explicit "remove" gesture.
  if (hitIdx !== -1) {
    return ranges.filter((_, i) => i !== hitIdx);
  }

  // CMD/CTRL: add ANOTHER range in any room, keeping the others.
  if (mods.meta) {
    return [...ranges, { id: nextId(), roomId, start: idx, end: idx }];
  }

  // Plain click on an unselected cell: replace the whole selection with one
  // single-cell range (the classic single-select start).
  return [{ id: nextId(), roomId, start: idx, end: idx }];
}

/** Remove a range by id (the cart's remove control). */
export function removeRange(ranges: SlotRange[], id: string): SlotRange[] {
  return ranges.filter((r) => r.id !== id);
}

/** Total selected half-hour slots across every range. */
export function totalSlots(ranges: SlotRange[]): number {
  return ranges.reduce((n, r) => n + (r.end - r.start + 1), 0);
}
