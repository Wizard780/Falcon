import { createElement } from 'react';
import { safeSet } from './storage';

/**
 * Starred and pinned files, as paths in the order they were marked. Both hide their copies in other search folders.
 * A starred file goes to the top of file search when it matches what you type; a pinned one also always shows,
 * listed first with the box empty. A hidden path (a file or a whole folder) stays out of file search and Search cards.
 */
const list = (key: string) => {
  const load = (): string[] => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? '[]');
      return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : [];
    } catch { return []; }
  };
  /** Mark `path`, or unmark it if it's marked. Returns the new list. */
  const toggle = (path: string): string[] => {
    const now = load();
    const next = now.includes(path) ? now.filter((p) => p !== path) : [...now, path];
    safeSet(key, JSON.stringify(next));
    return next;
  };
  return [load, toggle] as const;
};
export const [loadStarred, toggleStarred] = list('falcon.starredFiles');
export const [loadPinned, togglePinned] = list('falcon.pinnedFiles');
export const [loadHidden, toggleHidden] = list('falcon.hiddenFiles');

const icon = (d: string) => () => createElement('svg', { viewBox: '0 0 16 16', 'aria-hidden': true }, createElement('path', { d }));
export const StarIcon = icon('M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z');
export const PinIcon = icon('M5.5 1.8h5l-.8 4.4 2.6 2.6v1H8.6V14L8 14.8 7.4 14V9.8H3.7v-1l2.6-2.6z');
