import { afterEach, describe, expect, it } from 'vitest';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { schema } from '../src/editor/schema';
import { createState } from '../src/editor/editor';
import { BINDINGS } from '../src/editor/keybinds';
import { P, pref, resetPrefs } from '../src/editor/prefs';
import { docToolSettings } from '../src/editor/doc-tools';
import { cardToolSettings } from '../src/editor/card-tools';
import { navSettings } from '../src/editor/nav-keys';
import { matchRanges, parseArgs, parseQuery, rank, wordScore } from '../src/ui/command-center';
import { argEntries, citesUnder, commandEntries, headingEntries, settingDefs, settingEntries, textEntries, type Ctx } from '../src/ui/cc-sources';
import { make, map } from './helpers';

afterEach(() => { resetPrefs(); localStorage.clear(); });

/** A ctx over a bare state: commands apply to it, app actions are recorded. */
function fake(start: EditorState) {
  let state = start;
  const calls: string[] = [];
  const ctx: Ctx = {
    view: { get state() { return state; } } as unknown as EditorView,
    run: (cmd) => cmd(state, (tr) => { state = state.apply(tr); }),
    app: (id) => { calls.push(`app:${id}`); },
    blocked: () => false,
    zoom: 1, setZoom: (z) => calls.push(`zoom:${z}`), depth: 3, setDepth: (d) => calls.push(`depth:${d}`),
    showOutline: true, setShowOutline: () => {}, speechMin: 8, setSpeechMin: (m) => calls.push(`speech:${m}`),
    highlight: 'yellow', setHighlight: (c) => calls.push(`pen:${c}`),
    isSpeech: false, toggleSpeech: () => {}, sendToSpeech: () => calls.push('send'),
    jump: (i) => calls.push(`jump:${i}`), peek: () => {},
    find: (t, r) => calls.push(`find:${t}:${r}`), openSettings: (p, q) => calls.push(`settings:${p}:${q}`),
  };
  return { ctx, calls, get state() { return state; } };
}
const sample = () => make([
  ['pocket', 'Politics DA'], ['block', 'Uniqueness'], ['tag', 'Biden wins now'], ['normal', ''],
  ['tag', 'Midterms swing on the economy'], ['analytic', 'Their ev is old'],
]);

describe('reading the query', () => {
  it('prefixes narrow to one source', () => {
    expect(parseQuery('s theme')).toEqual({ source: 'set', text: 'theme' });
    expect(parseQuery('c bold')).toEqual({ source: 'cmd', text: 'bold' });
    expect(parseQuery('h ')).toEqual({ source: 'doc', text: '' });
    expect(parseQuery('>bold')).toEqual({ source: 'cmd', text: 'bold' });
    expect(parseQuery('#politics')).toEqual({ source: 'doc', text: 'politics' });
    expect(parseQuery('?')).toEqual({ source: 'help', text: '' });
  });
  it('a word that only starts with a prefix letter stays a search', () => {
    expect(parseQuery('cite')).toEqual({ text: 'cite' });
    expect(parseQuery('s')).toEqual({ text: 's' });
    expect(parseQuery('#12')).toEqual({ text: '#12' }); // card 12, not a heading search
  });
  it('typed values', () => {
    expect(parseArgs('zoom 150')).toEqual([{ kind: 'zoom', n: 150 }]);
    expect(parseArgs('125%')).toEqual([{ kind: 'zoom', n: 125 }]);
    expect(parseArgs('zoom 999')).toEqual([]);
    expect(parseArgs('14pt')).toEqual([{ kind: 'size', n: 14 }]);
    expect(parseArgs('size 9')).toEqual([{ kind: 'size', n: 9 }]);
    expect(parseArgs('card 12')).toEqual([{ kind: 'card', n: 12 }]);
    expect(parseArgs('#3')).toEqual([{ kind: 'card', n: 3 }]);
    expect(parseArgs('depth 2')).toEqual([{ kind: 'depth', n: 2 }]);
    expect(parseArgs('speech 6')).toEqual([{ kind: 'speech', n: 6 }]);
    expect(parseArgs('prep 5 min')).toEqual([{ kind: 'prep', n: 5 }]);
    expect(parseArgs('politics')).toEqual([]);
  });
});

describe('ranking', () => {
  it('scores starts, word starts, initials and letters in order', () => {
    expect(wordScore('stan', 'standardize highlighting')).toBe(100);
    expect(wordScore('high', 'standardize highlighting')).toBe(80);
    expect(wordScore('sh', 'standardize highlighting')).toBe(45);
    expect(wordScore('hlt', 'highlight')).toBe(30);
    expect(wordScore('zq', 'highlight')).toBe(0);
  });
  it('finds commands by name, initials and key', () => {
    const { ctx } = fake(sample());
    const all = [...commandEntries(ctx), ...settingEntries(ctx)];
    expect(rank(all, 'tag')[0].label).toBe('Tag');
    expect(rank(all, 'f7')[0].label).toBe('Tag');
    expect(rank(all, 'cwp').map((e) => e.label)).toContain('Condense with pilcrows');
    expect(rank(all, 'standardize hl')[0].label).toBe('Standardize Highlighting');
    expect(rank(all, 'uppercase')[0].label).toBe('Change case');
  });
  it('a recently run row moves up', () => {
    const { ctx } = fake(sample());
    const all = commandEntries(ctx);
    const first = rank(all, 'next')[0];
    const other = rank(all, 'next').find((e) => e !== first)!;
    expect(rank(all, 'next', [other.key])[0]).toBe(other);
  });
  it('choice rows only show once you type', () => {
    const { ctx } = fake(sample());
    const sets = settingEntries(ctx);
    expect(rank(sets, '').some((e) => e.label === 'Theme: Light')).toBe(false);
    expect(rank(sets, 'light').map((e) => e.label)).toContain('Theme: Light');
  });
  it('bolds where the words hit', () => {
    expect(matchRanges('Standardize Highlighting', 'high stan')).toEqual([[0, 4], [12, 16]]);
  });
});

