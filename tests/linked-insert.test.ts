// Cards other apps send over the bridge come in like a paste.
import { describe, expect, it } from 'vitest';
import { schema } from '../src/editor/schema';
import { insertContent, insertLabel } from '../src/editor/linked-insert';
import { markMap } from '../src/editor/editor';

const map = (f: ReturnType<typeof insertContent>) => markMap(schema.node('doc', null, f!));

describe('insertContent', () => {
  it("reads the CardMirror card HTML Nimbus sends", () => {
    const html = '<div data-pm-slice="0 0 []"><h4 class="pmd-tag">Warming is real</h4>'
      + '<p class="pmd-cite-para"><span class="pmd-cite">Lee 23</span>, Prof</p>'
      + '<p class="pmd-card-body"><span class="pmd-underline"><span class="pmd-highlight" data-highlight="cyan">emissions</span></span> rising</p></div>';
    const f = insertContent(html, 'Warming is real');
    expect(map(f).split('\n')).toEqual(['tag: Warming is real', 'normal: [Lee 23]{cite}, Prof', 'normal: [emissions]{highlight:cyan+underline} rising']);
    expect(insertLabel(f!)).toBe('Warming is real');
  });
  it('plain text when there is no HTML, a line a paragraph', () => {
    expect(map(insertContent('', 'one\ntwo'))).toBe('normal: one\nnormal: two');
  });
  it('nothing to insert is null', () => {
    expect(insertContent('<p></p>', '')).toBeNull();
    expect(insertContent(undefined, '  ')).toBeNull();
  });
});
