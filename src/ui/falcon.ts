// The falcon on Home: a flat silhouette in the app icon's style (the icon's head on a body with two swept wings)
// sweeps in over Home when Falcon starts: up from the bottom left, round the top, then back across the title
// dropping the letters of "Falcon" into place before it settles left of them as the logo. Home itself doesn't
// move. Any key or click lands it at once. Landed, it holds still, so Home costs no CPU while it sits open.

const NS = 'http://www.w3.org/2000/svg';
const f1 = (n: number) => Math.round(n * 10) / 10;

// the app icon's head (logo/build-brand.mjs HEAD, with its eye hole): the bird's head is the logo itself
const HEAD = 'M12 57V36A24 24 0 0 1 36 12H42C50.5 12 56 18 56 26C56 30.5 54 33.5 50.5 35.5C51 31.5 49 29 45.5 29H41C37 29 34.5 32 34.5 36V57ZM39 17.5A3.5 3.5 0 1 0 39 24.5A3.5 3.5 0 1 0 39 17.5Z';
const EYE = { x: 39, y: 21 }; // in the logo's own units (viewBox 10 9 48 50)
// the body runs back from the neck's base (x 12, y 40 to 57) into a tail; the wings hang off the shoulder
const BODY = 'M36 57C24 63,4 64,-18 60C-44 56,-66 58,-88 68L-82 57L-88 46C-66 48,-48 42,-28 37C-14 34,0 33,12 36Z';
const WING = 'M0 0C6 -8,10 -30,4 -64C0 -86,-8 -104,-24 -116C-30 -100,-32 -74,-28 -48C-26 -28,-20 -12,-12 2Z';
const SHOULDER = { x: -14, y: 44 };
// the bird's box in icon units, so the eye can be the point the flight moves
const BOX = { x: -170, y: -140, w: 240, h: 200 };

/** The bird's SVG. Wings are <g data-wing="near|far"> so the animation can beat them; the head is the logo. */
export function falconSvg(): string {
  return `<svg class="falcon-bird" viewBox="${BOX.x} ${BOX.y} ${BOX.w} ${BOX.h}" xmlns="${NS}" aria-hidden="true" focusable="false">
<g transform="translate(${-EYE.x} ${-EYE.y})">
  <g data-wing="far"><path d="${WING}" fill="var(--falcon-far, #8a8a92)"/></g>
  <path data-body d="${BODY}" fill="var(--falcon-ink, #f4f4f6)"/>
  <path data-head d="${HEAD}" fill="var(--falcon-ink, #f4f4f6)" fill-rule="evenodd"/>
  <g data-wing="near"><path d="${WING}" fill="var(--falcon-ink, #f4f4f6)"/></g>
</g>
</svg>`;
}

/** The logo on its perch: the icon's head, flat, as the rail draws it. */
export function logoSvg(): string {
  return `<svg class="falcon-logo" viewBox="10 9 48 50" xmlns="${NS}" aria-hidden="true" focusable="false"><path d="${HEAD}" fill="var(--falcon-ink, #f4f4f6)" fill-rule="evenodd"/></svg>`;
}

type Pt = { x: number; y: number; s: number };
/** A Catmull-Rom spline through `p`, sampled evenly along its length: `at(k)` for k in 0..1. */
function spline(p: Pt[]) {
  const seg = (i: number, t: number): Pt => {
    const a = p[Math.max(0, i - 1)], b = p[i], c = p[Math.min(p.length - 1, i + 1)], d = p[Math.min(p.length - 1, i + 2)];
    const t2 = t * t, t3 = t2 * t;
    const cr = (k: 'x' | 'y' | 's') => 0.5 * (2 * b[k] + (-a[k] + c[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3);
    return { x: cr('x'), y: cr('y'), s: cr('s') };
  };
  const pts: Pt[] = [], len: number[] = [0];
  for (let i = 0; i < p.length - 1; i++) for (let j = 0; j < 40; j++) {
    const q = seg(i, j / 40);
    if (pts.length) { const o = pts[pts.length - 1]; len.push(len[len.length - 1] + Math.hypot(q.x - o.x, q.y - o.y)); }
    pts.push(q);
  }
  pts.push(p[p.length - 1]);
  { const o = pts[pts.length - 2], q = p[p.length - 1]; len.push(len[len.length - 1] + Math.hypot(q.x - o.x, q.y - o.y)); }
  const total = len[len.length - 1];
  return (k: number): Pt => {
    const want = Math.min(1, Math.max(0, k)) * total;
    let lo = 0, hi = len.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (len[mid] <= want) lo = mid; else hi = mid; }
    const span = len[hi] - len[lo] || 1, t = (want - len[lo]) / span, a = pts[lo], b = pts[hi];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, s: a.s + (b.s - a.s) * t };
  };
}

