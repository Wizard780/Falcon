import { useEffect, useRef, useState } from 'react';
import { beam, clock, dots } from './home-fx';
import { whenLabel, type Recent } from './recents';
import { SvgIcon } from './icons';

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/** The start screen (and ⌘T): New, Open and the files you opened recently. */
export function Home(props: {
  open: boolean;
  current: string;
  recents: Recent[];
  onNew: () => void;
  onOpen: () => void;
  onRecent: (r: Recent) => void;
  onClear: (keep: Recent[] | null) => void;
}) {
  const { open, recents } = props;
  const homeRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLDivElement>(null);
  const scRef = useRef<HTMLDivElement>(null);
  const [peek, setPeek] = useState<{ r: Recent; left: number; top: number; from: 'top' | 'bottom' } | null>(null);
  const peekTimer = useRef(0);
  const [undo, setUndo] = useState<Recent[] | null>(null);

  // the effects run only while home is showing
  useEffect(() => {
    if (!open) return;
    scRef.current!.scrollTop = 0;
    const stops = [dots(bgRef.current!), clock(clockRef.current!)];
    let stopBeam = () => {};
    // wait a frame so the title has its final size before the beam measures it
    const raf = requestAnimationFrame(() => { stopBeam = beam(homeRef.current!, headRef.current!, titleRef.current!); });
    return () => { cancelAnimationFrame(raf); stopBeam(); stops.forEach((s) => s()); };
  }, [open]);

  // Clear hides the list for five seconds before it counts; hovering the toast pauses the clock
  const undoBar = useRef<HTMLElement>(null);
  const undoState = useRef({ left: 0, last: 0, paused: false, raf: 0 });
  useEffect(() => {
    if (!undo) return;
    const s = undoState.current;
    s.left = 5000; s.last = performance.now();
    const tick = (now: number) => {
      if (!s.paused) s.left -= now - s.last;
      s.last = now;
      if (undoBar.current) undoBar.current.style.transform = `scaleX(${Math.max(0, s.left / 5000)})`;
      if (s.left <= 0) { setUndo(null); return; }
      s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(s.raf);
  }, [undo]);

  // peek: hovering a file shows its blocks, so you can tell two files apart before opening one
  const showPeek = (row: HTMLElement, r: Recent) => {
    if (!r.blocks.length) return setPeek(null);
    const home = homeRef.current!.getBoundingClientRect(), rr = row.getBoundingClientRect(), nm = row.querySelector('.nm')!.getBoundingClientRect();
    const h = 40 + Math.min(r.blocks.length, 6) * 28 + 16;
    const below = rr.bottom + 8 + h < home.bottom - 16;
    setPeek({ r, left: nm.left - home.left - 12, top: below ? rr.bottom - home.top + 4 : rr.top - home.top - h - 4, from: below ? 'top' : 'bottom' });
  };
  const hidePeek = () => { clearTimeout(peekTimer.current); setPeek(null); };
  useEffect(() => { if (!open) hidePeek(); }, [open]);

  const day = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const shown = undo ? [] : recents;
  return (
    <section ref={homeRef} className={`home${open ? ' open' : ''}`} aria-label="Home" aria-hidden={!open} onPointerLeave={hidePeek}>
      <div ref={bgRef} className="hm-bg" aria-hidden="true" />
      <div ref={scRef} className="hm-sc" onScroll={hidePeek}>
        <div className="hm-in">
          <div ref={headRef} className="hm-head">
            <div className="hm-text">
              <p className="hm-date">{day}</p>
              <h1 className="hm-title"><span ref={titleRef} className="ft">Falcon</span></h1>
              <p className="hm-sub">{props.current ? `${props.current} is open. Press Esc to go back to it` : 'Open a file or start a new one'}</p>
            </div>
            <div ref={clockRef} className="hm-clock" aria-live="off" />
          </div>
          <div className="hm-acts">
            <button className="hm-act" onClick={props.onNew}><span className="ic"><SvgIcon name="plus" /></span><span className="t">New document</span><kbd>{MOD}N</kbd><span className="d">A blank file</span></button>
            <button className="hm-act" onClick={props.onOpen}><span className="ic"><SvgIcon name="open" /></span><span className="t">Open</span><kbd>{MOD}O</kbd><span className="d">A .docx file</span></button>
          </div>
          <div className="hm-lab"><span>Recent</span>{shown.length > 0 && <button className="hm-clear" onClick={() => { hidePeek(); setUndo(recents); props.onClear(null); }}>Clear</button>}</div>
          <div className="hm-list">
            {shown.length ? shown.map((r) => (
              <button key={(r.path ?? '') + r.name} className="hm-row" onClick={() => { hidePeek(); props.onRecent(r); }}
                onPointerEnter={(e) => { const row = e.currentTarget; clearTimeout(peekTimer.current); peekTimer.current = window.setTimeout(() => showPeek(row, r), peek ? 0 : 200); }}
                onPointerLeave={() => { clearTimeout(peekTimer.current); peekTimer.current = window.setTimeout(() => setPeek(null), 80); }}>
                <span className="ic"><SvgIcon name="doc" /></span><span className="nm">{r.name}</span><span className="fd">{r.folder}</span>
                <span className="ct">{r.cards ? `${r.cards} cards` : ''}</span><span className="wh">{whenLabel(r.when)}</span>
              </button>
            )) : <p className="hm-none">Files you open show up here</p>}
          </div>
        </div>
      </div>
      <div className={`hm-peek${peek ? ' open' : ''}`} role="tooltip" data-from={peek?.from ?? 'top'} style={peek ? { left: peek.left, top: peek.top } : undefined}>
        {peek && <>
          <p className="pk-h"><span>{peek.r.name}</span><span className="pk-c">{peek.r.cards} cards</span></p>
          {peek.r.blocks.slice(0, 6).map((b, i) => <p key={i} className={`pk-r l${b.level}`}><span>{b.label}</span><span className="pk-c">{b.cards}</span></p>)}
          {peek.r.blocks.length > 6 && <p className="pk-more">More blocks inside</p>}
        </>}
      </div>
      <div className={`hm-undo${undo ? ' open' : ''}`} role="status"
        onPointerEnter={() => (undoState.current.paused = true)} onPointerLeave={() => (undoState.current.paused = false)}>
        <span>Recent cleared</span>
        <button onClick={() => { props.onClear(undo); setUndo(null); }}>Undo</button>
        <i ref={undoBar} />
      </div>
    </section>
  );
}
