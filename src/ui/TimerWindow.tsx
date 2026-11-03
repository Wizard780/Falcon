import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { pick, reset, roundSpeeches, tick, toggle, freshClocks, type ClockId, type Clocks, type Speech } from './round-clock';
import css from './timer-window.css?inline';

export const TIMER_WINDOW = 'falcon-timer'; // the window's name: electron/main.cjs lets only this one open
const W = 300, H = 312;

/**
 * The round's clocks, counted against the wall clock: a hidden or busy page whose timers fire late
 * still takes off every second that passed. `done` hears which clock ran out.
 */
export function useRoundClocks(speechMin: number, prepMin: number, done: (id: ClockId) => void) {
  const speeches = useMemo(() => roundSpeeches(speechMin), [speechMin]);
  const prepSec = prepMin * 60;
  const [c, setC] = useState<Clocks>(() => freshClocks(speeches, prepSec));
  // the clocks as they are now, written before each render, so the ticker and the buttons never read an old copy
  const cRef = useRef(c);
  const set = (f: (c: Clocks) => Clocks) => { cRef.current = f(cRef.current); setC(cRef.current); };
  // a new length from Settings moves the clocks still at the old full time; time already used stays used
  const was = useRef({ speeches, prepSec });
  useEffect(() => {
    const old = was.current;
    was.current = { speeches, prepSec };
    if (old.speeches === speeches && old.prepSec === prepSec) return;
    set((c) => ({
      ...c,
      speech: c.speech === old.speeches[c.idx].sec ? speeches[c.idx].sec : Math.min(c.speech, speeches[c.idx].sec),
      our: c.our === old.prepSec ? prepSec : Math.min(c.our, prepSec),
      their: c.their === old.prepSec ? prepSec : Math.min(c.their, prepSec),
    }));
  }, [speeches, prepSec]);
  const doneRef = useRef(done);
  doneRef.current = done;
  useEffect(() => {
    if (!c.on) return;
    let last = Date.now();
    const t = window.setInterval(() => {
      const n = Math.floor((Date.now() - last) / 1000);
      if (n < 1) return;
      last += n * 1000;
      let next = cRef.current, ran: ClockId | null = null;
      for (let i = 0; i < n && next.on && !ran; i++) ({ clocks: next, done: ran } = tick(next, speeches));
      set(() => next);
      if (ran) doneRef.current(ran);
    }, 250);
    return () => clearInterval(t);
  }, [c.on, speeches]);
  return {
    clocks: c, speeches, prepSec,
    toggle: (id: ClockId) => set((c) => toggle(c, id, speeches, prepSec)),
    reset: (id: ClockId) => set((c) => reset(c, id, speeches, prepSec)),
    pick: (i: number) => set((c) => pick(c, i, speeches)),
  };
}
export type RoundClocks = ReturnType<typeof useRoundClocks>;

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
// the theme's colors the window uses, read off the main window as they are now
const VARS = ['--u-panel', '--u-well', '--u-ctl', '--u-ctl2', '--u-ctl-on', '--u-line', '--u-tx', '--u-tx2', '--u-top', '--u-sh', '--ink-ui'];

/**
 * Each new `req` opens the timer window, or brings it forward when it's already open. `onOpen` hears
 * when it opens and closes. The clocks stay in this page: the window is a second document this page
 * draws into, so the two can't fall out of step.
 */
