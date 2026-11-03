/** The command center starts, pauses and resets the toolbar's clocks with this event. */
export const TIMER_EVENT = 'falcon-timer';
export type TimerRequest = { which: 'speech' | 'prep'; op: 'toggle' | 'reset' };
