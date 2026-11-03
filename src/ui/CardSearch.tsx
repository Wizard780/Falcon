import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { bridge, type CardHit, type CardIndexStatus } from '../editor/host';
import { keyText } from '../editor/keybinds';
import { shortCite } from './card-search';
import { SvgIcon } from './icons';
import './palette.css';

const n = (x: number) => x.toLocaleString('en-US');

/** Search cards: every card in the folders allowed in Settings, by tag, cite, heading or file name. */
export function CardSearch(props: {
  open: boolean;
  onClose: () => void;
  /** Enter: open the file at the card. Mod-Enter: put the card into the open document */
  onPick: (h: CardHit, insert: boolean) => void;
  onSettings: () => void;
}) {
  const { open } = props;
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const [hits, setHits] = useState<CardHit[]>([]);
  const [status, setStatus] = useState<CardIndexStatus | null>(null);
  const [folders, setFolders] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    setQuery('');
    setHits([]);
    setAt(0);
    inputRef.current?.focus();
    let live = true;
    void bridge.indexFolders?.().then((f) => live && setFolders(f.length), () => {});
    return () => { live = false; };
  }, [open]);

  // ask on each change (a moment after typing stops), and again every so often while the index is still reading files
  const scanning = !!status?.scanning;
  useEffect(() => {
    if (!open || !bridge.searchCards) return;
    let live = true;
    const ask = () => bridge.searchCards!(query).then((r) => { if (live) { setHits(r.hits); setStatus(r.status); } }, () => {});
    const t = setTimeout(ask, query ? 60 : 0);
    const again = scanning ? setInterval(ask, 800) : 0;
    return () => { live = false; clearTimeout(t); clearInterval(again); };
  }, [open, query, scanning]);

  const cur = Math.min(at, hits.length - 1);
  useEffect(() => { listRef.current?.querySelector('[data-on]')?.scrollIntoView({ block: 'nearest' }); }, [cur, hits]);
  if (!open) return null;

  const pick = (h: CardHit | undefined, insert: boolean) => { if (h) { props.onClose(); props.onPick(h, insert); } };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length) setAt((cur + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length);
    } else if (e.key === 'Enter') { e.preventDefault(); pick(hits[cur], e.metaKey || e.ctrlKey); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (query) { setQuery(''); setAt(0); } else props.onClose(); }
  };

  const reading = status?.scanning && status.total ? `Reading files: ${n(status.done)} of ${n(status.total)}` : null;
  let empty: string;
  if (!bridge.searchCards) empty = 'Search cards reads the folders you pick in Settings, in the desktop app.';
  else if (folders === 0) empty = 'Add the folders your files are in, and every card in them shows up here.';
  else if (!query) empty = status ? `${reading ?? `${n(status.cards)} cards in ${n(status.files)} files`}. Type words from a tag, cite, heading or file name.` : '';
  else empty = reading ? `No cards match “${query.trim()}” yet. ${reading}.` : `No cards match “${query.trim()}”.`;

  return (
    <div className="pk-back" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="pk" role="dialog" aria-modal="true" aria-label="Search cards" onKeyDown={onKey}>
        <label className="pk-search">
          <SvgIcon name="search" />
          <input ref={inputRef} placeholder="Search cards" aria-label="Search cards" spellCheck={false} value={query}
            role="combobox" aria-expanded="true" aria-controls="pk-cards" aria-activedescendant={hits[cur] ? `pk-c${cur}` : undefined}
            onChange={(e) => { setQuery(e.target.value); setAt(0); }} />
        </label>
        <div ref={listRef} id="pk-cards" className="pk-list" role="listbox" aria-label="Cards">
          {hits.map((h, i) => (
            <div key={`${h.path}#${h.ordinal}`} id={`pk-c${i}`} className="pk-row pk-card" role="option" aria-selected={i === cur} data-on={i === cur || undefined}
              title={`${h.cite || h.tag}\n${h.path}${h.copies > 1 ? `\nIn ${h.copies} files, this is the newest` : ''}`}
              onMouseMove={() => { if (i !== cur) setAt(i); }} onClick={(e) => pick(h, e.metaKey || e.ctrlKey)}>
              <span className="pk-nm">{h.tag || 'Untitled card'}</span>
              <span className="pk-sub">
                <span className="pk-cite">{h.cite ? shortCite(h.cite) : 'Analytic'}</span>
                <span className="pk-in">{h.headings.length ? `${h.file} · ${h.headings[h.headings.length - 1]}` : h.file}</span>
              </span>
            </div>
          ))}
          {!hits.length && empty && <p className="pk-none">{empty}</p>}
        </div>
        {bridge.searchCards && folders === 0 ? (
          <button className="pk-foot" onClick={() => { props.onClose(); props.onSettings(); }}>Add folders in Settings</button>
        ) : hits.length > 0 && (
          <p className="pk-keys">Enter opens the file at the card · {keyText('Mod-Enter')} puts the card in this document{reading ? ` · ${reading}` : ''}</p>
        )}
      </div>
    </div>
  );
}
