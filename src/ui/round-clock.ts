/**
 * The round's clocks: the speech clock, which steps through the round's speeches (policy, LD or PF), and each side's prep.
 * One clock runs at a time, the way a round does: starting one pauses the others.
 */

export type Speech = { name: string; sec: number };
export type ClockId = 'speech' | 'our' | 'their';
export type Clocks = { idx: number; speech: number; our: number; their: number; on: ClockId | null };

export type RoundFormat = 'policy' | 'ld' | 'pf';
/** Each format's prep per side, in minutes (NSDA's): what choosing the format sets Prep time to. */
export const FORMAT_PREP: Record<RoundFormat, number> = { policy: 8, ld: 4, pf: 3 };
export const FORMAT_NAME: Record<RoundFormat, string> = { policy: 'Policy', ld: 'LD', pf: 'PF' };

/**
 * A round's speeches. Policy follows the Speech length setting: constructives run it, rebuttals 3 minutes
 * less (8 → 5, 9 → 6), cross-ex 3. LD and PF use NSDA's times.
 */
export function roundSpeeches(format: RoundFormat, speechMin: number): Speech[] {
  const m = (name: string, min: number) => ({ name, sec: min * 60 });
  if (format === 'ld') return [m('AC', 6), m('CX', 3), m('NC', 7), m('CX', 3), m('1AR', 4), m('NR', 6), m('2AR', 3)];
  if (format === 'pf') return [m('1st Con', 4), m('2nd Con', 4), m('CF', 3), m('1st Reb', 4), m('2nd Reb', 4), m('CF', 3),
    m('1st Sum', 3), m('2nd Sum', 3), m('GCF', 3), m('1st FF', 2), m('2nd FF', 2)];
  const c = speechMin, r = speechMin > 3 ? speechMin - 3 : speechMin;
  return [m('1AC', c), m('CX', 3), m('1NC', c), m('CX', 3), m('2AC', c), m('CX', 3), m('2NC', c), m('CX', 3),
    m('1NR', r), m('1AR', r), m('2NR', r), m('2AR', r)];
}

export const freshClocks = (speeches: Speech[], prepSec: number): Clocks =>
  ({ idx: 0, speech: speeches[0].sec, our: prepSec, their: prepSec, on: null });

/** Start or pause one clock. Starting it pauses whichever was running; a clock at zero starts over first. */
export function toggle(c: Clocks, id: ClockId, speeches: Speech[], prepSec: number): Clocks {
  if (c.on === id) return { ...c, on: null };
  const full = id === 'speech' ? speeches[c.idx].sec : prepSec;
  return { ...c, [id]: c[id] === 0 ? full : c[id], on: id };
}

/** Put one clock back to its full time, stopped. */
export function reset(c: Clocks, id: ClockId, speeches: Speech[], prepSec: number): Clocks {
  return { ...c, [id]: id === 'speech' ? speeches[c.idx].sec : prepSec, on: c.on === id ? null : c.on };
}

/** Pick another speech: the clock stops and loads that speech's time. */
export function pick(c: Clocks, idx: number, speeches: Speech[]): Clocks {
  const i = Math.max(0, Math.min(speeches.length - 1, idx));
  return { ...c, idx: i, speech: speeches[i].sec, on: c.on === 'speech' ? null : c.on };
}

/**
 * One second passes. Returns the new clocks and which clock ran out, if one did.
 * A speech that runs out moves the picker on to the next speech, ready to start.
 */
export function tick(c: Clocks, speeches: Speech[]): { clocks: Clocks; done: ClockId | null } {
  const id = c.on;
  if (!id) return { clocks: c, done: null };
  if (c[id] > 1) return { clocks: { ...c, [id]: c[id] - 1 }, done: null };
  if (id === 'speech' && c.idx < speeches.length - 1) return { clocks: { ...pick(c, c.idx + 1, speeches), on: null }, done: id };
  return { clocks: { ...c, [id]: 0, on: null }, done: id };
}
