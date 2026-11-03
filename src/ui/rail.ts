import { safeSet } from './storage';

/** The rail's width: icons only at its narrowest, file names once it's dragged past RAIL_NAMES. */
export const RAIL_MIN = 56, RAIL_NAMES = 140, RAIL_MAX = 300;
const KEY = 'falcon.rail';

/** Where a drag to `x` leaves the rail: short of halfway to RAIL_NAMES it snaps back to icons, so it never sits at a width with no room for names. */
export function railWidth(x: number, max = RAIL_MAX) {
  if (!(x >= (RAIL_MIN + RAIL_NAMES) / 2)) return RAIL_MIN;
  return Math.round(Math.min(Math.max(x, RAIL_NAMES), Math.max(RAIL_NAMES, max)));
}

/** The widest the rail goes in this window: RAIL_MAX, or less in a narrow window so the page keeps its room. */
export const railMax = () => Math.min(RAIL_MAX, Math.max(RAIL_NAMES, Math.round(innerWidth * 0.3)));

export const loadRail = () => railWidth(Number(localStorage.getItem(KEY)) || RAIL_MIN);
export const saveRail = (w: number) => safeSet(KEY, String(w));
