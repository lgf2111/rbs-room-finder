/*
 * src/components/UnmappedScreen.tsx
 *
 * The HONEST screen for any route Nova does not have data for (Bookings, Help,
 * and every path we have not mapped). It NEVER invents rows, bookings, or data.
 * It names the page and the endpoint that is missing, and offers a button that
 * reveals the untouched native UI for exactly this URL.
 *
 * The persistent "Native UI" escape hatch in the shell does the same thing; this
 * in-body button is the obvious, contextual way to get to the real page from the
 * screen that is explaining why Nova cannot render it.
 */
import * as React from 'react';

import { Button } from '@/components/ui/button';
import type { RouteInfo } from '@/lib/router';

export function UnmappedScreen({
  route,
  onRevealNative,
}: {
  route: RouteInfo;
  onRevealNative: () => void;
}) {
  return (
    <div
      data-testid="nova-unmapped"
      data-route-kind={route.kind}
      className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-4 p-8 text-center"
    >
      <div className="flex max-w-md flex-col items-center gap-3">
        <div className="text-base font-semibold text-foreground" data-testid="nova-unmapped-title">
          {route.title}
        </div>
        <p className="text-sm text-muted-foreground">
          Nova owns the whole RBS site, but it only has a data API for the room
          search board. This page is not mapped, so Nova will not show you
          invented {route.kind === 'bookings' ? 'bookings' : 'data'}.
        </p>
        <div
          className="w-full rounded-md border border-border bg-secondary p-3 text-left"
          data-testid="nova-unmapped-endpoint"
        >
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Current path
          </div>
          <div className="nova-mono text-[12px] text-foreground">{route.path}</div>
          <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            Missing endpoint
          </div>
          <div className="nova-mono text-[12px] text-foreground">
            {route.missingEndpoint ?? 'not mapped'}
          </div>
        </div>
        <Button onClick={onRevealNative} data-testid="nova-unmapped-reveal">
          Show the native page
        </Button>
        <p className="text-[11px] text-muted-foreground">
          This reveals the untouched RBS page for this URL. Nothing is hidden
          from you — if Nova can&apos;t help, the real site is one click away.
        </p>
      </div>
    </div>
  );
}
