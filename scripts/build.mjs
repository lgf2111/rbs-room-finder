// scripts/build.mjs
//
// Bundle src/ -> content/nova.bundle.js as a classic IIFE for the MV3 content
// script (isolated world). No ESM at runtime, no CDN, no eval. The compiled
// Tailwind CSS (src/styles/tailwind.out.css, produced by `npm run build:css`)
// is imported with the esbuild text loader and injected into the shadow root
// at runtime, so there is no chrome.runtime.getURL fetch.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// Build stamp. We embed the short git sha and a build timestamp so the UI can
// show exactly which build is loaded (and the user's screenshot identifies it).
// The timestamp is HEAD's COMMIT date, not `now`, so repeated builds of the
// same commit stay byte-identical (reproducible: a rebuild leaves no git diff).
function git(args, fallback) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}
const BUILD_SHA = git(['rev-parse', '--short', 'HEAD'], 'unknown');
const BUILD_AT = git(['show', '-s', '--format=%cI', 'HEAD'], new Date(0).toISOString());

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
    __RBS_BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __RBS_BUILD_AT__: JSON.stringify(BUILD_AT),
  },
  // Mirror the tsconfig "@/*" path alias so imports resolve in the bundle.
  alias: {
    '@': resolve(root, 'src'),
  },
  // Everything is bundled; nothing is external at runtime.
  external: [],
});

console.log(`built content/nova.bundle.js (build ${BUILD_SHA} ${BUILD_AT})`);
