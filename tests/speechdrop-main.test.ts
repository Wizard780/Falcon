// @vitest-environment node
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain .mjs test helper
import { startMock } from './speechdrop-mock.mjs';

// electron/speechdrop.cjs against the local stand-in, with real HTTP: cookies, XSRF tokens, redirects, multipart
const require = createRequire(import.meta.url);
const sdm = require('../electron/speechdrop.cjs');

type Mock = Awaited<ReturnType<typeof startMock>>;
let mock: Mock;
let sd: ReturnType<typeof sdm.createSpeechDrop>;
beforeAll(async () => {
  mock = await startMock();
  sd = sdm.createSpeechDrop({ base: mock.url, media: `${mock.url}/media/uploads/` });
});
afterAll(() => mock.close());

describe('SpeechDrop engine', () => {
  it('joins a room: its decoded name and files, newest first, deleted slots dropped', async () => {
    mock.seed('jn1234', 'Round 3 <Flight A> & "B"', [{ name: 'a.docx' }, { name: 'b.pdf' }, { name: 'c.txt' }]);
    mock.rooms.get('jn1234').files[1] = null;
    const r = await sd.room('jn1234');
    expect(r.name).toBe('Round 3 <Flight A> & "B"');
    expect(r.files.map((f: { index: number; name: string }) => [f.index, f.name])).toEqual([[2, 'c.txt'], [0, 'a.docx']]);
    expect(r.files[0].ctime).toBeGreaterThan(0);
  });

  it('a code with no room is no_room; a bad code never leaves the app', async () => {
    await expect(sd.room('nope99')).rejects.toThrow('no_room');
    await expect(sd.list('nope99')).rejects.toThrow('no_room');
    const n = mock.log.length;
    await expect(sd.room('ab/../x')).rejects.toThrow('bad_room');
    expect(mock.log.length).toBe(n);
  });

  it('makes a room and lands in it', async () => {
    const code = await sd.make('  Doubles Flight B  ');
    expect(code).toMatch(/^rm\d{4}$/);
    expect((await sd.room(code)).name).toBe('Doubles Flight B');
    await expect(sd.make('   ')).rejects.toThrow('bad_name');
    await expect(sd.make('x'.repeat(61))).rejects.toThrow('bad_name');
  });

  it('uploads with the page token, returns the slot it took, and deletes it', async () => {
    mock.seed('up1234', 'Uploads', [{ name: 'theirs.docx' }]);
    const up = await sd.upload({ room: 'up1234', name: '1AC.docx', bytes: Buffer.from('hello') });
    expect(up.index).toBe(1);
    expect(up.files[0]).toMatchObject({ index: 1, name: '1AC.docx' });
    expect(mock.rooms.get('up1234').files[1].bytes.toString()).toBe('hello');
    const left = await sd.remove('up1234', 1);
    expect(left.map((f: { name: string }) => f.name)).toEqual(['theirs.docx']);
    expect(mock.rooms.get('up1234').files[1]).toBeNull();
  });

  it('upload checks size and type before sending, and passes SpeechDrop\'s own refusals on', async () => {
    const n = mock.log.length;
    await expect(sd.upload({ room: 'up1234', name: 'big.docx', bytes: Buffer.alloc(sdm.MAX_BYTES + 1) })).rejects.toThrow('too_large');
    await expect(sd.upload({ room: 'up1234', name: 'virus.exe', bytes: Buffer.from('x') })).rejects.toThrow('bad_type');
    expect(mock.log.length).toBe(n);
    await expect(sd.upload({ room: 'zz9999', name: 'a.docx', bytes: Buffer.from('x') })).rejects.toThrow('no_room');
  });

  it('a write without the matching token is refused (the stand-in checks it like SpeechDrop)', async () => {
    const res = await fetch(`${mock.url}/makeroom`, { method: 'POST', body: new URLSearchParams({ name: 'x' }), redirect: 'manual' });
    expect(res.status).toBe(403);
  });

  it('downloads the bytes in a slot', async () => {
    mock.seed('dl1234', 'Down', [{ name: 'Neg 1NC.docx', bytes: 'neg doc' }]);
    expect((await sd.download({ room: 'dl1234', index: 0, name: 'Neg 1NC.docx' })).toString()).toBe('neg doc');
    await expect(sd.download({ room: 'dl1234', index: 3, name: 'x.docx' })).rejects.toThrow('download_failed');
  });

  it('unreachable SpeechDrop says so', async () => {
    const off = sdm.createSpeechDrop({ base: 'http://127.0.0.1:9', timeoutMs: 2000 });
    await expect(off.room('abc123')).rejects.toThrow('unreachable');
  });
});

