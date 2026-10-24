/*
 * src/lib/router.ts
 *
 * A tiny client-side router over the History API, scoped to the RBS origin.
 *
 * Nova now owns the ENTIRE origin (every path of https://rbs.singaporetech.edu.sg/*),
 * not just the search page. The app shell (brand + nav + the persistent Native
 * UI escape hatch) is rendered ONCE and survives route changes; only the body
 * swaps. Navigation is real: a nav click pushState()s the actual RBS path, so a
 * deep link or a browser Back/Forward lands on the right view. popstate restores
 * the view for whatever URL the history now points at.
 *
 * We never touch content/native.js. The route table maps the one path we have
 * data for (the search board) and treats EVERYTHING ELSE as an honest "unmapped"
 * route that names the page and the endpoint we do not have — Nova never invents
 * rows or bookings for an endpoint it cannot call.
 */
import * as React from 'react';

/** The one path whose JSON endpoints we actually drive. */
export const SEARCH_PATH = '/SRB001/SRB001Page';

export type RouteKind = 'search' | 'bookings' | 'help' | 'unmapped';

export interface RouteInfo {
  kind: RouteKind;
  /** The current pathname (no query string). */
  path: string;
  /** The full path + search, used as a stable key. */
  href: string;
  /** Human page name for the shell / honest screen. */
  title: string;
  /**
   * The native endpoint this route WOULD need, named honestly on the unmapped
   * screen. Empty for the search route (which has mapped endpoints).
   */
  missingEndpoint?: string;
}

/** The nav items the shell renders. Each points at a REAL RBS path. */
export interface NavItem {
  kind: RouteKind;
  label: string;
  path: string;
}

export const NAV_ITEMS: NavItem[] = [
  { kind: 'search', label: 'Search', path: SEARCH_PATH },
  { kind: 'bookings', label: 'Bookings', path: '/SRB001/MyBookings' },
  { kind: 'help', label: 'Help', path: '/Home/Help' },
];

/** Classify a pathname into a route. Only the search path is "mapped". */
export function classifyRoute(pathname: string, search = ''): RouteInfo {
  const href = pathname + (search || '');
  if (pathname.indexOf(SEARCH_PATH) !== -1) {
    return { kind: 'search', path: pathname, href, title: 'Room search' };
  }
  // Bookings is a known-but-unmapped destination: we have no bookings endpoint,
  // so it gets an honest screen rather than fabricated reservations.
  if (/\/MyBookings|\/Bookings/i.test(pathname)) {
    return {
      kind: 'bookings',
      path: pathname,
      href,
      title: 'My bookings',
      missingEndpoint: 'POST /SRB001/GetMyBookingList (not mapped)',
    };
  }
  if (/\/Help/i.test(pathname)) {
    return { kind: 'help', path: pathname, href, title: 'Help', missingEndpoint: '(static native help page)' };
  }
  // Anything else on the origin: honest unmapped screen naming the path.
  return {
    kind: 'unmapped',
    path: pathname,
    href,
    title: 'Page not mapped',
    missingEndpoint: `the JSON endpoint behind ${pathname} is not mapped`,
  };
}

function currentRoute(): RouteInfo {
  try {
    return classifyRoute(location.pathname, location.search);
  } catch {
    return classifyRoute(SEARCH_PATH);
  }
}

/**
 * The router hook. Returns the current route and a `navigate` that pushState()s
 * a real RBS path (so Back/Forward and deep links all work). A same-path
 * navigate is a no-op so the shell never remounts needlessly.
 */
export function useRouter(): { route: RouteInfo; navigate: (path: string) => void } {
  const [route, setRoute] = React.useState<RouteInfo>(() => currentRoute());

  React.useEffect(() => {
    const onPop = () => setRoute(currentRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = React.useCallback((path: string) => {
    try {
      const target = classifyRoute(path);
      if (target.href === location.pathname + location.search) {
        // Already here — still sync state (e.g. first click), no history entry.
        setRoute(target);
        return;
      }
      history.pushState({ nova: true }, '', path);
      setRoute(classifyRoute(location.pathname, location.search));
    } catch {
      /* navigation is best-effort; the escape hatch always works */
    }
  }, []);

  return { route, navigate };
}
