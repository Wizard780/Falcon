import { afterEach, describe, expect, it, vi } from 'vitest';
import { freshStorage, mountApp, unmountAll } from './app-harness';

afterEach(async () => {
  await unmountAll();
  vi.restoreAllMocks();
});

/** Replace the document with a pocket, a hat and two blocks, and let the outline follow the caret. */
async function withHeadings(app: Awaited<ReturnType<typeof mountApp>>) {
  const scrollTo = vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(() => {});
  await app.act(() => {
    const v = app.view(), { schema } = v.state;
    const p = (style: string, text: string) => schema.nodes.paragraph.create({ style }, schema.text(text));
    v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, [p('pocket', 'Pocket'), p('hat', 'Hat'), p('block', 'Block one'), p('block', 'Block two')]));
  }, 400);
  return scrollTo;
}

describe('outline scrolling the current heading into view', () => {
  it('is smooth by default', async () => {
    await freshStorage();
    const app = await mountApp();
    const scrollTo = await withHeadings(app);
    expect(scrollTo).toHaveBeenCalled();
    expect(scrollTo.mock.calls.map((c) => (c[0] as ScrollToOptions).behavior)).toContain('smooth');
  });

  it('jumps instead when Reduce motion is on in Settings', async () => {
    await freshStorage({ 'falcon.reduceMotion': 'on' });
    const app = await mountApp();
    const scrollTo = await withHeadings(app);
    expect(scrollTo).toHaveBeenCalled();
    expect(scrollTo.mock.calls.map((c) => (c[0] as ScrollToOptions).behavior)).not.toContain('smooth');
  });
});
