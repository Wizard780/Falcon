import { HIGHLIGHTS } from './schema';
import { P, pref } from './prefs';

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
