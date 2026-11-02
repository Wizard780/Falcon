// Home screen effects, ported from the prototype (prototypes/src/kit.js and beam.js).
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
export function clock(el: HTMLElement): () => void {
  el.innerHTML = '<div class="mx" aria-hidden="true"></div><p class="mx-l">Local time</p><span class="sr-only"></span>';
  const mx = el.querySelector('.mx') as HTMLElement, sr = el.querySelector('.sr-only') as HTMLElement;
  let prev = '';
  const tick = () => {
    const d = new Date(), hh = String(d.getHours() % 12 || 12).padStart(2, ' '), mm = String(d.getMinutes()).padStart(2, '0');
    const t = `${hh}:${mm}`;
    if (t === prev) return;
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

// The title is ruled with rows of short hairline dashes, like a line of small print.
// A beam follows the pointer across it; dashes under the beam swell into bars and take the highlighter ink,
// so passing over the word reads as highlighting it.
const NS = 'http://www.w3.org/2000/svg';
const PITCH = 6, HAIR = 1, FULL = 5, SIGMA = 34;
let beamN = 0;
// a small seeded random, so the "words" in each row are the same on every load
const rnd = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
type Dash = { el: SVGRectElement; cx: number; y: number; f: number; drawn?: number };

export function beam(root: HTMLElement, layer: HTMLElement, textEl: HTMLElement): () => void {
  let svg: SVGSVGElement | null = null, dashes: Dash[] = [], raf = 0, last = 0, rt = 0;
  let bx = 0, vx = 0, tx = 0, act = 0, target = 0;
  // an element's box in the layer's own coordinates, from offsets
  function local(el: HTMLElement) {
    let x = 0, y = 0, n: HTMLElement | null = el;
    while (n && n !== layer) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent as HTMLElement | null; }
    return { left: x, top: y, width: el.offsetWidth, height: el.offsetHeight, right: x + el.offsetWidth, bottom: y + el.offsetHeight };
  }
  function build() {
    if (svg) svg.remove();
    dashes = [];
    const w = layer.clientWidth, h = layer.clientHeight;
    if (!w || !h) return;
    const er = local(textEl), cs = getComputedStyle(textEl);
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    textEl.appendChild(probe);
    const base = local(probe).top;
    probe.remove();
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;display:block;overflow:hidden;pointer-events:none;color:var(--texture-ink);fill:currentColor`;
    const id = 'fx-beam-' + (++beamN);
    const cp = document.createElementNS(NS, 'clipPath');
    cp.id = id;
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', String(er.left + parseFloat(cs.paddingLeft)));
    t.setAttribute('y', String(base));
    t.style.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    t.style.letterSpacing = cs.letterSpacing;
    t.textContent = textEl.textContent;
    cp.appendChild(t);
    svg.appendChild(cp);
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('clip-path', `url(#${id})`);
    svg.appendChild(g);
    const r = rnd(7);
    for (let y = er.top + PITCH / 2; y < er.bottom; y += PITCH) {
      let x = er.left - r() * 24;
      while (x < er.right) {
        const len = 6 + Math.floor(r() * 30);
        const el = document.createElementNS(NS, 'rect');
        el.setAttribute('x', x.toFixed(1));
        el.setAttribute('width', String(len));
        el.setAttribute('rx', '0.6');
        g.appendChild(el);
        dashes.push({ el, cx: x + len / 2, y, f: -1 });
        x += len + 3 + Math.floor(r() * 3);
      }
    }
    layer.appendChild(svg);
    paint(0);
  }
  // each dash inks fast when the beam reaches it and dries slowly after, so a sweep leaves a short trail
  const ATTACK = 26, RELEASE = 5;
  let by = 0, sweep: { t0: number; dur: number; x0: number; x1: number; y: number } | null = null;
  function paint(dt: number) {
    let busy = false;
    const speed = Math.min(1.6, Math.abs(vx) / 700), dir = Math.sign(vx);
    for (const d of dashes) {
      const dx = d.cx - bx;
      const trailing = dir !== 0 && Math.sign(dx) === -dir;
      const sg = SIGMA * (trailing ? 1 + speed : 1 - 0.25 * speed);
      const dy = d.y - by;
      const gy = 0.55 + 0.45 * Math.exp(-(dy * dy) / (2 * 46 * 46));
      const goal = Math.exp(-(dx * dx) / (2 * sg * sg)) * gy * act;
      const prev = d.f < 0 ? 0 : d.f;
      const rate = goal > prev ? ATTACK : RELEASE;
      let f = dt === 0 ? goal : prev + (goal - prev) * (1 - Math.exp(-rate * dt));
      if (Math.abs(goal - f) < 0.004) f = goal; else busy = true;
      const drawn = d.drawn ?? -1;
      d.f = f;
      if (drawn >= 0 && Math.abs(f - drawn) < 0.003 && !(f === 0 && drawn !== 0)) continue;
      d.drawn = f;
      const hgt = HAIR + (FULL - HAIR) * f;
      d.el.setAttribute('y', (d.y - hgt / 2).toFixed(2));
      d.el.setAttribute('height', hgt.toFixed(2));
      d.el.style.fill = f < 0.02 ? '' : `color-mix(in srgb, var(--texture-hot) ${Math.round(Math.min(1, f * 1.5) * 100)}%, var(--texture-ink))`;
    }
    return busy;
  }
  // the beam trails the pointer on a critically damped spring and fades in and out with hover
  function tick(now: number) {
    const dt = Math.min(last ? (now - last) / 1000 : 1 / 60, 1 / 30);
    last = now;
    if (sweep) {
      const t = Math.max(0, Math.min(1, (now - sweep.t0) / sweep.dur)), e = 1 - Math.pow(1 - t, 3);
      tx = sweep.x0 + (sweep.x1 - sweep.x0) * e; by = sweep.y;
      target = t < 0.82 ? 1 : 0;
      if (t >= 1) sweep = null;
    }
    if (reduced()) { bx = tx; act = target; vx = 0; }
    else {
      const k = 260, c = 2 * Math.sqrt(k);
      vx += (k * (tx - bx) - c * vx) * dt;
      bx += vx * dt;
      act += (target - act) * (1 - Math.exp(-(target > act ? 14 : 8) * dt));
    }
    const busy = paint(reduced() ? 0 : dt);
    if (sweep || busy || Math.abs(tx - bx) > 0.3 || Math.abs(vx) > 1 || Math.abs(target - act) > 0.005) raf = requestAnimationFrame(tick);
    else { raf = 0; last = 0; }
  }
  const wake = () => { if (!raf) raf = requestAnimationFrame(tick); };
  const onMove = (e: PointerEvent) => {
    const box = layer.getBoundingClientRect();
    const lr = local(textEl), er = { left: box.left + lr.left, right: box.left + lr.right, top: box.top + lr.top, bottom: box.top + lr.bottom };
    const over = e.clientY > er.top - 24 && e.clientY < er.bottom + 24 && e.clientX > er.left - 48 && e.clientX < er.right + 48;
    const x = e.clientX - box.left;
    if (over) sweep = null;
    if (over && act < 0.02) { bx = x; vx = 0; }
    tx = x;
    by = e.clientY - box.top;
    if (!sweep) target = over ? 1 : 0;
    wake();
  };
  const onLeave = () => { if (!sweep) { target = 0; wake(); } };
  const onResize = () => { clearTimeout(rt); rt = window.setTimeout(build, 120); };
  root.addEventListener('pointermove', onMove, { passive: true });
  root.addEventListener('pointerleave', onLeave);
  addEventListener('resize', onResize);
  build();
  // one pass across the word when home opens
  if (!reduced() && dashes.length) {
    const er = local(textEl);
    bx = tx = er.left - 40; vx = 0;
    sweep = { t0: performance.now() + 220, dur: 1100, x0: er.left - 40, x1: er.right + 40, y: er.top + er.height * 0.55 };
    wake();
  }
  return () => {
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerleave', onLeave);
    removeEventListener('resize', onResize);
    cancelAnimationFrame(raf);
    clearTimeout(rt);
    if (svg) svg.remove();
  };
}
