import { describe, expect, it } from 'vitest';
import { collectHits, hiddenTest, parentName, rankHits } from '../src/ui/file-search';

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
  it('leaves out hidden files and everything in hidden folders, but never what is open', () => {
    const files = [
      { path: '/d/Aff/1AC.docx', root: '/d', mtime: 1 },
      { path: '/d/Aff/Old/2AC.docx', root: '/d', mtime: 2 },
      { path: '/d/Affirmatives/K.docx', root: '/d', mtime: 3 },
      { path: '/d/Neg/Cap.docx', root: '/d', mtime: 4 },
    ];
    const names = (h: { name: string }[]) => h.map((x) => x.name);
    expect(names(collectHits([], [], files, [], [], ['/d/Neg/Cap.docx']))).toEqual(['1AC', '2AC', 'K']);
    // a folder, not anything that starts the same
    expect(names(collectHits([], [], files, [], [], ['/d/Aff']))).toEqual(['K', 'Cap']);
    expect(names(collectHits([], [{ name: 'Cap', path: '/d/Neg/Cap.docx', folder: 'Neg', when: 1 }], [], [], [], ['/d/Neg']))).toEqual([]);
    expect(names(collectHits([{ id: 1, name: 'Cap', path: '/d/Neg/Cap.docx' }], [], files, [], [], ['/d/Neg']))).toEqual(['Cap', '1AC', '2AC', 'K']);
    // hiding beats a pin, and takes either path style
    expect(names(collectHits([], [], files, [], ['/d/Neg/Cap.docx'], ['/d/Neg']))).not.toContain('Cap');
    expect(hiddenTest(['C:\\Debate/Aff'])('C:\\Debate\\Aff\\1AC.docx')).toBe(true);
  });
  it('names the folder a file is in, on either path style', () => {
    expect(parentName('C:\\Debate\\Neg\\Cap K.docx')).toBe('Neg');
    expect(parentName('/d/Aff/x.docx')).toBe('Aff');
  });
  it('starred files beat other matches and hide their copies in other search folders', () => {
    const dropboxes = [
      { path: '/Users/a/Dropbox/DA/Impact Defense.docx', root: '/Users/a/Dropbox', mtime: 1 },
      { path: '/Users/a/Team Dropbox/DA/Impact Defense.docx', root: '/Users/a/Team Dropbox/', mtime: 9 },
      { path: '/Users/a/Team Dropbox/DA/Impact Turns.docx', root: '/Users/a/Team Dropbox', mtime: 5 },
    ];
    const plain = collectHits([], [], dropboxes);
    expect(plain.map((h) => h.source)).toEqual(['Dropbox', 'Team Dropbox', 'Team Dropbox']);
    expect(rankHits(plain, 'impact').map((h) => h.source)).toEqual(['Team Dropbox', 'Team Dropbox', 'Dropbox']); // newest first

    const hits = collectHits([], [], dropboxes, ['/Users/a/Dropbox/DA/Impact Defense.docx']);
    expect(hits.find((h) => h.starred)).toMatchObject({ name: 'Impact Defense', source: 'Dropbox', hidden: 1 });
    expect(hits.filter((h) => h.name === 'Impact Defense')).toHaveLength(1);
    expect(rankHits(hits, 'impact').map((h) => `${h.name} ${h.source}`)).toEqual(['Impact Defense Dropbox', 'Impact Turns Team Dropbox']);
  });
  it('a same-named file in another folder is not a copy', () => {
    const hits = collectHits([], [], [
      { path: '/d/Dropbox/Aff/1AC.docx', root: '/d/Dropbox', mtime: 1 },
      { path: 'C:\\Team Dropbox\\Aff\\1AC.docx', root: 'C:\\Team Dropbox\\', mtime: 3 },
      { path: '/d/Dropbox/Old Topic/1AC.docx', root: '/d/Dropbox', mtime: 2 },
    ], ['/d/Dropbox/Aff/1AC.docx']);
    expect(hits.map((h) => `${h.folder}${h.starred ? '*' : ''}${h.hidden ?? ''}`)).toEqual(['Aff*1', 'Old Topic']);
  });
  it('an open copy of a starred file still shows, and a star on a missing file does nothing', () => {
    const hits = collectHits([{ id: 1, name: 'Impact Defense', path: '/t/Impact Defense.docx' }], [], [{ path: '/d/Impact Defense.docx', mtime: 1 }], ['/d/Impact Defense.docx', '/gone.docx']);
    expect(hits.map((h) => `${h.kind}${h.starred ? '*' : ''}`)).toEqual(['open', 'file*']);
  });
  it('starred files keep their place until a search, pinned ones always come first', () => {
    const files = [
      { path: '/d/DA/Politics.docx', root: '/d', mtime: 3 },
      { path: '/d/T/Topicality.docx', root: '/d', mtime: 1 },
      { path: '/d/T/Topicality Old.docx', root: '/d', mtime: 9 },
      { path: '/d/K/Cap K.docx', root: '/d', mtime: 2 },
      { path: '/e/K/Cap K.docx', root: '/e', mtime: 8 },
    ];
    const hits = collectHits([], [{ name: 'Notes', folder: '', when: 5 }], files, ['/d/T/Topicality Old.docx'], ['/d/K/Cap K.docx']);
    // pinned first (with its copy hidden), then the rest in their usual order, the starred one where it was
    expect(hits.map((h) => `${h.name}${h.pinned ? '^' : ''}${h.starred ? '*' : ''}${h.hidden ? h.hidden : ''}`))
      .toEqual(['Cap K^1', 'Notes', 'Politics', 'Topicality', 'Topicality Old*']);
    // searching puts the starred match on top, even over an exact name match
    expect(rankHits(hits, 'topicality').map((h) => h.name)).toEqual(['Topicality Old', 'Topicality']);
    expect(rankHits(collectHits([], [], files), 'topicality').map((h) => h.name)).toEqual(['Topicality', 'Topicality Old']);
    expect(rankHits(hits, 'cap')[0]).toMatchObject({ name: 'Cap K', pinned: true });
  });
});
