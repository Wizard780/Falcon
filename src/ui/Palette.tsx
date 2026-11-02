import { useEffect, useMemo, useRef, useState } from 'react';
import { bridge, type IndexedFile } from '../editor/host';
import { collectHits, rankHits, type FileHit } from './file-search';
import type { Recent } from './recents';
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
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setAt(0);
    inputRef.current?.focus();
    let live = true;
    void bridge.indexFolders?.().then((f) => live && setFolders(f.length), () => {});
    void bridge.indexedFiles?.().then((f) => live && setFiles(f), () => {});
    return () => { live = false; };
  }, [open]);

  // hooks run before the `if (!open)` below, and App renders on every transaction: closed, rank nothing
  const all = useMemo(() => (open ? collectHits(props.docs, props.recents, files) : []), [open, props.docs, props.recents, files]);
  const hits = useMemo(() => (open ? rankHits(query ? all : all.filter((h) => h.kind !== 'file'), query) : []), [open, all, query]);
  const cur = Math.min(at, hits.length - 1);
  useEffect(() => { listRef.current?.querySelector('[data-on]')?.scrollIntoView({ block: 'nearest' }); }, [cur, hits]);
  if (!open) return null;

  const pick = (h: FileHit | undefined) => { if (h) { props.onClose(); props.onPick(h); } };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length) setAt((cur + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length);
    } else if (e.key === 'Enter') { e.preventDefault(); pick(hits[cur]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (query) { setQuery(''); setAt(0); } else props.onClose(); }
  };

  // with no query: what's open, then recent files, under their own labels
  let lastKind: FileHit['kind'] | null = null;
  const label = { open: 'Open', recent: 'Recent', file: 'Files' };
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
            const head = !query && h.kind !== lastKind ? label[h.kind] : null;
            lastKind = h.kind;
            return (
              <div key={h.key} role="presentation">
                {head && <div className="pk-head">{head}</div>}
                <div id={`pk-${i}`} className="pk-row" role="option" aria-selected={i === cur} data-on={i === cur || undefined}
                  title={h.path} onMouseMove={() => { if (i !== cur) setAt(i); }} onClick={() => pick(h)}>
                  <SvgIcon name="doc" />
                  <span className="pk-nm">{h.name}</span>
                  <span className="pk-in">{query && h.kind === 'open' ? 'Open' : h.folder}</span>
                </div>
              </div>
            );
          })}
          {!hits.length && <p className="pk-none">{query ? `No files match “${query.trim()}”.` : 'No recent files yet.'}</p>}
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
