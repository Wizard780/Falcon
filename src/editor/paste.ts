import { HIGHLIGHTS } from './schema';
import { P, pref } from './prefs';

const toHex = (c: string): string | null => {
  const m = c.trim().match(/^#([0-9a-f]{6})$/i);
  if (m) return `#${m[1].toUpperCase()}`;
  const rgb = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  return rgb ? `#${[rgb[1], rgb[2], rgb[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase()}` : null;
};
const HL_BY_HEX: Record<string, string> = Object.fromEntries(Object.entries(HIGHLIGHTS).map(([k, v]) => [v.toLowerCase(), k]));

/**
 * Turn clipboard HTML (Word, Verbatim, the web) into HTML Falcon's schema understands:
 * Verbatim character styles become cite/underline/emphasis, highlight colors map to Word's names,
 * and everything else (fonts, colors from web pages, classes) is dropped. With smart paste off in
 * Settings, Word's styles aren't converted: only bold, italic and the paragraphs come through.
 */
export function cleanPastedHTML(html: string, smart = pref(P.smartPaste)): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style, meta, link, script, title, xml').forEach((n) => n.remove());
  const fromWord = smart && /urn:schemas-microsoft-com|mso-/.test(html);
  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>('*'))) {
    const cls = (el.getAttribute('class') ?? '').toLowerCase();
    const style = (el.getAttribute('style') ?? '').toLowerCase();
    // our own classes round-trip untouched (copy/paste inside Falcon)
    if (/\bf-/.test(cls)) continue;
    if (el.tagName === 'SPAN' || el.tagName === 'FONT' || el.tagName === 'A') {
      if (fromWord) {
        if (cls.includes('emphasis')) { el.className = 'f-emphasis'; }
        else if (cls.includes('underline')) { el.className = 'f-underline'; }
        else if (cls.includes('cite') || cls.includes('13pt')) { el.className = 'f-cite'; }
      }
      const hl = style.match(/(?:mso-highlight|background(?:-color)?):\s*([#\w]+)/);
      if (hl) {
        const v = hl[1].toLowerCase();
        const name = HL_BY_HEX[v] ?? Object.keys(HIGHLIGHTS).find((k) => k.toLowerCase() === v);
        if (name && fromWord) {
          const wrap = doc.createElement('span');
          wrap.className = 'f-highlight';
          wrap.dataset.color = name;
          el.replaceWith(wrap);
          wrap.append(el);
        }
      }
      const keep = [] as string[];
      if (/text-decoration[^;]*underline/.test(style) && fromWord) keep.push('text-decoration:underline');
      if (/font-weight:\s*(bold|700)/.test(style)) keep.push('font-weight:bold');
      if (/font-style:\s*italic/.test(style)) keep.push('font-style:italic');
      keep.length ? el.setAttribute('style', keep.join(';')) : el.removeAttribute('style');
      if (!el.className.startsWith('f-')) el.removeAttribute('class');
    } else if (el.tagName === 'TD' || el.tagName === 'TH') {
      // a pasted table keeps its cell shading and column widths (spans are attributes, which stay)
      const bg = el.getAttribute('bgcolor') ?? style.match(/background(?:-color)?:\s*(#[0-9a-f]{6}|rgb\([^)]*\))/)?.[1];
      const hexBg = bg && toHex(bg);
      if (hexBg && hexBg !== '#FFFFFF') el.dataset.bg = hexBg;
      const w = Number(el.getAttribute('width')) || Number(style.match(/(?:^|;)\s*width:\s*([\d.]+)px/)?.[1]) || Number(style.match(/(?:^|;)\s*width:\s*([\d.]+)pt/)?.[1]) * 96 / 72;
      if (w > 0 && !el.dataset.colwidth && (Number(el.getAttribute('colspan')) || 1) === 1) el.dataset.colwidth = String(Math.round(w));
      el.removeAttribute('style');
      el.removeAttribute('class');
    } else if (el.tagName === 'IMG') {
      // a picture keeps the size it had where it was copied from
      for (const k of ['width', 'height'] as const) {
        const px = Number(style.match(new RegExp(`(?:^|;)\\s*${k}:\\s*([\\d.]+)px`))?.[1]);
        if (px > 0 && !el.getAttribute(k)) el.setAttribute(k, String(Math.round(px)));
      }
      el.removeAttribute('style');
      el.removeAttribute('class');
    } else if (!/^(H[1-6]|P|B|STRONG|I|EM|U|BR|SUP|SUB|S|DEL)$/.test(el.tagName)) {
      el.removeAttribute('style');
      el.removeAttribute('class');
    } else {
      el.removeAttribute('style');
      el.removeAttribute('class');
    }
  }
  return doc.body.innerHTML;
}
