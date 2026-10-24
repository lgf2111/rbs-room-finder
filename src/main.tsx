/*
 * src/main.tsx
 *
 * Entry point for the Nova (React + shadcn) panel, compiled to a classic IIFE
 * (content/nova.bundle.js).
 *
 * Phase 3: Nova is the DEFAULT skin on the search page. There is no query flag
 * to turn it on. The only flag left is the escape hatch `?nova=0`, which
 * disables Nova for one release and lets the old content/panel.js board render
 * instead. content/panel.js reads the SAME decision (novaDefaultOn) and stands
 * down on the search page whenever Nova will own it, so the two UIs never race
 * or double-fetch.
 *
 * Mounting is a SINGLETON and IDEMPOTENT:
 *   - a window guard (window.__rbsNovaMounted) and a marker on the host
 *     (data-nova-mounted="1") make every entry point a no-op after the first
 *     successful mount: DOMContentLoaded, a direct call, a bridge callback, an
 *     observer, or a re-injection of the bundle all collapse to one mount.
 *   - any stale `.nova-root` children from a previous attempt are REMOVED (the
 *     React root is unmounted first), never merely hidden, so the shadow root
 *     ends with exactly one nova-app + one nova-portal.
 *
 * MV3 content-script isolated world rules this file obeys:
 *   - no runtime ESM / CDN / eval: everything is bundled by esbuild.
 *   - the UI lives in a Shadow DOM so RBS WebForms styles cannot bleed in.
 *   - the compiled Tailwind CSS is injected as a <style> in that same shadow
 *     root (imported here as a string via the esbuild text loader).
 *   - Radix portals are redirected into the shadow root (PortalContainerProvider).
 *   - no Promise.all anywhere in the load path.
 */
import { createRoot, type Root } from 'react-dom/client';

import { App } from '@/App';
import { PortalContainerProvider } from '@/lib/portal-container';
// Compiled Tailwind, inlined as text (esbuild loader { '.css': 'text' }).
import tailwindCss from '@/styles/tailwind.out.css';

const HOST_ID = 'rbs-room-finder-host';

/**
 * The single source of truth for "is Nova on?". Nova now owns the ENTIRE RBS
 * origin: it mounts on ANY path of https://rbs.singaporetech.edu.sg/* (the
 * content script already matches the whole origin). It is turned OFF only by
 * the `?nova=0` escape hatch, which leaves the untouched native page (and the
 * old content/panel.js launcher) in place. content/panel.js mirrors this exact
 * logic so only one of the two UIs ever mounts, and only one nova root exists
 * per document (the singleton guard below).
 */
function novaDefaultOn(): boolean {
  try {
    if (/(?:^|[?&])nova=0(?:&|$)/.test(location.search)) return false; // escape hatch
    return true; // own every path on the origin
  } catch {
    return false;
  }
}

interface NovaGuard {
  mounted: boolean;
  root?: Root;
}

function guard(): NovaGuard {
  const w = window as unknown as { __rbsNovaMounted?: NovaGuard };
  if (!w.__rbsNovaMounted) w.__rbsNovaMounted = { mounted: false };
  return w.__rbsNovaMounted;
}

/** Remove any existing `.nova-root` children (unmounting React first). */
function clearNovaRoots(shadow: ShadowRoot): void {
  const g = guard();
  if (g.root) {
    try {
      g.root.unmount();
    } catch {
      /* already gone */
    }
    g.root = undefined;
  }
  shadow.querySelectorAll('.nova-root').forEach((n) => n.remove());
}

function mount(): void {
  if (!novaDefaultOn()) return; // escape hatch: leave the old panel.js path alone.

  const g = guard();
  if (g.mounted) return; // singleton: already mounted, every other entry is a no-op.

  // The host may already exist (panel.js creates it for ?nova=0; it also may be
  // left over from a prior attempt). Reuse it and own its shadow root.
  let hostEl = document.getElementById(HOST_ID) as HTMLElement | null;
  if (hostEl && hostEl.getAttribute('data-nova-mounted') === '1') {
    g.mounted = true; // a previous successful mount marked the host; respect it.
    return;
  }

  let shadow: ShadowRoot;
  if (hostEl && hostEl.shadowRoot) {
    shadow = hostEl.shadowRoot;
  } else {
    if (!hostEl) {
      hostEl = document.createElement('div');
      hostEl.id = HOST_ID;
      document.body.appendChild(hostEl);
    }
    shadow = hostEl.attachShadow({ mode: 'open' });
  }

  // Idempotency: drop any stale roots/styles from a half-finished prior attempt
  // so we never stack a second (or third) nova-root in the same shadow.
  clearNovaRoots(shadow);
  shadow.querySelectorAll('style[data-nova-style]').forEach((n) => n.remove());

  hostEl.setAttribute('data-nova', '1');

  // Inject the compiled Tailwind stylesheet into the shadow root.
  const style = document.createElement('style');
  style.setAttribute('data-nova-style', '1');
  style.textContent = tailwindCss as unknown as string;
  shadow.appendChild(style);

  // Exactly ONE `.nova-root` lives in the shadow root: a single wrapper that
  // carries the theme tokens / base styles. The React mount container and the
  // Radix portal target are plain SIBLINGS inside it (the portal must not be a
  // child of the React container, or React would wipe it on render). Both still
  // inherit `.nova-root` theming from this one ancestor, so portalled
  // Select/Popover/Dialog are styled by the same stylesheet.
  const novaRoot = document.createElement('div');
  novaRoot.className = 'nova-root';
  novaRoot.setAttribute('data-nova-root', '1');
  shadow.appendChild(novaRoot);

  const container = document.createElement('div');
  container.id = 'nova-app';
  novaRoot.appendChild(container);

  const portalContainer = document.createElement('div');
  portalContainer.id = 'nova-portal';
  novaRoot.appendChild(portalContainer);

  // NOTE: intentionally NOT wrapped in <StrictMode>. StrictMode double-invokes
  // effects in development, which would fire the initial board load twice (two
  // SearchSRB001List calls and a duplicated slot fill). Exactly one initial
  // search is a hard requirement, so the tree mounts once.
  const root = createRoot(container);
  g.root = root;
  root.render(
    <PortalContainerProvider container={portalContainer}>
      <App />
    </PortalContainerProvider>
  );

  // Mark success on BOTH the window guard and the host so any later entry point
  // (re-injection, observer, bridge callback) short-circuits immediately.
  g.mounted = true;
  hostEl.setAttribute('data-nova-mounted', '1');
}

// Exactly one wiring of the entry point. The singleton guard makes repeated
// calls harmless, but we also avoid registering duplicate listeners.
if (document.body) {
  mount();
} else {
  window.addEventListener('DOMContentLoaded', mount, { once: true });
}
