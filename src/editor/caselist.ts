import type { Node as PMNode } from 'prosemirror-model';
import { levelOf } from './schema';
import type { ClPosted, TabroomRound } from './host';

export type Side = 'A' | 'N' | '';

const ORDER = ['1AC', '1NC', '2AC', '2NC', '1AR', '1NR', '2AR', '2NR'];
const CODE = /(?<![A-Za-z0-9])([12])\s?(AC|NC|AR|NR)(?![A-Za-z0-9])/i;
const SEPS = /^[\s\-—–:|]+|[\s\-—–:|]+$/g;
// headings that aren't a position: the parts of one, or its housekeeping. The position is the heading above them
const NOT_A_POSITION = /^(cards?|uq|u\/q|uniqueness|links?|il|i\/l|internal links?|impacts?|solvency|o\/?v|overview|top ?level|contact.*|info.*)$/i;

/** "1AC---Econ" or "Econ---1AC": the speech a heading is labeled with, and the rest of its name. */
export function speechCode(text: string) {
  const m = CODE.exec(text);
  if (!m) return null;
  const before = text.slice(0, m.index).replace(SEPS, '');
  const after = text.slice(m.index + m[0].length).replace(SEPS, '');
  return { code: `${m[1]}${m[2].toUpperCase()}`, name: [before, after].filter(Boolean).join('---') };
}

/** The round report, in the page's shape ("1NC---Offshoring DA, Econ DA"), from the doc's pockets, hats and blocks.
 *  A label on a heading covers the headings under it; a doc with no labels is the file's speech, else the side's first. */
export function draftReport(doc: PMNode, fileName: string, side: Side): string {
  const heads: { level: number; text: string }[] = [];
  doc.forEach((p) => { const level = levelOf(p); if (level >= 1 && level <= 3 && p.textContent.trim()) heads.push({ level, text: p.textContent.trim() }); });
  const anyCode = heads.some((h) => speechCode(h.text));
  const fileCode = anyCode ? null : speechCode(fileName)?.code ?? (side === 'A' ? '1AC' : side === 'N' ? '1NC' : null);
  const stack: { code?: string; name: string }[] = []; // the headings above, by level
  const out: Record<string, string[]> = {};
  heads.forEach((h, i) => {
    stack.length = h.level;
    const own = speechCode(h.text);
    stack[h.level - 1] = { code: own?.code, name: own ? own.name : h.text };
    const above = stack.slice(0, h.level - 1).filter(Boolean).reverse();
    const code = own?.code ?? above.find((x) => x.code)?.code ?? fileCode;
    if (!code || (heads[i + 1]?.level ?? 0) > h.level) return; // only the innermost headings are arguments
    const name = [stack[h.level - 1], ...above].map((x) => x.name).find((n) => n && !NOT_A_POSITION.test(n));
    if (!name) return;
    const names = (out[code] ??= []);
    if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
  });
  return ORDER.filter((c) => out[c]).map((c) => `${c}---${out[c].join(', ')}`).join('\n');
}

export function sideOf(side: string): Side {
  const s = side.trim().toLowerCase();
  return ['a', 'aff', 'pro'].includes(s) ? 'A' : ['n', 'neg', 'con'].includes(s) ? 'N' : '';
}
export const sideLabels = (event: string): Record<'A' | 'N', string> => (/pf|public forum/i.test(event) ? { A: 'Pro', N: 'Con' } : { A: 'Aff', N: 'Neg' });

// each team numbers its tournaments its own way: "1---Fullerton", "01 - UKSO", "3. Presentation"
const NUMBERED = /^\s*(\d+)(\s*[-–—.:)]+\s*)/;
const bare = (t: string) => t.replace(NUMBERED, '').trim().toLowerCase();

/** The tournament as this team's page writes it: the name it's already up under, else the next number in the page's style. */
export function numberedTournament(name: string, posted: string[]): string {
  const want = name.trim().toLowerCase();
  if (!want) return '';
  const same = posted.find((t) => bare(t) === want) ?? posted.find((t) => bare(t).length > 3 && (bare(t).includes(want) || want.includes(bare(t))));
  if (same) return same.trim();
  const numbers = posted.flatMap((t) => { const m = NUMBERED.exec(t); return m ? [m] : []; });
  if (posted.length && !numbers.length) return name.trim();
  const last = numbers.reduce<RegExpExecArray | null>((a, m) => (!a || Number(m[1]) >= Number(a[1]) ? m : a), null);
  const next = last ? Number(last[1]) + 1 : 1;
  return `${String(next).padStart(last?.[1].length ?? 1, '0')}${last?.[2] ?? '---'}${name.trim()}`;
}

/** The page shows a prelim's number as "Round 3", so that's what it stores; elims go in by name. */
export const roundField = (round: string) => round.trim().replace(/^(?:round|rd|r)\s*(\d+)$/i, '$1');

/** The form's fields from a Tabroom pairing. */
export function prefill(r: TabroomRound, posted: ClPosted[]) {
  return {
    tournament: numberedTournament(r.tournament, posted.map((p) => p.tournament)), round: roundField(r.round),
    side: sideOf(r.side), opponent: r.opponent.trim(), judge: r.judge.trim(),
  };
}

/** Is this round already on the page? Posting again would add a second row. */
export const alreadyPosted = (f: { tournament: string; round: string; side: string }, posted: ClPosted[]) =>
  posted.some((p) => bare(p.tournament) === bare(f.tournament) && p.round.trim().toLowerCase() === f.round.trim().toLowerCase() && sideOf(p.side) === f.side);
