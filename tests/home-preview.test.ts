import { describe, expect, it } from 'vitest';
import { schema } from '../src/editor/schema';
import { noteRecent } from '../src/ui/recents';

const p = (style: string, ...kids: ReturnType<typeof schema.text>[]) => schema.nodes.paragraph.create({ style }, kids);

describe('home preview', () => {
  it('keeps the start of the file as the editor draws it, without pictures or live links', () => {
    const img = schema.nodes.image.create({ src: 'data:image/png;base64,AAAA' });
    const doc = schema.nodes.doc.create(null, [
      p('pocket', schema.text('1NC---OFF')),
      p('tag', schema.text('Data centers outbid factories for power')),
      p('normal'),
      p('normal', schema.text('the grid is ', []), schema.text('full', [schema.marks.highlight.create({ color: 'cyan' })]), schema.text(' now', [schema.marks.link.create({ href: 'https://x.org' })])),
      schema.nodes.paragraph.create(null, [img]),
    ]);
    const [r] = noteRecent([], doc, { name: 'Neg', path: '/d/Neg.docx' });
    const box = document.createElement('div');
    box.innerHTML = r.preview!;
    expect(box.querySelector('.f-pocket')?.textContent).toBe('1NC---OFF');
    expect(box.querySelector('.f-tag')?.textContent).toBe('Data centers outbid factories for power');
    expect(box.querySelector('.f-highlight')?.textContent).toBe('full');
    expect(box.querySelector('img')).toBeNull();
    expect(box.querySelector('[href]')).toBeNull();
    expect([...box.querySelectorAll('p')].filter((e) => !e.textContent).every((e) => e.querySelector('br'))).toBe(true); // blank lines and the emptied picture line keep their height
  });

  it('stops after about a page and a half of a big file', () => {
    const doc = schema.nodes.doc.create(null, Array.from({ length: 500 }, (_, i) => p('normal', schema.text(`paragraph ${i} `.repeat(10)))));
    const [r] = noteRecent([], doc, { name: 'Big' });
    expect(r.preview!.length).toBeLessThan(10_000);
    expect(r.preview).toContain('paragraph 0 ');
  });
});
