import { Fragment, type Node as PMNode } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import { idsInFile, newCardId } from './card-ids';
import { levelOf, schema } from './schema';

/**
 * Merging a file that changed on disk (another program, Claude's scripts) into the open doc, card by card.
 * A unit is a heading and the body under it, up to the next heading, keyed by the heading's card id ('' is
 * whatever comes before the first heading). Three versions meet: `base` (the file as Falcon last read or saved
 * it), `mine` (the open doc, with unsaved edits) and `disk` (the file now). A side that left a unit as it was in
 * base takes the other side's change; cards new on disk come in pending (orange); a unit both sides changed
 * differently is a conflict the user settles.
 */
export type Unit = { key: string; nodes: PMNode[] };
export type ConflictKind = 'both-changed' | 'mine-changed-disk-deleted' | 'mine-deleted-disk-changed' | 'both-added';
export type Conflict = { key: string; kind: ConflictKind; title: string };
/** How to settle a conflict: keep the open doc's version, take the file's, or keep both (the file's as a pending copy). */
export type Choice = 'mine' | 'disk' | 'both';
/** `base`: the file as read, with its cards keyed the way the open doc keys them: what the next merge compares against.
 *  `checkpoint`: the same with the cards this merge brought in marked pending, as the open doc has them, so the
 *  user's own edits (edit-log.ts) start from there and approving one of them counts. */
export type Merge = { nodes: PMNode[]; conflicts: Conflict[]; added: number; updated: number; removed: number; base: PMNode; checkpoint: PMNode };

export function units(doc: PMNode): Unit[] {
  const out: Unit[] = [];
  doc.forEach((n) => {
    if (levelOf(n) && n.attrs.card) out.push({ key: n.attrs.card, nodes: [n] });
    else if (out.length) out[out.length - 1].nodes.push(n);
    else out.push({ key: '', nodes: [n] });
  });
  return out;
}

// approving a card (only its pending flag changes) isn't an edit to it
const plain = (n: PMNode) => (n.attrs.pending ? n.type.create({ ...n.attrs, pending: false }, n.content, n.marks) : n);
const same = (a: Unit | undefined, b: Unit | undefined) =>
  !!a && !!b && a.nodes.length === b.nodes.length && a.nodes.every((n, i) => plain(n).eq(plain(b.nodes[i])));
const withPending = (u: Unit, key = u.key): Unit => {
  const [h, ...rest] = u.nodes;
  if (!levelOf(h)) return u;
  return { key, nodes: [h.type.create({ ...h.attrs, card: key, pending: true }, h.content, h.marks), ...rest] };
};

// ---------- matching cards whose ids aren't in the file ----------
// A file Falcon never saved has no id bookmarks: its ids are made from the headings on each read, so a tag
// edited on disk gets a new one, and an identical card elsewhere can take its old one. Those cards are matched to
// the earlier version by content and position (a diff), and only ids that are really in the file are trusted.

const sigs = new WeakMap<PMNode, string>();
/** A paragraph's content and formatting, its id and pending mark left out. */
function nodeSig(n: PMNode): string {
  let s = sigs.get(n);
  if (s === undefined) {
    s = JSON.stringify((n.attrs.card || n.attrs.pending ? n.type.create({ ...n.attrs, card: null, pending: false }, n.content, n.marks) : n).toJSON());
    sigs.set(n, s);
  }
  return s;
}
const unitSig = (u: Unit) => u.nodes.map(nodeSig).join('\n');

/** Index pairs of equal items of `a` and `b`, in order: ends trimmed, then a table for small middles,
 *  and items found once on each side as anchors for big ones. */
function common2(a: string[], b: string[], aLo: number, aHi: number, bLo: number, bHi: number, out: [number, number][]) {
  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) out.push([aLo++, bLo++]);
  const tail: [number, number][] = [];
  while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) tail.push([--aHi, --bHi]);
  const n = aHi - aLo, m = bHi - bLo;
  if (n && m && n * m <= 250_000) {
    const t = new Int32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      t[i * (m + 1) + j] = a[aLo + i] === b[bLo + j] ? t[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(t[(i + 1) * (m + 1) + j], t[i * (m + 1) + j + 1]);
    }
    for (let i = 0, j = 0; i < n && j < m;) {
      if (a[aLo + i] === b[bLo + j]) { out.push([aLo + i, bLo + j]); i++; j++; }
      else if (t[(i + 1) * (m + 1) + j] >= t[i * (m + 1) + j + 1]) i++;
      else j++;
    }
  } else if (n && m) {
    const count = (xs: string[], lo: number, hi: number) => { const c = new Map<string, number>(); for (let i = lo; i < hi; i++) c.set(xs[i], (c.get(xs[i]) ?? 0) + 1); return c; };
    const ca = count(a, aLo, aHi), cb = count(b, bLo, bHi);
    const at = new Map<string, number>();
    for (let j = bLo; j < bHi; j++) if (cb.get(b[j]) === 1 && ca.get(b[j]) === 1) at.set(b[j], j);
    // the longest run of anchors in order on both sides
    const pairs: [number, number][] = [];
    for (let i = aLo; i < aHi; i++) { const j = at.get(a[i]); if (j !== undefined) pairs.push([i, j]); }
    const tails: number[] = [], prev: number[] = [];
    pairs.forEach(([, j], k) => {
      let lo = 0, hi = tails.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[tails[mid]][1] < j) lo = mid + 1; else hi = mid; }
      prev[k] = lo ? tails[lo - 1] : -1;
      tails[lo] = k;
    });
    const chain: [number, number][] = [];
    for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) chain.unshift(pairs[k]);
    let i0 = aLo, j0 = bLo;
    for (const [i, j] of chain) { common2(a, b, i0, i, j0, j, out); out.push([i, j]); i0 = i + 1; j0 = j + 1; }
    if (chain.length) common2(a, b, i0, aHi, j0, bHi, out);
  }
  out.push(...tail.reverse());
}

