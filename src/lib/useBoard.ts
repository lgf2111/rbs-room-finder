/*
 * src/lib/useBoard.ts
 *
 * The Nova board engine, as a React hook. It owns:
 *   - the room list (fetched once per form) painted IMMEDIATELY as skeleton rows,
 *   - a lazy, single-flight slot fill (exactly ONE slot request in flight ever),
 *     viewport-prioritised via an IntersectionObserver the rows register with,
 *   - a generation counter so a stale response can never paint into a newer
 *     render (a response that lands after the form changed is cached, not painted),
 *   - a per-room in-memory cache keyed room+date+window (survives re-renders and
 *     a second pass performs zero fetches),
 *   - a status line model: rooms loaded / total, failures, requests in flight,
 *     elapsed.
 *
 * It never uses Promise.all: the slot queue (content/native.js createSlotQueue)
 * guarantees max-in-flight === 1. The room list is a single fetch.
 */
import * as React from 'react';

import {
  alignSlots,
  buildSlotAxis,
  createSlotQueue,
  DAY_WINDOW,
  fetchRooms,
  fetchSlots,
  slotCacheKey,
  type BoardForm,
  type Room,
  type Slot,
  type SlotQueue,
} from '@/lib/native-bridge';

export type RowState =
  | { kind: 'skeleton' }
  | { kind: 'loaded'; cells: (Slot | null)[] }
  | { kind: 'failed'; error: string };

export interface BoardRow {
  room: Room;
  state: RowState;
}

export interface BoardStatus {
  total: number;
  loaded: number;
  failed: number;
  inFlight: number;
  elapsedMs: number;
  done: boolean;
  /** Set when the room-list fetch itself failed (board kept intact). */
  error?: string;
}

export interface BoardModel {
  axis: string[];
  rows: BoardRow[];
  status: BoardStatus;
  /** Register a row element for viewport prioritisation. Returns an unobserver. */
  observeRow: (roomId: string, el: HTMLElement | null) => void;
  /** Retry one failed room (re-enqueues it at the front). */
  retryRoom: (roomId: string) => void;
}

/** Stable key for a form so a new load is only triggered on a real change. */
function formKey(f: BoardForm): string {
  return [f.building, f.roomType, f.minCapacity, f.search, f.date, f.window.start, f.window.end, f.sort].join('|');
}

