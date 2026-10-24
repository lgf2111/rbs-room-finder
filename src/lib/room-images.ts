/*
 * src/lib/room-images.ts
 *
 * Defect B: room photos are absent on the live site.
 *
 * Photos exist ONLY in the native result-card markup as `data-imgpath` (a bare
 * base64 PNG, no `data:` prefix) keyed by `data-rsrcid`. But nova drives the
 * board from the JSON API, so the native cards are usually empty — there is
 * nothing to harvest at the moment the board renders. The fix is a cache:
 *
 *   - harvest EVERY `[data-rsrcid][data-imgpath]` in the document on every
 *     render (cheap) and persist rsrcId -> imgpath in chrome.storage.local
 *     under ONE key, merging with what is already there;
 *   - when rendering a row, read the thumbnail from that cache first, then from
 *     the live DOM harvest;
 *   - expose ONE "Load room photos" action that runs the native search once
 *     (click #btnBookingMainSearch), waits for cards, harvests and caches.
 *
 * chrome.storage.local is the only persistence API (same as content/panel.js).
 * It is accessed defensively: outside the extension (the CDP harness injects
 * the bundle into a plain page) it may be absent, so every call falls back to
 * an in-memory map and never throws. No eval, no remote code, no network.
 */

import { CONTROL_IDS } from '@/lib/native-bridge';

/** The single chrome.storage.local key holding the whole rsrcId -> imgpath map. */
export const ROOM_IMAGE_CACHE_KEY = 'rbsRoomImages';

/** rsrcId -> bare base64 PNG (no "data:" prefix), exactly as on the card. */
export type ImagePathMap = Record<string, string>;

type ChromeLike = {
  storage?: {
    local?: {
      get: (keys: string | string[], cb: (items: Record<string, unknown>) => void) => void;
      set: (items: Record<string, unknown>, cb?: () => void) => void;
    };
  };
};

function chromeStorage(): NonNullable<NonNullable<ChromeLike['storage']>['local']> | null {
  try {
    const c = (globalThis as unknown as { chrome?: ChromeLike }).chrome;
    if (c && c.storage && c.storage.local && typeof c.storage.local.get === 'function') {
      return c.storage.local;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Process-lifetime fallback when chrome.storage.local is unavailable. */
let memoryCache: ImagePathMap = {};

/** Turn a harvested imgpath (bare base64 PNG) into a data: URI for an <img>. */
export function toDataUri(imgpath: string): string {
  const p = (imgpath || '').trim();
  if (!p) return '';
  if (/^data:/i.test(p)) return p; // already a data URI (defensive)
  return `data:image/png;base64,${p}`;
}

/**
 * Harvest a map of rsrcId -> bare base64 imgpath from EVERY matching element in
 * the WHOLE document (not just #resultList): the live site renders cards in
 * different containers across pages, so we scan every `[data-rsrcid]` that also
 * carries a non-empty `data-imgpath`. Reads only; never mutates the native DOM.
 */
export function harvestImagePaths(): ImagePathMap {
  const out: ImagePathMap = {};
  try {
    const nodes = document.querySelectorAll('[data-rsrcid][data-imgpath]');
    nodes.forEach((node) => {
      const el = node as HTMLElement;
      const id = (el.getAttribute('data-rsrcid') || '').trim();
      if (!id) return;
      const path = (el.getAttribute('data-imgpath') || '').trim();
      if (path) out[id] = path;
    });
  } catch {
    /* non-fatal: no images is a valid state (placeholders render) */
  }
  return out;
}

/** Read the persisted cache (chrome.storage.local, else the in-memory map). */
export function loadCache(): Promise<ImagePathMap> {
  const store = chromeStorage();
  if (!store) return Promise.resolve({ ...memoryCache });
  return new Promise((resolve) => {
    try {
      store.get([ROOM_IMAGE_CACHE_KEY], (items) => {
        const v = items && (items[ROOM_IMAGE_CACHE_KEY] as ImagePathMap | undefined);
        resolve(v && typeof v === 'object' ? { ...v } : {});
      });
    } catch {
      resolve({ ...memoryCache });
    }
  });
}

/**
 * Merge `paths` into the persisted cache (existing entries win only for keys
 * NOT present in `paths`; fresh harvests overwrite stale ones). Returns the
 * merged map. Always resolves; never throws.
 */
export function mergeIntoCache(paths: ImagePathMap): Promise<ImagePathMap> {
  const incoming = paths || {};
  const store = chromeStorage();
  if (!store) {
    memoryCache = { ...memoryCache, ...incoming };
    return Promise.resolve({ ...memoryCache });
  }
  return new Promise((resolve) => {
    try {
      store.get([ROOM_IMAGE_CACHE_KEY], (items) => {
        const prev = (items && (items[ROOM_IMAGE_CACHE_KEY] as ImagePathMap | undefined)) || {};
        const merged = { ...prev, ...incoming };
        try {
          store.set({ [ROOM_IMAGE_CACHE_KEY]: merged }, () => resolve(merged));
        } catch {
          memoryCache = { ...memoryCache, ...incoming };
          resolve(merged);
        }
      });
    } catch {
      memoryCache = { ...memoryCache, ...incoming };
      resolve({ ...memoryCache });
    }
  });
}

/**
 * Harvest the current document and merge the result into the cache. Returns the
 * merged cache as rsrcId -> data: URI (ready to hand to <img>). Cheap enough to
 * run on every render.
 */
export async function harvestAndCache(): Promise<Record<string, string>> {
  const paths = harvestImagePaths();
  const merged = Object.keys(paths).length ? await mergeIntoCache(paths) : await loadCache();
  return pathsToDataUris(merged);
}

/** Map every rsrcId -> data: URI (drops empties). */
export function pathsToDataUris(paths: ImagePathMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of Object.keys(paths || {})) {
    const uri = toDataUri(paths[id]);
    if (uri) out[id] = uri;
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the native search ONCE to force the native result cards to render, then
 * harvest + cache their images. Mirrors how the repo already drives the native
 * form: click #btnBookingMainSearch and wait for the cards. Safe to call
 * repeatedly.
 *
 * The native search may trigger a postback (full page reload). We do NOT try to
 * prevent that: if the page reloads, this promise never resolves (the document
 * is torn down) and the fresh document re-harvests from the new cards on the
 * way back up via the normal render-time harvest. When there is NO postback
 * (the usual case, an in-page re-render), we poll until new cards appear, then
 * harvest. Either way the user is never navigated away from nova.
 *
 * Returns the merged cache as data: URIs. Resolves even if nothing was found
 * (the caller keeps showing placeholders and the action).
 */
export async function loadRoomPhotos(opts?: {
  timeoutMs?: number;
  pollMs?: number;
}): Promise<Record<string, string>> {
  const timeoutMs = opts?.timeoutMs ?? 6000;
  const pollMs = opts?.pollMs ?? 150;

  const before = Object.keys(harvestImagePaths()).length;

  try {
    const btn = document.getElementById(CONTROL_IDS.searchButton) as HTMLElement | null;
    if (btn && typeof btn.click === 'function') btn.click();
  } catch {
    /* non-fatal: fall through to a harvest of whatever is already present */
  }

  // Poll for the native cards to (re)appear. If a postback reloads the page,
  // this loop simply never completes because the document is replaced — the
  // fresh page re-harvests on mount, which is the desired recovery.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const count = Object.keys(harvestImagePaths()).length;
    if (count > before || count > 0) break;
  }

  return harvestAndCache();
}
