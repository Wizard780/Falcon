import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clock, dots } from './home-fx';
import { tidy, whenLabel, type Recent } from './recents';
import { keyOf, keyText } from '../editor/keybinds';
import { SvgIcon } from './icons';
import { launchFalcon } from './falcon';
import { reducedMotion } from './motion';
import { P, pref } from '../editor/prefs';


/** The start screen (and ⌘T): the files you opened recently, the first page of the one you point at beside them. */
let launched = false; // the falcon's flight plays once per page load, not on every Home

export function Home(props: {
  open: boolean;
  current: string;
  recents: Recent[];
  onNew: () => void;
  onNewSpeech: () => void;
  onSpeechDrop: () => void;
  onOpen: () => void;
  onRecent: (r: Recent) => void;
  onClear: (keep: Recent[] | null) => void;
  /** A recent from before previews were kept: read it so its page can be shown. */
  onPeek: (r: Recent) => void;
}) {
  const { open, recents } = props;
  const homeRef = useRef<HTMLElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLDivElement>(null);
  const scRef = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const [sel, setSel] = useState(0);
  const [undo, setUndo] = useState<Recent[] | null>(null);

  // the falcon flies in once per launch, when Falcon starts on Home; after that it just sits on its perch
  const perchRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fly = open && !launched && pref(P.launchFalcon) && !reducedMotion();
    launched = true;
    return launchFalcon(homeRef.current!, perchRef.current!, fly);
  }, []);

  // the effects run only while home is showing; focus in a layout effect, so keys pressed right after it opens land here
  useLayoutEffect(() => {
    if (!open) return;
    setSel(0);
    scRef.current!.scrollTop = 0;
    homeRef.current!.focus({ preventScroll: true }); // Tab starts inside Home, not in the covered editor
    const stops = [dots(bgRef.current!), clock(clockRef.current!)];
    return () => stops.forEach((s) => s());
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

  const shown = undo ? [] : recents;
  const at = Math.min(sel, Math.max(0, shown.length - 1));
  const pick = shown[at];
  const { onPeek } = props;
  useEffect(() => { if (open && pick && pick.preview === undefined) onPeek(pick); }, [open, pick, onPeek]);
  // the arrow keys walk the list (focus follows, so Enter opens the row); the page beside it follows
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.target === homeRef.current && pick) { e.preventDefault(); props.onRecent(pick); return; }
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!step || !shown.length) return;
    e.preventDefault();
    const i = Math.min(shown.length - 1, Math.max(0, at + step));
    setSel(i);
    rows.current[i]?.focus();
  };

  const now = new Date();
  const day = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const total = shown.reduce((s, r) => s + r.cards, 0);
  return (
    <section ref={homeRef} tabIndex={-1} className={`home${open ? ' open' : ''}`} aria-label="Home" aria-hidden={!open} onKeyDown={onKey}>
      <div ref={bgRef} className="hm-bg" aria-hidden="true" />
      <div className="hm-glow" aria-hidden="true" />
      <div ref={scRef} className="hm-sc">
        <div className="hm-in">
          <header className="hm-head">
            <div className="hm-text">
              <div className="hm-brand">
                <div ref={perchRef} className="hm-perch" aria-hidden="true" />
                <div className="hm-words">
                  <p className="hm-date">{day}</p>
                  <p className="hm-sub">{props.current ? `${props.current} is open. Esc goes back to it` : shown.length ? `${shown.length} recent ${shown.length === 1 ? 'file' : 'files'} · ${total.toLocaleString('en-US')} cards` : 'Open a file or start a new one'}</p>
                </div>
              </div>
              <div className="hm-acts">
                <button className="hm-act" onClick={props.onNew}><SvgIcon name="plus" /><span>New document</span>{keyOf('new') && <kbd>{keyText(keyOf('new'))}</kbd>}</button>
                <button className="hm-act" onClick={props.onNewSpeech}><SvgIcon name="mic" /><span>New speech doc</span>{keyOf('newSpeech') && <kbd>{keyText(keyOf('newSpeech'))}</kbd>}</button>
                <button className="hm-act" onClick={props.onOpen}><SvgIcon name="open" /><span>Open…</span>{keyOf('open') && <kbd>{keyText(keyOf('open'))}</kbd>}</button>
                <button className="hm-act" onClick={props.onSpeechDrop}><SvgIcon name="inbox" /><span>SpeechDrop</span>{keyOf('speechdrop') && <kbd>{keyText(keyOf('speechdrop'))}</kbd>}</button>
              </div>
            </div>
            <div ref={clockRef} className="hm-clock" aria-live="off" />
          </header>

          <div className="hm-main">
            <div className="hm-col">
              <div className="hm-lab"><span>Recent</span>{shown.length > 0 && <button className="hm-clear" onClick={() => { setUndo(recents); props.onClear(null); }}>Clear</button>}</div>
              <div className="hm-list">
                {shown.length ? shown.map((r, i) => (
                  <button key={(r.path ?? '') + r.name} ref={(el) => { rows.current[i] = el; }} className="hm-row" data-on={i === at || undefined}
                    onPointerEnter={(e) => { setSel(i); if (document.activeElement?.classList.contains('hm-row')) e.currentTarget.focus({ preventScroll: true }); }} onFocus={() => setSel(i)} onClick={() => props.onRecent(r)}>
                    <span className="ic"><SvgIcon name="doc" /></span>
                    <span className="nm">{r.name}</span>
                    <span className="fd">{[r.folder, r.cards ? `${r.cards} cards` : ''].filter(Boolean).join(' · ')}</span>
                    <span className="wh">{whenLabel(r.when)}</span>
                  </button>
                )) : <p className="hm-none"><b>No recent files yet</b>Files you open show up here</p>}
              </div>
              {shown.length > 1 && <p className="hm-keys"><kbd>↑</kbd><kbd>↓</kbd> choose <kbd>↵</kbd> open <kbd>esc</kbd> back</p>}
            </div>

            <div className="hm-desk" aria-hidden="true">
              <div className="hm-sheet hm-under" />
              <Sheet key={pick ? (pick.path ?? '') + pick.name : ''} r={pick} />
              <div className="hm-cap">
                {pick ? <>
                  <div className="cap-t"><b>{pick.name}</b><span>{[pick.folder, `${pick.cards} cards`, whenLabel(pick.when)].filter(Boolean).join(' · ')}</span></div>
                  <button tabIndex={-1} className="cap-go" onClick={() => props.onRecent(pick)}>Open <kbd>↵</kbd></button>
                </> : <>
                  <div className="cap-t"><b>A blank page</b><span>Pockets, hats, blocks and tags</span></div>
                  <button tabIndex={-1} className="cap-go" onClick={props.onNew}>New document</button>
                </>}
              </div>
            </div>
          </div>
        </div>
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

// a small seeded random, so the blank page looks the same every time it's drawn
const rnd = (s: string) => { let x = [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 2147483647, 7) || 7; return () => (x = (x * 16807) % 2147483647) / 2147483647; };

/** A file's first page, drawn the way the editor draws it and shrunk to fit, like a Finder preview. */
function Sheet({ r }: { r?: Recent }) {
  if (r) return (
    <article className="hm-sheet hm-page">
      {r.preview
        ? <div className="ProseMirror hm-doc" dangerouslySetInnerHTML={{ __html: r.preview }} />
        : <p className="sh-pocket">{tidy(r.name)}</p>}
    </article>
  );
  return <Blank />;
}

/** No file yet: a page with stand-in cards, cut and highlighted. */
function Blank() {
  const rand = rnd('blank');
  const card = (k: number) => (
    <div key={k} className="sh-card">
      <i className="sh-tag" style={{ width: `${55 + rand() * 40}%` }} />
      <i className="sh-cite" style={{ width: `${30 + rand() * 25}%` }} />
      <p className="sh-body">{Array.from({ length: 9 + Math.floor(rand() * 6) }, (_, j) => {
        const v = rand();
        return <i key={j} className={v < 0.3 ? 'hl' : v < 0.55 ? 'ul' : ''} style={{ width: `${18 + rand() * 46}%` }} />;
      })}</p>
    </div>
  );
  return (
    <article className="hm-sheet hm-page" data-blank>
      <p className="sh-pocket">Untitled</p>
      {[0, 1, 2].map(card)}
    </article>
  );
}
