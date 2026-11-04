import { afterEach, describe, expect, it, vi } from 'vitest';
import { freshStorage, mountApp, tick, unmountAll } from './app-harness';
import { P, setPref } from '../src/editor/prefs';
import { schema } from '../src/editor/schema';

afterEach(async () => { await unmountAll(); });

function fakeSd() {
  return {
    room: vi.fn(async (room: string) => (room === 'rd3abc' ? { ok: true, value: { room, name: 'Round 3', files: [] } } : { ok: false, error: 'no_room' })),
    make: vi.fn(), remove: vi.fn(), pick: vi.fn(), open: vi.fn(), download: vi.fn(), archive: vi.fn(),
    upload: vi.fn(async (_room: string, name: string) => ({ ok: true, value: { files: [{ index: 0, name, ctime: Date.now() }], index: 0 } })),
    watch: vi.fn(() => () => {}),
  };
}
const ROUNDS = [{ id: 1, tournament: 'Blake', round: '3', side: 'Con', opponent: 'Sharon SS', judge: 'Raj Khan', start_time: null }];
function fakeCl(signedIn = true) {
  return {
    status: vi.fn(async () => ({ ok: true, value: signedIn })),
    login: vi.fn(async () => ({ ok: true, value: true })),
    logout: vi.fn(async () => ({ ok: true })),
    rounds: vi.fn(async () => ({ ok: true, value: { current: true, rounds: ROUNDS } })),
    caselists: vi.fn(async () => ({ ok: true, value: [{ name: 'hspf26', label: 'HS PF 2026-27', event: 'pf' }] })),
    schools: vi.fn(async () => ({ ok: true, value: [{ name: 'Jericho', label: 'Jericho' }] })),
    teams: vi.fn(async () => ({ ok: true, value: [{ name: 'XG', label: 'Jericho XG' }] })),
    posted: vi.fn(async () => ({ ok: true, value: [{ tournament: '2---Fullerton', round: '1', side: 'A' }] })),
    post: vi.fn(async (_t: unknown, _r: unknown, filename: string) => ({ ok: true, value: { filename } })),
  };
}
const TEAM = JSON.stringify({ caselist: 'hspf26', caselistLabel: 'HS PF 2026-27', event: 'pf', school: 'Jericho', schoolLabel: 'Jericho', team: 'XG', teamLabel: 'Jericho XG' });

const bar = () => document.querySelector('.bar .g.sp');
const barButton = (text: string) => [...document.querySelectorAll('.bar .g.sp button')].find((b) => b.textContent === text) ?? null;
const dialog = () => document.querySelector('.cf.cl');
const inputOf = (label: string) => document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
type App = Awaited<ReturnType<typeof mountApp>>;
// act holds effects until it ends, so a dialog's first load needs a second pass
const pressDown = async (app: App, el: Element | null, wait = 100) => {
  await app.act(() => { el!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); }, wait);
  await app.act(() => {}, wait);
  await app.act(() => {}, wait);
};
const mic = () => document.querySelector('.tools button[aria-label^="Speech doc"]');

const settled = async (app: App) => { await app.act(() => {}, 150); await app.act(() => {}, 150); };

async function speechDoc(extra: Record<string, unknown> = {}) {
  const sd = fakeSd(), cl = fakeCl();
  const app = await mountApp({ speechdrop: sd, caselist: cl, ...extra });
  await app.click(mic());
  return { app, sd, cl };
}
const setDoc = (app: App, paras: ReturnType<typeof schema.node>[]) => app.act(() => {
  const v = app.view();
  v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, paras));
}, 400); // the counts follow the doc after a 150 ms pause, with the outline

