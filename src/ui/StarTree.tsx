import { useMemo, useState, type ReactNode } from 'react';
import type { IndexedFile } from '../editor/host';
import { SvgIcon } from './icons';

type Dir = { name: string; path: string; dirs: Dir[]; files: IndexedFile[]; count: number };

const SEP = /[\\/]/;

/** The files under one search folder, as nested folders. */
export function buildTree(root: string, files: IndexedFile[]): Dir {
  const top: Dir = { name: '', path: root, dirs: [], files: [], count: 0 };
  const strip = root.replace(/[\\/]+$/, '');
  for (const f of files) {
    if (f.root.replace(/[\\/]+$/, '') !== strip) continue;
    const parts = f.path.slice(strip.length).split(SEP).filter(Boolean);
    let d = top;
    d.count++;
    for (const name of parts.slice(0, -1)) {
      let next = d.dirs.find((x) => x.name === name);
      if (!next) { next = { name, path: `${d.path}/${name}`, dirs: [], files: [], count: 0 }; d.dirs.push(next); }
      d = next;
      d.count++;
    }
    d.files.push(f);
  }
  const sort = (d: Dir) => {
    d.dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    d.files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    d.dirs.forEach(sort);
  };
  sort(top);
  return top;
}

const fileName = (p: string) => p.split(SEP).pop()!.replace(/\.docx$/i, '');

/** A search folder's insides, folders opening in place, each file with a star. */
export function StarTree(props: { root: string; files: IndexedFile[]; starred: string[]; star: (path: string, name: string) => ReactNode }) {
  const tree = useMemo(() => buildTree(props.root, props.files), [props.root, props.files]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const on = new Set(props.starred);
  const starsIn = (d: Dir): number => d.files.filter((f) => on.has(f.path)).length + d.dirs.reduce((n, x) => n + starsIn(x), 0);

  const level = (d: Dir, depth: number): ReactNode[] => [
    ...d.dirs.flatMap((x) => {
      const isOpen = open.has(x.path);
      const stars = starsIn(x);
      return [
        <button key={x.path} className="stt-row stt-dir" style={{ paddingLeft: depth * 18 + 4 }} aria-expanded={isOpen}
          onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(x.path)) n.delete(x.path); else n.add(x.path); return n; })}>
          <span className="stt-chev"><SvgIcon name="chev" /></span>
          <SvgIcon name="open" />
          <span className="stt-name">{x.name}</span>
          {stars > 0 && <span className="stt-stars" title={`${stars} starred inside`}>★ {stars}</span>}
          <output>{x.count.toLocaleString('en-US')}</output>
        </button>,
        ...(isOpen ? level(x, depth + 1) : []),
      ];
    }),
    ...d.files.map((f) => (
      <div key={f.path} className="stt-row stt-file" style={{ paddingLeft: depth * 18 + 26 }} title={f.path}>
        <SvgIcon name="doc" />
        <span className="stt-name">{fileName(f.path)}</span>
        {props.star(f.path, fileName(f.path))}
      </div>
    )),
  ];

  if (!tree.count) return <p className="stt-empty">Nothing here yet.</p>;
  return <div className="stt" role="group" aria-label={`Files in ${props.root}`}>{level(tree, 0)}</div>;
}
