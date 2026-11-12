// Live sessions end to end in jsdom: Falcon editors on src/collab/live.ts, talking through an in-memory relay with
// rooms (live-relay-fake.ts). Real timers: frames go out every 400 ms, reconnects back off from a second.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { createState, createView, markMap } from '../src/editor/editor';
import { falconKeys as K } from '../src/editor/keymap';
import { schema } from '../src/editor/schema';
import { docOf, liveState } from '../src/collab/live-doc';
import { host, join, BATCH_MS, type LiveSession } from '../src/collab/live';
import { checkRooms, nextUtcMidnight } from '../src/collab/relay';
import { openFrame, roomKey, unb64url } from '../src/collab/crypto';
import { LoroDoc } from 'loro-crdt';
import { fakeRooms, ROOMS } from './live-relay-fake';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(ok: () => boolean, ms = 6000, what = 'condition') {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(20); }
}

beforeAll(() => {
  Object.assign(document, { elementFromPoint: () => null });
  const zero = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => zero as DOMRect;
  Element.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

let relay: ReturnType<typeof fakeRooms>;
const open: { s: LiveSession; view?: EditorView }[] = [];
beforeEach(() => { relay = fakeRooms(); });
afterEach(() => { for (const o of open.splice(0)) { o.s.stop(); o.view?.destroy(); } relay.restore(); document.body.innerHTML = ''; });

const P = (style: string, text: string) => schema.node('paragraph', { style }, text ? [schema.text(text)] : []);
const seedDoc = () => schema.node('doc', null, [P('tag', 'Growth is slowing'), P('normal', 'Smith 24, Professor at MIT'), P('normal', 'The rapid expansion of AI has pushed utilities to their limits.')]);
const noop = () => {};

function mount(s: LiveSession, doc: PMNode) {
  const el = document.createElement('div');
  document.body.append(el);
  const view = createView(el, () => {}, liveState(createState(doc), s.binding, s.me));
  const o = open.find((x) => x.s === s);
  if (o) o.view = view;
  return view;
}
// the binding attaches on a timeout of 0 and holds off edits until then (live-doc attached): a person can't type sooner
function start(name: string, doc = seedDoc()) {
  const s = host({ relay: ROOMS, doc: 'Econ DA', name, onChange: noop }, doc);
  open.push({ s });
  return { s, view: mount(s, doc) };
}
async function enter(name: string, from: LiveSession) {
  const s = join({ relay: ROOMS, name, onChange: noop }, from.invite());
  open.push({ s });
  await s.ready;
  const view = mount(s, docOf(s.binding)!); // what Loro holds now, not at ready: frames may have come in since
  await sleep(0);
  return { s, view };
}
const pos = (v: EditorView, text: string, off = 0) => { let p = -1; v.state.doc.descendants((n, at) => { if (p < 0 && n.isTextblock) { const i = n.textContent.indexOf(text); if (i >= 0) p = at + 1 + i + off; } return p < 0; }); if (p < 0) throw new Error(text); return p; };
const caret = (v: EditorView, text: string, off = 0) => v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos(v, text, off))));
const select = (v: EditorView, text: string) => { const f = pos(v, text); v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, f, f + text.length))); };
const type = (v: EditorView, t: string) => { for (const ch of t) v.dispatch(v.state.tr.insertText(ch)); };
const mm = (v: EditorView) => markMap(v.state.doc);
const same = (...v: EditorView[]) => v.every((x) => mm(x) === mm(v[0]));

