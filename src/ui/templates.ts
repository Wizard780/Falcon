import { safeSet } from './storage';

/**
 * Templates: named sets of files that open together, from the command center (t then a space) or by name there.
 * Kept out of the prefs, like starred files, so Restore defaults doesn't throw the lists away.
 * Paths come from the desktop app's picker, which is also what lets openPath read them (electron/main.cjs).
 */
export type Template = { id: string; name: string; paths: string[] };

export const TEMPLATES_KEY = 'falcon.templates';

export function loadTemplates(): Template[] {
  try {
    const list = JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? '[]');
    return Array.isArray(list)
      ? list.filter((t) => typeof t?.id === 'string' && typeof t.name === 'string' && Array.isArray(t.paths) && t.paths.every((p: unknown) => typeof p === 'string'))
      : [];
  } catch { return []; }
}
const save = (list: Template[]) => safeSet(TEMPLATES_KEY, JSON.stringify(list));

/** Adds an empty template and returns its id. */
export function newTemplate(): string {
  const list = loadTemplates();
  const id = `t${Date.now().toString(36)}${list.length}`;
  save([...list, { id, name: `Template ${list.length + 1}`, paths: [] }]);
  return id;
}
export const editTemplate = (id: string, change: Partial<Template>) => save(loadTemplates().map((t) => (t.id === id ? { ...t, ...change } : t)));
export const deleteTemplate = (id: string) => save(loadTemplates().filter((t) => t.id !== id));
/** Adds `paths` to the template's list; one it already has stays where it is. */
export const addTemplatePaths = (t: Template, paths: string[]) => editTemplate(t.id, { paths: [...new Set([...t.paths, ...paths])] });

export const templateName = (t: Template) => t.name.trim() || 'Untitled template';
export const pathName = (p: string) => (p.split(/[\\/]/).pop() ?? p).replace(/\.docx$/i, '');
export const fileCount = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;
