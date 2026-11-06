// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { parseQuery, rank } from '../src/ui/command-center';
import { settingDefs, templateEntries, type Ctx } from '../src/ui/cc-sources';
import { addTemplatePaths, deleteTemplate, editTemplate, loadTemplates, newTemplate, type Template } from '../src/ui/templates';
import { exportSettings, importSettings } from '../src/ui/settings-file';
import { resetPrefs } from '../src/editor/prefs';

const make = (name: string, paths: string[]) => {
  const id = newTemplate();
  editTemplate(id, { name, paths });
  return id;
};
const opened: Template[] = [];
const ctx = { openTemplate: (t: Template) => opened.push(t) } as unknown as Ctx;

beforeEach(() => { localStorage.clear(); opened.length = 0; });

describe('templates', () => {
  it('t then a space narrows to templates', () => {
    expect(parseQuery('t fem')).toEqual({ source: 'tpl', text: 'fem' });
    expect(parseQuery('T ')).toEqual({ source: 'tpl', text: '' });
    expect(parseQuery('t')).toEqual({ text: 't' });
    expect(parseQuery('tag')).toEqual({ text: 'tag' });
  });
  it('is a TPL row found by its name or a file in it, and Enter opens the whole set', () => {
    make('AT Fem', ['/d/Fem K.docx', '/d/Fem Blocks.docx']);
    make('Cap', ['/d/Cap K.docx']);
    const rows = templateEntries(ctx);
    expect(rows.map((r) => [r.badge, r.label, r.hint])).toEqual([['TPL', 'AT Fem', '2 files'], ['TPL', 'Cap', '1 file']]);
    expect(rank(rows, 'fem')[0].label).toBe('AT Fem');
    expect(rank(rows, 'blocks').map((r) => r.label)).toEqual(['AT Fem']);
    rank(rows, 'at fem')[0].run!();
    expect(opened.map((t) => t.paths)).toEqual([['/d/Fem K.docx', '/d/Fem Blocks.docx']]);
  });
  it('an empty template is dimmed and does nothing', () => {
    make('Empty', []);
    const [row] = templateEntries(ctx);
    expect(row.can!()).toBe(false);
    expect(row.run!()).toBe(false);
    expect(opened).toEqual([]);
  });
  it('a blank name still reads as something, and Tab goes to its row in Settings', () => {
    make('  ', ['/d/a.docx']);
    const [row] = templateEntries(ctx);
    expect(row.label).toBe('Untitled template');
    expect(row.settings).toEqual({ page: 'templates', query: 'Untitled template' });
  });
  it('has no rows where files can\'t be opened by path (the web build)', () => {
    make('Cap', ['/d/Cap K.docx']);
    expect(templateEntries({} as Ctx)).toEqual([]);
  });
  it('adding a file it already has keeps one copy, in place', () => {
    const id = make('Cap', ['/d/a.docx', '/d/b.docx']);
    addTemplatePaths(loadTemplates()[0], ['/d/a.docx', '/d/c.docx']);
    expect(loadTemplates()[0].paths).toEqual(['/d/a.docx', '/d/b.docx', '/d/c.docx']);
    deleteTemplate(id);
    expect(loadTemplates()).toEqual([]);
  });
  it('skips stored entries of the wrong shape, and bad JSON', () => {
    localStorage.setItem('falcon.templates', JSON.stringify([{ id: 'a', name: 'ok', paths: ['/x.docx'] }, { id: 'b', name: 'no paths' }, { id: 'c', name: 'bad', paths: [1] }, null]));
    expect(loadTemplates().map((t) => t.id)).toEqual(['a']);
    localStorage.setItem('falcon.templates', '{');
    expect(loadTemplates()).toEqual([]);
  });
  it('survives Restore defaults', () => {
    make('Cap', ['/d/Cap K.docx']);
    resetPrefs();
    expect(loadTemplates().map((t) => t.name)).toEqual(['Cap']);
  });
  it('goes through a settings file, however long the list', () => {
    make('Cap', Array.from({ length: 40 }, (_, i) => `/a/long/folder/path/to/the/team/files/File ${i}.docx`));
    const file = JSON.stringify(exportSettings());
    localStorage.clear();
    expect(importSettings(file).ok).toBe(true);
    expect(loadTemplates()[0].paths).toHaveLength(40);
  });
  it('has a row in the command center\'s settings that leads to the page', () => {
    const row = settingDefs({ view: null } as unknown as Ctx).find((d) => d.id === 'falcon.templates')!;
    expect(row).toMatchObject({ label: 'Templates', page: 'templates', link: true });
  });
});
