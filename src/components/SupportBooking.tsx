/*
 * src/components/SupportBooking.tsx
 *
 * Interactive Support Booking route (/SPT001/SPT001Page). Fetches and parses the
 * reservations table (#bookingList) into a nova table. Per-row actions (Cancel,
 * Raise support request) HAND OFF to the native page for that reservation — the
 * cancel endpoint is NOT mapped, so nova never cancels by itself and never
 * claims success. A primary "New booking" routes to the search board.
 */
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { fetchReservations, type ReservationRow } from '@/lib/page-content';
import { SEARCH_PATH, SUPPORT_BOOKING_PATH, type RouteInfo } from '@/lib/router';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: ReservationRow[] }
  | { kind: 'error'; message: string };

export function SupportBooking({
  route,
  navigate,
  onRevealNative,
  onCount,
}: {
  route: RouteInfo;
  navigate: (path: string) => void;
  onRevealNative: () => void;
  /** Report the row count so the shell/status line can show it. */
  onCount?: (n: number) => void;
}) {
  const [state, setState] = React.useState<State>({ kind: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    fetchReservations(route.path)
      .then((rows) => {
        if (cancelled) return;
        setState({ kind: 'ready', rows });
        onCount?.(rows.length);
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ kind: 'error', message: e.message || 'could not load reservations' });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.path]);

  // Both per-row actions reveal the native Support Booking page so the user can
  // act on that reservation there. Nova does NOT cancel or raise by itself.
  const handoff = React.useCallback(() => {
    onRevealNative();
  }, [onRevealNative]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6" data-testid="nova-support-booking">
      <div className="mb-3 flex items-center gap-3">
        <h1 className="text-lg font-semibold text-foreground">Support Booking</h1>
        <span className="text-xs text-muted-foreground" data-testid="nova-sb-count">
          {state.kind === 'ready'
            ? `${state.rows.length} reservation${state.rows.length === 1 ? '' : 's'}`
            : state.kind === 'loading'
              ? 'loading…'
              : ''}
        </span>
        <Button
          className="ml-auto h-control"
          onClick={() => navigate(SEARCH_PATH)}
          data-testid="nova-sb-new"
        >
          New booking
        </Button>
      </div>

      {state.kind === 'loading' && (
        <div className="text-sm text-muted-foreground" data-testid="nova-sb-loading">
          Loading reservations…
        </div>
      )}

      {state.kind === 'error' && (
        <div className="flex flex-col items-start gap-3 text-sm" data-testid="nova-sb-error">
          <p className="text-muted-foreground">
            Nova could not load your reservations ({state.message}).
          </p>
          <Button variant="outline" onClick={onRevealNative} data-testid="nova-sb-reveal">
            Show the native page
          </Button>
        </div>
      )}

      {state.kind === 'ready' && state.rows.length === 0 && (
        <div className="flex flex-col items-start gap-2 text-sm" data-testid="nova-sb-empty">
          <div className="font-medium text-foreground">No reservations</div>
          <p className="text-muted-foreground">
            You have no Support Booking reservations. Start one from the board.
          </p>
        </div>
      )}

      {state.kind === 'ready' && state.rows.length > 0 && (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="nova-sb-table w-full text-sm" data-testid="nova-sb-list">
            <thead>
              <tr>
                <th>Room</th>
                <th>Date</th>
                <th>Time</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((r) => (
                <tr key={r.id} data-testid="nova-sb-row" data-booking-id={r.id}>
                  <td className="nova-mono">{r.room}</td>
                  <td className="nova-mono">{r.date}</td>
                  <td className="nova-mono">{r.time}</td>
                  <td>{r.status}</td>
                  <td className="whitespace-nowrap">
                    <Button
                      size="sm"
                      variant="outline"
                      className="mr-2"
                      onClick={handoff}
                      data-testid="nova-sb-cancel"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handoff}
                      data-testid="nova-sb-raise"
                    >
                      Raise support request
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-muted-foreground" data-testid="nova-sb-note">
            Nova does not cancel or raise requests by itself — both actions open
            the native Support Booking page so you complete them there.
          </p>
        </div>
      )}
    </div>
  );
}

// Re-export so App can reference the canonical path without a second import.
export { SUPPORT_BOOKING_PATH };
