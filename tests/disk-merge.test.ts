import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { docToDocx } from '../src/docx/export';
import { docxToDoc } from '../src/docx/import';
import { mergeFromDisk, type Choice } from '../src/editor/disk-merge';
import { schema, type ParaStyle } from '../src/editor/schema';

// a doc from [style, text, id?, pending?]; headings get the id given (body lines take none)
type P = [ParaStyle, string, string?, boolean?];
const doc = (paras: P[]) => schema.node('doc', null, paras.map(([style, text, card, pending]) => schema.node('paragraph', { style, card: card ?? null, pending: !!pending }, text ? [schema.text(text)] : [])));
const lines = (nodes: readonly PMNode[]) => nodes.map((n) => `${n.attrs.pending ? '*' : ''}${n.attrs.style === 'normal' ? '' : `${n.attrs.style}:`}${n.textContent}`);
const BASE: P[] = [['block', 'Block', 'b1'], ['tag', 'Card A', 'aa'], ['normal', 'a body'], ['tag', 'Card B', 'bb'], ['normal', 'b body'], ['tag', 'Card C', 'cc'], ['normal', 'c body']];
const edit = (paras: P[], text: string, to: string) => paras.map((p) => (p[1] === text ? [p[0], to, p[2], p[3]] as P : p));
const drop = (paras: P[], ...texts: string[]) => paras.filter((p) => !texts.includes(p[1]));
const merge = (base: P[] | null, mine: P[], disk: P[], choose?: Choice) => mergeFromDisk(base && doc(base), doc(mine), doc(disk), choose && (() => choose));

