// @vitest-environment node
import { expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';

type Handler = (e: unknown, opts: unknown) => Promise<{ path: string } | null>;

/** The real main-process save handler, with a stand-in for Electron. */
function saveHandler(): Handler {
  const handlers = new Map<string, Handler>();
  const noop = () => {};
  const app = { setPath: noop, getPath: () => os.tmpdir(), requestSingleInstanceLock: () => true, quit: noop, on: noop, isReady: () => false, whenReady: () => new Promise(noop) };
  const electron = { app, BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] }, Menu: {}, clipboard: {}, dialog: {}, nativeTheme: {}, shell: {}, ipcMain: { on: noop, handle: (name: string, f: Handler) => handlers.set(name, f) } };
  const load = (Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown })._load;
  (Module as unknown as { _load: typeof load })._load = (req, ...rest) => (req === 'electron' ? electron : load(req, ...rest));
  try { createRequire(import.meta.url)('../electron/main.cjs'); } finally { (Module as unknown as { _load: typeof load })._load = load; }
  return handlers.get('falcon:save-file')!;
}

test('two saves of the same file at once leave it holding the later one, never a mix', async () => {
  const save = saveHandler();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-race-')), 'Doc.docx');
  fs.writeFileSync(file, 'original');
  for (let round = 0; round < 5; round++) {
    const big = new Uint8Array(8 << 20).fill(0x41), small = new Uint8Array(1 << 20).fill(0x42);
    const results = await Promise.allSettled([save(null, { path: file, data: big }), save(null, { path: file, data: small })]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(Buffer.from(fs.readFileSync(file)).equals(Buffer.from(small))).toBe(true);
  }
});
