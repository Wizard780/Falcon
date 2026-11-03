import type { Mark, Node as PMNode } from 'prosemirror-model';
import { units, type Unit } from './disk-merge';
import { levelOf } from './schema';

/**
 * The user's edits since a checkpoint (the file as opened, or as another program last wrote it), card by card,
 * for outside tools: Claude reads them from a file in app data (electron/docsync.cjs) and replays them into its
 * own copy. Nothing is shown in Falcon. Each card that differs says what kind of change it was and carries its
 * full before and after (paragraph styles, text runs and marks), plus where it sits now.
 */
export type Change = 'added' | 'removed' | 'moved' | 'heading' | 'tag' | 'cite' | 'body' | 'highlight' | 'underline' | 'emphasis' | 'formatting' | 'approved' | 'rejected';
export type Run = { text: string; marks: string[] };
export type Para = { style: string; indent?: number; runs: Run[] };
export type CardEdit = {
  id: string; // the heading's card id ('' for lines before the first heading)
  style: string; // the heading's style: pocket, hat, block, tag, analytic
  title: string; // the heading's text now (or before, when removed)
  changes: Change[];
  before: Para[] | null;
  after: Para[] | null;
  /** Where it is now (where it was, when removed): the card before it, and the block (or hat, pocket) it's under. */
  position: { after: string | null; under: string | null };
};

const markName = (m: Mark): string => {
  const a = m.attrs as Record<string, unknown>;
  const v = a.color ?? a.pt ?? a.href;
  return v === undefined || v === null ? m.type.name : `${m.type.name}:${v}`;
};

/** A paragraph as plain data: style, indent and its text runs with their marks (pictures and notes as placeholders). */
export function paraOf(n: PMNode): Para {
  const runs: Run[] = [];
  n.forEach((c) => {
    const text = c.isText ? c.text! : c.type.name === 'hard_break' ? '\n' : c.type.name === 'image' ? '￼' : c.type.name === 'footnote' ? '[note]' : '';
    if (!text) return;
    const marks = c.marks.map(markName);
    const last = runs[runs.length - 1];
    if (last && last.marks.join() === marks.join()) last.text += text;
    else runs.push({ text, marks });
  });
  return { style: n.type.name === 'paragraph' ? n.attrs.style : n.type.name, ...(n.attrs.indent ? { indent: n.attrs.indent } : {}), runs };
}

const text = (ns: PMNode[]) => ns.map((n) => n.textContent).join('\n');
const marksOf = (ns: PMNode[], pick: (name: string) => boolean) =>
  JSON.stringify(ns.map((n) => paraOf(n).runs.flatMap((r) => (r.marks.some(pick) ? [[r.text, r.marks.filter(pick)]] : []))));
const plain = (n: PMNode) => (n.attrs.pending ? n.type.create({ ...n.attrs, pending: false }, n.content, n.marks) : n);

/** Splits a card into heading, cite line and body (a tag's first non-empty, non-undertag line is its cite). */
function parts(u: Unit) {
  const [head, ...rest] = u.nodes;
  let cite = -1;
  if (head && head.attrs.style === 'tag') cite = rest.findIndex((n) => n.type.name === 'paragraph' && n.attrs.style !== 'undertag' && n.content.size > 0);
  return { head, cite: cite >= 0 ? [rest[cite]] : [], body: rest.filter((_n, i) => i !== cite) };
}

/** What changed between two versions of a card. */
function kinds(a: Unit, b: Unit): Change[] {
  const out: Change[] = [];
  const pa = parts(a), pb = parts(b);
  if (pa.head && pb.head && levelOf(pa.head)) {
    if (pa.head.attrs.pending && !pb.head.attrs.pending) out.push('approved');
    if (!plain(pa.head).eq(plain(pb.head))) out.push(pb.head.attrs.style === 'tag' || pb.head.attrs.style === 'analytic' ? 'tag' : 'heading');
  }
  const same = (x: PMNode[], y: PMNode[]) => x.length === y.length && x.every((n, i) => plain(n).eq(plain(y[i])));
  if (!same(pa.cite, pb.cite)) out.push('cite');
  if (!same(pa.body, pb.body)) {
    const before = out.length;
    if (text(pa.body) !== text(pb.body)) out.push('body');
    if (marksOf(pa.body, (m) => m.startsWith('highlight')) !== marksOf(pb.body, (m) => m.startsWith('highlight'))) out.push('highlight');
    if (marksOf(pa.body, (m) => m === 'underline') !== marksOf(pb.body, (m) => m === 'underline')) out.push('underline');
    if (marksOf(pa.body, (m) => m === 'emphasis') !== marksOf(pb.body, (m) => m === 'emphasis')) out.push('emphasis');
    if (out.length === before) out.push('formatting');
  }
  return out;
}

/** Ids in `b`'s order that kept their place relative to each other since `a` (the longest run in order); the rest moved. */
function stayed(a: string[], b: string[]): Set<string> {
  const ia = new Map(a.map((k, i) => [k, i]));
  const seq = b.filter((k) => ia.has(k));
  const tails: number[] = [], prev: number[] = [];
  seq.forEach((k, n) => {
    const v = ia.get(k)!;
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ia.get(seq[tails[mid]])! < v) lo = mid + 1; else hi = mid; }
    prev[n] = lo ? tails[lo - 1] : -1;
    tails[lo] = n;
  });
  const out = new Set<string>();
  for (let n = tails.length ? tails[tails.length - 1] : -1; n >= 0; n = prev[n]) out.add(seq[n]);
  return out;
}

/** Each unit's position: the unit before it and the nearest heading above it at a higher level. */
function positions(list: Unit[]) {
  const out = new Map<string, { after: string | null; under: string | null }>();
  const stack: { level: number; key: string }[] = [];
  list.forEach((u, i) => {
    const level = u.nodes[0] ? levelOf(u.nodes[0]) : 0;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    out.set(u.key, { after: i ? list[i - 1].key : null, under: stack.length ? stack[stack.length - 1].key : null });
    if (level) stack.push({ level, key: u.key });
  });
  return out;
}

/** The cards that differ between `checkpoint` and `now`, in the order they're in now (removed ones last). */
export function cardEdits(checkpoint: PMNode, now: PMNode): CardEdit[] {
  const A = units(checkpoint), B = units(now);
  const MA = new Map(A.map((u) => [u.key, u]));
  const MB = new Map(B.map((u) => [u.key, u]));
  const kept = stayed(A.map((u) => u.key), B.map((u) => u.key));
  const posA = positions(A), posB = positions(B);
  const out: CardEdit[] = [];
  const card = (u: Unit, changes: Change[], before: Unit | undefined, after: Unit | undefined, pos: { after: string | null; under: string | null }): CardEdit => ({
    id: u.key, style: u.nodes[0]?.type.name === 'paragraph' ? u.nodes[0].attrs.style : 'normal', title: u.nodes[0]?.textContent.trim() ?? '', changes,
    before: before ? before.nodes.map(paraOf) : null, after: after ? after.nodes.map(paraOf) : null, position: pos,
  });
  for (const b of B) {
    const a = MA.get(b.key);
    if (!a) { out.push(card(b, ['added'], undefined, b, posB.get(b.key)!)); continue; }
    const changes = kinds(a, b);
    if (!kept.has(b.key)) changes.unshift('moved');
    if (changes.length) out.push(card(b, changes, a, b, posB.get(b.key)!));
  }
  for (const a of A) {
    if (MB.has(a.key)) continue;
    out.push(card(a, [a.nodes[0]?.attrs.pending ? 'rejected' : 'removed'], a, undefined, posA.get(a.key)!));
  }
  return out;
}
