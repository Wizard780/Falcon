import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { bridge, type IndexedFile } from '../editor/host';
import { collectHits, rankHits, type FileHit } from './file-search';
import type { Recent } from './recents';
import { PinIcon, StarIcon, loadHidden, loadPinned, loadStarred } from './starred';
import { SvgIcon } from './icons';
import { IS_MAC } from '../editor/keybinds';
import './palette.css';

/** Cmd-K: search open documents, recent files and the folders allowed in Settings, and open one. */
export function Palette(props: {
  open: boolean;
  onClose: () => void;
  docs: { id: number; name: string; path?: string }[];
  recents: Recent[];
  onPick: (h: FileHit) => void;
  /** Search blocks: can it read this file, and list its headings to insert from (in the command center) */
  canBlocks?: (h: FileHit) => boolean;
  onBlocks?: (h: FileHit) => void;
  onSettings: () => void;
}) {
  const { open } = props;
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const [files, setFiles] = useState<IndexedFile[]>([]);
  const [folders, setFolders] = useState<number | null>(null); // how many folders are allowed (null: not asked yet)
  const [starred, setStarred] = useState<string[]>(loadStarred);
  const [pinned, setPinned] = useState<string[]>(loadPinned);
  const [hidden, setHidden] = useState<string[]>(loadHidden);
  // Enter on a file asks: search its blocks, or open it (Mod-Enter opens straight away)
  const [choice, setChoice] = useState<{ hit: FileHit; at: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    setQuery('');
    setAt(0);
    setChoice(null);
    setStarred(loadStarred());
    setPinned(loadPinned());
    setHidden(loadHidden());
    inputRef.current?.focus();
    let live = true;
    void bridge.indexFolders?.().then((f) => live && setFolders(f.length), () => {});
    void bridge.indexedFiles?.().then((f) => live && setFiles(f), () => {});
    return () => { live = false; };
  }, [open]);

  // hooks run before the `if (!open)` below, and App renders on every transaction: closed, rank nothing
  // stars only count in a search: with the box empty they'd hide a recent copy without showing themselves
  const typing = !!query.trim();
  const all = useMemo(() => (open ? collectHits(props.docs, props.recents, files, typing ? starred : [], pinned, hidden) : []), [open, props.docs, props.recents, files, typing, starred, pinned, hidden]);
  // with no query: pinned files, then what's open, then recent files (starred ones only jump ahead in a search)
  const hits = useMemo(() => (open ? rankHits(typing ? all : all.filter((h) => h.kind !== 'file' || h.pinned), query) : []), [open, all, typing, query]);
  const cur = Math.min(at, hits.length - 1);
  useEffect(() => { listRef.current?.querySelector('[data-on]')?.scrollIntoView({ block: 'nearest' }); }, [cur, hits]);
  if (!open) return null;

  const open1 = (h: FileHit | undefined) => { if (h) { props.onClose(); props.onPick(h); } };
  const pick = (h: FileHit | undefined, mod = false) => {
    if (!h) return;
    if (!mod && props.onBlocks && props.canBlocks?.(h)) { setChoice({ hit: h, at: 0 }); return; }
    open1(h);
  };
  const choose = (i: number) => { const h = choice!.hit; if (i === 0) props.onBlocks!(h); else open1(h); };
  const onKey = (e: React.KeyboardEvent) => {
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    if (choice) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setChoice({ ...choice, at: 1 - choice.at }); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(mod ? 1 : choice.at); }
      else if (e.key === 'Escape' || (e.key === 'Backspace' && !query)) { e.preventDefault(); e.stopPropagation(); setChoice(null); }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length) setAt((cur + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length);
    } else if (e.key === 'Enter') { e.preventDefault(); pick(hits[cur], mod); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (query) { setQuery(''); setAt(0); } else props.onClose(); }
  };

  // with no query: pinned, what's open, then recent files, under their own labels
  let lastHead: string | null = null;
  const label = { open: 'Open', recent: 'Recent', file: 'Files' };
  const where = (h: FileHit) => {
    const at = h.source && h.source !== h.folder ? `${h.source} › ${h.folder}` : h.folder;
    const shown = typing && h.kind === 'open' ? 'Open' : at;
    return h.hidden ? `${shown} · ${h.hidden} more hidden` : shown;
  };
  return (
    <div className="pk-back" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="pk" role="dialog" aria-modal="true" aria-label="Search files" onKeyDown={onKey}>
        <label className="pk-search">
          <SvgIcon name="search" />
          <input ref={inputRef} placeholder="Search files" aria-label="Search files" spellCheck={false} value={query}
            role="combobox" aria-expanded="true" aria-controls="pk-list" aria-activedescendant={choice ? `pk-${choice.at}` : hits[cur] ? `pk-${cur}` : undefined}
            onChange={(e) => { setQuery(e.target.value); setAt(0); }} />
        </label>
        {choice ? (
          <div ref={listRef} id="pk-list" className="pk-list" role="listbox" aria-label={choice.hit.name}>
            <div className="pk-head">{choice.hit.name}</div>
            {['Search blocks', 'Open'].map((what, i) => (
              <div key={what} id={`pk-${i}`} className="pk-row" role="option" aria-selected={i === choice.at} data-on={i === choice.at || undefined}
                onMouseMove={() => { if (i !== choice.at) setChoice({ ...choice, at: i }); }} onClick={() => choose(i)}>
                <SvgIcon name={i ? 'doc' : 'search'} />
                <span className="pk-nm">{what}</span>
                <span className="pk-in">{i ? `${IS_MAC ? '⌘' : 'Ctrl'}↵` : 'insert its blocks, hats and cards'}</span>
              </div>
            ))}
          </div>
        ) : (
        <div ref={listRef} id="pk-list" className="pk-list" role="listbox" aria-label="Files">
          {hits.map((h, i) => {
            const section = h.pinned ? 'Pinned' : label[h.kind];
            const head = !typing && section !== lastHead ? section : null;
            lastHead = section;
            return (
              <div key={h.key} role="presentation">
                {head && <div className="pk-head">{head}</div>}
                <div id={`pk-${i}`} className="pk-row" role="option" aria-selected={i === cur} data-on={i === cur || undefined}
                  data-star={h.starred || h.pinned || undefined}
                  title={h.hidden ? `${h.path}\n${h.hidden} ${h.hidden === 1 ? 'copy' : 'copies'} in other search folders hidden while this one is ${h.pinned ? 'pinned' : 'starred'}` : h.path}
                  onMouseMove={() => { if (i !== cur) setAt(i); }} onClick={(ev) => pick(h, IS_MAC ? ev.metaKey : ev.ctrlKey)}>
                  <SvgIcon name="doc" />
                  <span className="pk-nm">{h.name}</span>
                  <span className="pk-in">{where(h)}</span>
                  {/* stars and pins are set in Settings > File search, here they only mark */}
                  {h.pinned ? <span className="pk-star" aria-label="Pinned" title="Pinned in Settings > File search"><PinIcon /></span>
                    : h.starred && <span className="pk-star" aria-label="Starred" title="Starred in Settings > File search"><StarIcon /></span>}
                </div>
              </div>
            );
          })}
          {!hits.length && <p className="pk-none">{query ? `No files match “${query.trim()}”.` : 'No recent files yet. Pin files in Settings > File search to keep them here.'}</p>}
        </div>
        )}
        {bridge.indexedFiles && folders === 0 && (
          <button className="pk-foot" onClick={() => { props.onClose(); props.onSettings(); }}>
            Add folders in Settings to search all your files
          </button>
        )}
      </div>
    </div>
  );
}
