import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// One quick tooltip for every button. Buttons keep writing `title="Name (key): what it does"`;
// on hover the title moves to data-tip (so the slow native tooltip never shows) and this draws it.
const DELAY = 350, WARM = 400;

type Tip = { label: string; key?: string; desc?: string; r: DOMRect };

export function parseTip(t: string): Omit<Tip, 'r'> {
  const m = /^(.*?)(?: \(([^)]+)\))?(?:: (.*))?$/s.exec(t)!;
  return { label: m[1], key: m[2], desc: m[3] };
}

export function Tips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let el: HTMLElement | null = null, timer = 0, hiddenAt = 0;
    const hide = () => {
      clearTimeout(timer);
      if (el) hiddenAt = performance.now();
      el = null;
      setTip(null);
    };
    // the title moves to data-tip, so the slow native tooltip never shows; the label and
    // description stay readable to screen readers
    const harvest = (t: HTMLElement) => {
      const p = parseTip(t.title);
      if (!t.getAttribute('aria-label') && !t.textContent?.trim()) t.setAttribute('aria-label', p.label);
      if (p.desc) t.setAttribute('aria-description', p.desc); else t.removeAttribute('aria-description');
      t.dataset.tip = t.title;
      t.removeAttribute('title');
    };
    const show = (t: HTMLElement) => { if (el === t && t.isConnected) setTip({ ...parseTip(t.dataset.tip!), r: t.getBoundingClientRect() }); };
    const over = (e: PointerEvent) => {
      const t = (e.target as Element).closest?.<HTMLElement>('[title], [data-tip]');
      if (t === el) return;
      hide();
      if (!t || t.closest('.ProseMirror')) return;
      if (t.title) harvest(t);
      el = t;
      // moving straight from one button to the next shows the next one at once
      if (performance.now() - hiddenAt < WARM) show(t); else timer = window.setTimeout(() => show(t), DELAY);
    };
    // React writes a title back when it changes (Bigger's "now 12 pt"): take it again and refresh a
    // showing tip; and a button that goes away takes its tip with it
    const mo = new MutationObserver((ms) => {
      for (const m of ms) if (m.type === 'attributes' && (m.target as HTMLElement).title) {
        const t = m.target as HTMLElement;
        harvest(t);
        if (t === el) setTip((cur) => (cur ? { ...parseTip(t.dataset.tip!), r: t.getBoundingClientRect() } : cur));
      }
      if (el && !el.isConnected) hide();
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
    const leave = (e: PointerEvent) => { if (!e.relatedTarget) hide(); };
    const down = () => { clearTimeout(timer); el = null; hiddenAt = 0; setTip(null); };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', leave);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', down, true);
    addEventListener('blur', hide);
    addEventListener('scroll', hide, true);
    return () => {
      clearTimeout(timer);
      mo.disconnect();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', down, true);
      removeEventListener('blur', hide);
      removeEventListener('scroll', hide, true);
    };
  }, []);
  // under the button, centered, kept inside the window; above it when there's no room below
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d || !tip) return;
    // measure free of the last tip's spot, which would squeeze the width near the window's edge
    d.style.left = '0px'; d.style.top = '0px';
    const { r } = tip, w = d.offsetWidth, h = d.offsetHeight;
    const below = r.bottom + 6 + h <= innerHeight - 8;
    d.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8))}px`;
    d.style.top = `${below ? r.bottom + 6 : r.top - 6 - h}px`;
    d.dataset.from = below ? 'top' : 'bottom';
  }, [tip]);
  if (!tip) return null;
  return (
    <div ref={ref} className="tip" role="tooltip">
      <div className="tip-h"><b>{tip.label}</b>{tip.key && <kbd>{tip.key}</kbd>}</div>
      {tip.desc && <p>{tip.desc}</p>}
    </div>
  );
}
