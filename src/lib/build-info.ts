/*
 * src/lib/build-info.ts
 *
 * Build stamp — OPTION (b): the artifact's content identity.
 *
 * scripts/build.mjs injects two compile-time constants via esbuild `define`:
 *   - __RBS_BUILD_ID__  sha256 (12 hex) over the sorted (path, contents) of
 *                       every build INPUT (src/, content/native.js, the config
 *                       files, package.json, build.mjs). A pure function of the
 *                       source tree: identical on every rebuild of the same
 *                       checkout, and it changes iff a build input changes. It
 *                       does NOT depend on HEAD, so committing the bundle never
 *                       invalidates it — that is what keeps the deterministic
 *                       build gate green (a rebuild of a clean checkout leaves
 *                       no git diff).
 *   - __RBS_BUILD_AT__  HEAD's committer date (git log -1 --format=%cI), fixed
 *                       for a given checkout, so it is byte-stable across builds.
 *
 * This module surfaces that stamp:
 *   - window.__rbsBuild = { id, builtAt } for a one-line console check;
 *   - a short "build <id> · HH:MM" label for the status bar corner;
 *   - a one-time console.info("[rbs] build <id> <timestamp>") on mount.
 */

// Declared so TypeScript accepts the esbuild-defined globals. At runtime these
// are replaced by string literals; the `typeof` guards keep an un-defined dev
// build (e.g. running outside the bundler) from throwing.
declare const __RBS_BUILD_ID__: string;
declare const __RBS_BUILD_AT__: string;

export interface BuildInfo {
  /** Content identity: sha256(sorted build inputs), 12 hex chars. */
  id: string;
  /** HEAD committer date (ISO), fixed per checkout. */
  builtAt: string;
}

export const BUILD: BuildInfo = {
  id: typeof __RBS_BUILD_ID__ === 'string' ? __RBS_BUILD_ID__ : 'dev',
  builtAt: typeof __RBS_BUILD_AT__ === 'string' ? __RBS_BUILD_AT__ : new Date(0).toISOString(),
};

/** Short form of the content id for compact UI (first 7 chars). */
function shortId(): string {
  return (BUILD.id || '').slice(0, 7) || 'dev';
}

/** "HH:MM" from the build ISO timestamp (local-insensitive: parsed as-is). */
function hhmm(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '');
  return m ? `${m[1]}:${m[2]}` : '';
}

/** Short label for the status-bar corner, e.g. "build ed6788f · 15:42". */
export function buildLabel(): string {
  const t = hhmm(BUILD.builtAt);
  return `build ${shortId()}${t ? ` · ${t}` : ''}`;
}

/** Full label for the Help/User Guide screen, e.g. "build ed6788f · <ISO>". */
export function buildLabelFull(): string {
  return `build ${shortId()} · ${BUILD.builtAt}`;
}

/**
 * Publish window.__rbsBuild and log the stamp once. Idempotent: a second call
 * (re-injection, StrictMode) neither re-logs nor re-assigns noisily.
 */
export function publishBuildInfo(): void {
  try {
    const w = window as unknown as { __rbsBuild?: BuildInfo; __rbsBuildLogged?: boolean };
    w.__rbsBuild = { id: BUILD.id, builtAt: BUILD.builtAt };
    if (!w.__rbsBuildLogged) {
      w.__rbsBuildLogged = true;
      // eslint-disable-next-line no-console
      console.info(`[rbs] build ${BUILD.id} ${BUILD.builtAt}`);
    }
  } catch {
    /* non-fatal */
  }
}