describe('merging a file that changed on disk', () => {
  it('a card added on disk comes in pending, where the file put it, and unsaved edits stay', () => {
    const disk: P[] = [...BASE.slice(0, 3), ['tag', 'Claude card', 'zz'], ['normal', 'z body'], ...BASE.slice(3)];
    const r = merge(BASE, edit(BASE, 'b body', 'b body EDITED'), disk);
    expect(lines(r.nodes)).toEqual(['block:Block', 'tag:Card A', 'a body', '*tag:Claude card', 'z body', 'tag:Card B', 'b body EDITED', 'tag:Card C', 'c body']);
    expect(r).toMatchObject({ conflicts: [], added: 1 });
  });

  it('a card changed on disk that the open doc left alone takes the file version', () => {
    const r = merge(BASE, edit(BASE, 'a body', 'a body mine'), edit(BASE, 'c body', 'c body from disk'));
    expect(lines(r.nodes)).toEqual(['block:Block', 'tag:Card A', 'a body mine', 'tag:Card B', 'b body', 'tag:Card C', 'c body from disk']);
    expect(r).toMatchObject({ conflicts: [], updated: 1 });
  });

  it('a card deleted on disk goes, unless the open doc changed it', () => {
    expect(lines(merge(BASE, BASE, drop(BASE, 'Card B', 'b body')).nodes)).not.toContain('tag:Card B');
    const r = merge(BASE, edit(BASE, 'b body', 'b mine'), drop(BASE, 'Card B', 'b body'));
    expect(r.conflicts).toEqual([{ key: 'bb', kind: 'mine-changed-disk-deleted', title: 'Card B' }]);
    expect(lines(r.nodes)).toContain('b mine');
  });

  it('a card deleted in the open doc stays deleted, unless the file changed it', () => {
    expect(lines(merge(BASE, drop(BASE, 'Card A', 'a body'), BASE).nodes)).not.toContain('tag:Card A');
    const r = merge(BASE, drop(BASE, 'Card A', 'a body'), edit(BASE, 'a body', 'a disk'), 'both');
    expect(r.conflicts[0].kind).toBe('mine-deleted-disk-changed');
    expect(lines(r.nodes).slice(0, 3)).toEqual(['block:Block', '*tag:Card A', 'a disk']);
  });

  it('the same card changed on both sides is a conflict: mine, the file\'s, or both (the file\'s as a pending copy)', () => {
    const mine = edit(BASE, 'b body', 'b mine'), disk = edit(BASE, 'b body', 'b disk');
    const asked = merge(BASE, mine, disk);
    expect(asked.conflicts).toEqual([{ key: 'bb', kind: 'both-changed', title: 'Card B' }]);
    expect(lines(merge(BASE, mine, disk, 'mine').nodes)).toContain('b mine');
    expect(lines(merge(BASE, mine, disk, 'disk').nodes)).toEqual(lines(doc(disk).content.content));
    const both = merge(BASE, mine, disk, 'both').nodes;
    expect(lines(both).slice(3, 7)).toEqual(['tag:Card B', 'b mine', '*tag:Card B', 'b disk']);
    expect(both[5].attrs.card).not.toBe('bb'); // the copy has its own id
  });

  it('the same change on both sides, or approving a card, is no conflict', () => {
    expect(merge(BASE, edit(BASE, 'a body', 'same'), edit(BASE, 'a body', 'same')).conflicts).toEqual([]);
    const pend = BASE.map((p): P => (p[1] === 'Card C' ? [p[0], p[1], p[2], true] : p));
    const r = merge(pend, BASE, edit(pend, 'a body', 'a disk'));
    expect(r.conflicts).toEqual([]);
    expect(lines(r.nodes)).toEqual(['block:Block', 'tag:Card A', 'a disk', 'tag:Card B', 'b body', 'tag:Card C', 'c body']);
  });

  it('cards moved on disk follow the file; cards moved in the open doc keep the open doc\'s order', () => {
    const moved: P[] = [BASE[0], ...BASE.slice(5), ...BASE.slice(1, 5)];
    expect(lines(merge(BASE, edit(BASE, 'a body', 'a mine'), moved).nodes)).toEqual(['block:Block', 'tag:Card C', 'c body', 'tag:Card A', 'a mine', 'tag:Card B', 'b body']);
    expect(lines(merge(BASE, moved, edit(BASE, 'a body', 'a disk')).nodes)).toEqual(['block:Block', 'tag:Card C', 'c body', 'tag:Card A', 'a disk', 'tag:Card B', 'b body']);
  });

  it('with no saved copy to compare (a restored doc), only new cards come in and every difference asks', () => {
    const disk: P[] = [...edit(BASE, 'a body', 'a disk'), ['tag', 'New', 'nn'], ['normal', 'n']];
    const r = merge(null, edit(BASE, 'c body', 'c mine'), disk);
    expect(r.conflicts.map((c) => c.key).sort()).toEqual(['aa', 'cc']);
    expect(lines(r.nodes).slice(-2)).toEqual(['*tag:New', 'n']);
  });

  it('a file with no id bookmarks: a tag edited on both sides asks, and an identical copy of that card elsewhere stays put', async () => {
    const plain = (ps: P[]) => doc(ps.map(([st, t]) => [st, t] as P));
    const FILE: P[] = [['block', 'One'], ['tag', 'Same card'], ['normal', 'same body'], ['tag', 'Other'], ['normal', 'o'], ['block', 'Two'], ['tag', 'Same card'], ['normal', 'same body']];
    const base = await docxToDoc(await docToDocx(plain(FILE)));
    const mine = base.copy(base.content.replaceChild(1, base.child(1).type.create(base.child(1).attrs, schema.text('Same card MINE'))));
    const disk = await docxToDoc(await docToDocx(plain(FILE.map((p, i): P => (i === 1 ? [p[0], 'Same card DISK'] : p)))));
    const r = mergeFromDisk(base, mine, disk, () => 'both');
    expect(r.conflicts.map((c) => c.kind)).toEqual(['both-changed']);
    expect(lines(r.nodes)).toEqual(['block:One', 'tag:Same card MINE', 'same body', '*tag:Same card DISK', 'same body', 'tag:Other', 'o', 'block:Two', 'tag:Same card', 'same body']);
    expect(r.removed).toBe(0);
  });

  it('a file with no id bookmarks, read twice, matches card by card (ids come from the headings)', async () => {
    const plain = (ps: P[]) => doc(ps.map(([st, t]) => [st, t] as P));
    const base = await docxToDoc(await docToDocx(plain(BASE)));
    const changed = await docxToDoc(await docToDocx(plain([...edit(BASE, 'c body', 'c disk'), ['tag', 'Added', undefined], ['normal', 'x']])));
    const r = mergeFromDisk(base, base, changed);
    expect(r.conflicts).toEqual([]);
    expect(lines(r.nodes)).toEqual(['block:Block', 'tag:Card A', 'a body', 'tag:Card B', 'b body', 'tag:Card C', 'c disk', '*tag:Added', 'x']);
  });
});