describe('the speech doc\'s top bar', () => {
  it('only a speech doc gets the buttons; unmarking takes them away', async () => {
    await freshStorage();
    const app = await mountApp({ speechdrop: fakeSd(), caselist: fakeCl() });
    expect(bar()).toBeNull();
    await app.click(mic());
    expect(bar()).not.toBeNull();
    expect(barButton('SpeechDrop')).not.toBeNull();
    expect(barButton('Caselist')).not.toBeNull();
    await app.click(mic());
    expect(bar()).toBeNull();
  });

  it('switching to another doc hides them, and coming back brings them', async () => {
    await freshStorage();
    const { app } = await speechDoc();
    await app.menu('new');
    expect(bar()).toBeNull();
    await app.click(app.el.querySelectorAll('.fs-docs .doc-nm')[0]);
    expect(bar()).not.toBeNull();
  });

  it('Home covers them', async () => {
    await freshStorage();
    const { app } = await speechDoc();
    await app.act(() => { (document.querySelector('[aria-label="Home"]') as HTMLElement).click(); });
    expect(bar()).toBeNull();
  });

  it('counts what\'s read aloud: highlights, tags and cites, live', async () => {
    await freshStorage();
    const { app } = await speechDoc();
    const hl = schema.marks.highlight.create({ color: 'yellow' });
    await setDoc(app, [
      schema.node('paragraph', { style: 'tag' }, [schema.text('Two words')]),
      schema.node('paragraph', { style: 'normal' }, [schema.text('read these three', [hl]), schema.text(' but never these ones')]),
    ]);
    const rc = () => document.querySelector('.bar .rc');
    expect(rc()?.querySelector('b')?.textContent).toBe('5 words');
    expect(rc()?.querySelector('i')?.textContent).toBe('0:01'); // Reader 2's 300 wpm is the default
    await app.act(() => { setPref(P.speechReader, 1); }); // Reader 1's 200 wpm
    await setDoc(app, [schema.node('paragraph', { style: 'tag' }, [schema.text(Array(100).fill('word').join(' '))])]);
    expect(rc()?.querySelector('b')?.textContent).toBe('100 words');
    expect(rc()?.querySelector('i')?.textContent).toBe('0:30');
    await setDoc(app, [schema.node('paragraph', { style: 'tag' }, [schema.text('One')])]);
    expect(rc()?.querySelector('b')?.textContent).toBe('1 word');
  });

  it('Read mode\'s one button is on the right, and it still works', async () => {
    await freshStorage();
    const app = await mountApp({});
    expect(document.querySelector('.tools button[aria-label="Read mode"]')).toBeNull();
    const read = document.querySelector('.bar .end .b') as HTMLElement;
    expect(read.textContent).toBe('Read');
    await pressDown(app, read);
    expect(app.el.querySelector('.status .lit')?.textContent).toContain('Read mode');
  });
});

describe('SpeechDrop button', () => {
  const joinFromLobby = async (app: Awaited<ReturnType<typeof mountApp>>) => {
    await app.act(() => window.dispatchEvent(new Event('falcon:sd-show')));
    await app.fill(document.querySelector('section.sd input[aria-label="Room code"]'), 'rd3abc', 100);
    await app.click(app.el.querySelectorAll('.fs-docs .doc-nm')[0]);
  };

  it('with a room joined, one click uploads the doc to it, without asking', async () => {
    await freshStorage();
    const { app, sd } = await speechDoc();
    await joinFromLobby(app);
    await pressDown(app, barButton('SpeechDrop'));
    expect(sd.upload).toHaveBeenCalledTimes(1);
    expect(sd.upload.mock.calls[0].slice(0, 2)).toEqual(['rd3abc', 'Untitled.docx']);
    expect(app.toast()).toContain('Uploaded Untitled.docx to Round 3');
    expect(document.querySelector('.cf input[aria-label="Room code"]')).toBeNull();
  });

  it('with no room, asks for the code once, joins behind the doc and uploads; the next click just uploads', async () => {
    await freshStorage();
    const { app, sd } = await speechDoc();
    await pressDown(app, barButton('SpeechDrop'));
    const code = () => document.querySelector('.cf input[aria-label="Room code"]');
    expect(code()).not.toBeNull();
    await app.fill(code(), 'zzzzzz', 100);
    expect(document.querySelector('.cf .ns-file')?.textContent).toBe('No room has that code');
    expect(sd.upload).not.toHaveBeenCalled();
    await app.fill(code(), 'rd3abc', 200);
    expect(code()).toBeNull();
    await tick(100);
    expect(sd.upload).toHaveBeenCalledTimes(1);
    expect(sd.upload.mock.calls[0][0]).toBe('rd3abc');
    expect(document.querySelector('section.sd.open')).toBeNull(); // the doc stays up
    expect(bar()).not.toBeNull();
    await pressDown(app, barButton('SpeechDrop'));
    expect(sd.upload).toHaveBeenCalledTimes(2);
    expect(code()).toBeNull();
  });
});

