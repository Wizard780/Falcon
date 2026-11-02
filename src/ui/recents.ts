import type { Node as PMNode } from 'prosemirror-model';
import { buildOutline } from '../editor/outline';
// the most Settings lets Home show; Home shows the first `Recent files` of them
const MAX = 24;

/** A file the user opened or saved. `blocks` is a short outline for the home peek. */
export type Recent = {
  name: string;
  path?: string;
  folder: string;
  cards: number;
  blocks: { label: string; level: number; cards: number }[];
  when: number;
};

const KEY = 'falcon.recents.v1';

export function loadRecents(): Recent[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Recent[]; } catch { return []; }
}
export function saveRecents(list: Recent[]) {
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
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
  };
  return [entry, ...list.filter((r) => !same(r, file))].slice(0, MAX);
}

/** "9:41" today, "Yesterday", else "Oct 28". */
export function whenLabel(t: number, now = new Date()): string {
  const d = new Date(t);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/, '');
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Display form of a Verbatim name: "---" reads as " · ", and a trailing speech name is dropped. */
export const tidy = (s: string) => s.trim().replace(/---/g, ' · ').replace(/ · (1AC|1NC|2AC|2NC|1NR|1AR|2NR|2AR)$/, '');
