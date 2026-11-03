// @vitest-environment node
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// electron/docsync.cjs: open-docs.json, watching open files, and the stale-save check
const require = createRequire(import.meta.url);
const { createDocSync } = require('../electron/docsync.cjs');

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'falcon-docsync-'));
  const statusFile = join(dir, 'userData', 'open-docs.json');
  const doc = join(dir, 'AT Neg.docx');
  writeFileSync(doc, 'v1');
  const told: string[] = [];
  const sync = createDocSync({ statusFile, notify: (p: string) => told.push(p) });
  const status = () => JSON.parse(readFileSync(statusFile, 'utf8'));
  // a write by another program, a second later as far as the file's modified time goes
  const outside = (text: string) => { writeFileSync(doc, text); const t = Date.now() / 1000 + 1; utimesSync(doc, t, t); };
  return { dir, doc, told, sync, status, outside };
}

describe('open docs and outside changes', () => {
  it('writes open-docs.json: each open doc, unsaved or not, and when Falcon read and saved it', async () => {
    const { doc, sync, status } = setup();
    await sync.read(doc, () => readFile(doc));
    sync.setDocs([{ path: doc, name: 'AT Neg', unsaved: true, active: true }, { name: 'Untitled', unsaved: false, active: false }]);
    const s = status();
    expect(s).toMatchObject({ version: 1, pid: process.pid, docs: [{ path: doc, name: 'AT Neg', unsaved: true, active: true, savedAt: null }, { path: null, name: 'Untitled', unsaved: false, active: false, readAt: null, savedAt: null }] });
    expect(Date.parse(s.docs[0].readAt)).toBeGreaterThan(Date.now() - 5000);
    await sync.wrote(doc);
    expect(Date.parse(status().docs[0].savedAt)).toBeGreaterThan(Date.now() - 5000);
    sync.stop();
    expect(status().docs).toEqual([]);
  });

  it('tells the page once when an open file changes outside Falcon, and not for its own saves', async () => {
    const { doc, told, sync, outside } = setup();
    await sync.read(doc, () => readFile(doc));
    sync.setDocs([{ path: doc, name: 'AT Neg', unsaved: false, active: true }]);
    await sync.poll();
    expect(told).toEqual([]);
    writeFileSync(doc, 'falcon save'); await sync.wrote(doc);
    await sync.poll();
    expect(told).toEqual([]);
    outside('claude wrote this');
    await sync.poll(); await sync.poll();
    expect(told).toEqual([doc]);
    sync.stop();
  });

  it('a Save over a file that changed since Falcon read it is refused until Falcon reads it again', async () => {
    const { doc, sync, outside } = setup();
    await sync.read(doc, () => readFile(doc));
    expect(await sync.changed(doc)).toBe(false);
    outside('claude wrote this');
    expect(await sync.changed(doc)).toBe(true);
    await sync.read(doc, () => readFile(doc)); // the page merged it in
    expect(await sync.changed(doc)).toBe(false);
    expect(await sync.changed(join(doc, '..', 'never-read.docx'))).toBe(false);
    sync.stop();
  });
});
