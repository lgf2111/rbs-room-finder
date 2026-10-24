// scripts/build.mjs
//
// Bundle src/ -> content/nova.bundle.js as a classic IIFE for the MV3 content
// script (isolated world). No ESM at runtime, no CDN, no eval. The compiled
// Tailwind CSS (src/styles/tailwind.out.css, produced by `npm run build:css`)
// is imported with the esbuild text loader and injected into the shadow root
// at runtime, so there is no chrome.runtime.getURL fetch.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, join, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// ---------------------------------------------------------------------------
// Build stamp — OPTION (b): content identity, not a git sha.
//
// Why NOT wall-clock time and NOT the git sha of HEAD:
//   - `new Date()` makes every rebuild write different bytes (breaks the
//     deterministic-build gate: a rebuild of a clean checkout showed
//     `M content/nova.bundle.js`).
//   - embedding the short SHA of HEAD also breaks the gate the moment the
//     bundle is committed: committing moves HEAD, so the committed bundle (which
//     embeds the PRE-commit sha) no longer matches a rebuild (which embeds the
//     NEW HEAD). A commit can never contain its own hash — the fixpoint is
//     unreachable.
//
// So the stamp is the HONEST IDENTITY of the artifact:
//   id      = sha256 over the sorted (relativePath, contents) of every build
//             INPUT (src/, tailwind config, postcss config, package.json, and
//             content/native.js), truncated to 12 hex chars. This is a pure
//             function of the source tree: identical on every rebuild of the
//             same checkout, and it changes iff a build input changes. It does
//             NOT depend on HEAD, so committing the bundle never invalidates it.
//   builtAt = HEAD's committer date (git log -1 --format=%cI), which is fixed
//             for a given checkout, so it is byte-stable across rebuilds too.
//             (Falls back to the unix epoch when git is unavailable.)
// ---------------------------------------------------------------------------
function git(args, fallback) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

/** Recursively list files under dir (absolute paths), skipping the throwaway
 *  Tailwind output which is a BUILD ARTIFACT, not an input. */
function listFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...listFiles(abs));
    else out.push(abs);
  }
  return out;
}

/** The exact set of inputs whose contents define this artifact. */
function collectBuildInputs() {
  const files = [
    ...listFiles(resolve(root, 'src')).filter((f) => !f.endsWith(join('styles', 'tailwind.out.css'))),
    resolve(root, 'content/native.js'),
    resolve(root, 'package.json'),
    resolve(root, 'tailwind.config.js'),
    resolve(root, 'postcss.config.js'),
    resolve(root, 'scripts/build.mjs'),
  ].filter((f) => existsSync(f));
  // Sort by POSIX-normalised relative path so the hash is OS-independent.
  return files
    .map((abs) => ({ rel: relative(root, abs).split(sep).join('/'), abs }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

function computeBuildId() {
  const h = createHash('sha256');
  for (const { rel, abs } of collectBuildInputs()) {
    h.update(rel);
    h.update('\0');
    h.update(readFileSync(abs));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

const BUILD_ID = computeBuildId();
const BUILD_AT = git(['log', '-1', '--format=%cI'], new Date(0).toISOString());

await build({
  entryPoints: [resolve(root, 'src/main.tsx')],
  outfile: resolve(root, 'content/nova.bundle.js'),
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  jsx: 'automatic',
  platform: 'browser',
  sourcemap: false,
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
  // .css imported as a plain string, inlined into the shadow root at runtime.
  loader: { '.css': 'text' },
  define: {
    'process.env.NODE_ENV': '"production"',
    __RBS_BUILD_ID__: JSON.stringify(BUILD_ID),
    __RBS_BUILD_AT__: JSON.stringify(BUILD_AT),
  },
  // Mirror the tsconfig "@/*" path alias so imports resolve in the bundle.
  alias: {
    '@': resolve(root, 'src'),
  },
  // Everything is bundled; nothing is external at runtime.
  external: [],
});

console.log(`built content/nova.bundle.js (build ${BUILD_ID} ${BUILD_AT})`);
