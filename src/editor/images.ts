import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, Plugin, type Command } from 'prosemirror-state';
import { ReplaceAroundStep, ReplaceStep } from 'prosemirror-transform';
import type { EditorView, NodeView } from 'prosemirror-view';
import { schema } from './schema';

const PAGE_PX = 624; // 6.5in of text width
const MIN_PX = 24;

const readAsDataUrl = (blob: Blob) => new Promise<string>((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result));
  r.onerror = () => fail(r.error);
  r.readAsDataURL(blob);
});
const naturalSize = (src: string) => new Promise<{ w: number; h: number } | null>((ok) => {
  const img = new Image();
  img.onload = () => ok(img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null);
  img.onerror = () => ok(null);
  img.src = src;
});

/** Formats a .docx can hold as an ordinary picture; anything else (WebP, AVIF, SVG, HEIC…) is redrawn as PNG. */
const WORD_TYPES = /^data:image\/(png|jpeg|gif|bmp);/i;
async function wordSafe(src: string, size: { w: number; h: number }): Promise<string | null> {
  if (WORD_TYPES.test(src)) return src;
  const img = new Image();
  img.src = src;
  try { await img.decode(); } catch { return null; }
  const c = document.createElement('canvas');
  c.width = size.w; c.height = size.h;
  c.getContext('2d')?.drawImage(img, 0, 0);
  const png = c.toDataURL('image/png');
  return png.startsWith('data:image/png') ? png : null;
}

/** An image node for a picture file, no wider than the page (a big screenshot comes in at page width). */
async function imageFrom(file: Blob): Promise<PMNode | null> {
  if (!/^image\//.test(file.type)) return null;
  const size = await naturalSize(await readAsDataUrl(file));
  if (!size) return null;
  // a picture the file can't hold is refused here, not dropped later when saving
  const src = await wordSafe(await readAsDataUrl(file), size);
  if (!src) return null;
  const w = Math.min(size.w, PAGE_PX);
  return schema.nodes.image.create({ src, width: w, height: Math.round((w * size.h) / size.w) });
}

async function insertFiles(view: EditorView, files: File[], pos?: number) {
  const nodes = (await Promise.all(files.map(imageFrom))).filter((n): n is PMNode => !!n);
  if (!nodes.length) return;
  const tr = view.state.tr;
  if (pos === undefined) tr.replaceSelectionWith(nodes[0], false);
  else tr.insert(pos, nodes[0]);
  // the rest go after the first, in order
  let at = pos === undefined ? tr.selection.from : tr.mapping.map(pos);
  for (const n of nodes.slice(1)) { tr.insert(at, n); at += n.nodeSize; }
  view.dispatch(tr.scrollIntoView());
}

/** Doc menu: pick picture files and put them at the cursor. */
export const insertPicture: Command = (_state, dispatch, view) => {
  if (!dispatch || !view) return true;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp';
  input.multiple = true;
  input.addEventListener('change', () => { void insertFiles(view, Array.from(input.files ?? [])); });
  input.click();
  return true;
};

const imageFiles = (dt: DataTransfer | null) => Array.from(dt?.files ?? []).filter((f) => /^image\//.test(f.type));

/**
 * A picture with a resize handle on its bottom-right corner. Dragging it scales the picture (it never
 * stretches), shows the size as it goes, and the new size is one undo step. Double-click the handle
 * for the picture's own size, up to the page width.
 */
class ImageView implements NodeView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  /** What the size applies to: the picture, or for a picture Word cropped, the window showing the crop. */
  private box: HTMLElement;
  private clip: HTMLElement | null = null;
  private handle: HTMLElement;
  private label: HTMLElement;
  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    this.dom = document.createElement('span');
    this.dom.className = 'f-img';
    this.img = document.createElement('img');
    this.img.className = 'f-image';
    this.img.draggable = false;
    this.img.addEventListener('error', () => this.dom.classList.add('f-img-broken'));
    this.img.addEventListener('load', () => this.dom.classList.remove('f-img-broken'));
    this.box = this.img;
    this.handle = document.createElement('span');
    this.handle.className = 'f-img-handle';
    this.handle.title = 'Drag to resize (double-click for the picture\'s own size)';
    this.label = document.createElement('span');
    this.label.className = 'f-img-size';
    this.dom.append(this.img, this.handle, this.label);
    this.handle.addEventListener('pointerdown', (e) => this.startResize(e));
    this.handle.addEventListener('dblclick', (e) => { e.preventDefault(); void this.ownSize(); });
    this.render();
  }
  private render() {
    const { src, width, height, alt, crop } = this.node.attrs;
    if (this.img.getAttribute('src') !== src) { this.dom.classList.remove('f-img-broken'); this.img.src = src; }
    this.img.alt = alt;
    const c = crop as { l: number; t: number; r: number; b: number } | null;
    if (c && width && height) {
      // Word's crop: the picture, scaled up, inside a window the size of the cropped picture
      if (!this.clip) { this.clip = document.createElement('span'); this.clip.className = 'f-img-clip'; this.img.replaceWith(this.clip); this.clip.append(this.img); }
      const fx = 1 - c.l - c.r, fy = 1 - c.t - c.b;
      this.box = this.clip;
      this.img.style.width = `${100 / fx}%`;
      this.img.style.maxWidth = 'none';
      this.img.style.aspectRatio = `${width / fx} / ${height / fy}`;
      this.img.style.marginLeft = `${(-c.l / fx) * 100}%`;
      this.img.style.marginTop = `${(-(c.t * height) / fy / width) * 100}%`;
    } else if (this.clip) { this.clip.replaceWith(this.img); this.clip = null; this.img.removeAttribute('style'); }
    this.box = this.clip ?? this.img;
    this.box.style.width = width ? `${width}px` : '';
    this.box.style.aspectRatio = width && height ? `${width} / ${height}` : '';
  }
  private ratio() {
    const { width, height } = this.node.attrs;
    if (width && height) return height / width;
    return this.img.naturalWidth ? this.img.naturalHeight / this.img.naturalWidth : 1;
  }
  private maxWidth() {
    const page = this.view.dom.clientWidth || PAGE_PX;
    // a picture in a table cell stays inside its cell
    const cell = this.dom.closest('td, th') as HTMLElement | null;
    return Math.max(MIN_PX, cell ? cell.clientWidth - 8 : page);
  }
  private commit(w: number) {
    const pos = this.getPos();
    if (pos === undefined) return;
    const width = Math.round(w), height = Math.round(w * this.ratio());
    const tr = this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, width, height });
    this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
  }
  private async ownSize() {
    const own = await naturalSize(this.node.attrs.src);
    const c = this.node.attrs.crop as { l: number; r: number } | null;
    if (own) this.commit(Math.min(own.w * (c ? 1 - c.l - c.r : 1), this.maxWidth()));
  }
  private startResize(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startW = this.box.getBoundingClientRect().width, max = this.maxWidth(), ratio = this.ratio();
    let w = startW;
    this.dom.classList.add('f-img-resizing');
    this.handle.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => {
      w = Math.max(MIN_PX, Math.min(max, startW + ev.clientX - startX));
      this.box.style.width = `${w}px`;
      this.box.style.aspectRatio = `${1} / ${ratio}`;
      this.label.textContent = `${Math.round(w)} × ${Math.round(w * ratio)}`;
    };
    const up = () => {
      this.handle.removeEventListener('pointermove', move);
      this.handle.removeEventListener('pointerup', up);
      this.handle.removeEventListener('pointercancel', up);
      this.dom.classList.remove('f-img-resizing');
      if (Math.round(w) !== Math.round(startW)) this.commit(w);
    };
    this.handle.addEventListener('pointermove', move);
    this.handle.addEventListener('pointerup', up);
    this.handle.addEventListener('pointercancel', up);
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
  stopEvent(e: Event) { return e.target === this.handle; }
  ignoreMutation() { return true; }
}

