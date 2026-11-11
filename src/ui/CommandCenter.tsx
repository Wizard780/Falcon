import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { redo, undo } from 'prosemirror-history';
import { IS_MAC, keyParts } from '../editor/keybinds';
import { PREFIXES, loadRecent, matchRanges, noteRecent, parseArgs, parseQuery, rank, type Entry, type SourceId } from './command-center';
import { argEntries, blockEntries, canFold, commandEntries, fileEntries, headingEntries, settingEntries, startFolded, templateEntries, textEntries, visibleTree, type Ctx } from './cc-sources';
import { collectHits, type FileHit } from './file-search';
import type { Node as PMNode } from 'prosemirror-model';
import { cardContent } from './card-search';
import { insertAtEnd, insertIntoSpeech } from '../editor/speech';
import { isReading } from '../editor/read';
import { levelOf } from '../editor/schema';
import { bridge, type IndexedFile } from '../editor/host';
import { SvgIcon } from './icons';
import './command-center.css';

const SOURCE_NAME: Record<SourceId, string> = { arg: '', cmd: 'Commands', set: 'Settings', doc: 'In this file', file: 'Files', tpl: 'Templates', help: 'Help', blk: 'Blocks' };
const BADGE: Record<SourceId, string> = { arg: 'GO', cmd: 'CMD', set: 'SET', doc: '', file: 'DOCX', tpl: 'TPL', help: '?', blk: '' };
const badgeOf = (e: Entry) => e.badge ?? (e.key === 'find' || e.key === 'replace' ? 'FIND' : BADGE[e.source]);
// like CardMirror: 50 rows at a time, arrowing past the end shows the next 50
const PAGE = 50;
// mixed in with commands and settings, the file's headings take at most this many rows
const DOC_CAP = 8;
// and files at most this many (an indexed folder can hold thousands); f then a space lists them all
const FILE_CAP = 10;

type Row = { e: Entry; head?: string };
/** Where Esc goes back to: the file list as it was. */
type Back = { query: string; at: number };
/** Search blocks: another file's headings, to insert from. `doc` is unset while it's read. */
type Inside = { hit: FileHit; back: Back; doc?: PMNode; err?: string };

const HELP: Entry[] = [
  ...PREFIXES.filter((p) => p.prefix !== '?').map((p): Entry => ({ key: `help:${p.prefix}`, source: 'help', label: `${p.prefix} then a space: ${p.label.toLowerCase()}`, group: 'Narrow it down', fill: `${p.prefix} ` })),
  { key: 'help:>', source: 'help', label: '> commands, # headings (no space needed)', group: 'Narrow it down', fill: '>' },
  { key: 'help:zoom', source: 'help', label: 'zoom 150 sets the zoom', group: 'Type a value', fill: 'zoom 150' },
  { key: 'help:size', source: 'help', label: '14pt sets the font size', group: 'Type a value', fill: '14pt' },
  { key: 'help:card', source: 'help', label: 'card 12 goes to the 12th card', group: 'Type a value', fill: 'card 12' },
  { key: 'help:depth', source: 'help', label: 'depth 2 sets the outline depth', group: 'Type a value', fill: 'depth 2' },
  { key: 'help:speech', source: 'help', label: 'speech 6, prep 5 set the timers', group: 'Type a value', fill: 'speech 6' },
  { key: 'help:find', source: 'help', label: 'anything else: find or replace it in this file', group: 'Type a value', fill: '' },
  { key: 'help:keys', source: 'help', label: 'Shift-Enter runs and keeps this open; Mod-Z undoes from here', group: 'Keys', fill: '' },
];

/**
 * Mod-Shift-Space, CardMirror's Search Everything: a bar over the bottom of the page with results above it.
 * Runs any command, toggles or cycles any setting, and jumps to any heading or card in the file.
 */