/** Sort + text-filter rooms client-side (the search box is a substring match). */
function applyClientFilters(rooms: Room[], form: BoardForm): Room[] {
  let out = rooms;
  const needle = form.search.trim().toLowerCase();
  if (needle) {
    out = out.filter(
      (r) => r.name.toLowerCase().includes(needle) || r.serial.toLowerCase().includes(needle)
    );
  }
  if (form.minCapacity > 0) out = out.filter((r) => r.capacity >= form.minCapacity);
  out = [...out];
  if (form.sort === 'capacity') out.sort((a, b) => b.capacity - a.capacity || a.name.localeCompare(b.name));
  else out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function useBoard(form: BoardForm): BoardModel {
  const axis = React.useMemo(() => buildSlotAxis(DAY_WINDOW.start, DAY_WINDOW.end), []);

  const [rows, setRows] = React.useState<BoardRow[]>([]);
  const [status, setStatus] = React.useState<BoardStatus>({
    total: 0,
    loaded: 0,
    failed: 0,
    inFlight: 0,
    elapsedMs: 0,
    done: true,
  });

  // The per-room slot cache survives re-renders and form changes: a cache hit
  // is never re-fetched (keyed room+date+window+status inside native.js).
  const cacheRef = React.useRef<Map<string, Slot[]>>(new Map());
  const queueRef = React.useRef<SlotQueue | null>(null);
  const ioRef = React.useRef<IntersectionObserver | null>(null);
  const rowEls = React.useRef<Map<string, HTMLElement>>(new Map());
  const startRef = React.useRef<number>(0);
  const key = formKey(form);

  // Paint one room's cells (fresh generation only; the queue already dropped
  // stale responses before calling onLoaded).
  const paint = React.useCallback(
    (roomId: string, slots: Slot[]) => {
      const cells = alignSlots(axis, slots);
      setRows((prev) =>
        prev.map((r) => (r.room.id === roomId ? { ...r, state: { kind: 'loaded', cells } } : r))
      );
    },
    [axis]
  );

  const markFailed = React.useCallback((roomId: string, err: Error) => {
    setRows((prev) =>
      prev.map((r) =>
        r.room.id === roomId ? { ...r, state: { kind: 'failed', error: err.message } } : r
      )
    );
  }, []);

  // Load the board whenever the form key changes.
  React.useEffect(() => {
    // The form is not ready until the top bar has emitted a real date. App
    // seeds an INITIAL_FORM with date='' purely to render the shell; firing a
    // search for it would issue a throwaway SearchSRB001List before the real
    // one (the Phase 3 "two initial searches" defect). Skip until date is set,
    // so first paint issues EXACTLY ONE SearchSRB001List.
    if (!form.date) return;

    let cancelled = false;
    // A new load: bump the generation so any in-flight slot response from the
    // previous form is cached but never painted.
    if (queueRef.current) queueRef.current.bumpGeneration();

    setStatus((s) => ({ ...s, done: false, error: undefined, inFlight: 0 }));

    (async () => {
      let roomList: Room[];
      try {
        roomList = await fetchRooms(form);
      } catch (e) {
        if (cancelled) return;
        // Leave the previous board intact; surface the error on the status line.
        setStatus((s) => ({ ...s, done: true, error: (e as Error).message }));
        return;
      }
      if (cancelled) return;

      const filtered = applyClientFilters(roomList, form);

      // Skeleton rows painted immediately from the room list.
      setRows(filtered.map((room) => ({ room, state: { kind: 'skeleton' } as RowState })));
      startRef.current = Date.now();
      setStatus({
        total: filtered.length,
        loaded: 0,
        failed: 0,
        inFlight: 0,
        elapsedMs: 0,
        done: filtered.length === 0,
      });

      if (filtered.length === 0) return;

      // Build the single-flight queue. The fetcher is the ONLY network call for
      // slots; the queue guarantees exactly one is in flight at a time.
      const queue = createSlotQueue({
        fetcher: (room: Room) => fetchSlots(room, form.date),
        date: form.date,
        window: DAY_WINDOW,
        status: 'All',
        cache: cacheRef.current,
        onLoaded: (roomId, slots) => {
          if (cancelled) return;
          paint(roomId, slots);
          setStatus((s) => ({
            ...s,
            loaded: s.loaded + 1,
            inFlight: queue.inFlight,
            elapsedMs: Date.now() - startRef.current,
          }));
        },
        onError: (roomId, error) => {
          if (cancelled) return;
          markFailed(roomId, error);
          setStatus((s) => ({
            ...s,
            failed: s.failed + 1,
            inFlight: queue.inFlight,
            elapsedMs: Date.now() - startRef.current,
          }));
        },
        onProgress: () => {
          if (cancelled) return;
          setStatus((s) => ({ ...s, inFlight: queue.inFlight }));
        },
        onDone: () => {
          if (cancelled) return;
          setStatus((s) => ({
            ...s,
            done: true,
            inFlight: 0,
            elapsedMs: Date.now() - startRef.current,
          }));
        },
      });
      queueRef.current = queue;
      queue.enqueue(filtered);

      // Prioritise whatever rows are already in the viewport before draining.
      for (const [roomId, el] of rowEls.current) {
        if (isInViewport(el)) queue.prioritize(roomId);
      }
      void queue.run();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A ticking elapsed clock while the fill is running.
  React.useEffect(() => {
    if (status.done) return;
    const t = setInterval(() => {
      setStatus((s) => (s.done ? s : { ...s, elapsedMs: Date.now() - startRef.current }));
    }, 250);
    return () => clearInterval(t);
  }, [status.done]);

  // One IntersectionObserver for the whole board: a row scrolling into view
  // jumps the queue so visible rooms fill first.
  React.useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const q = queueRef.current;
        if (!q) return;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.roomId;
          if (id) q.prioritize(id);
        }
      },
      { root: null, rootMargin: '200px 0px', threshold: 0 }
    );
    ioRef.current = io;
    for (const el of rowEls.current.values()) io.observe(el);
    return () => {
      io.disconnect();
      ioRef.current = null;
    };
  }, []);

  const observeRow = React.useCallback((roomId: string, el: HTMLElement | null) => {
    const prev = rowEls.current.get(roomId);
    if (prev && prev !== el) ioRef.current?.unobserve(prev);
    if (el) {
      el.dataset.roomId = roomId;
      rowEls.current.set(roomId, el);
      ioRef.current?.observe(el);
    } else if (prev) {
      ioRef.current?.unobserve(prev);
      rowEls.current.delete(roomId);
    }
  }, []);

  const retryRoom = React.useCallback(
    (roomId: string) => {
      const q = queueRef.current;
      const row = rows.find((r) => r.room.id === roomId);
      if (!q || !row) return;
      // Drop the cached failure (there is none cached on error) and re-enqueue.
      cacheRef.current.delete(slotCacheKey(roomId, form.date, DAY_WINDOW, 'All'));
      setRows((prev) =>
        prev.map((r) => (r.room.id === roomId ? { ...r, state: { kind: 'skeleton' } } : r))
      );
      setStatus((s) => ({ ...s, failed: Math.max(0, s.failed - 1), done: false }));
      q.enqueue(row.room);
      q.prioritize(roomId);
      void q.run();
    },
    [rows, form.date]
  );

  return { axis, rows, status, observeRow, retryRoom };
}

function isInViewport(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return r.top < vh && r.bottom > 0;
}
