import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshStorage, mountApp, unmountAll } from './app-harness';
import { freshClocks, pick, reset, roundSpeeches, tick, toggle } from '../src/ui/round-clock';

describe('round clocks', () => {
  const sp = roundSpeeches('policy', 8);
  it('lays out a policy round: constructives, cross-ex at 3, rebuttals 3 shorter', () => {
    expect(sp.map((s) => `${s.name} ${s.sec / 60}`).join(', '))
      .toBe('1AC 8, CX 3, 1NC 8, CX 3, 2AC 8, CX 3, 2NC 8, CX 3, 1NR 5, 1AR 5, 2NR 5, 2AR 5');
    expect(roundSpeeches('policy', 9).at(-1)!.sec).toBe(360);
  });
  it('lays out LD and PF rounds at their usual times', () => {
    const list = (f: 'ld' | 'pf') => roundSpeeches(f, 8).map((s) => `${s.name} ${s.sec / 60}`).join(', ');
    expect(list('ld')).toBe('AC 6, CX 3, NC 7, CX 3, 1AR 4, NR 6, 2AR 3');
    expect(list('pf')).toBe('1st Con 4, 2nd Con 4, CF 3, 1st Reb 4, 2nd Reb 4, CF 3, 1st Sum 3, 2nd Sum 3, GCF 3, 1st FF 2, 2nd FF 2');
  });
  it('runs one clock at a time', () => {
    let c = toggle(freshClocks(sp, 480), 'speech', sp, 480);
    c = toggle(c, 'their', sp, 480);
    expect(c.on).toBe('their');
    c = tick(c, sp).clocks;
    expect([c.speech, c.their]).toEqual([480, 479]);
  });
  it('a speech that runs out moves on to the next one, stopped', () => {
    const c = { ...freshClocks(sp, 480), speech: 1, on: 'speech' as const };
    const r = tick(c, sp);
    expect(r.done).toBe('speech');
    expect(r.clocks).toMatchObject({ idx: 1, speech: 180, on: null });
  });
  it('prep that runs out stays at zero and starts over on the next start', () => {
    const r = tick({ ...freshClocks(sp, 480), our: 1, on: 'our' }, sp);
    expect(r).toMatchObject({ done: 'our', clocks: { our: 0, on: null } });
    expect(toggle(r.clocks, 'our', sp, 480)).toMatchObject({ our: 480, on: 'our' });
  });
  it('picking a speech or resetting loads its time and stops it', () => {
    const c = { ...freshClocks(sp, 480), speech: 100, on: 'speech' as const };
    expect(pick(c, 8, sp)).toMatchObject({ idx: 8, speech: 300, on: null });
    expect(reset(c, 'speech', sp, 480)).toMatchObject({ speech: 480, on: null });
    expect(pick(c, 99, sp).idx).toBe(11);
  });
});