export function CommandCenter(props: { open: boolean; onClose: () => void; ctx: Ctx; flash: (m: string) => void; saveScroll: () => () => void; start?: FileHit | null }) {
  const { open, ctx } = props;
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  // a setting's choices, listed in place of the results (Esc goes back)
  const [sub, setSub] = useState<{ entry: Entry; back: string } | null>(null);
  // a file row's Enter: open it, or search its blocks (Mod-Enter skips this and opens)
  const [choose, setChoose] = useState<{ hit: FileHit; back: Back } | null>(null);
  const [inside, setInside] = useState<Inside | null>(null);
  const [folded, setFolded] = useState<Set<number>>(new Set());
  // bumped whenever a read stops mattering (Esc, close, another file), so a slow read can't land late
  const reading = useRef(0);
  const [tick, setTick] = useState(0);
  const [place, setPlace] = useState<{ left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const actRef = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  const restore = useRef<(() => void) | null>(null);
  // .docx files in the folders Settings > File search allows (desktop only)
  const [indexed, setIndexed] = useState<IndexedFile[]>([]);
  const peeked = useRef(false);

  useLayoutEffect(() => {
    if (!open) return;
    setQuery(''); setAt(0); setSub(null); setLimit(PAGE); setChoose(null); setInside(null);
    peeked.current = false;
    // Cmd-K's Search blocks lands straight in the file, and Esc goes to the files list
    if (props.start) enterBlocks(props.start, { query: 'f ', at: 0 });
    restore.current = props.saveScroll();
    inputRef.current?.focus();
    let live = true;
    void bridge.indexedFiles?.().then((f) => live && setIndexed(f), () => {});
    // centered over the page, like CardMirror centers it over the active pane
    const fit = () => {
      const r = document.querySelector('.f-scroll')?.getBoundingClientRect();
      const avail = r && r.width > 0 ? r.width : innerWidth, mid = r && r.width > 0 ? r.left + r.width / 2 : innerWidth / 2;
      setPlace({ left: Math.round(mid), width: Math.round(Math.max(280, Math.min(620, avail - 24))) });
    };
    fit();
    addEventListener('resize', fit);
    return () => { live = false; reading.current++; removeEventListener('resize', fit); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Read `hit` and list its headings. A function declaration, so the open effect above can call it. */
  function enterBlocks(hit: FileHit, back: Back) {
    const id = ++reading.current;
    setChoose(null); setSub(null); setInside({ hit, back }); setQuery(''); setAt(0); setLimit(PAGE);
    const failed = (why: string) => { if (reading.current === id) setInside((s) => s && { ...s, err: why }); };
    Promise.resolve(ctx.fileDoc ? ctx.fileDoc(hit) : null).then((d) => {
      if (reading.current !== id) return;
      if (!d) { failed(`Couldn't read ${hit.name}.`); return; }
      const ls: number[] = [];
      d.forEach((n) => { const l = levelOf(n); if (l) ls.push(l); }); // the outline's levels, as blockEntries will list them
      setFolded(startFolded(ls));
      setInside((s) => s && { ...s, doc: d });
    }, (e: unknown) => failed(`Couldn't read ${hit.name}: ${(e as Error).message}`));
  }

  const doc = ctx.view?.state.doc;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const headings = useMemo(() => (open ? headingEntries(ctx) : []), [open, doc]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const base = useMemo(() => (open ? [...commandEntries(ctx), ...settingEntries(ctx)] : []), [open, ctx, tick]);
  const recent = useMemo(() => (open ? loadRecent() : []), [open, tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hits = useMemo(() => (open ? collectHits(ctx.docs ?? [], ctx.recents ?? [], indexed) : []), [open, ctx.docs?.length, ctx.recents, indexed]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const files = useMemo(() => fileEntries(ctx, hits), [hits]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const templates = useMemo(() => (open ? templateEntries(ctx) : []), [open]);

  // in a list of its own the box only filters it: "t subs" or "c china" there are words, not prefixes
  const { source, text } = sub || choose || inside ? { source: undefined, text: query } : parseQuery(query);
  const typed = !!text.trim();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const blocks = useMemo(() => (inside?.doc ? blockEntries(inside.doc) : null), [inside?.doc]);
  const levels = useMemo(() => blocks?.items.map((it) => it.level) ?? [], [blocks]);
  const rows: Row[] = useMemo(() => {
    if (!open) return [];
    if (sub) {
      const opts = sub.entry.options!().map((o, i): Entry => ({
        key: `opt:${i}`, source: 'set', badge: 'SET', label: o.label, group: sub.entry.label, state: o.on ? 'Now' : undefined, run: () => { o.pick(); },
      }));
      return rank(opts, query, [], 500).map((e) => ({ e }));
    }
    if (choose) {
      const h = choose.hit, fileKey = `file:${h.path ?? h.key}`;
      const opts: Entry[] = [
        { key: 'pick:blocks', source: 'blk', badge: 'BLK', label: `Search blocks in ${h.name}`, group: '', keep: true, run: () => { noteRecent(fileKey); enterBlocks(h, choose.back); } },
        { key: fileKey, source: 'file', badge: 'DOCX', label: `Open ${h.name}`, group: '', hint: h.path, run: () => { ctx.openFile?.(h); } },
      ];
      return rank(opts, query, [], 10).map((e) => ({ e }));
    }
    if (inside) {
      if (!blocks) return [];
      if (!typed) return visibleTree(levels, folded).map((i) => ({ e: blocks.entries[i] }));
      return rank(blocks.entries, text, [], 100000).map((e) => ({ e }));
    }
    if (source === 'help') return rank(HELP, text, [], 50).map((e) => ({ e }));
    // c is commands plus the setting toggles and cycles, as in CardMirror
    const pool = source === 'cmd' ? base.filter((e) => e.source === 'cmd' || e.badge === 'TOG' || e.badge === 'CYC')
      : source === 'set' ? base.filter((e) => e.source === 'set')
      : source === 'doc' ? headings
      : source === 'file' ? files
      : source === 'tpl' ? templates
      : [...base, ...templates, ...headings, ...files];
    if (!typed) {
      if (source === 'doc') return pool.map((e) => ({ e }));
      // f alone: what's open and what you opened lately (the folders' files show once you type)
      if (source === 'file') return files.filter((e, i) => hits[i].kind !== 'file').map((e, i, all) => ({ e, head: e.group !== all[i - 1]?.group ? e.group : undefined }));
      // nothing typed and no prefix: just what you ran lately (CardMirror shows nothing here)
      if (!source) {
        const byKey = new Map(pool.map((e) => [e.key, e]));
        return recent.map((k) => byKey.get(k)).filter((e): e is Entry => !!e).slice(0, 8).map((e, i) => ({ e, head: i ? undefined : 'Recent' }));
      }
      const out: Row[] = [];
      let last = '';
      for (const e of pool) {
        if (e.typedOnly) continue;
        out.push({ e, head: e.group !== last ? e.group : undefined });
        last = e.group;
      }
      return out;
    }
    const args = !source || source === 'cmd' || source === 'doc' ? argEntries(ctx, parseArgs(text)) : [];
    let docs = 0, fs = 0;
    const ranked = rank(pool, text, recent, 300).filter((e) => source
      || (e.source === 'doc' ? ++docs <= DOC_CAP : e.source === 'file' ? ++fs <= FILE_CAP : true));
    const tail = !source || source === 'doc' ? textEntries(ctx, text) : [];
    return [...args, ...ranked, ...tail].map((e) => ({ e }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sub, choose, inside, blocks, folded, query, base, headings, files, templates, recent]);

  const shown = rows.slice(0, limit);
  const cur = Math.max(0, Math.min(at, shown.length - 1));
  const row = shown[cur]?.e;

  // one lit pill slides to the current row, like the outline's
  useLayoutEffect(() => {
    const list = listRef.current, act = actRef.current;
    if (!list || !act) return;
    const el = list.querySelector<HTMLElement>('.cc-row[data-on]');
    if (!el) { act.style.opacity = '0'; return; }
    act.style.height = `${el.offsetHeight}px`;
    act.style.transform = `translateY(${el.offsetTop}px)`;
    act.style.opacity = '1';
    el.scrollIntoView({ block: 'nearest' });
  });
  // no slide on the first frame: the pill starts where it belongs
  useEffect(() => {
    if (!open) { setReady(false); return; }
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);
  // arrowing onto a heading shows it on the page behind
  useEffect(() => {
    if (!open || !row?.peek) return;
    const raf = requestAnimationFrame(() => { peeked.current = true; row.peek!(); });
    return () => cancelAnimationFrame(raf);
  }, [open, row]);

  if (!open) return null;

  const close = (keepPlace: boolean) => {
    // closed without going anywhere: the page goes back to where it was before peeking
    if (!keepPlace && peeked.current) restore.current?.();
    props.onClose();
  };
  const settingsFor = (e: Entry) => { if (e.settings) { close(true); ctx.openSettings(e.settings.page, e.settings.query); } };
  const drill = (e: Entry) => { setSub({ entry: e, back: query }); setQuery(''); setAt(Math.max(0, e.options!().findIndex((o) => o.on))); setLimit(PAGE); };
  const canDive = (h?: FileHit) => !!h && !!ctx.fileDoc && !!ctx.readable?.(h);
  /** Put the heading's whole section (a hat brings its blocks and cards) into the open doc. The box stays open for more, as in CardMirror. */
  const insertBlock = (e: Entry, atEnd: boolean) => {
    const d = inside?.doc, it = blocks?.items[Number(e.key.slice(4))];
    const content = d && it ? cardContent(d, it.pos) : null;
    if (!content) return;
    const v = ctx.view;
    if (!v) { props.flash('Open a file to insert into'); return; }
    if (isReading(v.state)) { props.flash('Turn read mode off to insert'); return; }
    ctx.run((state, dispatch) => { dispatch?.(atEnd ? insertAtEnd(state, content) : insertIntoSpeech(state, content).scrollIntoView()); return true; });
    peeked.current = false; // the page moved on purpose: closing keeps it there
    props.flash(`Inserted ${e.label}${atEnd ? ' at the end' : ''}`);
    inputRef.current?.focus();
  };
  const toggleFold = (e: Entry) => {
    const i = Number(e.key.slice(4));
    if (!canFold(levels, i)) return;
    setFolded((f) => { const n = new Set(f); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  };
  const activate = (e: Entry | undefined, stay: boolean, mod = false, alt = false) => {
    if (!e) return;
    if (inside) { if (e.source === 'blk') insertBlock(e, alt); return; }
    if (e.keep) { e.run?.(); return; }
    // a file: ask open or search its blocks; Mod-Enter opens it straight away
    if (e.file && !mod && canDive(e.file)) { setChoose({ hit: e.file, back: { query, at: cur } }); setQuery(''); setAt(0); setLimit(PAGE); return; }
    if (e.fill !== undefined) { if (e.fill) { setQuery(e.fill); setAt(0); } inputRef.current?.focus(); return; }
    if (!e.run) return;
    if (e.source === 'cmd' || e.source === 'set' || e.source === 'file' || e.source === 'tpl') noteRecent(sub ? sub.entry.key : e.key);
    if (!stay) close(e.source === 'doc' || e.source === 'arg');
    const did = e.run();
    if (did === false) props.flash(e.can && !e.can() ? `${e.label}: nothing to do here` : `${e.label} didn't change anything`);
    if (stay) { setTick((t) => t + 1); inputRef.current?.focus(); }
  };
  const back = () => {
    if (sub) { const q = sub.back; setSub(null); setQuery(q); setAt(0); return; }
    const b = (choose ?? inside)!.back;
    reading.current++;
    setChoose(null); setInside(null); setQuery(b.query); setAt(b.at); setLimit(Math.max(PAGE, b.at + 1));
  };
  const nested = !!(sub || choose || inside);
  const move = (d: number) => {
    const n = shown.length;
    if (!n) return;
    const next = cur + d;
    // past the last row: the next page, when there is one
    if (next >= n && rows.length > n) { setLimit((l) => l + PAGE); setAt(next); return; }
    setAt((next + n) % n);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); setAt(Math.max(0, Math.min(shown.length - 1, cur + (e.key === 'PageDown' ? 8 : -8)))); }
    else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      // in the open-or-blocks choice Mod-Enter still means open
      if (choose && mod) { activate(rows.find((r) => r.e.source === 'file')?.e, false); return; }
      activate(row, e.shiftKey, mod, e.altKey);
    }
    else if (e.key === 'Tab') { e.preventDefault(); if (row?.options) drill(row); else if (!nested && row?.file && canDive(row.file)) enterBlocks(row.file, { query, at: cur }); else if (row) settingsFor(row); }
    else if (e.key === 'ArrowRight' && row?.options && e.currentTarget.selectionStart === query.length) { e.preventDefault(); drill(row); }
    // → on a file goes straight to its blocks, like CardMirror's Tab
    else if (e.key === 'ArrowRight' && !nested && row?.file && canDive(row.file) && e.currentTarget.selectionStart === query.length) { e.preventDefault(); enterBlocks(row.file, { query, at: cur }); }
    // the file's tree, nothing typed: → opens a heading, ← closes it
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && inside && !typed && row?.source === 'blk') {
      const i = Number(row.key.slice(4));
      if (canFold(levels, i) && folded.has(i) === (e.key === 'ArrowRight')) { e.preventDefault(); toggleFold(row); }
    }
    else if (e.key === 'Backspace' && nested && !query) { e.preventDefault(); back(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (nested) back(); else close(false); }
    else if (mod && /^[zy]$/i.test(e.key)) {
      // undo and redo reach the document, so a command run with Shift-Enter can be taken back from here
      e.preventDefault();
      const again = e.key.toLowerCase() === 'y' || e.shiftKey;
      if (!ctx.run(again ? redo : undo)) props.flash(again ? 'Nothing to redo' : 'Nothing to undo');
      setTick((t) => t + 1);
    }
  };

  const label = (e: Entry): ReactNode => {
    const ranges = e.source === 'help' || e.keep || choose ? [] : matchRanges(e.label, text);
    if (!ranges.length) return e.label;
    const out: ReactNode[] = [];
    let i = 0;
    ranges.forEach(([a, b], k) => { out.push(e.label.slice(i, a), <b key={k}>{e.label.slice(a, b)}</b>); i = b; });
    out.push(e.label.slice(i));
    return out;
  };
  // the hint strip says what each key does for the row you're on
  const verb = (e: Entry) => e.fill !== undefined ? 'type it' : e.keep ? 'search' : inside ? 'insert' : e.file && canDive(e.file) && !choose ? 'open or search' : e.badge === 'TOG' ? 'toggle' : e.badge === 'CYC' ? 'cycle' : e.source === 'doc' || e.source === 'arg' ? 'go' : e.source === 'file' || e.source === 'tpl' ? 'open' : 'run';
  const hints: [string, string][] = [];
  const modKey = IS_MAC ? '⌘' : 'Ctrl';
  if (row && inside) {
    hints.push(['↵', 'insert'], [IS_MAC ? '⌥↵' : 'Alt ↵', 'at end']);
    if (!typed && canFold(levels, Number(row.key.slice(4)))) hints.push(['→←', 'fold']);
  } else if (row && (choose || (row.file && canDive(row.file)))) {
    hints.push(['↵', verb(row)], [`${modKey}↵`, 'open']);
    if (!choose) hints.push(['→', 'blocks']);
  } else if (row) {
    hints.push(['↵', verb(row)]);
    if (row.run && row.source !== 'doc' && row.source !== 'help' && row.source !== 'arg') hints.push(['⇧↵', 'keep open']);
    if (row.options) hints.push(['⇥', 'choices']);
    else if (row.settings) hints.push(['⇥', row.settings.page === 'keys' ? 'change key' : 'settings']);
  }
  hints.push(['esc', nested ? 'back' : 'close']);
  const empty = inside ? (inside.err ?? (!blocks ? `Reading ${inside.hit.name}…` : typed ? `Nothing in ${inside.hit.name} matches “${text.trim()}”.` : `${inside.hit.name} has no headings.`))
    : sub || choose ? `No choice matches “${query.trim()}”.` : source === 'doc' && !typed ? 'This file has no headings yet.' : source === 'tpl' && !typed ? 'No templates yet. Make one in Settings > Templates.' : typed ? `Nothing matches “${text.trim()}”.` : '';
  const fill = (q: string) => { setQuery(q); setAt(0); inputRef.current?.focus(); };

  /** What a setting is now: a little switch for toggles, now → next for cycles, a tick for the current choice. */
  const state = (e: Entry): ReactNode => {
    if (!e.state) return null;
    if (e.badge === 'TOG') return <span className="st-tog cc-tog" aria-checked={e.state === 'On'} aria-label={e.state}><i /></span>;
    if (e.state === 'Now') return <span className="cc-now" aria-label="Current"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg></span>;
    const [now, next] = e.state.split(' → ');
    return next === undefined ? <span className="cc-cyc"><b>{now}</b></span> : <span className="cc-cyc"><b>{now}</b><i>→</i>{next}</span>;
  };

  return (
    <div className="cc-back" onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
      <div className="cc" role="dialog" aria-label="Command center" style={place ? { left: place.left, width: place.width } : undefined}>
        <div ref={listRef} id="cc-list" className="cc-list" role="listbox" aria-label="Results" data-ready={ready || undefined} onMouseDown={(e) => e.preventDefault()}>
          <span ref={actRef} className="cc-act" />
          {!typed && !nested && !source && (
            <div className="cc-start">
              <span>Type to search everything, or narrow it down</span>
              <span className="cc-chips">
                {PREFIXES.map((p) => (
                  <button key={p.prefix} onClick={() => fill(p.prefix === '?' ? '?' : `${p.prefix} `)}><kbd>{p.prefix}</kbd>{p.prefix === '?' ? 'More' : SOURCE_NAME[p.source] === 'In this file' ? 'Headings' : SOURCE_NAME[p.source]}</button>
                ))}
              </span>
            </div>
          )}
          {shown.map(({ e, head }, i) => {
            const dim = e.can ? !e.can() : false;
            const b = badgeOf(e);
            return (
              <div key={`${e.key}-${i}`} role="presentation">
                {head && <div className="cc-head">{head}</div>}
                <div id={`cc-${i}`} className="cc-row" role="option" aria-selected={i === cur} aria-disabled={dim || undefined}
                  data-on={i === cur || undefined} data-dim={dim || undefined} data-src={e.source}
                  style={e.level && (source === 'doc' || (inside && e.source === 'blk')) && !typed ? { paddingLeft: 10 + (e.level - 1) * 16 } : undefined}
                  title={e.hint} onMouseMove={() => { if (i !== cur) setAt(i); }}
                  onClick={(ev) => activate(e, ev.shiftKey, IS_MAC ? ev.metaKey : ev.ctrlKey, ev.altKey)}
                  onContextMenu={(ev) => { ev.preventDefault(); if (inside) toggleFold(e); else settingsFor(e); }}>
                  {inside && !typed && (canFold(levels, Number(e.key.slice(4)))
                    ? <svg className="cc-fold" data-open={!folded.has(Number(e.key.slice(4))) || undefined} viewBox="0 0 16 16" aria-label={folded.has(Number(e.key.slice(4))) ? 'Open' : 'Close'}
                      onClick={(ev) => { ev.stopPropagation(); toggleFold(e); }}><path d="m6.5 4.5 3.5 3.5-3.5 3.5" /></svg>
                    : <span className="cc-fold" />)}
                  {b && <span className="cc-badge" data-b={b}>{b}</span>}
                  <span className="cc-nm">{label(e)}</span>
                  {(e.source === 'doc' || (e.source === 'blk' && !e.keep)) && e.hint && <span className="cc-meta">{e.hint}</span>}
                  {typed && e.group && e.source !== 'doc' && e.source !== 'blk' && <span className="cc-meta">{e.group}</span>}
                  {state(e)}
                  {e.shortcut && <span className="cc-keys">{keyParts(e.shortcut).map((p, k) => <kbd key={k}>{p}</kbd>)}</span>}
                  {e.options && <svg className="cc-go" viewBox="0 0 16 16" aria-hidden="true"><path d="m6.5 4.5 3.5 3.5-3.5 3.5" /></svg>}
                </div>
              </div>
            );
          })}
          {rows.length > shown.length && (
            <button className="cc-more" onClick={() => { setLimit((l) => l + PAGE); inputRef.current?.focus(); }}>
              Show {Math.min(PAGE, rows.length - shown.length)} more <span>{rows.length - shown.length} left</span>
            </button>
          )}
          {!rows.length && empty && <p className="cc-none">{empty}</p>}
        </div>
        <label className="cc-bar">
          <SvgIcon name="search" />
          {nested && <button className="cc-chip" onMouseDown={(e) => { e.preventDefault(); back(); }} title="Back (Esc)">{sub ? sub.entry.label.replace(/^Cycle /, '') : (choose ?? inside)!.hit.name}</button>}
          {!nested && source && <span className="cc-chip src">{SOURCE_NAME[source]}</span>}
          <input ref={inputRef} className="cc-input" placeholder={inside ? `Search in ${inside.hit.name}…` : sub || choose ? 'Pick one…' : 'Search…'} aria-label="Command center" spellCheck={false} value={query}
            role="combobox" aria-expanded="true" aria-controls="cc-list" aria-activedescendant={row ? `cc-${cur}` : undefined}
            onChange={(e) => { setQuery(e.target.value); setAt(0); setLimit(PAGE); }} onKeyDown={onKey} />
        </label>
        <div className="cc-hints">
          <span className="cc-why">{row?.hint && row.source !== 'doc' && row.source !== 'blk' ? row.hint : ''}</span>
          {hints.map(([k, what]) => <span key={what} className="cc-hint"><kbd>{k}</kbd>{what}</span>)}
        </div>
      </div>
    </div>
  );
}
