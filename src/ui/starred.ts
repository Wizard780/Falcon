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