describe('a live session through the relay', { timeout: 30_000 }, () => {
  it('a joiner gets the doc from the host; typing and F-keys on both sides converge; each sees the other', async () => {
    const A = start('Avery');
    await until(() => A.s.status.kind === 'live', 6000, 'host live');
    const B = await enter('Blake', A.s);
    expect(mm(B.view)).toBe(mm(A.view));
    await until(() => B.s.status.kind === 'live');
    select(A.view, 'pushed utilities'); K.F9(A.view.state, A.view.dispatch);
    select(B.view, 'rapid expansion'); K.F11(B.view.state, B.view.dispatch);
    caret(B.view, 'Smith'); type(B.view, 'Dr. ');
    caret(A.view, 'Growth'); type(A.view, 'US ');
    await until(() => same(A.view, B.view) && mm(A.view).includes('Dr. Smith') && mm(A.view).includes('US Growth'), 6000, 'converge');
    expect(mm(A.view)).toContain('[pushed utilities]{underline}');
    expect(mm(A.view)).toContain('[rapid expansion]{highlight:yellow}');
    await until(() => A.s.members.some((m) => m.name === 'Blake') && B.s.members.some((m) => m.name === 'Avery'), 6000, 'names');
  });

  it("frames: a typist sends at most one per batch window, and an idle peer sends none", async () => {
    const A = start('Avery');
    await until(() => A.s.status.kind === 'live');
    const B = await enter('Blake', A.s);
    await until(() => B.s.status.kind === 'live' && A.s.members.some((m) => m.name === 'Blake'));
    await sleep(BATCH_MS * 2);
    const a0 = A.s.sent, b0 = B.s.sent, t0 = Date.now();
    caret(A.view, 'Growth');
    for (let i = 0; i < 20; i++) { type(A.view, 'x'); await sleep(100); }
    await until(() => mm(B.view).includes('x'.repeat(20)), 6000, 'B has the typing');
    const secs = (Date.now() - t0) / 1000;
    expect(B.s.sent - b0).toBe(0);
    expect(A.s.sent - a0).toBeLessThanOrEqual(Math.ceil((secs * 1000) / BATCH_MS) + 1);
    expect(A.s.sent - a0).toBeGreaterThan(1);
  });

  it('the socket drops: both keep editing, and on reconnect each gets what the other did', async () => {
    const A = start('Avery');
    await until(() => A.s.status.kind === 'live');
    const B = await enter('Blake', A.s);
    await until(() => B.s.status.kind === 'live');
    relay.dropAll();
    await until(() => A.s.status.kind === 'retry' && B.s.status.kind === 'retry', 3000, 'both retrying');
    caret(A.view, 'Growth'); type(A.view, 'offline A ');
    caret(B.view, 'Smith'); type(B.view, 'offline B ');
    await until(() => same(A.view, B.view) && mm(A.view).includes('offline A') && mm(A.view).includes('offline B'), 8000, 'reconnect sync');
    expect(A.s.status.kind).toBe('live');
  });

  it('a late joiner gets everything, and leaving takes that person out of the room but keeps their doc', async () => {
    const A = start('Avery');
    await until(() => A.s.status.kind === 'live');
    const B = await enter('Blake', A.s);
    caret(B.view, 'Smith'); type(B.view, 'Before C. ');
    await until(() => mm(A.view).includes('Before C.'));
    const C = await enter('Casey', A.s);
    expect(mm(C.view)).toBe(mm(A.view));
    await until(() => A.s.members.length === 2 && C.s.members.filter((m) => m.name !== '…').length === 2, 6000, 'three in the room');
    expect(C.s.members.map((m) => m.name).sort()).toEqual(['Avery', 'Blake']);
    const kept = mm(B.view);
    B.s.stop();
    await until(() => A.s.members.length === 1 && C.s.members.length === 1, 6000, 'B gone');
    caret(A.view, 'Growth'); type(A.view, 'after B left ');
    await until(() => mm(C.view).includes('after B left'));
    await sleep(BATCH_MS * 2);
    expect(mm(B.view)).toBe(kept);
  });

  it("edits made while the socket was down reach the room even when nobody answers the ask", async () => {
    const s = host({ relay: ROOMS, doc: 'Econ DA', name: 'Avery', onChange: noop, askWait: 300 }, seedDoc());
    open.push({ s });
    const view = mount(s, seedDoc());
    await until(() => s.status.kind === 'live');
    const inv = s.invite();
    // someone in the room who never answers an ask (a laptop asleep with its socket not yet known dead)
    const got: Uint8Array[] = [];
    const mute = () => { const ws = new WebSocket(`wss://rooms.test/v1/room/${inv.room}`); ws.binaryType = 'arraybuffer'; ws.onopen = () => ws.send(JSON.stringify({ t: 'join' })); ws.onmessage = (e: MessageEvent) => { if (typeof e.data !== 'string') got.push(new Uint8Array(e.data as ArrayBuffer)); }; return ws; };
    mute();
    await sleep(50);
    const before = s.binding.doc.export({ mode: 'snapshot' });
    relay.dropAll();
    await until(() => s.status.kind === 'retry', 3000, 'retrying');
    caret(view, 'Growth'); type(view, 'offline edit ');
    mute(); // back first, so it's the one asked
    got.length = 0;
    await until(() => s.status.kind === 'live', 8000, 'back, after the ask went unanswered');
    await sleep(100);
    // what reached the room: open it as the mute peer would, on top of the doc as it was before the drop
    const key = await roomKey(unb64url(inv.key)), updates: Uint8Array[] = [];
    for (const f of got.filter((b) => b[0] === 1)) {
      const plain = await openFrame(key, inv.room, 1, f.subarray(5));
      const body = plain.subarray(8), dv = new DataView(body.buffer, body.byteOffset);
      for (let at = 0; at + 5 <= body.length;) { const len = dv.getUint32(at + 1); if (body[at] === 1) updates.push(body.slice(at + 5, at + 5 + len)); at += 5 + len; }
    }
    const peer = new LoroDoc();
    peer.import(before);
    peer.importBatch(updates);
    expect(JSON.stringify(peer.toJSON())).toContain('offline edit ');
  });

  it('a joiner with nobody in the room waits, and gets the doc when someone who has it comes back', async () => {
    const A = start('Avery');
    await until(() => A.s.status.kind === 'live');
    const invite = A.s.invite();
    A.s.stop();
    const B = join({ relay: ROOMS, name: 'Blake', onChange: noop }, invite);
    open.push({ s: B });
    await until(() => B.status.kind === 'waiting', 6000, 'waiting');
    // Avery comes back into the same room with the doc (a rejoin from the same invite)
    const back = join({ relay: ROOMS, name: 'Avery', onChange: noop }, invite);
    back.binding.doc.import(A.s.binding.doc.export({ mode: 'snapshot' }));
    open.push({ s: back });
    const doc = await B.ready;
    expect(markMap(doc)).toBe(markMap(seedDoc()));
    await until(() => B.status.kind === 'live');
  });
});

