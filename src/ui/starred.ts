import { createElement } from 'react';
import { safeSet } from './storage';

/** Starred files: kept at the top of file search, and their copies in other search folders hidden. Paths, in starring order. */
const KEY = 'falcon.starredFiles';

export function loadStarred(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : [];
  } catch { return []; }
}
/** Star `path`, or unstar it if it's starred. Returns the new list. */
export function toggleStarred(path: string): string[] {
  const list = loadStarred();
  const next = list.includes(path) ? list.filter((p) => p !== path) : [...list, path];
  safeSet(KEY, JSON.stringify(next));
  return next;
}

const STAR = 'M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z';
export const StarIcon = () => createElement('svg', { viewBox: '0 0 16 16', 'aria-hidden': true }, createElement('path', { d: STAR }));
