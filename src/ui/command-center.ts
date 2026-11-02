/** Command center (Mod-Shift-Space): what a query asks for and how rows rank. Pure, so it's unit tested. */

/** Where a row comes from. Files and the card library aren't here on purpose: they get their own source later. */
export type SourceId = 'arg' | 'cmd' | 'set' | 'doc' | 'help';

/** One choice under a setting (Theme > Light). */
export type Option = { label: string; on: boolean; pick: () => void };

export type Entry = {
  /** stable across opens, so recents can find it again */
  key: string;
  source: SourceId;
  label: string;
  /** dim text on the right, and the section head when browsing */
  group: string;
  hint?: string;
  /** more words that match, weaker than the label (the key's name, synonyms, a card's cite) */
  keywords?: string;
  /** a keymap name like "Mod-Shift-8" */
  shortcut?: string;
  /** what a setting is now: On, Off, Light… */
  state?: string;
  /** a setting with choices: Enter lists them */
  options?: () => Option[];
  /** does it; false means there was nothing to do */
  run?: () => boolean | void;
  /** can it do anything right now (rows that can't are dimmed) */
  can?: () => boolean;
  /** arrowing onto the row shows it (headings scroll the page there) */
  peek?: () => void;
  /** Tab opens it in Settings: the page, and what to search for there */
  settings?: { page: string; query: string };
  /** heading level, for indenting the outline */
  level?: number;
  /** hidden until you type (one row per theme, per highlighter color…) */
  typedOnly?: boolean;
  /** picking it types this into the box instead (the help rows) */
  fill?: string;
  /** the short tag at the row's left, CardMirror style: CMD, TOG, CYC, SET, TAG… */
  badge?: string;
};

export const PREFIXES: { prefix: string; source: SourceId; label: string }[] = [
  { prefix: 'c', source: 'cmd', label: 'Commands, toggles and cycles' },
  { prefix: 's', source: 'set', label: 'Settings' },
  { prefix: 'h', source: 'doc', label: 'Headings and cards in this file' },
  { prefix: '?', source: 'help', label: 'What you can type here' },
];

/** "s theme" is settings only; ">" and "#" are VS Code style shorthands that need no space. */
export function parseQuery(q: string): { source?: SourceId; text: string } {
  const m = /^([csh?])(?:\s+|$)/i.exec(q);
  if (m && (q.length > 1 || m[1] === '?')) return { source: PREFIXES.find((p) => p.prefix === m[1].toLowerCase())!.source, text: q.slice(m[0].length) };
  if (q.startsWith('>')) return { source: 'cmd', text: q.slice(1).trimStart() };
  if (q.startsWith('#') && !/^#\s*\d+\s*$/.test(q)) return { source: 'doc', text: q.slice(1).trimStart() };
  return { text: q };
}

/** Typed values: "zoom 150", "14pt", "card 12", "depth 2", "speech 6", "prep 5". */
export type Arg =
  | { kind: 'zoom'; n: number } | { kind: 'size'; n: number } | { kind: 'card'; n: number }
  | { kind: 'depth'; n: number } | { kind: 'speech'; n: number } | { kind: 'prep'; n: number };

export function parseArgs(text: string): Arg[] {
  const t = text.trim().toLowerCase();
  const out: Arg[] = [];
  let m: RegExpExecArray | null;
  if ((m = /^(?:zoom|z)\s*(\d{2,3})\s*%?$/.exec(t) ?? /^(\d{2,3})\s*%$/.exec(t))) {
    const n = Number(m[1]);
    if (n >= 50 && n <= 300) out.push({ kind: 'zoom', n });
  }
  if ((m = /^(?:size|font size|font|fs)\s*(\d{1,2})\s*(?:pt)?$/.exec(t) ?? /^(\d{1,2})\s*pt$/.exec(t))) {
    const n = Number(m[1]);
    if (n >= 4 && n <= 72) out.push({ kind: 'size', n });
  }
  if ((m = /^(?:card|go to card|go to|go|tag|#)\s*(\d{1,4})$/.exec(t))) out.push({ kind: 'card', n: Number(m[1]) });
  if ((m = /^(?:depth|level|outline)\s*([1-4])$/.exec(t))) out.push({ kind: 'depth', n: Number(m[1]) });
  if ((m = /^(?:speech|timer|speech time|speech length)\s*(\d{1,2})(?:\s*m(?:in)?)?$/.exec(t))) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 30) out.push({ kind: 'speech', n });
  }
  if ((m = /^(?:prep|prep time)\s*(\d{1,2})(?:\s*m(?:in)?)?$/.exec(t))) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 15) out.push({ kind: 'prep', n });
  }
  return out;
}

