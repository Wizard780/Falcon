import { P, pref } from '../editor/prefs';

/** Reduce motion in Settings, or the system asking for less motion. */
export const reducedMotion = () => pref(P.reduceMotion) || matchMedia('(prefers-reduced-motion: reduce)').matches;
