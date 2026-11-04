/** The command center starts, pauses and resets the round's clocks, and opens the timer window, with this event. */
export const TIMER_EVENT = 'falcon-timer';
/** `prep` is our prep, `their` the other side's. `open` shows the timer window (`which` is ignored). */
export type TimerRequest = { which: 'speech' | 'prep' | 'their'; op: 'toggle' | 'reset' | 'open' };