const withKey = (u: Unit, key: string): Unit => {
  const [h, ...rest] = u.nodes;
  return { key, nodes: [h.type.create({ ...h.attrs, card: key }, h.content, h.marks), ...rest] };
};

/** `disk`'s units keyed like `ref`'s: an id in the file and in `ref` is the same card; every other unit is matched by
 *  content and position, or (a card edited in place) by its heading or its body between matches. The rest are new. */
function rekey(ref: Unit[], disk: Unit[], real: Set<string> | undefined, taken: Set<string>): Unit[] {
  const refKeys = new Set(ref.map((u) => u.key));
  const trusted = (u: Unit) => u.key === '' || ((!real || real.has(u.key)) && refKeys.has(u.key));
  const trustedKeys = new Set(disk.filter(trusted).map((u) => u.key));
  const r = ref.map((_u, i) => i).filter((i) => !trustedKeys.has(ref[i].key));
  const d = disk.map((_u, i) => i).filter((i) => !trusted(disk[i]));
  const pairs: [number, number][] = [];
  common2(r.map((i) => unitSig(ref[i])), d.map((i) => unitSig(disk[i])), 0, r.length, 0, d.length, pairs);
  // between matches: a card whose heading or body is unchanged is the same card, edited
  const gaps: [number, number][] = [];
  let i0 = 0, j0 = 0;
  for (const [i, j] of [...pairs, [r.length, d.length] as [number, number]]) {
    const used = new Set<number>();
    for (let x = i0; x < i; x++) {
      const a = ref[r[x]];
      const body = (u: Unit) => u.nodes.slice(1).map(nodeSig).join('\n');
      for (let y = j0; y < j; y++) {
        const b = disk[d[y]];
        if (used.has(y) || a.nodes[0].attrs.style !== b.nodes[0].attrs.style) continue;
        if (nodeSig(a.nodes[0]) === nodeSig(b.nodes[0]) || (a.nodes.length > 1 && body(a) === body(b))) { gaps.push([x, y]); used.add(y); break; }
      }
    }
    i0 = i + 1; j0 = j + 1;
  }
  const keyOf = new Map<number, string>();
  for (const [x, y] of [...pairs, ...gaps]) keyOf.set(d[y], ref[r[x]].key);
  const used = new Set<string>([...trustedKeys, ...keyOf.values()]);
  return disk.map((u, i) => {
    if (trusted(u)) return u;
    let key = keyOf.get(i);
    if (!key) {
      key = u.key;
      while (!key || refKeys.has(key) || taken.has(key) || used.has(key)) key = newCardId();
      used.add(key);
    }
    return key === u.key ? u : withKey(u, key);
  });
}

/** The order `seq` puts the keys in that are also in `keep`. */
const common = (seq: string[], keep: Set<string>) => seq.filter((k) => keep.has(k));
const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/** Put each of `extra` after the nearest key before it in `order` that's already placed (or first, after the preamble). */
function weave(placed: string[], extra: string[], order: string[]): string[] {
  const out = [...placed];
  for (const k of order.filter((x) => extra.includes(x))) {
    let at = -1;
    for (let i = order.indexOf(k) - 1; i >= 0 && at < 0; i--) at = out.indexOf(order[i]);
    out.splice(at >= 0 ? at + 1 : out[0] === '' ? 1 : 0, 0, k);
  }
  return out;
}

