// scripts/build.mjs
//
// Bundle src/ -> content/nova.bundle.js as a classic IIFE for the MV3 content
// script (isolated world). No ESM at runtime, no CDN, no eval. The compiled
// Tailwind CSS (src/styles/tailwind.out.css, produced by `npm run build:css`)
// is imported with the esbuild text loader and injected into the shadow root
// at runtime, so there is no chrome.runtime.getURL fetch.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

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
  },
  // Mirror the tsconfig "@/*" path alias so imports resolve in the bundle.
  alias: {
    '@': resolve(root, 'src'),
  },
  // Everything is bundled; nothing is external at runtime.
  external: [],
});

console.log('built content/nova.bundle.js');