const BOUNDARY = /[\s\-_.·:/()[\]>,'’"“”]/;
const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);
const starts = (text: string) => {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) if (!BOUNDARY.test(text[i]) && (i === 0 || BOUNDARY.test(text[i - 1]))) out.push(i);
  return out;
};

/** How well one query word hits `text` (lowercase). 0 = not at all. */
export function wordScore(w: string, text: string): number {
  const i = text.indexOf(w);
  if (i === 0) return 100;
  if (i > 0) {
    for (let at = i; at >= 0; at = text.indexOf(w, at + 1)) if (BOUNDARY.test(text[at - 1])) return 80;
    return 50;
  }
  if (w.length < 2) return 0;
  // initials: "sh" is Standardize Highlighting, "cwp" Condense With Pilcrows
  const st = starts(text);
  let k = 0;
  for (const s of st) if (k < w.length && text[s] === w[k]) k++;
  if (k === w.length) return 45;
  // letters in order inside one word ("hlt" in "highlight")
  for (const s of st) {
    let j = 0;
    for (let p = s; p < text.length && !BOUNDARY.test(text[p]) && j < w.length; p++) if (text[p] === w[j]) j++;
    if (j === w.length && w.length >= 3) return 30;
  }
  return 0;
}

/** Recently run rows, most recent first. Kept per machine, not a setting. */
const RECENT_KEY = 'falcon.cc.recent';
export function loadRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; }
  catch { return []; }
}
export function noteRecent(key: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([key, ...loadRecent().filter((k) => k !== key)].slice(0, 30))); }
  catch { /* storage full, recents just don't stick */ }
}

// commands edge out settings, which edge out headings, when they match equally well
const WEIGHT: Record<SourceId, number> = { arg: 40, cmd: 6, set: 3, doc: 0, help: 0 };

/** Rank `entries` against `text`: every word has to hit the label, or (weaker) the group or keywords. */
export function rank(entries: Entry[], text: string, recent: string[] = [], limit = 80): Entry[] {
  const ws = words(text);
  if (!ws.length) return entries.filter((e) => !e.typedOnly).slice(0, limit);
  const scored: [Entry, number][] = [];
  for (const e of entries) {
    const label = e.label.toLowerCase(), extra = `${e.group} ${e.keywords ?? ''}`.toLowerCase();
    let total = 0;
    for (const w of ws) {
      const s = Math.max(wordScore(w, label), wordScore(w, extra) * 0.6);
      if (!s) { total = -1; break; }
      total += s;
    }
    if (total < 0) continue;
    total /= ws.length;
    if (label === ws.join(' ')) total += 40;
    total -= Math.min(15, label.length / 6); // short labels say less that the query didn't ask for
    total += WEIGHT[e.source];
    const r = recent.indexOf(e.key);
    if (r >= 0) total += Math.max(4, 20 - r);
    // "Theme: Light" wins when you typed "light", and stays under Cycle Theme when you only typed "theme"
    if (e.typedOnly) {
      const cut = label.indexOf(': '), name = label.slice(0, cut), choice = label.slice(cut + 2);
      const hitChoice = ws.some((w) => wordScore(w, choice) >= 80), hitName = ws.some((w) => wordScore(w, name) >= 80);
      // the choice alone ("light") is a fair guess, its setting plus choice ("theme light") a sure one
      total -= hitChoice ? (hitName ? 0 : 12) : 25;
    }
    scored.push([e, total]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  return scored.slice(0, limit).map(([e]) => e);
}

/** Where each query word shows up in `label`, for bolding: [from, to) pairs, merged. */
export function matchRanges(label: string, text: string): [number, number][] {
  const l = label.toLowerCase(), out: [number, number][] = [];
  for (const w of words(text)) {
    let i = -1;
    for (let at = l.indexOf(w); at >= 0; at = l.indexOf(w, at + 1)) { if (at === 0 || BOUNDARY.test(l[at - 1])) { i = at; break; } if (i < 0) i = at; }
    if (i >= 0) out.push([i, i + w.length]);
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]);
  }
  return merged;
}
