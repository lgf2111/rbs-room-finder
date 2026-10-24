/*
 * src/components/SearchView.tsx
 *
 * The Search route body: the full availability board (unchanged engine), the
 * top bar, and the multi-slot selection CART.
 *
 * This is the one route with mapped JSON endpoints, so it keeps everything the
 * board had: skeleton rows -> lazy single-flight slot fill, the generation
 * counter, the per-room cache, room photos harvested from the hidden native
 * cards, and the board keyboard shortcuts. The selection is now a LIST of
 * ranges (click / shift-range / cmd-add / click-to-remove), surfaced as a cart.
 *
 * Auto-reveal: if the room-list fetch fails repeatedly (>= 3 in a row, matching
 * content/native.js shouldRevealNative), Nova reveals the native page so the
 * user is never stuck on a board that cannot load.
 */
import * as React from 'react';

import { Board, buildCart, type Selection } from '@/components/Board';
import { SelectionDrawer } from '@/components/SelectionDrawer';
import { TopBar } from '@/components/TopBar';
import { applyClick, removeRange } from '@/lib/selection';
import {
  DAY_WINDOW,
  keyToAction,
  type BoardForm,
} from '@/lib/native-bridge';
import { harvestAndCache, loadCache, loadRoomPhotos, pathsToDataUris } from '@/lib/room-images';
import { useBoard } from '@/lib/useBoard';

function statusSentence(s: {
  total: number;
  loaded: number;
  failed: number;
  freeSlots: number;
  done: boolean;
  error?: string;
}): string {
  if (s.error) return s.error;
  if (s.total === 0) return s.done ? 'No rooms' : 'Loading rooms…';
  const parts: string[] = [];
  parts.push(`${s.total} ${s.total === 1 ? 'room' : 'rooms'}`);
  parts.push(`${s.freeSlots} free ${s.freeSlots === 1 ? 'slot' : 'slots'}`);
  if (!s.done) parts.push(`loading ${s.loaded}/${s.total}`);
  else if (s.failed > 0) parts.push(`${s.failed} failed`);
  return parts.join(' · ');
}

const INITIAL_FORM: BoardForm = {
  building: '',
  roomType: '',
  minCapacity: 0,
  search: '',
  date: '',
  window: { start: DAY_WINDOW.start, end: DAY_WINDOW.end },
  sort: 'name',
};

const MAX_CONSECUTIVE_FAILURES = 3;