describe('Caselist button', () => {
  const open = async (stored: Record<string, string> = { 'falcon.caselist.team': TEAM }) => {
    await freshStorage(stored);
    const got = await speechDoc();
    await setDoc(got.app, [schema.node('paragraph', { style: 'pocket' }, [schema.text('1NC')]), schema.node('paragraph', { style: 'block' }, [schema.text('Offshoring DA---1NC')]), schema.node('paragraph', { style: 'block' }, [schema.text('Econ DA---1NC')])]);
    await pressDown(got.app, barButton('Caselist'));
    return got;
  };
  const button = (text: string) => [...document.querySelectorAll('.cf.cl button')].find((b) => b.textContent === text) as HTMLButtonElement;

  it('prefills from Tabroom, numbers the tournament, drafts the report, and posts nothing until Disclose', async () => {
    const { app, cl } = await open();
    expect(inputOf('Tournament').value).toBe('3---Blake');
    expect(inputOf('Round').value).toBe('3');
    expect(inputOf('Opponent').value).toBe('Sharon SS');
    expect(inputOf('Judge').value).toBe('Raj Khan');
    expect(button('Con').getAttribute('aria-pressed')).toBe('true');
    expect((document.querySelector('textarea[aria-label="Round report"]') as HTMLTextAreaElement).value).toBe('1NC---Offshoring DA, Econ DA');
    expect(dialog()?.textContent).toContain('Posts Untitled.docx');
    expect(dialog()?.textContent).toContain('Jericho XG');
    expect(cl.post).not.toHaveBeenCalled();
    await app.click(button('Disclose'), 200);
    await settled(app);
    expect(cl.post).toHaveBeenCalledTimes(1);
    const [target, round, filename, data] = cl.post.mock.calls[0] as unknown as [{ team: string }, Record<string, string>, string, Uint8Array];
    expect(target.team).toBe('XG');
    expect(round).toEqual({ tournament: '3---Blake', round: '3', side: 'N', opponent: 'Sharon SS', judge: 'Raj Khan', report: '1NC---Offshoring DA, Econ DA' });
    expect(filename).toBe('Untitled.docx');
    expect(data.length).toBeGreaterThan(100);
    expect(dialog()).toBeNull();
    expect(app.toast()).toContain('Disclosed Untitled.docx to Jericho XG');
  });

  it('his edits are what posts; Cancel posts nothing', async () => {
    const { app, cl } = await open();
    await app.fill(inputOf('Opponent'), 'McLean KR');
    await app.click(button('Disclose'), 200);
    await settled(app);
    expect((cl.post.mock.calls[0] as unknown as [unknown, { opponent: string }])[1].opponent).toBe('McLean KR');
    const again = await speechDocAgain(app);
    await app.click(again('Cancel'));
    expect(cl.post).toHaveBeenCalledTimes(1);
  });
  const speechDocAgain = async (app: App) => { await pressDown(app, barButton('Caselist')); return button; };

  it('asks for a sign-in first when there is none, and sends the password only to login', async () => {
    await freshStorage({ 'falcon.caselist.team': TEAM });
    const cl = fakeCl(false);
    const { app } = await speechDoc({ caselist: cl });
    cl.status.mockResolvedValueOnce({ ok: true, value: false }).mockResolvedValue({ ok: true, value: true });
    await pressDown(app, barButton('Caselist'));
    expect(inputOf('Tournament')).toBeNull();
    await app.fill(inputOf('Tabroom email'), 'me@school.org');
    await app.fill(inputOf('Tabroom password'), 'test-pass');
    await app.click(button('Sign in'), 200);
    await settled(app);
    expect(cl.login).toHaveBeenCalledWith('me@school.org', 'test-pass');
    expect(inputOf('Tournament').value).toBe('3---Blake');
  });

  it('with no team yet, asks which one once and remembers it', async () => {
    const { app } = await open({});
    const select = (label: string) => document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
    expect(select('Caselist').value).toBe('hspf26');
    const pick = async (label: string, value: string) => app.act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select(label), value);
      select(label).dispatchEvent(new Event('change', { bubbles: true }));
    }, 100);
    await settled(app);
    await pick('School', 'Jericho');
    await settled(app);
    await pick('Team', 'XG');
    await settled(app);
    await app.click(button('Continue'), 200);
    await settled(app);
    expect(inputOf('Tournament').value).toBe('3---Blake');
    expect(JSON.parse(localStorage.getItem('falcon.caselist.team')!).teamLabel).toBe('Jericho XG');
  });

  it('warns when the round is already up, and a failed post stays open with the reason', async () => {
    await freshStorage({ 'falcon.caselist.team': TEAM });
    const cl = fakeCl();
    cl.posted.mockResolvedValue({ ok: true, value: [{ tournament: '3---Blake', round: '3', side: 'N' }] });
    cl.post.mockResolvedValue({ ok: false, error: 'upload_unknown' } as never);
    const { app } = await speechDoc({ caselist: cl });
    await pressDown(app, barButton('Caselist'));
    expect(dialog()?.textContent).toContain('already on your page');
    await app.click(button('Disclose'), 200);
    await settled(app);
    expect(dialog()?.textContent).toContain('Check your team\'s page before posting again');
  });
});
