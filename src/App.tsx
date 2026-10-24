/*
 * src/App.tsx
 *
 * Full-site takeover shell.
 *
 * Nova now owns the ENTIRE RBS origin, not just the search page. App is the
 * persistent application shell:
 *
 *   - a top bar with the brand, the RBS building context, and nav
 *     (Search / Bookings / Help), plus a persistent, keyboard-reachable
 *     "Native UI" escape hatch — all rendered ONCE and surviving route changes
 *     (no remount flash, no duplicated chrome);
 *   - a client-side router over the History API (src/lib/router): nav clicks
 *     pushState the real RBS paths, popstate restores the view, and a deep link
 *     to any path renders that route directly;
 *   - a route-aware body: the Search route is the full board (SearchView);
 *     Bookings / Help / any unmapped path get an honest screen that names the
 *     missing endpoint and reveals the native page.
 *
 * It hides the native DOM on mount (class on <html>, nodes never removed) and
 * reveals it for the Native UI control, the booking handoff, or auto-reveal
 * after repeated failures. content/native.js is untouched.
 */
import * as React from 'react';

import { SearchView } from '@/components/SearchView';
import { UnmappedScreen } from '@/components/UnmappedScreen';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  hideNativeUI,
  readBuildings,
  revealNativeUI,
  type NativeOption,
} from '@/lib/native-bridge';
import { NAV_ITEMS, useRouter, type RouteInfo } from '@/lib/router';

const HOST_ID = 'rbs-room-finder-host';

/** Reveal the untouched native page for the current URL and hide the Nova app. */
function revealNativeAndHideApp(): void {
  revealNativeUI();
  const host = document.getElementById(HOST_ID);
  if (host) host.style.display = 'none';
}

/** The brand + building context + nav + the persistent Native UI control. */
function Shell({
  route,
  navigate,
  onRevealNative,
  building,
}: {
  route: RouteInfo;
  navigate: (path: string) => void;
  onRevealNative: () => void;
  building: string;
}) {
  return (
    <header
      data-testid="nova-shell"
      className="flex items-center gap-4 border-b border-border bg-card px-4 py-2"
    >
      <div className="flex items-center gap-2">
        <span className="rounded bg-primary px-1.5 py-0.5 text-[11px] font-bold text-primary-foreground">
          RBS
        </span>
        <span className="text-sm font-semibold text-foreground">Room Finder</span>
      </div>

      <span aria-hidden className="text-muted-foreground">
        ·
      </span>
      <span className="text-xs text-muted-foreground" data-testid="nova-shell-building">
        {building || 'SIT Room Booking'}
      </span>

      <nav className="ml-4 flex items-center gap-1" data-testid="nova-nav" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active = item.kind === route.kind;
          return (
            <button
              key={item.kind}
              type="button"
              data-testid={`nova-nav-${item.kind}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(item.path)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                active
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Persistent, unobtrusive escape hatch — present on every route and
          keyboard reachable. The one thing between the user and a site they
          cannot use if Nova breaks. */}
      <Button
        variant="secondary"
        className="ml-auto h-control"
        onClick={onRevealNative}
        data-testid="nova-native-btn"
      >
        Native UI
      </Button>
    </header>
  );
}

export function App() {
  const { route, navigate } = useRouter();

  // Hide the native page while Nova is mounted; always reveal on unmount so the
  // page is never left with neither UI.
  React.useEffect(() => {
    hideNativeUI();
    return () => revealNativeUI();
  }, []);

  // Re-hide the native page on every Nova navigation: a prior Native UI reveal
  // (or an unmapped-screen reveal) hid the host and showed the native body; when
  // the user navigates back into a Nova route we take the viewport back.
  React.useEffect(() => {
    const host = document.getElementById(HOST_ID);
    if (host) host.style.display = '';
    hideNativeUI();
  }, [route.href]);

  // Building context for the shell: read once from the native building select
  // (its selected option), falling back to a generic label on unmapped pages
  // that carry no such control.
  const building = React.useMemo(() => {
    try {
      const opts: NativeOption[] = readBuildings();
      const sel = document.getElementById('building') as HTMLSelectElement | null;
      const current = sel?.value ?? '';
      const match = opts.find((o) => o.value === current && o.value);
      return match ? `Building ${match.text}` : opts.find((o) => o.value)?.text ? `Building ${opts.find((o) => o.value)!.text}` : '';
    } catch {
      return '';
    }
  }, [route.href]);

  // A persistent "d" shortcut reveals the native UI from anywhere (matching the
  // keyToAction('d') contract). It lives at the shell so it works on every
  // route, not just the board.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const inInput =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (inInput) return;
      if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        revealNativeAndHideApp();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-screen min-h-0 w-full flex-col">
      <Shell
        route={route}
        navigate={navigate}
        onRevealNative={revealNativeAndHideApp}
        building={building}
      />
      <div className="min-h-0 flex-1 overflow-hidden" data-testid="nova-body">
        {route.kind === 'search' ? (
          <SearchView onRevealNative={revealNativeAndHideApp} />
        ) : (
          <UnmappedScreen route={route} onRevealNative={revealNativeAndHideApp} />
        )}
      </div>
    </div>
  );
}
