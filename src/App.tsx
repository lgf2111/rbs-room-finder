/*
 * src/App.tsx
 *
 * Phase 2B app shell: the shadcn top bar PLUS the ported board.
 *
 * App owns the BoardForm (emitted by the top bar), runs the board engine
 * (useBoard: skeleton rows -> lazy single-flight slot fill), and wires the
 * range-selection drawer, the keyboard shortcuts and the booking handoff. It
 * hides the native RBS chrome on mount so the app owns the viewport, and
 * reveals it again for the handoff / on failure.
 */
import * as React from 'react';

import { Board, selectionSummary, type Selection } from '@/components/Board';
import { SelectionDrawer, type DrawerModel } from '@/components/SelectionDrawer';
import { TopBar } from '@/components/TopBar';
import {
  DAY_WINDOW,
  harvestRoomImages,
  hideNativeUI,
  imgPathToDataUri,
  keyToAction,
  revealNativeUI,
  type BoardForm,
} from '@/lib/native-bridge';

/**
 * Build the status line as a human sentence:
 *   "6 rooms · 144 free slots · loading 3/6"      (while filling)
 *   "6 rooms · 144 free slots"                     (done, no failures)
 *   "6 rooms · 140 free slots · 1 failed"          (done, with failures)
 *   "0 rooms"                                      (empty)
 * An explicit error is appended when the room-list fetch failed.
 */
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
import { useBoard } from '@/lib/useBoard';

const INITIAL_FORM: BoardForm = {
  building: '',
  roomType: '',
  minCapacity: 0,
  search: '',
  date: '',
  window: { start: DAY_WINDOW.start, end: DAY_WINDOW.end },
  sort: 'name',
};

export function App() {
  const [form, setForm] = React.useState<BoardForm>(INITIAL_FORM);
  const [cursor, setCursor] = React.useState(0);
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const model = useBoard(form);
  const { rows, axis, status } = model;

  // Room photos: the JSON API carries none, so harvest the hidden native result
  // cards (rsrcId -> base64 PNG) and expose them as data: URIs. The native list
  // is re-rendered per search, so re-harvest whenever the room set changes (and
  // again once the fill is done, in case the native cards arrived late).
  const [imageMap, setImageMap] = React.useState<Record<string, string>>({});
  const roomsKey = React.useMemo(() => rows.map((r) => r.room.id).join(','), [rows]);
  React.useEffect(() => {
    const harvest = () => {
      const raw = harvestRoomImages();
      const next: Record<string, string> = {};
      for (const id of Object.keys(raw)) next[id] = imgPathToDataUri(raw[id]);
      setImageMap(next);
    };
    harvest();
    // A second pass shortly after lets a late native re-render settle.
    const t = setTimeout(harvest, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomsKey, status.done]);

  // Hide the native page while the app is mounted; always reveal on unmount.
  React.useEffect(() => {
    hideNativeUI();
    return () => revealNativeUI();
  }, []);

  // Keep the cursor within the current row set.
  React.useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  const onForm = React.useCallback((f: BoardForm) => {
    setForm(f);
    setSelection(null);
  }, []);

  const onSelectRange = React.useCallback(
    (roomId: string, startIdx: number, endIdx: number, extend: boolean) => {
      setSelection((prev) => {
        if (extend && prev && prev.roomId === roomId) {
          return { roomId, startIdx: prev.startIdx, endIdx };
        }
        return { roomId, startIdx, endIdx };
      });
      const i = rows.findIndex((r) => r.room.id === roomId);
      if (i >= 0) setCursor(i);
    },
    [rows]
  );

  const revealNative = React.useCallback(() => {
    revealNativeUI();
    const host = document.getElementById('rbs-room-finder-host');
    if (host) host.style.display = 'none';
  }, []);

  // Keyboard shortcuts (native.js keyToAction maps the key -> action).
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const inInput =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const action = keyToAction(e.key.toLowerCase(), { inInput });
      if (!action) return;
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
          if (row) onSelectRange(row.room.id, 0, axis.length - 1, false);
          break;
        }
        case 'toggleNative':
          revealNative();
          break;
        case 'clear':
          setSelection(null);
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, cursor, axis.length, onSelectRange, revealNative]);

  const drawer: DrawerModel | null = React.useMemo(() => {
    if (!selection) return null;
    return selectionSummary(axis, rows, selection, form.date);
  }, [selection, axis, rows, form.date]);

  // Count free slots across the rooms whose slots have loaded, so the status
  // line can read like a sentence ("6 rooms · 144 free slots · loading 3/6").
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
    <div className="flex h-screen min-h-0 w-full flex-col">
      <TopBar
        onForm={onForm}
        onForceReload={model.reload}
        statusLine={statusLine}
        onRevealNative={revealNative}
        searchRef={searchRef}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <Board
          model={model}
          form={form}
          images={imageMap}
          cursorIndex={cursor}
          selection={selection}
          onSelectRange={onSelectRange}
          registerRowRef={model.observeRow}
        />
      </div>
      <SelectionDrawer model={drawer} onClose={() => setSelection(null)} />
    </div>
  );
}
