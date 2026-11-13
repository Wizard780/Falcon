import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { createState } from '../src/editor/editor';
import { schema } from '../src/editor/schema';
import { outlinePreview } from '../src/ui/outline-preview';

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe('outline card preview', () => {
  it("a row the outline hasn't caught up on (an edit cut the doc shorter) shows nothing and throws nothing", () => {
    vi.useFakeTimers();
    const doc = schema.node('doc', null, [schema.node('paragraph', { style: 'tag' }, [schema.text('Tag')]), schema.node('paragraph', null, [schema.text('Smith 24')])]);
    const view = new EditorView(document.createElement('div'), { state: createState(doc) });
    const list = document.createElement('div');
    const row = document.createElement('button');
    row.className = 'sb-row ol';
    list.append(row);
    document.body.append(list);
    const errors: unknown[] = [];
    const onErr = (e: ErrorEvent) => { errors.push(e.error); e.preventDefault(); };
    addEventListener('error', onErr);
    for (const stale of [doc.content.size + 50, doc.child(0).nodeSize + 2]) {
      const off = outlinePreview(list, () => view, () => stale);
      row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 10 }));
      expect(() => vi.advanceTimersByTime(400)).not.toThrow();
      expect(document.querySelector('.cl-pv.cl-on')).toBeNull();
      off();
    }
    removeEventListener('error', onErr);
    expect(errors).toEqual([]);
    view.destroy();
  });
});