describe('files on disk', () => {
  it('saveUnique reuses an identical file and numbers a different one; refuses path names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-'));
    const a = await sdm.saveUnique(dir, 'x.docx', Buffer.from('1'));
    expect(await sdm.saveUnique(dir, 'x.docx', Buffer.from('1'))).toBe(a);
    expect(await sdm.saveUnique(dir, 'x.docx', Buffer.from('2'))).toBe(join(dir, 'x (2).docx'));
    await expect(sdm.saveUnique(dir, '../x.docx', Buffer.from('1'))).rejects.toThrow('bad_name');
    expect(sdm.safeName('Round 3: A/B?')).toBe('Round 3- A-B-');
  });

  it('the zip holds each file once, under unique names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdz-'));
    const out = await sdm.freeName(dir, 'Room.zip');
    const z = await sdm.createZipWriter(out);
    await z.add('a.docx', Buffer.from('one'));
    await z.add('a.docx', Buffer.from('two'));
    await z.close();
    const buf = readFileSync(out);
    expect(buf.includes(Buffer.from('a (2).docx'))).toBe(true);
    expect(buf.readUInt16LE(buf.length - 22 + 10)).toBe(2); // entries in the end record
    expect(readdirSync(dir)).toEqual(['Room.zip']);
  });
});

describe('live list', () => {
  it('takes pushes from the socket, and polls once it drops', async () => {
    vi.useFakeTimers();
    const sockets: FakeWS[] = [];
    class FakeWS {
      sent: string[] = [];
      onopen?: () => void; onmessage?: (e: { data: string }) => void; onclose?: () => void; onerror?: () => void;
      constructor() { sockets.push(this); }
      send(s: string) { this.sent.push(s); }
      close() { this.onclose?.(); }
    }
    const updates: { files: { name: string }[]; live: boolean }[] = [];
    const list = vi.fn(async () => [{ index: 0, name: 'polled.docx', ctime: 1 }]);
    const w = sdm.createWatcher({ list, onFiles: (u: never) => updates.push(u), WebSocketImpl: FakeWS, pollMs: 5000, reconnectMs: 1000 });
    w.watch('ab1234');
    sockets[0].onopen!();
    expect(JSON.parse(sockets[0].sent[0])).toEqual({ type: 'register', address: 'speechdrop.room.ab1234' });
    sockets[0].onmessage!({ data: JSON.stringify({ type: 'rec', body: JSON.stringify([{ name: 'a.docx', ctime: 1 }, null, { name: 'b.docx', ctime: 2 }]) }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(updates.at(-1)).toEqual({ room: 'ab1234', files: [{ index: 2, name: 'b.docx', ctime: 2 }, { index: 0, name: 'a.docx', ctime: 1 }], live: true });
    expect(list).not.toHaveBeenCalled(); // live: no polling
    sockets[0].onclose!();
    expect(updates.at(-1)!.live).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(list).toHaveBeenCalled();
    expect(updates.at(-1)!.files[0].name).toBe('polled.docx');
    expect(sockets.length).toBe(2); // and it tries the socket again
    w.stop();
    const n = updates.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(updates.length).toBe(n); // stopped means quiet
    vi.useRealTimers();
  });
});
