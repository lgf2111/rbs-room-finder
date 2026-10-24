/*
 * src/lib/build-info.ts
 *
 * Build stamp (task A). scripts/build.mjs injects two compile-time constants
 * via esbuild `define`:
 *   - __RBS_BUILD_SHA__  short git sha of HEAD
 *   - __RBS_BUILD_AT__   HEAD's COMMIT date (ISO) — NOT `now`, so repeated
 *                        builds of the same commit stay byte-identical.
 *
 * This module surfaces that stamp:
 *   - window.__rbsBuild = { sha, builtAt } for a one-line console check;
 *   - a short "build <sha> · HH:MM" label for the status bar corner;
 *   - a one-time console.info("[rbs] build <sha> <timestamp>") on mount.
 */

// Declared so TypeScript accepts the esbuild-defined globals. At runtime these
// are replaced by string literals; the `typeof` guards keep an un-defined dev
// build (e.g. running outside the bundler) from throwing.
declare const __RBS_BUILD_SHA__: string;
declare const __RBS_BUILD_AT__: string;

export interface BuildInfo {
  sha: string;
  builtAt: string;
}

export const BUILD: BuildInfo = {
  sha: typeof __RBS_BUILD_SHA__ === 'string' ? __RBS_BUILD_SHA__ : 'dev',
  builtAt: typeof __RBS_BUILD_AT__ === 'string' ? __RBS_BUILD_AT__ : new Date(0).toISOString(),
};

/** "HH:MM" from the build ISO timestamp (local-insensitive: parsed as-is). */
function hhmm(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '');
  return m ? `${m[1]}:${m[2]}` : '';
}

/** Short label for the status-bar corner, e.g. "build ed6788f · 15:42". */
export function buildLabel(): string {
  const t = hhmm(BUILD.builtAt);
  return `build ${BUILD.sha}${t ? ` · ${t}` : ''}`;
}

/** Full label for the Help/User Guide screen, e.g. "build ed6788f · <ISO>". */
export function buildLabelFull(): string {
  return `build ${BUILD.sha} · ${BUILD.builtAt}`;
}

/**
 * Publish window.__rbsBuild and log the stamp once. Idempotent: a second call
 * (re-injection, StrictMode) neither re-logs nor re-assigns noisily.
 */
export function publishBuildInfo(): void {
  try {
    const w = window as unknown as { __rbsBuild?: BuildInfo; __rbsBuildLogged?: boolean };
    w.__rbsBuild = { sha: BUILD.sha, builtAt: BUILD.builtAt };
    if (!w.__rbsBuildLogged) {
      w.__rbsBuildLogged = true;
      // eslint-disable-next-line no-console
      console.info(`[rbs] build ${BUILD.sha} ${BUILD.builtAt}`);
    }
  } catch {
    /* non-fatal */
  }
}
