/**
 * The round's clocks: the speech clock, which steps through a policy round's speeches, and each side's prep.
 * One clock runs at a time, the way a round does: starting one pauses the others.
 */

export type Speech = { name: string; sec: number };
export type ClockId = 'speech' | 'our' | 'their';
export type Clocks = { idx: number; speech: number; our: number; their: number; on: ClockId | null };

/** A policy round. Constructives run the speech length, rebuttals 3 minutes less (8 → 5, 9 → 6), cross-ex 3. */
export function roundSpeeches(speechMin: number): Speech[] {
  const c = speechMin * 60, r = (speechMin > 3 ? speechMin - 3 : speechMin) * 60, cx = 180;
  return ([['1AC', c], ['CX', cx], ['1NC', c], ['CX', cx], ['2AC', c], ['CX', cx], ['2NC', c], ['CX', cx],
    ['1NR', r], ['1AR', r], ['2NR', r], ['2AR', r]] as const).map(([name, sec]) => ({ name, sec }));
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
