import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The UI is written against React's API but runs on Preact (preact/compat): a tenth of react-dom's
// size, and it doesn't save and restore the page selection on every render (react-dom walks every
// text node of the focused editor to do that, ~30 ms per render on a 15k-paragraph file).
export const alias = [
  { find: /^react-dom\/client$/, replacement: 'preact/compat/client' },
  { find: /^react-dom\/test-utils$/, replacement: 'preact/test-utils' },
  { find: /^react-dom$/, replacement: 'preact/compat' },
  { find: /^react\/jsx-runtime$/, replacement: 'preact/jsx-runtime' },
  { find: /^react\/jsx-dev-runtime$/, replacement: 'preact/jsx-dev-runtime' },
  { find: /^react$/, replacement: 'preact/compat' },
  // live editing's CRDT with its wasm inline: the app loads its page from file://, where fetching a .wasm file fails.
  // Only a live session imports it, so it's a chunk of its own, loaded then
  { find: /^loro-crdt$/, replacement: 'loro-crdt/base64' },
];

/**
 * The relay (relay/) as the desktop app uploads it to someone's Cloudflare account (electron/relay-setup.cjs): its one
 * module with the types stripped, which is all wrangler's bundling does to it, and what the upload needs from
 * wrangler.jsonc. A second module or package would need a real bundler, so that stops the build.
 */
export function relayWorker(root = '.') {
  const src = readFileSync(`${root}/relay/src/index.ts`, 'utf8');
  const other = [...src.matchAll(/^\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)]
    .map((m) => m[1] ?? m[2]).filter((m) => m !== 'cloudflare:workers');
  if (other.length) throw new Error(`relay/src/index.ts imports ${other.join(', ')}: bundle it before shipping it in the app`);
  // the comments out of the JSONC, leaving strings whole
  const config = JSON.parse(readFileSync(`${root}/relay/wrangler.jsonc`, 'utf8').replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, s) => s ?? ''));
  return {
    name: config.name as string,
    compatibility_date: config.compatibility_date as string,
    bindings: config.durable_objects.bindings as { name: string; class_name: string }[],
    migrations: config.migrations as { tag: string; new_sqlite_classes?: string[] }[],
    observability: config.observability as { enabled: boolean },
    code: stripTypeScriptTypes(src, { mode: 'strip' }),
  };
}

const relayAsset: Plugin = {
  name: 'falcon-relay-worker',
  apply: 'build',
  generateBundle() { this.emitFile({ type: 'asset', fileName: 'relay-worker.json', source: JSON.stringify(relayWorker()) }); },
};

export default defineConfig({
  plugins: [react(), relayAsset],
  resolve: { alias },
  base: './',
  server: { port: 5173, strictPort: true },
});
