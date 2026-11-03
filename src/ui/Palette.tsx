import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { bridge, type IndexedFile } from '../editor/host';
import { collectHits, rankHits, type FileHit } from './file-search';
import type { Recent } from './recents';
import { loadStarred, toggleStarred } from './starred';
import { SvgIcon } from './icons';
import './palette.css';

/** Cmd-K: search open documents, recent files and the folders allowed in Settings, and open one. */
export function Palette(props: {
  open: boolean;
  onClose: () => void;
  docs: { id: number; name: string; path?: string }[];
  recents: Recent[];
  onPick: (h: FileHit) => void;
  onSettings: () => void;
}) {
  const { open } = props;
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const [files, setFiles] = useState<IndexedFile[]>([]);
  const [folders, setFolders] = useState<number | null>(null); // how many folders are allowed (null: not asked yet)
  const [starred, setStarred] = useState<string[]>(loadStarred);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    setQuery('');
    setAt(0);
    setStarred(loadStarred());
    inputRef.current?.focus();
    let live = true;
    void bridge.indexFolders?.().then((f) => live && setFolders(f.length), () => {});
    void bridge.indexedFiles?.().then((f) => live && setFiles(f), () => {});
    return () => { live = false; };
  }, [open]);

  // hooks run before the `if (!open)` below, and App renders on every transaction: closed, rank nothing
  const all = useMemo(() => (open ? collectHits(props.docs, props.recents, files, starred) : []), [open, props.docs, props.recents, files, starred]);
  // with no query: starred files, then what's open, then recent files
  const hits = useMemo(() => (open ? rankHits(query ? all : all.filter((h) => h.kind !== 'file' || h.starred), query) : []), [open, all, query]);
  // starring moves the file (to the top, or back down): the highlight goes with it
  const follow = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!follow.current) return;
    const i = hits.findIndex((h) => h.path === follow.current);
    follow.current = null;
    if (i >= 0) setAt(i);
  }, [hits]);
  const cur = Math.min(at, hits.length - 1);
  useEffect(() => { listRef.current?.querySelector('[data-on]')?.scrollIntoView({ block: 'nearest' }); }, [cur, hits]);
  if (!open) return null;

  const pick = (h: FileHit | undefined) => { if (h) { props.onClose(); props.onPick(h); } };
  const star = (h: FileHit | undefined) => { if (h?.path) { follow.current = h.path; setStarred(toggleStarred(h.path)); } };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length) setAt((cur + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length);
    } else if (e.key === 'Enter') { e.preventDefault(); pick(hits[cur]); }
    // Alt-P stars, as in CardMirror (e.code: Option-P types π on a Mac)
    else if (e.altKey && e.code === 'KeyP') { e.preventDefault(); star(hits[cur]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (query) { setQuery(''); setAt(0); } else props.onClose(); }
  };

  // with no query: starred, what's open, then recent files, under their own labels
  let lastHead: string | null = null;
  const label = { open: 'Open', recent: 'Recent', file: 'Files' };
  const where = (h: FileHit) => {
    const at = h.source && h.source !== h.folder ? `${h.source} › ${h.folder}` : h.folder;
    const shown = query && h.kind === 'open' ? 'Open' : at;
    return h.hidden ? `${shown} · ${h.hidden} more hidden` : shown;
  };
  return (
    <div className="pk-back" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="pk" role="dialog" aria-modal="true" aria-label="Search files" onKeyDown={onKey}>
        <label className="pk-search">
          <SvgIcon name="search" />
          <input ref={inputRef} placeholder="Search files" aria-label="Search files" spellCheck={false} value={query}
            role="combobox" aria-expanded="true" aria-controls="pk-list" aria-activedescendant={hits[cur] ? `pk-${cur}` : undefined}
            onChange={(e) => { setQuery(e.target.value); setAt(0); }} />
        </label>
        <div ref={listRef} id="pk-list" className="pk-list" role="listbox" aria-label="Files">
          {hits.map((h, i) => {
            const section = h.starred ? 'Starred' : label[h.kind];
            const head = !query && section !== lastHead ? section : null;
            lastHead = section;
            return (
              <div key={h.key} role="presentation">
                {head && <div className="pk-head">{head}</div>}
                <div id={`pk-${i}`} className="pk-row" role="option" aria-selected={i === cur} data-on={i === cur || undefined}
                  data-star={h.starred || undefined}
                  title={h.hidden ? `${h.path}\n${h.hidden} ${h.hidden === 1 ? 'copy' : 'copies'} in other search folders hidden while this one is starred` : h.path}
                  onMouseMove={() => { if (i !== cur) setAt(i); }} onClick={() => pick(h)}>
                  <SvgIcon name="doc" />
                  <span className="pk-nm">{h.name}</span>
                  <span className="pk-in">{where(h)}</span>
                  {h.path && (
                    <button className="pk-star" aria-pressed={!!h.starred} aria-label={h.starred ? `Unstar ${h.name}` : `Star ${h.name}`}
                      title={h.starred ? 'Starred (⌥P to unstar)' : 'Star (⌥P): keep this file at the top and hide its copies in other search folders'}
                      onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); star(h); }}>
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" /></svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {!hits.length && <p className="pk-none">{query ? `No files match “${query.trim()}”.` : 'No recent files yet. Star a file (⌥P) to keep it here.'}</p>}
        </div>
        {bridge.indexedFiles && folders === 0 && (
          <button className="pk-foot" onClick={() => { props.onClose(); props.onSettings(); }}>
            Add folders in Settings to search all your files
          </button>
        )}
      </div>
    </div>
  );
}
