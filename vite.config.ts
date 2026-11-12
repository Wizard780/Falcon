import { defineConfig } from 'vite';
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

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  base: './',
  server: { port: 5173, strictPort: true },
});
