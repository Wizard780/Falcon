import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { pick, reset, roundSpeeches, tick, toggle, freshClocks, type ClockId, type Clocks, type Speech } from './round-clock';
import css from './timer-window.css?inline';

export const TIMER_WINDOW = 'falcon-timer'; // the window's name: electron/main.cjs lets only this one open
const W = 300, H = 312;

/** The round's clocks, ticking once a second. `done` hears which clock ran out. */
export function useRoundClocks(speechMin: number, prepMin: number, done: (id: ClockId) => void) {
  const speeches = useMemo(() => roundSpeeches(speechMin), [speechMin]);
  const prepSec = prepMin * 60;
  const [c, setC] = useState<Clocks>(() => freshClocks(speeches, prepSec));
  // a new length from Settings resets the clocks that aren't running
  useEffect(() => { setC((c) => ({ ...c, speech: c.on === 'speech' ? c.speech : speeches[c.idx].sec })); }, [speeches]);
  useEffect(() => { setC((c) => ({ ...c, our: c.on === 'our' ? c.our : prepSec, their: c.on === 'their' ? c.their : prepSec })); }, [prepSec]);
  const doneRef = useRef(done);
  doneRef.current = done;
  useEffect(() => {
    if (!c.on) return;
    const t = window.setInterval(() => setC((c) => {
      const next = tick(c, speeches);
      if (next.done) { const d = next.done; queueMicrotask(() => doneRef.current(d)); }
      return next.clocks;
    }), 1000);
    return () => clearInterval(t);
  }, [c.on, speeches]);
  return {
    clocks: c, speeches, prepSec,
    toggle: (id: ClockId) => setC((c) => toggle(c, id, speeches, prepSec)),
    reset: (id: ClockId) => setC((c) => reset(c, id, speeches, prepSec)),
    pick: (i: number) => setC((c) => pick(c, i, speeches)),
  };
}
export type RoundClocks = ReturnType<typeof useRoundClocks>;

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
// the theme's colors the window uses, read off the main window as they are now
const VARS = ['--u-panel', '--u-well', '--u-ctl', '--u-ctl2', '--u-ctl-on', '--u-line', '--u-tx', '--u-tx2', '--u-top', '--u-sh', '--ink-ui'];

/**
 * Opens the timer window while `open` is true; closing it calls `onClose`. The clocks stay in this page:
 * the window is a second document this page draws into, so it can't fall out of step.
 */
export function TimerWindow(props: { open: boolean; onClose: () => void; rc: RoundClocks; low: number }) {
  const [doc, setDoc] = useState<Document | null>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  const winRef = useRef<Window | null>(null);

  useEffect(() => {
    if (!props.open) return;
    if (winRef.current && !winRef.current.closed) { winRef.current.focus(); return; }
    const w = window.open('', TIMER_WINDOW, `popup,width=${W},height=${H}`);
    if (!w) { onClose.current(); return; }
    winRef.current = w;
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
    setDoc(d);
    // the user closed it (the window's own close button)
    const poll = window.setInterval(() => { if (w.closed) onClose.current(); }, 400);
    // this page going away takes the window with it
    const bye = () => w.close();
    addEventListener('pagehide', bye);
    return () => {
      mo.disconnect(); clearInterval(poll); removeEventListener('pagehide', bye);
      setDoc(null); winRef.current = null;
      if (!w.closed) w.close();
    };
  }, [props.open]);

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
