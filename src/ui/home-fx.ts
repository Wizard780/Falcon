// Home screen effects, ported from the prototype (prototypes/src/kit.js).
// Dot Field and the matrix clock are adapted from EasyUI (https://easyui.site, MIT, Suraj Maurya).

import { onPrefs } from '../editor/prefs';
import { reducedMotion as reduced } from './motion';


/** A still canvas grid of dots that fades along a diagonal. Returns a stop function. */
export function dots(host: HTMLElement): () => void {
  const c = document.createElement('canvas');
  c.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;pointer-events:none';
  host.appendChild(c);
  const draw = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 2), ctx = c.getContext('2d')!;
    c.width = Math.floor(w * dpr); c.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    // the theme's text color (a canvas can't read CSS variables), faded from 10% to 3% along the diagonal
    const tx = getComputedStyle(document.documentElement).getPropertyValue('--u-tx').trim();
    const [r0, g0, b0] = /^#[0-9a-f]{6}$/i.test(tx) ? [1, 3, 5].map((i) => parseInt(tx.slice(i, i + 2), 16)) : [237, 237, 237];
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `rgba(${r0},${g0},${b0},0.10)`); g.addColorStop(1, `rgba(${r0},${g0},${b0},0.03)`);
    ctx.fillStyle = g;
    const r = 1.5, step = r + 14, cols = Math.floor(w / step), rows = Math.floor(h / step);
    const px = (w % step) / 2, py = (h % step) / 2;
    ctx.beginPath();
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const ax = px + x * step + step / 2, ay = py + y * step + step / 2;
      ctx.moveTo(ax + r / 2, ay); ctx.arc(ax, ay, r / 2, 0, Math.PI * 2);
    }
    ctx.fill();
  };
  draw();
  const ro = new ResizeObserver(draw);
  ro.observe(host);
  const off = onPrefs(draw); // a new theme: redraw in its text color (theme.ts applied it first, on the same event)
  return () => { ro.disconnect(); off(); c.remove(); };
}

// each character is a 5x7 dot glyph; the unlit dots stay faintly visible
const G: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'], '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'], ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
const R = 0.34;
const path = (ch: string | null) => [...Array(35).keys()].map((i) => ({ x: i % 5, y: Math.floor(i / 5) }))
  .filter(({ x, y }) => ch === null || G[ch][y][x] === '1')
  .map(({ x, y }) => `M${x - R},${y}a${R},${R} 0 1,0 ${R * 2},0a${R},${R} 0 1,0 ${-R * 2},0`).join('');
const OFF = path(null), ON = Object.fromEntries(Object.keys(G).map((k) => [k, path(k)]));
const glyph = (ch: string) => `<svg viewBox="-0.5 -0.5 5 7" aria-hidden="true"><path d="${OFF}" class="off"/><path d="${ON[ch] || ON[' ']}" class="on"/></svg>`;

/** The airport matrix clock: changed characters roll up into place. Returns a stop function. */
/** Good morning until noon, afternoon until 5, evening after that. */
export const greeting = (h: number) => (h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening');

export function clock(el: HTMLElement): () => void {
  el.innerHTML = '<p class="hm-greet"></p><p class="hm-date"></p><div class="mx" aria-hidden="true"></div><p class="mx-l">Local time</p><span class="sr-only"></span>';
  const mx = el.querySelector('.mx') as HTMLElement, sr = el.querySelector('.sr-only') as HTMLElement;
  const greet = el.querySelector('.hm-greet') as HTMLElement, date = el.querySelector('.hm-date') as HTMLElement;
  let prev = '', day = '';
  const tick = () => {
    const d = new Date(), hh = String(d.getHours() % 12 || 12).padStart(2, ' '), mm = String(d.getMinutes()).padStart(2, '0');
    const t = `${hh}:${mm}`;
    if (t === prev) return;
    // the greeting and the date sit over the digits and roll with them (at noon, at five, at midnight)
    greet.textContent = greeting(d.getHours());
    const today = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    if (today !== day) { day = today; date.textContent = `It\u2019s ${today}`; }
    sr.textContent = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (!prev) mx.innerHTML = [...t].map((ch) => `<span class="mx-c">${glyph(ch)}</span>`).join('');
    else [...t].forEach((ch, i) => {
      if (ch === prev[i]) return;
      const cell = mx.children[i] as HTMLElement, old = cell.firstElementChild as SVGElement;
      cell.insertAdjacentHTML('beforeend', glyph(ch));
      const nu = cell.lastElementChild as SVGElement;
      if (reduced()) { old.remove(); return; }
      const o: KeyframeAnimationOptions = { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' };
      old.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-72%)', opacity: 0 }], o).finished.then(() => old.remove());
      nu.animate([{ transform: 'translateY(72%)', opacity: 0.45 }, { transform: 'translateY(0)', opacity: 1 }], o);
    });
    prev = t;
  };
  tick();
  const t = window.setInterval(tick, 1000);
  return () => clearInterval(t);
}
