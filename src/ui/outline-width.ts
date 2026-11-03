import { safeSet } from './storage';

/** The outline pane's width, dragged from its right edge. */
export const OL_MIN = 200, OL_DEFAULT = 280, OL_MAX = 560;
const KEY = 'falcon.outlineWidth';

/** The widest it goes in this window: OL_MAX, or 40% of a narrow window so the page keeps its room. */
export const outlineMax = () => Math.max(OL_MIN, Math.min(OL_MAX, Math.round(innerWidth * 0.4)));
export const outlineWidth = (x: number, max = OL_MAX) => Math.round(Math.min(Math.max(Number.isFinite(x) ? x : OL_DEFAULT, OL_MIN), Math.max(OL_MIN, max)));

export const loadOutlineWidth = () => outlineWidth(Number(localStorage.getItem(KEY)) || OL_DEFAULT);
export const saveOutlineWidth = (w: number) => safeSet(KEY, String(w));
