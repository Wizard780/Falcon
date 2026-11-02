import { describe, expect, it } from 'vitest';
import { collectHits, parentName, rankHits } from '../src/ui/file-search';

const files = [
  { path: '/d/Aff/Aff---2AC Blocks.docx', mtime: 3 },
  { path: '/d/Neg/China CP DA.docx', mtime: 2 },
  { path: '/d/Neg/Cap K.docx', mtime: 1 },
  { path: '/d/Aff/Aff---1AC.docx', mtime: 4 },
  { path: '/d/Old/Capitalism Kritik Long Name Backfile.docx', mtime: 9 },
];
const names = (q: string, hits = collectHits([], [], files)) => rankHits(hits, q).map((h) => h.name);

describe('file search ranking', () => {
  it('needs every word to match, in the name or its folder', () => {
    expect(names('2ac')).toEqual(['Aff---2AC Blocks']);
    expect(names('neg cap')).toEqual(['Cap K']); // "neg" matches the folder
    expect(names('zzz')).toEqual([]);
  });
  it('ranks a prefix above a word start above a letters-in-order match', () => {
    expect(names('cap')).toEqual(['Cap K', 'Capitalism Kritik Long Name Backfile']);
    expect(names('cpda')[0]).toBe('China CP DA');
    expect(names('cp', collectHits([], [], [{ path: '/d/Zebra Counterplan.docx', mtime: 0 }]))).toEqual(['Zebra Counterplan']);
    expect(names('zebra cp', collectHits([], [], [{ path: '/d/Zebra Counterplan.docx', mtime: 0 }]))).toEqual(['Zebra Counterplan']);
  });
  it('breaks ties by the newer file', () => {
    expect(names('aff')).toEqual(['Aff---1AC', 'Aff---2AC Blocks']);
  });
  it('lists open docs, then recents, then indexed files, each path once', () => {
    const hits = collectHits(
      [{ id: 7, name: 'Aff---1AC', path: '/d/Aff/Aff---1AC.docx' }, { id: 8, name: 'Untitled' }],
      [{ name: 'Cap K', path: '/d/Neg/Cap K.docx', folder: 'Neg', when: 5 }],
      files,
    );
    expect(hits.map((h) => `${h.kind}:${h.name}`)).toEqual([
      'open:Aff---1AC', 'open:Untitled', 'recent:Cap K', 'file:Aff---2AC Blocks', 'file:China CP DA', 'file:Capitalism Kritik Long Name Backfile',
    ]);
    expect(hits[0].docId).toBe(7);
    expect(rankHits(hits, 'aff')[0].kind).toBe('open');
  });
  it('names the folder a file is in, on either path style', () => {
    expect(parentName('C:\\Debate\\Neg\\Cap K.docx')).toBe('Neg');
    expect(parentName('/d/Aff/x.docx')).toBe('Aff');
  });
});