export function mergeFromDisk(base: PMNode | null, mine: PMNode, disk: PMNode, choose: (c: Conflict) => Choice = () => 'mine'): Merge {
  const B = new Map(base ? units(base).map((u) => [u.key, u]) : []);
  const mineUnits = units(mine);
  const diskUnits = rekey(base ? units(base) : mineUnits, units(disk), idsInFile.get(disk), new Set(mineUnits.map((u) => u.key)));
  const M = new Map(mineUnits.map((u) => [u.key, u])), D = new Map(diskUnits.map((u) => [u.key, u]));
  const result = new Map<string, Unit>();
  const after = new Map<string, Unit>(); // a pending copy that goes right after the key's unit ("keep both")
  const conflicts: Conflict[] = [];
  const cameIn = new Set<string>(); // new on disk, brought in pending
  let added = 0, updated = 0, removed = 0;
  const title = (u: Unit | undefined) => (u ? u.nodes[0].textContent.trim().slice(0, 80) || '(untitled)' : '');
  const settle = (key: string, kind: ConflictKind, m: Unit | undefined, d: Unit) => {
    const c: Conflict = { key, kind, title: title(m ?? d) };
    conflicts.push(c);
    // with nothing on disk to keep a copy of, "keep both" is keeping the open doc's version
    const asked = choose(c);
    const pick = asked === 'both' && !d.nodes.length ? 'mine' : asked;
    if (pick === 'disk') { result.set(key, d); updated++; }
    else if (pick === 'both') {
      if (m) { result.set(key, m); after.set(key, withPending(d, newCardId())); } else result.set(key, withPending(d));
      added++;
    } else if (m) result.set(key, m);
  };

  for (const key of new Set([...M.keys(), ...D.keys(), ...B.keys()])) {
    const b = B.get(key), m = M.get(key), d = D.get(key);
    if (m && d) {
      if (same(m, d)) result.set(key, m);
      else if (!b) settle(key, 'both-added', m, d);
      else if (same(m, b)) { result.set(key, d); updated++; }
      else if (same(d, b)) result.set(key, m);
      else settle(key, 'both-changed', m, d);
    } else if (m) {
      // not on disk: new in the open doc, or deleted on disk
      if (!b) result.set(key, m);
      else if (same(m, b)) removed++;
      else settle(key, 'mine-changed-disk-deleted', m, { key, nodes: [] });
    } else if (d) {
      // not in the open doc: new on disk, or deleted here
      if (!b) { result.set(key, key ? withPending(d) : d); if (key) cameIn.add(key); added++; }
      else if (!same(d, b)) settle(key, 'mine-deleted-disk-changed', undefined, d);
    }
  }

  // order: whoever moved cards wins; if only the file moved them, follow the file
  const keep = new Set(result.keys());
  const baseOrder = base ? units(base).map((u) => u.key) : [];
  const mineOrder = mineUnits.map((u) => u.key), diskOrder = diskUnits.map((u) => u.key);
  const inBase = new Set(baseOrder);
  const mineMoved = !sameOrder(common(mineOrder, inBase), common(baseOrder, new Set(mineOrder)));
  const diskMoved = !sameOrder(common(diskOrder, inBase), common(baseOrder, new Set(diskOrder)));
  let order: string[];
  if (diskMoved && !mineMoved) {
    const skeleton = common(diskOrder, keep);
    order = weave(skeleton, common(mineOrder, keep).filter((k) => !skeleton.includes(k)), mineOrder);
  } else {
    const skeleton = common(mineOrder, keep);
    order = weave(skeleton, common(diskOrder, keep).filter((k) => !skeleton.includes(k)), diskOrder);
  }
  const nodes: PMNode[] = [];
  for (const k of order) {
    nodes.push(...result.get(k)!.nodes);
    const extra = after.get(k);
    if (extra) nodes.push(...extra.nodes);
  }
  const next = disk.copy(Fragment.from(diskUnits.flatMap((u) => u.nodes)));
  const real = idsInFile.get(disk);
  if (real) idsInFile.set(next, real);
  const checkpoint = cameIn.size ? disk.copy(Fragment.from(diskUnits.flatMap((u) => (cameIn.has(u.key) ? withPending(u) : u).nodes))) : next;
  return { nodes, conflicts, added, updated, removed, base: next, checkpoint };
}

/** One step that turns `state`'s doc into `nodes`, replacing only the stretch between what's unchanged at either end. */
export function applyMerge(state: EditorState, nodes: PMNode[]): Transaction {
  const want = nodes.length ? nodes : [schema.nodes.paragraph.create()];
  const old: PMNode[] = [];
  state.doc.forEach((n) => { old.push(n); });
  let a = 0;
  while (a < old.length && a < want.length && old[a].eq(want[a])) a++;
  let b = 0;
  while (b < old.length - a && b < want.length - a && old[old.length - 1 - b].eq(want[want.length - 1 - b])) b++;
  let from = 0, to = state.doc.content.size;
  for (let i = 0; i < a; i++) from += old[i].nodeSize;
  for (let i = 0; i < b; i++) to -= old[old.length - 1 - i].nodeSize;
  return state.tr.replaceWith(from, to, want.slice(a, want.length - b)).setMeta(DISK, true);
}
/** Meta on the transaction that brings a disk change in: not an edit the user made. */
export const DISK = 'fromDisk';
