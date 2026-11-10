/**
 * A small, fast XML reader for the parts of a .docx. The browser's DOMParser builds a full DOM, which
 * takes seconds on a 30 MB document.xml; this builds plain objects with just the DOM calls the
 * importer uses (localName, children, getAttribute(NS), textContent, getElementsByTagNameNS), with
 * namespace prefixes resolved the same way.
 */

const XMLNS = 'http://www.w3.org/2000/xmlns/';
type NS = Record<string, string>;

export class XEl {
  readonly children: XEl[] = [];
  /** Direct text, entities decoded (the importer only reads text from leaf elements like <w:t>). */
  text = '';
  constructor(readonly tagName: string, readonly localName: string, readonly attrs: string[], readonly ns: NS) {}

  getAttribute(qname: string): string | null {
    const a = this.attrs;
    for (let i = 0; i < a.length; i += 2) if (a[i] === qname) return a[i + 1];
    return null;
  }

  getAttributeNS(uri: string | null, local: string): string | null {
    const a = this.attrs;
    for (let i = 0; i < a.length; i += 2) {
      const q = a[i], c = q.indexOf(':');
      if (c < 0) { if (q === local && !uri) return a[i + 1]; continue; }
      if (q.length - c - 1 === local.length && q.endsWith(local) && this.ns[q.slice(0, c)] === uri) return a[i + 1];
    }
    return null;
  }

  get textContent(): string {
    if (!this.children.length) return this.text;
    let s = this.text;
    for (const c of this.children) s += c.textContent;
    return s;
  }

  /** Every descendant with this local name (and namespace, unless '*'), in document order. */
  getElementsByTagNameNS(uri: string, local: string): XEl[] {
    const out: XEl[] = [];
    const walk = (el: XEl) => {
      for (const c of el.children) {
        if (c.localName === local && (uri === '*' || c.ns[c.prefix] === uri)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }

  get prefix(): string {
    const c = this.tagName.indexOf(':');
    return c < 0 ? '' : this.tagName.slice(0, c);
  }
}

export type XDoc = { documentElement: XEl };

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENT[e] ?? m;
  });
}

const isSpace = (c: number) => c === 32 || c === 10 || c === 13 || c === 9;

/**
 * Parse XML text into XEl objects. Malformed input throws, like a DOMParser parse error would make the import fail.
 * `onClose` sees each element as it ends, with its open ancestors (the document node first); returning true
 * drops it from its parent. The importer reads the body one block at a time this way, so a big file's
 * element tree never exists all at once: each paragraph's elements die young instead of piling up in the
 * old generation, which is where most of the import's garbage-collection time and peak memory went.
 */
export function parseXml(src: string, onClose?: (el: XEl, parents: readonly XEl[]) => boolean): XDoc {
  const root = new XEl('#document', '#document', [], { xml: 'http://www.w3.org/XML/1998/namespace', xmlns: XMLNS });
  const stack: XEl[] = [root];
  let top = root;
  const n = src.length;
  let i = 0;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i && top !== root) top.text += decode(src.slice(i, lt));
    const c1 = src.charCodeAt(lt + 1);
    if (c1 === 47) { // </name>
      const gt = src.indexOf('>', lt);
      if (gt < 0 || stack.length < 2 || src.slice(lt + 2, gt).trim() !== top.tagName) throw new Error('bad XML');
      const el = stack.pop()!;
      top = stack[stack.length - 1];
      if (onClose?.(el, stack)) top.children.pop();
      i = gt + 1;
      continue;
    }
    if (c1 === 63) { const e = src.indexOf('?>', lt); i = e < 0 ? n : e + 2; continue; } // <?xml ...?>
    if (c1 === 33) { // <!-- -->, <![CDATA[ ]]>, <!DOCTYPE>
      if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt); i = e < 0 ? n : e + 3; continue; }
      if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); const end = e < 0 ? n : e; if (top !== root) top.text += src.slice(lt + 9, end); i = end + 3; continue; }
      const e = src.indexOf('>', lt); i = e < 0 ? n : e + 1; continue;
    }
    // <name attr="v" ...> or <name .../>
    let j = lt + 1;
    while (j < n) { const c = src.charCodeAt(j); if (isSpace(c) || c === 47 || c === 62) break; j++; }
    const tag = src.slice(lt + 1, j);
    const attrs: string[] = [];
    let ns = top.ns, own = false;
    let selfClose = false;
    for (;;) {
      while (j < n && isSpace(src.charCodeAt(j))) j++;
      const c = src.charCodeAt(j);
      if (c === 62) { j++; break; }
      if (c === 47) { selfClose = true; j = src.indexOf('>', j) + 1; break; }
      if (j >= n) throw new Error('bad XML');
      const eq = src.indexOf('=', j);
      const name = src.slice(j, eq).trim();
      let q = eq + 1;
      while (isSpace(src.charCodeAt(q))) q++;
      const quote = src[q];
      const end = src.indexOf(quote, q + 1);
      if (eq < 0 || end < 0 || (quote !== '"' && quote !== "'")) throw new Error('bad XML');
      const value = decode(src.slice(q + 1, end));
      if (name === 'xmlns' || name.startsWith('xmlns:')) {
        if (!own) { ns = Object.create(ns) as NS; own = true; }
        ns[name === 'xmlns' ? '' : name.slice(6)] = value;
      }
      attrs.push(name, value);
      j = end + 1;
    }
    const colon = tag.indexOf(':');
    const el = new XEl(tag, colon < 0 ? tag : tag.slice(colon + 1), attrs, ns);
    top.children.push(el);
    if (!selfClose) { stack.push(el); top = el; }
    else if (onClose?.(el, stack)) top.children.pop();
    i = j;
  }
  const documentElement = root.children[0];
  if (!documentElement || stack.length !== 1) throw new Error('bad XML');
  return { documentElement };
}
