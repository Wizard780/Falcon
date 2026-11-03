import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as KeyEv } from 'react';
import { compareTexts, type CompareOpts, type CompareResult, type Piece } from '../editor/doc-tools/compare';
import { readJson, safeSet } from './storage';

const OPTS_KEY = 'falcon.compareOpts';
/** Kept until Falcon quits, so one pasted source can be checked against several cards. */
let kept: [string, string] = ['', ''];

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function summary(a: string, b: string, r: CompareResult, o: CompareOpts) {
  if (!r.diffs) {
    const ignoring = [o.ignoreCase && 'case', o.ignoreSpace && 'spacing'].filter(Boolean).join(' and ');
    return a === b ? 'Identical, byte for byte' : `No differences${ignoring ? ` (ignoring ${ignoring})` : ''}`;
  }
  return [plural(r.diffs, 'difference'), r.removed && `${plural(r.removed, r.unit)} only in Text 1`,
    r.added && `${plural(r.added, r.unit)} only in Text 2`, r.timedOut && 'too long to line up exactly'].filter(Boolean).join(' · ');
}

function Side({ pieces, side, cur, onPick, label }: { pieces: Piece[]; side: 'a' | 'b'; cur: number; onPick: (g: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // the current difference sits a third of the way down
  useLayoutEffect(() => {
    const el = ref.current, first = el?.querySelector<HTMLElement>(`[data-g="${cur}"]`);
    if (el && first) el.scrollTop = Math.max(0, first.offsetTop - el.clientHeight / 3);
  }, [cur, pieces]);
  return (
    <div ref={ref} className="cmp-out" tabIndex={0} aria-label={label}>
      {pieces.map((p, i) => !p.kind ? p.text : (
        <span key={i} data-g={p.g} className={`cmp-k${p.kind} cmp-${side}${p.g === cur ? ' cmp-cur' : ''}`}
          title={p.kind === 3 ? (side === 'a' ? 'Text 2 has text here' : 'Text 1 has text here') : undefined}
          onMouseDown={() => onPick(p.g)}>
          {/* a changed line break or space has to be visible */}
          {p.kind === 3 ? '' : p.kind === 2 ? p.text.replace(/\n/g, '↵\n') : p.text}
        </span>
      ))}
    </div>
  );
}

/**
 * Compare Text: Text 1 and Text 2 side by side. Paste either one, or Use selection: the panel steps aside,
 * you select the passage in the document and press Use selection on the bar. Compare (Mod-Enter) marks
 * what differs: red only in Text 1, green only in Text 2, a thin bar where the other side has text.
 */
export function ComparePanel({ open, onClose, readSelection }: { open: string | null; onClose: () => void; readSelection: () => string }) {
  const [texts, setTexts] = useState<[string, string]>(kept);
  const [opts, setOpts] = useState<CompareOpts>(() => ({ mode: 'words', ignoreCase: false, ignoreSpace: false, ...readJson<CompareOpts>(OPTS_KEY, {}) }));
  const [res, setRes] = useState<CompareResult | null>(null); // showing the result
  const [cur, setCur] = useState(-1);
  const [picking, setPicking] = useState<0 | 1 | null>(null);
  const pickRef = useRef(picking); // the Esc listener reads it as of now, not as of its last effect
  pickRef.current = picking;
  const [note, setNote] = useState('');
  const boxes = [useRef<HTMLTextAreaElement>(null), useRef<HTMLTextAreaElement>(null)];
  const outs = useRef<HTMLDivElement>(null);

  const put = (t: [string, string]) => { kept = t; setTexts(t); };
  const edit = useCallback((k: number) => { setRes(null); setNote(''); requestAnimationFrame(() => boxes[k].current?.focus()); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (t = texts, o = opts, keep = false) => {
    if (!t[0].trim() && !t[1].trim()) { setNote('Paste or select two texts to compare'); return; }
    const r = compareTexts(t[0], t[1], o);
    setRes(r);
    setNote(summary(t[0], t[1], r, o));
    setCur(r.diffs ? (keep ? Math.min(Math.max(cur, 0), r.diffs - 1) : 0) : -1);
    requestAnimationFrame(() => outs.current?.querySelectorAll<HTMLElement>('.cmp-out')[1]?.focus());
  };
  const go = (i: number) => { if (res?.diffs) setCur(Math.max(0, Math.min(i, res.diffs - 1))); };

  // opening: the selection becomes Text 1
  useLayoutEffect(() => {
    if (open === null) return;
    const t: [string, string] = open.trim() ? [open, kept[1]] : kept;
    put(t);
    setRes(null); setNote(''); setPicking(null);
    const focus = () => {
      const k = t[0] ? 1 : 0, box = boxes[k].current;
      if (!box || document.activeElement === box) return;
      box.focus();
      if (t[0] && t[1]) boxes[1].current?.select(); // pasting replaces the kept Text 2
    };
    setTimeout(focus, 0); // after this render, and again after whatever closed (the command center) hands focus back
    setTimeout(focus, 60);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const setOpt = (o: CompareOpts) => { setOpts(o); safeSet(OPTS_KEY, JSON.stringify(o)); if (res) run(texts, o, true); };

  // Esc: cancels picking, else closes
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      const k = pickRef.current;
      if (k !== null) { pickRef.current = null; setPicking(null); edit(k); } else onClose();
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [open, onClose, edit]);

  if (open === null) return null;

  const finishPick = () => {
    const k = picking!, got = readSelection();
    pickRef.current = null;
    setPicking(null);
    if (!got.trim()) { edit(k); setNote('Nothing was selected. Select text in the document first'); return; }
    const t: [string, string] = k ? [texts[0], got] : [got, texts[1]];
    put(t);
    if (t[1 - k].trim()) run(t); else edit(1 - k);
  };
  if (picking !== null) {
    return (
      <div className="cmp-pick" role="status">
        <span>Select the text for Text {picking + 1} in your document</span>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => { const k = picking; pickRef.current = null; setPicking(null); edit(k); }}>Cancel</button>
        <button className="cmp-main" onMouseDown={(e) => e.preventDefault()} onClick={finishPick}>Use selection</button>
      </div>
    );
  }

  const onKey = (e: KeyEv) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); res ? edit(0) : run(); return; }
    if (!res || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); go(cur + 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); go(cur - 1); }
  };
  const n = res?.diffs ?? 0;
  return (
    <div className="cf-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cf cmp" role="dialog" aria-modal="true" aria-labelledby="cmp-t" onKeyDown={onKey}>
        <h2 id="cmp-t">Compare Text</h2>
        <div className="cmp-bar">
          <span className="st-seg" role="group" aria-label="Compare by">
            {(['words', 'chars'] as const).map((m) => (
              <button key={m} data-on={(opts.mode ?? 'words') === m || undefined} aria-pressed={(opts.mode ?? 'words') === m} onClick={() => setOpt({ ...opts, mode: m })}>
                {m === 'words' ? 'Words' : 'Characters'}
              </button>
            ))}
          </span>
          <span className="st-seg" role="group" aria-label="Ignore">
            {(['ignoreCase', 'ignoreSpace'] as const).map((k) => (
              <button key={k} data-on={opts[k] || undefined} aria-pressed={!!opts[k]} onClick={() => setOpt({ ...opts, [k]: !opts[k] })}>
                {k === 'ignoreCase' ? 'Ignore case' : 'Ignore spacing'}
              </button>
            ))}
          </span>
          <span className="cmp-nav">
            <span aria-live="polite">{n ? `${cur + 1} of ${n}` : ''}</span>
            <button aria-label="Previous difference" title="Previous difference (↑)" disabled={!n || cur <= 0} onClick={() => go(cur - 1)}>↑</button>
            <button aria-label="Next difference" title="Next difference (↓)" disabled={!n || cur >= n - 1} onClick={() => go(cur + 1)}>↓</button>
          </span>
        </div>
        <div className="cmp-cols" ref={outs}>
          {([0, 1] as const).map((k) => (
            <div key={k} className="cmp-col">
              <div className="cmp-head">
                <span>Text {k + 1}</span>
                <button onClick={() => setPicking(k)}>Use selection</button>
                <button onClick={() => { put(k ? [texts[0], ''] : ['', texts[1]]); edit(k); }}>Clear</button>
              </div>
              {res
                ? <Side pieces={k ? res.right : res.left} side={k ? 'b' : 'a'} cur={cur} onPick={setCur} label={`Text ${k + 1}, differences marked`} />
                : <textarea ref={boxes[k]} className="cmp-text" aria-label={`Text ${k + 1}`} spellCheck={false} value={texts[k]}
                    placeholder={k ? 'Paste the second text, or press Use selection and select it in your document' : 'Paste the first text, or press Use selection'}
                    onChange={(e) => put(k ? [texts[0], e.target.value] : [e.target.value, texts[1]])} />}
            </div>
          ))}
        </div>
        <div className="cmp-foot">
          <span className="cmp-note">{note || (res ? '' : `${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}Enter to compare · Esc to close`)}</span>
          <button onClick={() => { const t: [string, string] = [texts[1], texts[0]]; put(t); if (res) run(t, opts, true); }}>Swap</button>
          <button className="cmp-main" onClick={() => (res ? edit(0) : run())}>{res ? 'Edit' : 'Compare'}</button>
        </div>
      </div>
    </div>
  );
}