describe('timer window', () => {
  beforeEach(async () => { await freshStorage(); });
  afterEach(async () => { vi.restoreAllMocks(); await unmountAll(); });

  /** window.open hands back a blank page, as Electron and the browser do for the timer window. */
  const fakeOpen = () => {
    const w = { document: document.implementation.createHTMLDocument(''), closed: false, focus: vi.fn(), close() { w.closed = true; } };
    const open = vi.spyOn(window, 'open').mockReturnValue(w as unknown as Window);
    return { w, open };
  };

  it('clicking the speech timer opens a small window with the speech, our prep and their prep', async () => {
    const { w, open } = fakeOpen();
    const app = await mountApp();
    const btn = app.el.querySelector<HTMLButtonElement>('button.timer')!;
    await app.act(() => btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    expect(open).toHaveBeenCalledWith('', 'falcon-timer', expect.stringContaining('popup'));
    const d = w.document;
    expect(d.title).toBe('Timer');
    expect(d.querySelector('.tw-pick b')!.textContent).toBe('1AC');
    expect(d.querySelector('[role=timer]')!.textContent).toBe('8:00');
    expect([...d.querySelectorAll('.tw-p')].map((r) => r.textContent)).toEqual(['Our prep8:00', 'Their prep8:00']);

    // their prep runs; then the speech starts and pauses it
    const theirs = d.querySelectorAll<HTMLButtonElement>('.tw-p')[1];
    await app.act(() => theirs.click());
    await app.act(() => {}, 1100);
    expect(theirs.hasAttribute('data-on')).toBe(true);
    expect(theirs.textContent).toBe('Their prep7:59');
    const start = d.querySelector<HTMLButtonElement>('.tw-ctl button')!;
    await app.act(() => start.click());
    expect(start.textContent).toBe('Pause');
    expect(theirs.hasAttribute('data-on')).toBe(false);
    // the top bar shows the same speech clock
    await app.act(() => {}, 1100);
    expect(btn.textContent).toBe(d.querySelector('[role=timer]')!.textContent);
    expect(btn.textContent).toBe('7:59');

    // the next speech: CX, three minutes
    await app.act(() => d.querySelector<HTMLButtonElement>('[aria-label="Next speech"]')!.click());
    expect(d.querySelector('.tw-pick b')!.textContent).toBe('CX');
    expect(d.querySelector('[role=timer]')!.textContent).toBe('3:00');

    // clicking the toolbar again brings the open window forward instead of opening a second
    await app.act(() => btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    expect(open).toHaveBeenCalledTimes(1);
    expect(w.focus).toHaveBeenCalled();
  });

  it('a clock whose timers fire late still takes off every second that passed', async () => {
    const { w } = fakeOpen();
    const app = await mountApp();
    await app.act(() => app.el.querySelector('button.timer')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    const ours = w.document.querySelector<HTMLButtonElement>('.tw-p')!;
    await app.act(() => ours.click());
    const real = Date.now.bind(Date), from = real();
    vi.spyOn(Date, 'now').mockImplementation(() => real() + (real() - from > 0 ? 5000 : 0)); // the page slept 5 s
    await app.act(() => {}, 400);
    expect(ours.textContent).toBe('Our prep7:55');
  });

  it('choosing PF in Settings starts a PF round with 3 minutes of prep a side', async () => {
    const { w } = fakeOpen();
    const app = await mountApp();
    await app.act(() => app.el.querySelector('button.timer')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    const d = w.document;
    await app.act(() => d.querySelector<HTMLButtonElement>('[aria-label="Next speech"]')!.click());
    const { P, setPref } = await import('../src/editor/prefs');
    await app.act(() => { setPref(P.round, 'pf'); setPref(P.prepMin, 3); });
    expect(d.querySelector('.tw-pick b')!.textContent).toBe('1st Con');
    expect(d.querySelector('[role=timer]')!.textContent).toBe('4:00');
    expect([...d.querySelectorAll('.tw-p')].map((r) => r.textContent)).toEqual(['Our prep3:00', 'Their prep3:00']);
    expect(app.el.querySelector('button.timer')!.textContent).toBe('4:00');
    // from grand crossfire (PF's 9th speech) to LD, which has 7: a fresh LD round, no crash
    for (let i = 0; i < 8; i++) await app.act(() => d.querySelector<HTMLButtonElement>('[aria-label="Next speech"]')!.click());
    expect(d.querySelector('.tw-pick b')!.textContent).toBe('GCF');
    await app.act(() => { setPref(P.round, 'ld'); setPref(P.prepMin, 4); });
    expect(d.querySelector('.tw-pick b')!.textContent).toBe('AC');
    expect(d.querySelector('[role=timer]')!.textContent).toBe('6:00');
  });

  it('a new prep length in Settings keeps the prep a side already used', async () => {
    const { w } = fakeOpen();
    const app = await mountApp();
    await app.act(() => app.el.querySelector('button.timer')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    const [ours, theirs] = w.document.querySelectorAll<HTMLButtonElement>('.tw-p');
    await app.act(() => ours.click());
    await app.act(() => {}, 1100);
    await app.act(() => ours.click()); // paused at 7:59
    const { P, setPref } = await import('../src/editor/prefs');
    await app.act(() => setPref(P.prepMin, 10));
    expect([ours.textContent, theirs.textContent]).toEqual(['Our prep7:59', 'Their prep10:00']);
  });

  it('closing the window lets the toolbar open it again, and leaving the page closes it', async () => {
    const { w, open } = fakeOpen();
    const app = await mountApp();
    const btn = app.el.querySelector<HTMLButtonElement>('button.timer')!;
    const click = () => app.act(() => btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    await click();
    w.closed = true; // the user closed it
    await app.act(() => {}, 500);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    w.closed = false;
    await click();
    expect(open).toHaveBeenCalledTimes(2);
    dispatchEvent(new Event('pagehide'));
    expect(w.closed).toBe(true);
  });
});
