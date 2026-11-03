/** File search (Cmd-K): what the palette lists and how a query ranks it. Pure, so it's unit tested. */

/** One row in the palette: an open document, a recent file, or a file from an indexed folder. */
export type FileHit = {
  key: string;
  name: string;
  /** the folder it's in, shown dim beside the name */
  folder: string;
  path?: string;
  /** set for a document that's open now */
  docId?: number;
  kind: 'open' | 'recent' | 'file';
  when: number;
  /** the search folder it came from ("Dropbox", "Team Dropbox"), so same-named files can be told apart */
  source?: string;
  /** starred: first among what matches a search, and its copies in other search folders are hidden */
  starred?: boolean;
  /** pinned: like starred, and it also always shows, first, with the box empty */
  pinned?: boolean;
  /** how many copies this starred or pinned one hides */
  hidden?: number;
};

const SEP = /[\\/]/;
const base = (p: string) => p.split(SEP).pop() ?? p;
export const stripDocx = (n: string) => n.replace(/\.docx$/i, '');
/** The folder a file sits in, as one name ("Aff"), not a path. */
export const parentName = (p: string) => { const parts = p.split(SEP); return parts.length > 1 ? parts[parts.length - 2] : ''; };

/**
 * Pinned files first, then open docs, recents and indexed files; each path appears once, as its first source.
 * Starred files keep their place (a search puts them on top). A starred or pinned file hides its copies: the same
 * path inside another search folder (an open one stays: it's open).
 */
export function collectHits(
  open: { id: number; name: string; path?: string }[],
  recents: { name: string; path?: string; folder: string; when: number }[],
  files: { path: string; mtime: number; root?: string }[],
  starred: readonly string[] = [],
  pinned: readonly string[] = [],
): FileHit[] {
  const seen = new Set<string>();
  const out: FileHit[] = [];
  const add = (h: FileHit) => {
    const k = h.path ? `p:${h.path}` : `n:${h.name}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(h);
  };
  for (const d of open) add({ key: `o${d.id}`, name: d.name, folder: d.path ? parentName(d.path) : '', path: d.path, docId: d.id, kind: 'open', when: Infinity });
  for (const r of recents) add({ key: `r:${r.path ?? r.name}`, name: r.name, folder: r.folder, path: r.path, kind: 'recent', when: r.when });
  for (const f of files) add({ key: `f:${f.path}`, name: stripDocx(base(f.path)), folder: parentName(f.path), path: f.path, kind: 'file', when: f.mtime, source: f.root ? base(f.root.replace(/[\\/]+$/, '')) : undefined });
  if (!starred.length && !pinned.length) return out;
  const stars = new Set(starred), pins = new Set(pinned);
  const marked = (h: FileHit) => !!h.path && (stars.has(h.path) || pins.has(h.path));
  // a copy is the same path inside another search folder (Dropbox/DA/x and Team Dropbox/DA/x), not just the same name
  const roots = [...new Set(files.map((f) => f.root?.replace(/[\\/]+$/, '')).filter((r): r is string => !!r))].sort((a, b) => b.length - a.length);
  const rel = (p?: string) => {
    const r = p && roots.find((r) => p.startsWith(r) && SEP.test(p[r.length] ?? ''));
    return r ? p.slice(r.length + 1).replace(/\\/g, '/').toLowerCase() : undefined;
  };
  const mark = new Map(out.filter(marked).map((h) => [h, { ...h, starred: stars.has(h.path!) || undefined, pinned: pins.has(h.path!) || undefined, hidden: 0 }]));
  const byRel = new Map([...mark.values()].flatMap((h) => { const k = rel(h.path); return k ? [[k, h] as const] : []; }));
  const top: FileHit[] = [], rest: FileHit[] = [];
  for (const h of out) {
    const m = mark.get(h);
    if (m) { (m.pinned ? top : rest).push(m); continue; }
    const k = h.kind !== 'open' ? rel(h.path) : undefined;
    const twin = k ? byRel.get(k) : undefined;
    if (twin) twin.hidden! += 1; else rest.push(h);
  }
  return [...top, ...rest];
}

const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);
const BOUNDARY = /[\s\-_.·()[\]]/;

/** How well one query word matches `text` (lowercase): 0 = not at all. */
function wordScore(w: string, text: string): number {
  const i = text.indexOf(w);
  if (i === 0) return 100;
  if (i > 0) {
    // the start of a word ("2ac" in "Aff---2AC"), or a run inside one
    let at = i;
    while (at >= 0 && !(at === 0 || BOUNDARY.test(text[at - 1]))) at = text.indexOf(w, at + 1);
    return at >= 0 ? 80 : 55;
  }
  // abbreviations: each letter comes later in the same word ("cp" for "Counterplan") or starts a new
  // word ("cpda" for "China CP DA"), so letters scattered across words ("cap" in "China CP DA") don't count
  if (w.length < 2) return 0;
  const wordOf: number[] = [];
  for (let k = 0, n = 0; k < text.length; k++) { if (k > 0 && BOUNDARY.test(text[k - 1]) && !BOUNDARY.test(text[k])) n++; wordOf.push(n); }
  const start = (k: number) => !BOUNDARY.test(text[k]) && (k === 0 || BOUNDARY.test(text[k - 1]));
  const failed = new Set<number>(); // (word letter, text position) pairs already tried: keeps it polynomial
  const from = (wi: number, prev: number): boolean => {
    if (wi === w.length) return true;
    if (failed.has(wi * 10000 + prev + 1)) return false;
    for (let k = prev + 1; k < text.length; k++) {
      if (text[k] === w[wi] && ((wi > 0 && wordOf[k] === wordOf[prev]) || start(k)) && from(wi + 1, k)) return true;
    }
    failed.add(wi * 10000 + prev + 1);
    return false;
  };
  return from(0, -1) ? 35 : 0;
}

/** Rank `hits` against `query`: every word must match the name (or, weaker, the folder). Empty query keeps the order. */
export function rankHits(hits: FileHit[], query: string, limit = 50): FileHit[] {
  const ws = words(query);
  if (!ws.length) return hits.slice(0, limit);
  const scored: [FileHit, number][] = [];
  for (const h of hits) {
    const name = h.name.toLowerCase(), folder = h.folder.toLowerCase();
    let total = 0;
    for (const w of ws) {
      const s = Math.max(wordScore(w, name), wordScore(w, folder) * 0.4);
      if (!s) { total = -1; break; }
      total += s;
    }
    if (total < 0) continue;
    // a whole-name match wins; then shorter names (less left unmatched); open docs edge out the rest
    if (name === ws.join(' ')) total += 50;
    total -= Math.min(20, name.length / 4);
    if (h.kind === 'open') total += 8;
    if (h.starred || h.pinned) total += 120; // starred and pinned files go to the very top of what matches
    scored.push([h, total]);
  }
  scored.sort((a, b) => b[1] - a[1] || b[0].when - a[0].when);
  return scored.slice(0, limit).map(([h]) => h);
}