/**
 * Fly the bird in over `home`, drop the letters of `title` into place, and land it in `perch`. With `fly` false
 * (reduced motion, or the setting off) it just appears perched with the title as it is. Returns a stop function.
 */
export function launchFalcon(home: HTMLElement, perch: HTMLElement, title: HTMLElement, fly: boolean): () => void {
  perch.innerHTML = logoSvg();
  const logo = perch.firstElementChild as SVGSVGElement;
  if (!fly) return () => { logo.remove(); };
  logo.style.opacity = '0';
  const letters = Array.from(title.querySelectorAll<HTMLElement>('.hm-ch'));
  for (const l of letters) l.style.opacity = '0';
  const shown = new Set<HTMLElement>();
  const settle = (l: HTMLElement, fromY: number) => {
    shown.add(l);
    const dy = fromY - l.getBoundingClientRect().top;
    l.style.transition = 'none';
    l.style.top = `${f1(Math.min(0, dy))}px`;
    l.style.opacity = '1';
    requestAnimationFrame(() => {
      l.style.transition = 'top 560ms cubic-bezier(.3,1.5,.5,1)';
      l.style.top = '0px';
    });
  };
  const show = () => { for (const l of letters) l.style.transition = l.style.top = l.style.opacity = ''; };

  const host = document.createElement('div');
  host.innerHTML = falconSvg();
  const svg = host.firstElementChild as SVGSVGElement;
  const near = svg.querySelector<SVGGElement>('[data-wing="near"]')!, far = svg.querySelector<SVGGElement>('[data-wing="far"]')!;
  const body = svg.querySelector<SVGPathElement>('[data-body]')!;
  const wings = (deg: number, lag: number) => {
    near.setAttribute('transform', `translate(${SHOULDER.x} ${SHOULDER.y}) rotate(${f1(deg)})`);
    far.setAttribute('transform', `translate(${SHOULDER.x + 4} ${SHOULDER.y - 4}) rotate(${f1(lag)})`);
  };

  // in flight the bird rides an overlay over all of Home, so nothing under it moves
  const layer = document.createElement('div');
  layer.className = 'falcon-flight';
  const trail = document.createElement('canvas');
  layer.append(trail, svg);
  home.appendChild(layer);
  const W = home.clientWidth, H = home.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
  trail.width = W * dpr; trail.height = H * dpr;
  const tc = trail.getContext('2d');
  tc?.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ink = getComputedStyle(home).getPropertyValue('--ink').trim() || '#00e5ff';
  svg.style.cssText = `position:absolute;left:0;top:0;width:${BOX.w}px;height:${BOX.h}px;transform-origin:${-BOX.x}px ${-BOX.y}px;will-change:transform`;

  const DUR = 2700, END = 3300; // the flight, then the last letters settling after it
  const smooth = (v: number) => { const c = Math.min(1, Math.max(0, v)); return c * c * (3 - 2 * c); };
  // it lands with its eye on the logo's eye, its head the size of the logo's
  const home0 = () => home.getBoundingClientRect();
  const goal = () => {
    const h = home0(), p = perch.getBoundingClientRect(), u = p.width / 48;
    return { x: p.left - h.left + (EYE.x - 10) * u, y: p.top - h.top + (EYE.y - 9) * u, s: u };
  };
  // the route: in from the bottom left, up through the list, round the top, then back left across the title
  const route = () => {
    const h = home0(), t = title.getBoundingClientRect(), g = goal();
    const top = t.top - h.top, left = t.left - h.left, right = t.right - h.left;
    return spline([
      { x: -W * 0.08, y: H * 1.1, s: 2.2 },
      { x: W * 0.22, y: H * 0.8, s: 2.8 },
      { x: W * 0.5, y: H * 0.48, s: 2.3 },
      { x: Math.max(W * 0.62, right + 260), y: H * 0.16, s: 1.7 },
      { x: Math.max(W * 0.5, right + 120), y: top - 100, s: 1.4 },
      { x: (left + right) / 2, y: top - 54, s: 1.3 },
      { x: g.x, y: g.y, s: g.s },
    ]);
  };
  let path = route();
  // fast as it comes in, easing all the way down to a soft landing
  const travel = (t: number) => 1 - Math.pow(1 - t, 1.7);
  let t0 = 0, last = 0, phase = 0, bank = 0, face = 1, skip = false, px = 0;
  const pts: { x: number; y: number; t: number }[] = [];
  const step = (now: number) => {
    if (!t0) t0 = last = now;
    const t = skip ? END : Math.min(END, now - t0), dt = Math.min(50, now - last) / 1000;
    last = now;
    const k = Math.min(1, t / DUR), e = travel(k);
    if (t === 0 || (k < 1 && dt > 0.04)) path = route(); // a resize mid-flight: keep aiming at the perch
    const { x, y, s } = path(e);
    const ahead = path(travel(Math.min(1, k + 0.015)));
    const dx = ahead.x - x || px, dy = ahead.y - y;
    // it faces the way it flies; over the last stretch it comes round to face right, the way the logo looks
    const turn = smooth((k - 0.86) / 0.12);
    face += ((dx < 0 ? -1 + 2 * turn : 1) - face) * Math.min(1, dt * 14);
    const facing = skip ? 1 : face;
    const heading = (Math.atan2(dy, Math.abs(dx) || 1) * 180) / Math.PI * (dx < 0 ? -1 : 1);
    const level = Math.min(1, Math.max(0, (k - 0.8) / 0.2));
    bank += (Math.max(-32, Math.min(32, heading)) * (1 - level) - bank) * Math.min(1, dt * 8);
    px = dx;
    // wingbeats slow into a glide past the top, then it flares, wings up, to settle
    const glide = smooth((k - 0.5) / 0.3), rate = 3.2 * (1 - glide) + 0.6;
    phase += 2 * Math.PI * rate * dt;
    const amp = 46 * (1 - glide) + 10 * glide;
    const flare = smooth((k - 0.84) / 0.14);
    wings((amp * Math.sin(phase) - 4) * (1 - flare) - 40 * flare, (amp * Math.sin(phase - 0.6) - 4) * (1 - flare) - 48 * flare);
    // one continuous hand-off: body and wings dissolve as it settles, the head is already the logo
    const rest = String(1 - smooth((k - 0.9) / 0.1));
    near.style.opacity = far.style.opacity = body.style.opacity = rest;
    svg.style.transform = `translate(${f1(x + BOX.x)}px,${f1(y + BOX.y)}px) scale(${(s * facing).toFixed(4)},${s.toFixed(4)}) rotate(${f1(bank * facing)}deg)`;
    // flying left over the title, each letter drops out behind it as it clears the letter's middle
    const tailX = x + 110 * s, tailY = y + 34 * s;
    if (dx < 0 && k > 0.6) {
      const h = home0(), vent = x + 36 * s;
      for (const l of letters) {
        if (shown.has(l)) continue;
        const r = l.getBoundingClientRect();
        if (vent < r.left - h.left + r.width * 0.5) settle(l, tailY + h.top);
      }
    }
    if (tc) {
      tc.clearRect(0, 0, W, H);
      pts.push({ x: tailX, y: tailY, t });
      while (pts.length && t - pts[0].t > 320) pts.shift();
      tc.strokeStyle = ink; tc.lineCap = 'round';
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], age = 1 - (t - b.t) / 320;
        tc.globalAlpha = 0.5 * age * (1 - level); tc.lineWidth = 2.4 * age * s;
        tc.beginPath(); tc.moveTo(a.x, a.y); tc.lineTo(b.x, b.y); tc.stroke();
      }
      tc.globalAlpha = 1;
    }
    if (t < END) { raf = requestAnimationFrame(step); return; }
    off();
    layer.remove();
    logo.style.opacity = '';
    show();
  };
  let raf = requestAnimationFrame(step);
  const land = () => { skip = true; };
  const off = () => { removeEventListener('keydown', land, true); removeEventListener('pointerdown', land, true); };
  addEventListener('keydown', land, true);
  addEventListener('pointerdown', land, true);
  return () => { cancelAnimationFrame(raf); off(); layer.remove(); logo.remove(); show(); };
}