describe('everything is reachable', () => {
  it('every key binding is a command, except file search', () => {
    const { ctx } = fake(sample());
    const keys = new Set(commandEntries(ctx).map((e) => e.key));
    for (const b of BINDINGS) {
      if (b.id === 'search' || b.id === 'commands') expect(keys.has(`cmd:${b.id}`)).toBe(false);
      else expect(keys.has(`cmd:${b.id}`), b.id).toBe(true);
    }
  });
  it('every setting Settings has is a row', () => {
    const { ctx } = fake(sample());
    const ids = new Set(settingDefs(ctx).map((d) => d.id));
    for (const p of Object.values(P)) expect(ids.has(p.key), p.key).toBe(true);
    for (const s of [...navSettings, ...docToolSettings, ...cardToolSettings]) expect(ids.has(s.key), s.key).toBe(true);
  });
});

describe('doing things', () => {
  it('a command row edits the doc', () => {
    const f = fake(sample());
    commandEntries(f.ctx).find((e) => e.key === 'cmd:hat')!.run!();
    expect(map(f.state).split('\n')[0]).toBe('hat: Politics DA');
  });
  it('an app row asks the app', () => {
    const f = fake(sample());
    commandEntries(f.ctx).find((e) => e.key === 'cmd:saveAs')!.run!();
    expect(f.calls).toContain('app:saveAs');
  });
  it('a toggle flips, a choice row sets, and the choices list says which is on', () => {
    const f = fake(sample());
    const sets = () => settingEntries(f.ctx);
    sets().find((e) => e.label === 'Toggle Bold cites')!.run!();
    expect(pref(P.citeBold)).toBe(false);
    expect(sets().find((e) => e.label === 'Toggle Bold cites')!.state).toBe('Off');
    sets().find((e) => e.label === 'Theme: Light')!.run!();
    expect(pref(P.theme)).toBe('light');
    const theme = sets().find((e) => e.label === 'Cycle Theme')!;
    expect(theme.state).toMatch(/^Light → /);
    expect(theme.options!().find((o) => o.on)!.label).toBe('Light');
    theme.options!().find((o) => o.label === 'Dark')!.pick();
    expect(pref(P.theme)).toBe('dark');
  });
  it('Cycle steps to the next choice and wraps, like CardMirror', () => {
    const f = fake(sample());
    const cycle = () => settingEntries(f.ctx).find((e) => e.label === 'Cycle Hat underline')!;
    expect(cycle().state).toBe('Double → Single');
    cycle().run!();
    expect(pref(P.hatLine)).toBe('single');
    cycle().run!();
    expect(pref(P.hatLine)).toBe('double');
  });
  it('feature settings write their own keys', () => {
    const f = fake(sample());
    settingEntries(f.ctx).find((e) => e.label === 'Find order: By position')!.run!();
    expect(localStorage.getItem('falcon.find.order')).toBe('position');
  });
  it('settings that live in the app go through it', () => {
    const f = fake(sample());
    settingEntries(f.ctx).find((e) => e.label === 'Highlighter: Green')!.run!();
    settingEntries(f.ctx).find((e) => e.label === 'Zoom: 150%')!.run!();
    expect(f.calls).toEqual(['pen:green', 'zoom:1.5']);
  });
  it('typed values: zoom, size, card', () => {
    const f = fake(sample());
    const [z] = argEntries(f.ctx, parseArgs('zoom 150'));
    z.run!();
    expect(f.calls).toContain('zoom:1.5');
    const [card] = argEntries(f.ctx, parseArgs('card 2'));
    expect(card.label).toBe('Go to card 2: Midterms swing on the economy');
    card.run!();
    expect(f.calls).toContain('jump:3');
    const [none] = argEntries(f.ctx, parseArgs('card 9'));
    expect(none.label).toBe('No card 9 (this file has 3)');
    expect(none.can!()).toBe(false);
  });
  it('find and replace take the typed text', () => {
    const f = fake(sample());
    textEntries(f.ctx, ' midterms ').forEach((e) => e.run!());
    expect(f.calls).toEqual(['find:midterms:false', 'find:midterms:true']);
  });
});

describe('headings and cites', () => {
  it('every heading is a row, and a tag carries the cite under it', () => {
    const s = createState(schema.node('doc', null, [
      schema.node('paragraph', { style: 'block' }, [schema.text('AT Politics')]),
      schema.node('paragraph', { style: 'tag' }, [schema.text('Econ decides')]),
      schema.node('paragraph', { style: 'normal' }, [schema.text('Smith 24', [schema.marks.cite.create()]), schema.text(', Professor')]),
      schema.node('paragraph', { style: 'normal' }, [schema.text('body')]),
    ]));
    expect(citesUnder(s.doc)).toEqual([undefined, 'Smith 24']);
    const f = fake(s);
    const rows = headingEntries(f.ctx);
    expect(rows.map((r) => [r.label, r.group, r.level])).toEqual([['AT Politics', 'Block', 3], ['Econ decides', 'Tag', 4]]);
    expect(rank(rows, 'smith')[0].label).toBe('Econ decides');
  });
});

describe('usage statistics', () => {
  it('an opt-out survives Restore defaults', async () => {
    const { setPref } = await import('../src/editor/prefs');
    setPref(P.usageStats, false);
    resetPrefs();
    expect(pref(P.usageStats)).toBe(false);
    setPref(P.usageStats, true);
  });
});
