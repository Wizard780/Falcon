import { DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import { buildOutline } from '../editor/outline';
import { schema } from '../editor/schema';
import { readJson, safeSet } from './storage';
// the most Settings lets Home show (Recent files is typed, 1 to this); Home shows the first `Recent files` of them
export const MAX = 100;

/** A file the user opened or saved. `blocks` is a short outline; `preview` is its first page as HTML, for the home peek. */
export type Recent = {
  name: string;
  path?: string;
  folder: string;
  cards: number;
  blocks: { label: string; level: number; cards: number }[];
  when: number;
  preview?: string;
};

// about a page and a half of text: more than the home page shows, less than a big file's first section
const PEEK = 4000;

/** The start of a doc as the editor would draw it, without pictures (they'd bloat storage) or live links. */
export function peekHtml(doc: PMNode): string {
  if (typeof document === 'undefined') return '';
  const box = document.createElement('div');
  const ser = DOMSerializer.fromSchema(schema);
  for (let i = 0, chars = 0; i < doc.childCount && chars < PEEK; i++) {
    chars += doc.child(i).textContent.length;
    box.appendChild(ser.serializeNode(doc.child(i)));
  }
  box.querySelectorAll('img').forEach((e) => e.remove());
  box.querySelectorAll('[href]').forEach((e) => e.removeAttribute('href'));
  box.querySelectorAll('p:empty, h1:empty, h2:empty, h3:empty, h4:empty').forEach((e) => e.append(document.createElement('br'))); // a blank line keeps its height, as in the editor
  return box.innerHTML;
}

const KEY = 'falcon.recents.v1';
// a month of history: a file last opened more calendar days ago than this leaves the list and storage
export const KEEP_DAYS = 30;

const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
/** Calendar days from `t` to `now` on the local clock: 0 today, 1 yesterday. A day that changes the clock (DST) still counts as one. */
export const daysAgo = (t: number, now = new Date()) => Math.round((dayStart(now) - dayStart(new Date(t))) / 86_400_000);

/** The recents opened in the last KEEP_DAYS days. One with no time can't be dated, so it goes too. */
export const fresh = (list: Recent[], now = new Date()) => list.filter((r) => Number.isFinite(r.when) && daysAgo(r.when, now) <= KEEP_DAYS);

export function loadRecents(): Recent[] {
  return fresh(readJson<Recent[]>(KEY, []));
}
// previews are a page of HTML each, so only the first few recents keep theirs in storage; the rest are read
// again the first time Home shows them (App peekRecent)
const KEEP_PREVIEWS = 24;
export function saveRecents(list: Recent[]) {
  safeSet(KEY, JSON.stringify(fresh(list).slice(0, MAX).map((r, i) => (i < KEEP_PREVIEWS || r.preview === undefined ? r : { ...r, preview: undefined }))));
}

const same = (a: Recent, b: { name: string; path?: string }) => (a.path && b.path ? a.path === b.path : !a.path && !b.path && a.name === b.name);

/** Put a file at the top of the recents, with its card count and blocks read from the doc. */
export function noteRecent(list: Recent[], doc: PMNode, file: { name: string; path?: string }): Recent[] {
  const items = buildOutline(doc);
  const parts = file.path?.split(/[\\/]/) ?? [];
  const entry: Recent = {
    name: file.name,
    path: file.path,
    folder: parts.length > 1 ? parts[parts.length - 2] : '',
    cards: items.filter((i) => i.level === 4).length,
    blocks: items.filter((i) => i.level === 2 || i.level === 3).slice(0, 7).map((i) => ({ label: i.text || 'Untitled', level: i.level, cards: i.cards })),
    when: Date.now(),
    preview: peekHtml(doc),
  };
  return fresh([entry, ...list.filter((r) => !same(r, file))]).slice(0, MAX);
}

export type RecentGroup = { label: 'Today' | 'Last 7 days' | 'Earlier'; items: Recent[] };
/** Home's sections, in list order (newest first): opened today, in the six days before, and the rest of the month. Empty ones are left out. */
export function groupRecents(list: Recent[], now = new Date()): RecentGroup[] {
  const groups: RecentGroup[] = [{ label: 'Today', items: [] }, { label: 'Last 7 days', items: [] }, { label: 'Earlier', items: [] }];
  for (const r of fresh(list, now)) {
    const d = daysAgo(r.when, now);
    groups[d < 1 ? 0 : d < 7 ? 1 : 2].items.push(r); // a clock set back puts a file in the future: it's still today's
  }
  return groups.filter((g) => g.items.length);
}

/** "9:41" today, "Yesterday", else "Oct 28". */
export function whenLabel(t: number, now = new Date()): string {
  const d = new Date(t);
  const diff = daysAgo(t, now);
  if (diff === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/, '');
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Display form of a Verbatim heading: "---" reads as " · ". */
export const tidyHeading = (s: string) => s.trim().replace(/---/g, ' · ');
/** Display form of a Verbatim file name: as a heading, and a trailing speech name is dropped. */
export const tidy = (s: string) => tidyHeading(s).replace(/ · (1AC|1NC|2AC|2NC|1NR|1AR|2NR|2AR)$/, '');
