import { closeHistory } from 'prosemirror-history';
import { Plugin, PluginKey, Selection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { bridge } from './host';
import { P, pref, setPref } from './prefs';
import { isReading } from './read';
import { schema } from './schema';

/** Falcon's own prompt. A reply marks its parts the way CardMirror's prompts do, so one imported from there just works. */
export const BUILT_IN_PROMPT = `Today's date is {DATE}.

You format citations for competitive debate evidence. The message is a citation, a URL, or messy source information. Work out what each piece is (author, qualifications, date, title, publication, link) from what it says, not where it sits.

Write one line in this form:
Last 'YY [First Last, qualifications; Month Day, Year; "Title," Publication, URL]

- Outside the bracket: the lead author's last name and the two-digit year. If an organization wrote it, use a short form of its name. If nobody is named, use the publication.
- Inside the bracket: every author in order, with what qualifies them, then the full date, the title, the publication, and the URL or volume and pages.
- Keep everything the source gives you. Use only what it gives you: never guess an author, date or qualification. Leave out what you can't find.

Answer with only this block:
[[CITE]]
the finished cite
[[TOKENS]]
the part outside the bracket, copied exactly from the cite
[[END]]`;

export type CitePreset = { id: string; name: string; prompt: string };
export const MAX_PRESETS = 10;

/** Your saved prompts, in the order the Use Prompt Preset commands count them. */
export function citePresets(): CitePreset[] {
  try {
    const list = JSON.parse(pref(P.aiCitePresets));
    return Array.isArray(list) ? list.filter((f) => typeof f?.id === 'string' && typeof f.name === 'string' && typeof f.prompt === 'string') : [];
  } catch { return []; }
}
/** The preset in use, or null for the built-in prompt. */
export const currentPreset = () => citePresets().find((f) => f.id === pref(P.aiCitePreset)) ?? null;
const promptInUse = () => currentPreset()?.prompt.trim() || BUILT_IN_PROMPT;
const savePresets = (list: CitePreset[]) => setPref(P.aiCitePresets, JSON.stringify(list));

/** Saves a copy of the prompt in use under a new name and starts using it. */
export function newPreset() {
  const list = citePresets();
  if (list.length >= MAX_PRESETS) return;
  const id = `p${Date.now().toString(36)}${list.length}`;
  savePresets([...list, { id, name: `Preset ${list.length + 1}`, prompt: promptInUse() }]);
  setPref(P.aiCitePreset, id);
}
export const editPreset = (id: string, change: Partial<CitePreset>) => savePresets(citePresets().map((f) => (f.id === id ? { ...f, ...change } : f)));
export function deletePreset(id: string) {
  savePresets(citePresets().filter((f) => f.id !== id));
  if (pref(P.aiCitePreset) === id) setPref(P.aiCitePreset, '');
}
/** The Use Prompt Preset N commands (0 is the built-in prompt). Returns what's in use now, or null if there's no preset N. */
export function usePreset(n: number): string | null {
  if (!n) { setPref(P.aiCitePreset, ''); return 'the built-in prompt'; }
  const p = citePresets()[n - 1];
  if (!p) return null;
  setPref(P.aiCitePreset, p.id);
  return p.name;
}

const part = (text: string, name: string) => text.search(new RegExp(`\\[\\[\\s*${name}\\s*\\]\\]`, 'i'));
const noTag = (s: string) => s.replace(/^\[\[\s*\w+\s*\]\]/, '');
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The cite and the stretches of it to mark. The [[CITE]] / [[TOKENS]] / [[END]] block is optional: a prompt of your own can just answer with the cite. Null when there's nothing in it. */
export function parseCite(reply: string): { cite: string; tokens: string[] } | null {
  const c = part(reply, 'CITE'), t = part(reply, 'TOKENS'), e = part(reply, 'END');
  const stop = t > c ? t : e > c ? e : reply.length;
  const cite = oneLine(noTag(reply.slice(Math.max(c, 0), stop)).replace(/```\w*/g, ''));
  if (!cite) return null;
  const tokens = t > c ? noTag(reply.slice(t, e > t ? e : undefined)).split('\n').map(oneLine).filter(Boolean) : [];
  return { cite, tokens };
}

const flat = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

/** The cite as text nodes with the tokens cite-marked. `marked` is false when no token was found in it. */
export function citeNodes({ cite, tokens }: { cite: string; tokens: string[] }) {
  const on = new Array<boolean>(cite.length).fill(false);
  const hay = flat(cite);
  let marked = false;
  for (const t of tokens) {
    const at = hay.indexOf(flat(t)); // same length: flat() swaps one character for one
    if (at < 0) continue;
    on.fill(true, at, at + t.length);
    marked = true;
  }
  const nodes: PMNode[] = [];
  for (let i = 0; i < cite.length;) {
    let j = i;
    while (j < cite.length && on[j] === on[i]) j++;
    nodes.push(schema.text(cite.slice(i, j), on[i] ? [schema.marks.cite.create()] : []));
    i = j;
  }
  return { nodes, marked };
}

type Span = { from: number; to: number };
type Held = Span & { id: number };
const key = new PluginKey<Held[]>('aiCite');
let nextId = 0;

/** Does this change touch a held stretch? Each step's positions are in the doc as the last step left it. */
function touches(tr: Transaction, spans: Span[]) {
  let held = spans, hit = false;
  for (const map of tr.mapping.maps) {
    map.forEach((from, to) => { if (held.some((s) => from < s.to && to > s.from)) hit = true; });
    held = held.map((s) => ({ from: map.map(s.from, 1), to: map.map(s.to, -1) }));
  }
  return hit;
}

/** Keeps each stretch the AI is working on in place while you edit around it, tints it, and locks it. */
export const aiCitePlugin = new Plugin<Held[]>({
  key,
  state: {
    init: () => [],
    apply(tr, spans) {
      const moved = tr.docChanged ? spans.map((s) => ({ id: s.id, from: tr.mapping.map(s.from, 1), to: tr.mapping.map(s.to, -1) })) : spans;
      const m = tr.getMeta(key) as { add?: Held; drop?: number; own?: boolean } | undefined;
      if (m?.add) return [...moved, m.add];
      return m?.drop === undefined ? moved : moved.filter((s) => s.id !== m.drop);
    },
  },
  // typing there does nothing and the text flashes; the rest of the doc stays editable
  filterTransaction(tr, state) {
    const spans = key.getState(state)!;
    if (!spans.length || !tr.docChanged || tr.getMeta(key)?.own || !touches(tr, spans)) return true;
    document.querySelectorAll('.ai-busy').forEach((el) => { el.classList.remove('ai-flash'); void (el as HTMLElement).offsetWidth; el.classList.add('ai-flash'); });
    return false;
  },
  props: {
    decorations(state) {
      const spans = key.getState(state)!.filter((s) => s.to > s.from);
      return spans.length ? DecorationSet.create(state.doc, spans.map((s) => Decoration.inline(s.from, s.to, { class: 'ai-busy' }))) : null;
    },
  },
});

const today = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
export const citePrompt = () => promptInUse().split('{DATE}').join(today());

/** `end` is where the text ended up, so a pass over the doc knows where to carry on. */
export type CiteResult = ({ ok: true; marked: boolean } | { ok: false; error: string; stop?: boolean }) & { end: number };

/** Hold the range, ask, and swap the answer in as one undo step, unless the text changed meanwhile. */
async function rewrite(view: EditorView, range: Span): Promise<CiteResult> {
  const read = (r: Span) => view.state.doc.textBetween(r.from, r.to, '\n', '\n');
  const original = read(range);
  if (!original.trim()) return { ok: false, error: 'There\'s no text in that selection.', end: range.to };
  const id = ++nextId;
  view.dispatch(view.state.tr.setMeta(key, { add: { ...range, id } }).setMeta('addToHistory', false));
  const answer = await bridge.aiAsk!({ system: citePrompt(), text: original.trim(), model: pref(P.aiModel).trim(), maxTokens: pref(P.aiMaxTokens) });
  if (view.isDestroyed) return { ok: false, error: 'The document closed.', stop: true, end: 0 };
  const now = key.getState(view.state)!.find((s) => s.id === id)!;
  view.dispatch(view.state.tr.setMeta(key, { drop: id }).setMeta('addToHistory', false));
  if (answer.error !== undefined) return { ok: false, error: answer.error, stop: answer.stop, end: now.to };
  const parsed = parseCite(answer.text ?? '');
  if (!parsed) return { ok: false, error: 'The AI sent back nothing to put in.', end: now.to };
  if (read(now) !== original) return { ok: false, error: 'That text changed, so the cite wasn\'t put in.', end: now.to };
  const { nodes, marked } = citeNodes(parsed);
  const tr = closeHistory(view.state.tr).replaceWith(now.from, now.to, nodes).setMeta(key, { own: true }).scrollIntoView();
  view.dispatch(tr);
  return { ok: true, marked, end: tr.mapping.map(now.to) };
}

/** The selection without a paragraph break it ends on (triple click runs to the start of the next line). */
function citeRange(state: EditorState): Span {
  const { from, to, $to } = state.selection;
  if ($to.parentOffset === 0 && $to.depth >= 1 && from < $to.before()) {
    return { from, to: Math.max(from, Selection.near(state.doc.resolve($to.before()), -1).to) };
  }
  return { from, to };
}

const overlaps = (state: EditorState, r: Span) => key.getState(state)!.some((s) => s.from < r.to && r.from < s.to);

const ready = (view: EditorView): string | null => {
  if (!bridge.aiAsk) return 'AI features need the desktop app.';
  if (!pref(P.aiOn)) return 'Turn on AI features in Settings > AI.';
  if (isReading(view.state)) return 'Leave read mode first.';
  return null;
};

/** Mod-Shift-X: the selected citation or URL becomes a styled cite. `say` shows a message. */
export async function formatCite(view: EditorView, say: (msg: string) => void) {
  const no = ready(view);
  if (no) { say(no); return; }
  if (view.state.selection.empty) { say('Select a citation or URL first.'); return; }
  const r = citeRange(view.state);
  if (overlaps(view.state, r)) { say('Another AI edit is working on that text. Try again in a moment.'); return; }
  say('Formatting the cite…');
  const res = await rewrite(view, r);
  if (!res.ok) say(res.error);
  else say(res.marked ? 'Cite formatted.' : 'Cite formatted, but the name and date weren\'t marked. Press F8 on them.');
}

const isCiteLine = (n: PMNode) => {
  let found = false;
  n.descendants((c) => { if (c.isText && schema.marks.cite.isInSet(c.marks)) found = true; return !found; });
  return found;
};

/** Paragraphs already holding a cite, as document positions. Tags can't be cites and long lines are card text. */
export function citeLines(doc: PMNode): Span[] {
  const out: Span[] = [];
  doc.forEach((n, pos) => {
    if (n.attrs.style === 'normal' && n.textContent.length <= 2000 && isCiteLine(n)) out.push({ from: pos + 1, to: pos + 1 + n.content.size });
  });
  return out;
}

export type ReformatReport = { done: number; failed: number; unmarked: number; stopped: boolean; error?: string };

/** Every cite in the doc, one request at a time. Three failures in a row, or a key problem, end the run. */
export async function reformatCites(view: EditorView, opts: { stopped: () => boolean; progress: (done: number, total: number) => void }): Promise<ReformatReport> {
  const total = citeLines(view.state.doc).length;
  const rep: ReformatReport = { done: 0, failed: 0, unmarked: 0, stopped: false };
  let streak = 0, after = 0;
  // capped at the count the confirm promised: cites pasted in mid-run wait for the next pass
  for (let i = 0; i < total; i++) {
    if (opts.stopped()) { rep.stopped = true; break; }
    const line = citeLines(view.state.doc).find((l) => l.from >= after);
    if (!line) break;
    opts.progress(i, total);
    const res = await rewrite(view, line);
    after = res.end;
    if (res.ok) {
      rep.done++;
      streak = 0;
      if (!res.marked) rep.unmarked++;
    } else {
      rep.failed++;
      streak++;
      rep.error = res.error;
      if (res.stop || streak >= 3) { rep.stopped = true; break; }
    }
  }
  return rep;
}

/** How many requests a pass would make, or why it can't run. */
export const reformatCount = (view: EditorView): number | string => ready(view) ?? citeLines(view.state.doc).length;
