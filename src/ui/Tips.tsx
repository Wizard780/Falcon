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
    const over = (e: PointerEvent) => {
      const t = (e.target as Element).closest?.<HTMLElement>('[title], [data-tip]');
      if (t === el) return;
      hide();
      if (!t || t.closest('.ProseMirror')) return;
      if (t.title) {
        // an icon button named only by its title keeps that name for screen readers
        if (!t.getAttribute('aria-label') && !t.textContent?.trim()) t.setAttribute('aria-label', parseTip(t.title).label);
        t.dataset.tip = t.title;
        t.removeAttribute('title');
      }
      el = t;
      const show = () => { if (el === t && t.isConnected) setTip({ ...parseTip(t.dataset.tip!), r: t.getBoundingClientRect() }); };
      // moving straight from one button to the next shows the next one at once
      if (performance.now() - hiddenAt < WARM) show(); else timer = window.setTimeout(show, DELAY);
    };
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
