/*
 * src/components/SelectionDrawer.tsx
 *
 * The range-selection drawer. It shows the selected room, the derived window,
 * the slot count and any conflict, and offers the booking HANDOFF only:
 * "Book on native form" reveals the native UI, names the room, clicks the
 * native room card and waits for a native signal. It NEVER clicks a submit
 * button (handoffToNative in native-bridge refuses any FORBIDDEN_CLICK_IDS).
 */
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { handoffToNative, type Room } from '@/lib/native-bridge';

export interface DrawerModel {
  room: Room | null;
  window: { start: string; end: string; count: number };
  conflict: boolean;
}

export function SelectionDrawer({
  model,
  onClose,
}: {
  model: DrawerModel | null;
  onClose: () => void;
}) {
  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setStatus(null);
  }, [model?.room?.id, model?.window.start, model?.window.end]);

  if (!model || !model.room) return null;
  const room = model.room;

  async function onBook() {
    setBusy(true);
    setStatus(`Revealing the native form for ${room.serial || room.name}…`);
    const res = await handoffToNative(room);
    setBusy(false);
    if (res.ok) {
      setStatus(
        res.signal === 'detail-popup'
          ? 'Native detail popup opened. Confirm there — nothing is booked until you click Book.'
          : `${res.badge ?? 'Selected'}. Confirm on the native form — nothing is booked until you click Book.`
      );
    } else {
      setStatus(
        res.reason === 'card-not-found'
          ? 'Could not find the room card on the native page. Open the native UI and select it yourself.'
          : 'The selection did not take. Open the native UI and select the room yourself.'
      );
    }
  }

  return (
    <aside
      data-testid="nova-drawer"
      className="fixed right-0 top-0 z-40 flex h-full w-[300px] flex-col gap-3 border-l border-border bg-card p-4 shadow-lg"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold text-foreground">Selected slots</div>
          <div className="nova-mono text-xs text-muted-foreground">{room.serial || room.name}</div>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>

      <div className="rounded-md border border-border bg-secondary p-3">
        <div className="text-sm font-medium text-foreground">{room.name}</div>
        <div className="text-[11px] text-muted-foreground">{room.type}</div>
        <div className="text-[11px] text-muted-foreground">Capacity: {room.capacity}</div>
      </div>

      <div className="rounded-md border border-border p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Selected window</div>
        <div className="nova-mono text-sm text-foreground" data-testid="nova-drawer-window">
          {model.window.start} – {model.window.end}
        </div>
        <div className="text-[11px] text-muted-foreground">{model.window.count} slot(s)</div>
      </div>

      {model.conflict && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-[11px] text-destructive"
          data-testid="nova-drawer-conflict"
        >
          Selected range contains booked slots.
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <Button onClick={onBook} disabled={busy} data-testid="nova-book-btn">
          Book on native form
        </Button>
        <Button variant="outline" onClick={onClose}>
          Clear
        </Button>
        {status && (
          <div
            className={cn(
              'text-[11px]',
              status.includes('did not take') || status.includes('Could not')
                ? 'text-destructive'
                : 'text-muted-foreground'
            )}
            data-testid="nova-drawer-status"
          >
            {status}
          </div>
        )}
        <div className="text-[10px] text-muted-foreground">
          Nothing is booked until you click Book on the native form.
        </div>
      </div>
    </aside>
  );
}
