/*
 * src/main.tsx
 *
 * Entry point for the Nova (React + shadcn) panel, compiled to a classic IIFE
 * (content/nova.bundle.js). Phase 1: mount a shadcn top bar behind the ?nova=1
 * flag, INSTEAD of the old content/panel.js top bar.
 *
 * MV3 content-script isolated world rules this file obeys:
 *   - no runtime ESM / CDN / eval: everything is bundled by esbuild.
 *   - the UI lives in a Shadow DOM so RBS WebForms styles cannot bleed in.
 *   - the compiled Tailwind CSS is injected as a <style> in that same shadow
 *     root (imported here as a string via the esbuild text loader).
 *   - Radix portals are redirected into the shadow root (PortalContainerProvider).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/App';
import { PortalContainerProvider } from '@/lib/portal-container';
// Compiled Tailwind, inlined as text (esbuild loader { '.css': 'text' }).
import tailwindCss from '@/styles/tailwind.out.css';

const HOST_ID = 'rbs-room-finder-host';

/** Phase 1 trigger: only mount Nova when the URL carries ?nova=1. */
function novaEnabled(): boolean {
  try {
    return /(?:^|[?&])nova=1(?:&|$)/.test(location.search);
  } catch {
    return false;
  }
}

function mount() {
  if (!novaEnabled()) return; // flag off: leave the old panel.js path alone.

  // If the old panel already created a host, replace its shadow content with
  // Nova so the two UIs never stack. (panel.js stays the default without the flag.)
  let hostEl = document.getElementById(HOST_ID) as HTMLElement | null;
  let shadow: ShadowRoot;
  if (hostEl && hostEl.shadowRoot) {
    shadow = hostEl.shadowRoot;
    shadow.innerHTML = '';
  } else {
    if (!hostEl) {
      hostEl = document.createElement('div');
      hostEl.id = HOST_ID;
      document.body.appendChild(hostEl);
    }
    shadow = hostEl.attachShadow({ mode: 'open' });
  }
  hostEl.setAttribute('data-nova', '1');

  // Inject the compiled Tailwind stylesheet into the shadow root.
  const style = document.createElement('style');
  style.setAttribute('data-nova-style', '1');
  style.textContent = tailwindCss as unknown as string;
  shadow.appendChild(style);

  // React mount container + the Radix portal target (a sibling inside the shadow
  // root so portalled Select/Popover/Dialog are styled by the same stylesheet).
  const container = document.createElement('div');
  container.id = 'nova-app';
  container.className = 'nova-root';
  shadow.appendChild(container);

  const portalContainer = document.createElement('div');
  portalContainer.id = 'nova-portal';
  portalContainer.className = 'nova-root';
  shadow.appendChild(portalContainer);

  createRoot(container).render(
    <StrictMode>
      <PortalContainerProvider container={portalContainer}>
        <App />
      </PortalContainerProvider>
    </StrictMode>
  );
}

if (document.body) {
  mount();
} else {
  window.addEventListener('DOMContentLoaded', mount, { once: true });
}
