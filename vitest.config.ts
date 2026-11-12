import { defineConfig } from 'vitest/config';
import { alias } from './vite.config';
// loro-prosemirror is inlined so the loro-crdt alias reaches it too: one copy of the CRDT's wasm, as in the app's build
export default defineConfig({ resolve: { alias }, test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], server: { deps: { inline: ['loro-prosemirror'] } } } });