/**
 * Web pictures in pasted HTML arrive as addresses. Each one is fetched once and embedded, so the saved file
 * carries the picture itself; when a site refuses, the picture stays linked (Word shows linked pictures too).
 */
const needsEmbed = (src: string) => /^https?:/i.test(src) || !WORD_TYPES.test(src);
function embedWebImages(view: EditorView, srcs: readonly string[]) {
  for (const src of srcs) {
    fetch(src).then((r) => (r.ok ? r.blob() : null)).then(async (blob) => {
      if (!blob || !/^image\//.test(blob.type) || view.isDestroyed) return;
      const raw = await readAsDataUrl(blob);
      const size = await naturalSize(raw);
      const data = size && await wordSafe(raw, size);
      if (!data) return;
      const tr = view.state.tr;
      view.state.doc.descendants((n, pos) => {
        if (n.type.name !== 'image' || n.attrs.src !== src) return true;
        const w = n.attrs.width ?? (size ? Math.min(size.w, PAGE_PX) : null);
        tr.setNodeMarkup(pos, null, { ...n.attrs, src: data, width: w, height: n.attrs.height ?? (size && w ? Math.round((w * size.h) / size.w) : null) });
        return false;
      });
      if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false));
    }).catch(() => { /* the picture stays linked */ });
  }
}

/** Pictures: resizable, pasted or dropped as files (screenshots too), web pictures embedded. */
const NONE: readonly string[] = [];
export const imagePlugin = new Plugin<readonly string[]>({
  // the pictures a paste or drop just brought in: only those are fetched, never the ones a file was opened with
  state: {
    init: () => NONE,
    apply: (tr, pending) => {
      // a plugin's follow-up to the paste (the table plugin adding a paragraph after a table) keeps the list for the view
      if (!/^(paste|drop)$/.test(tr.getMeta('uiEvent') ?? '')) return tr.getMeta('appendedTransaction') ? pending : NONE;
      const srcs = new Set<string>();
      for (const step of tr.steps) {
        if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
          step.slice.content.descendants((n) => { if (n.type.name === 'image' && needsEmbed(n.attrs.src)) srcs.add(n.attrs.src); });
        }
      }
      return srcs.size ? [...srcs] : NONE;
    },
  },
  props: {
    nodeViews: { image: (node, view, getPos) => new ImageView(node, view, getPos) },
    handlePaste(view, ev) {
      const files = imageFiles(ev.clipboardData);
      if (!files.length) return false;
      // a copied picture can also carry HTML; when that HTML is only the picture, the file's bytes win
      const html = ev.clipboardData?.getData('text/html') ?? '';
      const text = html ? new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() : '';
      if (text) return false;
      void insertFiles(view, files);
      return true;
    },
    handleDrop(view, ev) {
      const files = imageFiles((ev as DragEvent).dataTransfer);
      if (!files.length) return false;
      ev.preventDefault();
      const hit = view.posAtCoords({ left: (ev as DragEvent).clientX, top: (ev as DragEvent).clientY });
      void insertFiles(view, files, hit?.pos);
      return true;
    },
  },
  view: () => ({
    update: (v, prev) => {
      const srcs = imagePlugin.getState(v.state)!;
      if (srcs.length && srcs !== imagePlugin.getState(prev)) embedWebImages(v, srcs);
    },
  }),
});