export function SearchView({ onRevealNative }: { onRevealNative: () => void }) {
  const [form, setForm] = React.useState<BoardForm>(INITIAL_FORM);
  const [cursor, setCursor] = React.useState(0);
  const [selection, setSelection] = React.useState<Selection>([]);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const model = useBoard(form);
  const { rows, axis, status } = model;

  // Room photos: cache-first, then the live DOM harvest (defect B). The cache
  // lives in chrome.storage.local under one key; every render harvests any
  // native cards present and merges them in, so the map only grows and warm
  // reloads paint photos immediately with no action.
  const [imageMap, setImageMap] = React.useState<Record<string, string>>({});
  const [loadingPhotos, setLoadingPhotos] = React.useState(false);
  const roomsKey = React.useMemo(() => rows.map((r) => r.room.id).join(','), [rows]);

  // Seed from the persisted cache on mount so a warm cache renders instantly.
  React.useEffect(() => {
    let cancelled = false;
    loadCache().then((paths) => {
      if (!cancelled) setImageMap((prev) => ({ ...pathsToDataUris(paths), ...prev }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Harvest + cache on every render pass (cheap) and whenever the rooms change.
  React.useEffect(() => {
    let cancelled = false;
    const harvest = () => {
      harvestAndCache().then((merged) => {
        if (!cancelled) setImageMap((prev) => ({ ...prev, ...merged }));
      });
    };
    harvest();
    const t = setTimeout(harvest, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomsKey, status.done]);

  // Which visible rows still have no image? The "Load room photos" action is
  // shown only while at least one does, and removes itself once every row has
  // an image.
  const missingPhotos = React.useMemo(
    () => rows.some((r) => !imageMap[r.room.id]),
    [rows, imageMap]
  );
  const showLoadPhotos = rows.length > 0 && missingPhotos;

  const onLoadPhotos = React.useCallback(() => {
    if (loadingPhotos) return;
    setLoadingPhotos(true);
    loadRoomPhotos()
      .then((merged) => setImageMap((prev) => ({ ...prev, ...merged })))
      .finally(() => setLoadingPhotos(false));
  }, [loadingPhotos]);

  // Auto-reveal the native UI after repeated room-list failures, so a broken
  // board never traps the user. We count only settled loads (status.done).
  const failRef = React.useRef(0);
  React.useEffect(() => {
    if (!status.done) return;
    if (status.error) {
      failRef.current += 1;
      if (failRef.current >= MAX_CONSECUTIVE_FAILURES) onRevealNative();
    } else {
      failRef.current = 0;
    }
  }, [status.done, status.error, onRevealNative]);

  // Keep the cursor within the current row set.
  React.useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  const onForm = React.useCallback((f: BoardForm) => {
    setForm(f);
    setSelection([]);
  }, []);

  // Multi-slot selection: apply a click (with modifiers) to the range list.
  const onCellClick = React.useCallback(
    (roomId: string, idx: number, mods: { shift: boolean; meta: boolean }) => {
      setSelection((prev) => applyClick(prev, roomId, idx, mods));
      const i = rows.findIndex((r) => r.room.id === roomId);
      if (i >= 0) setCursor(i);
    },
    [rows]
  );

  // Keyboard shortcuts (native.js keyToAction maps the key -> action). The "d"
  // (toggle native) shortcut is owned by the shell so it works on every route.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const inInput =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const action = keyToAction(e.key.toLowerCase(), { inInput });
      if (!action || action === 'toggleNative') return;
      e.preventDefault();
      switch (action) {
        case 'focusSearch':
          searchRef.current?.focus();
          break;
        case 'rowDown':
          setCursor((c) => Math.min(rows.length - 1, c + 1));
          break;
        case 'rowUp':
          setCursor((c) => Math.max(0, c - 1));
          break;
        case 'handoff': {
          const row = rows[cursor];
          if (row) setSelection((prev) => applyClick(prev, row.room.id, 0, { shift: false, meta: true }));
          break;
        }
        case 'clear':
          setSelection([]);
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, cursor]);

  const cart = React.useMemo(
    () => buildCart(axis, rows, selection, form.date),
    [axis, rows, selection, form.date]
  );

  const freeSlots = React.useMemo(() => {
    let n = 0;
    for (const r of rows) {
      if (r.state.kind !== 'loaded') continue;
      for (const c of r.state.cells) if (c && c.state === 'free') n++;
    }
    return n;
  }, [rows]);

  const statusLine = (
    <span data-testid="nova-status-counts">
      {statusSentence({
        total: status.total,
        loaded: status.loaded,
        failed: status.failed,
        freeSlots,
        done: status.done,
        error: status.error,
      })}
    </span>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <TopBar
        onForm={onForm}
        onForceReload={model.reload}
        statusLine={statusLine}
        onRevealNative={onRevealNative}
        searchRef={searchRef}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <Board
          model={model}
          form={form}
          images={imageMap}
          cursorIndex={cursor}
          selection={selection}
          onCellClick={onCellClick}
          registerRowRef={model.observeRow}
          onRevealNative={onRevealNative}
          showLoadPhotos={showLoadPhotos}
          loadingPhotos={loadingPhotos}
          onLoadPhotos={onLoadPhotos}
        />
      </div>
      <SelectionDrawer
        model={cart}
        onRemove={(id) => setSelection((prev) => removeRange(prev, id))}
        onClear={() => setSelection([])}
      />
    </div>
  );
}