describe('when the relay can’t carry a session', { timeout: 30_000 }, () => {
  it("over the day's free allowance: paused until 00:00 UTC, and the doc still edits", async () => {
    relay.setMode('daily');
    const A = start('Avery');
    await until(() => A.s.status.kind === 'paused', 3000, 'paused');
    expect(A.s.status).toEqual({ kind: 'paused', until: nextUtcMidnight() });
    caret(A.view, 'Growth'); type(A.view, 'still mine ');
    expect(mm(A.view)).toContain('still mine Growth');
  });

  it("the relay's own request cap spent before the first connect: paused until 00:00 UTC, not taken for an old relay", async () => {
    relay.setMode('capped');
    const A = start('Avery');
    await until(() => A.s.status.kind === 'paused', 3000, 'paused');
    expect(A.s.status).toEqual({ kind: 'paused', until: nextUtcMidnight() });
  });

  it('a relay that answers 503 before the first connect: retrying, not taken for an old relay', async () => {
    relay.setMode('broken');
    const A = start('Avery');
    await until(() => A.s.status.kind === 'retry', 3000, 'retry');
    relay.setMode('up');
    await until(() => A.s.status.kind === 'live', 8000, 'back');
  });

  it('checkRooms: only a 404 is an old relay', async () => {
    const answer = (status: number, body = '{}') => { const f = globalThis.fetch; globalThis.fetch = async () => new Response(body, { status }); return () => { globalThis.fetch = f; }; };
    for (const [status, body, want] of [[404, '{"error":"not_found"}', 'no_rooms'], [429, '<html>1027</html>', 'daily_limit'], [503, 'x', 'unreachable'], [200, '{"rooms":1}', 'ok'], [200, 'not json', 'unreachable']] as const) {
      const undo = answer(status, body);
      try { expect(await checkRooms('https://somewhere.test')).toBe(want); } finally { undo(); }
    }
  });

  it('a relay from before rooms: no_rooms, and nothing more is tried', async () => {
    relay.setMode('old');
    const A = start('Avery');
    await until(() => A.s.status.kind === 'no_rooms', 3000, 'no_rooms');
    await sleep(1500);
    expect(A.s.status.kind).toBe('no_rooms');
  });

  it('the relay is down: it keeps retrying, with the doc editable', async () => {
    relay.setMode('down');
    const A = start('Avery');
    await until(() => A.s.status.kind === 'retry', 3000, 'retry');
    caret(A.view, 'Growth'); type(A.view, 'local ');
    expect(mm(A.view)).toContain('local Growth');
    relay.setMode('up');
    await until(() => A.s.status.kind === 'live', 8000, 'back');
  });
});
