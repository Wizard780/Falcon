import type { EditorView } from 'prosemirror-view';

export const tick = (ms = 50) => new Promise<void>((r) => setTimeout(r, ms));

// The app reads `window.falcon` once, when its modules load, so the fake is one object that mountApp refills.
// Import this file before anything from src/ (it has no static src imports for that reason).
type Bridge = Record<string, unknown>;
const fake: Bridge = {};
(globalThis as unknown as { falcon: Bridge }).falcon = fake;

const roots: (() => Promise<void>)[] = [];

/** A .docx whose paragraphs are tags with the given texts, as the file picker would hand it over. */
export async function docxBytes(...texts: string[]) {
  const { docToDocx } = await import('../src/docx/export');
  const { schema } = await import('../src/editor/schema');
  return docToDocx(schema.node('doc', null, texts.map((t) => schema.node('paragraph', { style: 'tag' }, [schema.text(t)]))));
}

/** Forget every setting and stored value, the way a fresh install starts. */
export async function freshStorage(extra: Record<string, string> = {}) {
  const { resetPrefs } = await import('../src/editor/prefs');
  resetPrefs();
  localStorage.clear();
  localStorage.setItem('falcon.openHome', 'off');
  for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
}

/**
 * Render the real <App/> against a fake `window.falcon`, on whatever localStorage holds now.
 * Calling it again after `unmount()` is a restart: same storage, new page.
 */
export async function mountApp(bridge: Bridge = {}) {
  // jsdom has no layout: ProseMirror and the outline ask for geometry it cannot give
  Object.assign(document, { elementFromPoint: () => null });
  const zero = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => zero as DOMRect;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof matchMedia;
  Element.prototype.scrollTo = (() => {}) as unknown as typeof Element.prototype.scrollTo;
  Element.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

  for (const k of Object.keys(fake)) delete fake[k];
  let onMenu: (c: string) => void = () => {};
  Object.assign(fake, { platform: 'darwin', onMenu: (f: (c: string) => void) => { onMenu = f; return () => {}; } }, bridge);
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { App } = await import('../src/ui/App');
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(createElement(App)); await tick(); });

  const view = () => (window as unknown as { __falconView: EditorView }).__falconView;
  const unmount = async () => {
    await act(async () => { root.unmount(); });
    el.remove();
    const i = roots.indexOf(unmount);
    if (i >= 0) roots.splice(i, 1);
  };
  roots.push(unmount);
  return {
    el,
    view,
    unmount,
    /** Run `f` inside React's act, then give timers `wait` ms. */
    act: async (f: () => unknown, wait = 50) => { await act(async () => { await f(); await tick(wait); }); },
    /** A File menu command: 'new', 'open', 'save', 'saveAs', 'close'. */
    menu: async (c: string, wait = 100) => { await act(async () => { onMenu(c); await tick(wait); }); },
    /** Type text at the caret of the open document. */
    type: async (text: string, wait = 50) => { await act(async () => { view().dispatch(view().state.tr.insertText(text)); await tick(wait); }); },
    text: () => view().state.doc.textContent,
    /** The names of the open documents, as the rail lists them. */
    tabs: () => [...el.querySelectorAll('.fs-docs .doc-nm')].map((b) => b.getAttribute('aria-label')),
    /** The rail's button for the tab with this name. */
    tab: (name: string) => [...el.querySelectorAll('.fs-docs .doc-nm')].find((b) => b.getAttribute('aria-label') === name) ?? null,
    toast: () => el.querySelector('.toast')?.textContent ?? '',
    /** A key pressed on the page (Ctrl is the shortcut modifier here: jsdom is not a Mac). */
    press: async (key: string, init: KeyboardEventInit = {}, wait = 50) => {
      await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })); await tick(wait); });
    },
    /** Type into a React-controlled text field. */
    fill: async (input: Element | null, value: string, wait = 50) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input!.dispatchEvent(new Event('input', { bubbles: true }));
        await tick(wait);
      });
    },
    click: async (node: Element | null, wait = 100) => { await act(async () => { (node as HTMLElement).click(); await tick(wait); }); },
  };
}

export async function unmountAll() {
  for (const u of [...roots]) await u();
}
