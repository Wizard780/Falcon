import { describe, expect, it } from 'vitest';
import { parseQuery, rank } from '../src/ui/command-center';
import { fileEntries, type Ctx } from '../src/ui/cc-sources';
import { collectHits, type FileHit } from '../src/ui/file-search';

const opened: FileHit[] = [];
const ctx = { openFile: (h: FileHit) => opened.push(h) } as unknown as Ctx;
const hits = collectHits(
  [{ id: 1, name: 'Aff---1AC', path: '/d/Aff/Aff---1AC.docx' }],
  [{ name: 'Cap K', path: '/d/Neg/Cap K.docx', folder: 'Neg', when: 5 }],
  [{ path: '/d/Neg/China CP DA.docx', mtime: 1 }, { path: '/d/Aff/Aff---1AC.docx', mtime: 2 }],
);

describe('command center files', () => {
  it('f then a space narrows to files', () => {
    expect(parseQuery('f cap')).toEqual({ source: 'file', text: 'cap' });
    expect(parseQuery('f7')).toEqual({ text: 'f7' }); // a key name, not the prefix
  });
  it('lists each file once as a DOCX row, grouped by where it came from', () => {
    const rows = fileEntries(ctx, hits);
    expect(rows.map((r) => [r.badge, r.label, r.group])).toEqual([
      ['DOCX', 'Aff---1AC', 'Open'], ['DOCX', 'Cap K', 'Recent'], ['DOCX', 'China CP DA', 'Neg'],
    ]);
  });
  it('matches by name, initials or folder, and picking one opens it', () => {
    const rows = fileEntries(ctx, hits);
    expect(rank(rows, 'ccd')[0].label).toBe('China CP DA');
    expect(rank(rows, 'neg').map((r) => r.label)).toEqual(expect.arrayContaining(['Cap K', 'China CP DA']));
    rank(rows, 'china')[0].run!();
    expect(opened.map((h) => h.path)).toEqual(['/d/Neg/China CP DA.docx']);
  });
});