export function TimerWindow(props: { req: number; onOpen: (open: boolean) => void; rc: RoundClocks; low: number }) {
  const [doc, setDoc] = useState<Document | null>(null);
  const onOpen = useRef(props.onOpen);
  onOpen.current = props.onOpen;
  const live = useRef<{ w: Window; end: () => void } | null>(null);

  useEffect(() => {
    if (!props.req) return;
    if (live.current && !live.current.w.closed) { live.current.w.focus(); return; }
    live.current?.end(); // closed a moment ago, before the check below saw it
    const w = window.open('', TIMER_WINDOW, `popup,width=${W},height=${H}`);
    if (!w) return;
    const d = w.document;
    d.title = 'Timer';
    const style = d.createElement('style');
    style.textContent = css;
    d.head.appendChild(style);
    const root = d.createElement('div');
    root.id = 'tw-root';
    d.body.replaceChildren(root);
    // follow the theme: copy its colors now and whenever Settings changes them
    const paint = () => {
      const cs = getComputedStyle(document.documentElement);
      for (const v of VARS) d.documentElement.style.setProperty(v, cs.getPropertyValue(v));
      d.documentElement.dataset.chrome = document.documentElement.dataset.chrome ?? 'dark';
      d.documentElement.style.colorScheme = document.documentElement.style.colorScheme;
    };
    paint();
    const mo = new MutationObserver(paint);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-chrome'] });
    // this page going away takes the window with it
    const bye = () => w.close();
    addEventListener('pagehide', bye);
    // the user closed it with the window's own close button
    const poll = window.setInterval(() => { if (w.closed) end(); }, 400);
    const end = () => {
      if (live.current?.w !== w) return;
      live.current = null;
      mo.disconnect(); clearInterval(poll); removeEventListener('pagehide', bye);
      if (!w.closed) w.close();
      setDoc(null);
      onOpen.current(false);
    };
    live.current = { w, end };
    setDoc(d);
    onOpen.current(true);
  }, [props.req]);
  useEffect(() => () => live.current?.end(), []); // the toolbar going away closes it

  // Space starts or pauses the speech, as in the toolbar
  const rc = useRef(props.rc);
  rc.current = props.rc;
  useEffect(() => {
    if (!doc) return;
    const key = (e: KeyboardEvent) => { if (e.key === ' ' && !(e.target as HTMLElement).closest?.('button')) { e.preventDefault(); rc.current.toggle('speech'); } };
    doc.addEventListener('keydown', key);
    return () => doc.removeEventListener('keydown', key);
  }, [doc]);

  if (!doc) return null;
  return createPortal(<TimerFace rc={props.rc} low={props.low} />, doc.getElementById('tw-root')!);
}

/** What the window shows: the speech picker, the speech clock with Start and Reset, and both sides' prep. */
export function TimerFace({ rc, low }: { rc: RoundClocks; low: number }) {
  const { clocks: c, speeches, prepSec } = rc;
  const lowOf = (id: ClockId) => (c.on === id && low > 0 && c[id] <= low ? 'low' : undefined);
  const s: Speech = speeches[c.idx];
  const prep = (id: 'our' | 'their', who: string) => (
    <button className={`tw-p ${lowOf(id) ?? ''}`} data-on={c.on === id || undefined} title={`${who}: click to start or pause. Right-click to reset`}
      onClick={() => rc.toggle(id)} onContextMenu={(e) => { e.preventDefault(); rc.reset(id); }}>
      <span className="who">{who}</span>
      <span className="tw-bar"><i style={{ width: `${(c[id] / prepSec) * 100}%` }} /></span>
      <span className="num">{clock(c[id])}</span>
    </button>
  );
  return (
    <div className="tw">
      <div className="tw-top">
        <div className="tw-pick">
          <button aria-label="Previous speech" disabled={c.idx === 0} onClick={() => rc.pick(c.idx - 1)}><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg></button>
          <b aria-label="Speech">{s.name}</b>
          <button aria-label="Next speech" disabled={c.idx === speeches.length - 1} onClick={() => rc.pick(c.idx + 1)}><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></button>
        </div>
        <div className={`tw-big num ${lowOf('speech') ?? ''}`} data-on={c.on === 'speech' || undefined} role="timer" aria-label={`${s.name} time left`}>{clock(c.speech)}</div>
        <div className="tw-ctl">
          <button onClick={() => rc.toggle('speech')}>{c.on === 'speech' ? 'Pause' : 'Start'}</button>
          <button onClick={() => rc.reset('speech')}>Reset</button>
        </div>
      </div>
      <div className="tw-well">
        {prep('our', 'Our prep')}
        {prep('their', 'Their prep')}
      </div>
    </div>
  );
}
