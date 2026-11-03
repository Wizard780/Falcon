// The falcon on Home: drawn feather by feather, it sweeps in over Home when Falcon starts and perches in the
// empty strip above the date. Home itself doesn't move. Any key or click lands it at once. Perched, it holds
// still, so Home costs no CPU while it sits open.

const NS = 'http://www.w3.org/2000/svg';
const f1 = (n: number) => Math.round(n * 10) / 10;

/** One feather from its base, pointing at `deg`: a long vane that ends in a point or a rounded tip. */
function feather(x: number, y: number, deg: number, len: number, w: number, round = false): string {
  const a = (deg * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
  const at = (along: number, side: number) => `${f1(x + dx * len * along + nx * w * side)} ${f1(y + dy * len * along + ny * w * side)}`;
  const tip = round ? at(1, 0) : at(1.04, 0);
  const near = round ? 0.97 : 0.8;
  return `M${at(0, 0.5)}C${at(0.45, 0.62)},${at(near, round ? 0.5 : 0.36)},${tip}C${at(near, round ? -0.5 : -0.36)},${at(0.45, -0.62)},${at(0, -0.5)}Z`;
}
const shaft = (x: number, y: number, deg: number, len: number) => {
  const a = (deg * Math.PI) / 180;
  return `M${f1(x)} ${f1(y)}L${f1(x + Math.cos(a) * len * 0.9)} ${f1(y + Math.sin(a) * len * 0.9)}`;
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Tone = { lead: string; cov: string; sec: string; pri: string; tip: string; edge: string; shaft: string };
/** A wing in its own space: the shoulder at 0,0, raised up and back toward -104,-156. */
function wing(t: Tone): string {
  let out = '';
  const path = (d: string, fill: string, extra = '') => { out += `<path d="${d}" fill="${fill}"${extra}/>`; };
  const edge = ` stroke="${t.edge}" stroke-width=".7" stroke-linejoin="round"`;
  // secondaries along the arm, pointing back; inner first so the outer ones lie on top
  for (let i = 7; i >= 0; i--) {
    const k = i / 7, x = lerp(-6, -52, k), y = lerp(-6, -86, k);
    path(feather(x, y, lerp(150, 140, k), lerp(42, 36, k), 15, true), t.sec, edge);
    out += `<path d="${shaft(x, y, lerp(150, 140, k), lerp(42, 36, k))}" stroke="${t.shaft}" stroke-width=".6" fill="none"/>`;
  }
  // primaries fan out from the hand to the wingtip, longest on the leading edge
  for (let i = 6; i >= 0; i--) {
    const k = i / 6, x = lerp(-50, -60, k), y = lerp(-84, -106, k);
    const deg = lerp(-170, -126, k), len = lerp(44, 74, k);
    path(feather(x, y, deg, len, 13), i === 6 ? t.tip : t.pri, edge);
    out += `<path d="${shaft(x, y, deg, len)}" stroke="${t.shaft}" stroke-width=".6" fill="none"/>`;
  }
  // greater and median coverts: two rows of short rounded feathers over the flight feathers' bases
  for (const [row, len, fill, off] of [[0, 20, t.cov, 0], [1, 13, t.lead, 7]] as const) {
    for (let i = 6; i >= 0; i--) {
      const k = i / 6, x = lerp(-2 + off * 0.7, -46 + off * 0.5, k), y = lerp(-6 - off * 0.8, -80 - off * 0.3, k);
      path(feather(x, y, lerp(150, 140, k), len - row * k * 2, 11, true), fill, edge);
    }
  }
  // the arm: lesser coverts as one band along the leading edge, over the coverts' bases
  path('M10 2C9 -26,-16 -76,-62 -112C-58 -96,-50 -84,-44 -76C-32 -58,-18 -34,-4 -10C-2 -4,-1 0,-2 6Z', t.lead);
  return out;
}

const NEAR: Tone = { lead: '#f3f3f5', cov: '#dcdce0', sec: '#bfbfc5', pri: '#93939a', tip: '#6b6b72', edge: '#0f0f10', shaft: '#e9e9ec' };
const FAR: Tone = { lead: '#7c7c83', cov: '#6c6c73', sec: '#5c5c63', pri: '#4a4a51', tip: '#38383e', edge: '#0f0f10', shaft: '#86868c' };

let markup = '';
/** The bird's SVG, built once. Wings are <g data-wing="near|far"> so the animation can beat them. */
export function falconSvg(): string {
  if (markup) return markup;
  let tail = '';
  for (const i of [0, 4, 1, 3, 2]) {
    const y = 117 + (i - 2) * 2.6, deg = 180 + (i - 2) * 7, len = 74 - Math.abs(i - 2) * 3;
    tail += `<path d="${feather(170, y, deg, len, 17, true)}" fill="${['#bcbcc2', '#cdcdd2', '#dedee2'][Math.abs(i - 2)]}" stroke="#0f0f10" stroke-width=".7"/>`;
  }
  const bars = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const x = 196 + (i % 4) * 18 + (i > 3 ? 9 : 0), y = i > 3 ? 131 : 123;
    return `<path d="M${x - 5} ${y}q5 4 10 0" stroke="#8d8d94" stroke-width="1.3" fill="none" stroke-linecap="round" opacity=".75"/>`;
  }).join('');
  markup = `<svg class="falcon-bird" viewBox="0 0 400 220" xmlns="${NS}" aria-hidden="true" focusable="false">
<defs>
  <linearGradient id="fb-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f6f8"/><stop offset=".6" stop-color="#e6e6ea"/><stop offset="1" stop-color="#bdbdc3"/></linearGradient>
  <linearGradient id="fb-hood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5e5e66"/><stop offset="1" stop-color="#2f2f35"/></linearGradient>
  <linearGradient id="fb-beak" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a4a52"/><stop offset="1" stop-color="#1c1c20"/></linearGradient>
</defs>
<g transform="translate(0 40)">
  <g data-wing="far"><g transform="scale(.9)">${wing(FAR)}</g></g>
  ${tail}
  <path d="M160 114C178 96,236 84,282 88C304 90,318 102,318 116C316 130,298 142,266 144C226 146,190 136,160 122Z" fill="url(#fb-body)" stroke="#0f0f10" stroke-width=".8"/>
  ${bars}
  <path d="M286 112c4 6 3 12 -2 17M296 108c5 7 4 14 -1 20" stroke="#a3a3a9" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".7"/>
  <g data-head>
    <path d="M284 98C288 80,304 70,320 70C334 70,344 78,347 88C353 90,358 95,359 101C353 102,349 106,346 110C340 117,330 120,318 120C304 120,290 112,284 102Z" fill="#f4f4f6" stroke="#0f0f10" stroke-width=".8"/>
    <path d="M284 98C288 80,304 70,320 70C331 70,340 75,344 82C336 80,328 80,322 82C311 86,299 93,292 105C289 103,286 101,284 98Z" fill="url(#fb-hood)"/>
    <path d="M327 91C322 99,321 109,318 120C311 112,311 100,317 92C320 89,324 89,327 91Z" fill="url(#fb-hood)"/>
    <path d="M296 80c-4 4 -6 9 -7 14M305 75c-5 5 -8 10 -9 16" stroke="#24242a" stroke-width="1.1" fill="none" opacity=".55"/>
    <path d="M323 80C329 77,337 78,341 82" stroke="#24242a" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M343 82C355 82,362 90,362 102C362 106,360 109,357 111C356 106,353 103,349 103L346 104C346 96,345 88,343 82Z" fill="url(#fb-beak)"/>
    <path d="M341 81C345 79,349 81,350 85C347 86,343 85,341 83Z" fill="var(--ink)"/>
    <path d="M356 92c2 3 3 7 2 12" stroke="#6a6a72" stroke-width=".8" fill="none"/>
    <circle cx="349" cy="88" r=".9" fill="#0f0f10"/>
    <circle cx="333" cy="88" r="6.8" fill="var(--ink)"/>
    <circle cx="333" cy="88" r="4.7" fill="#0f0f10"/>
    <circle cx="334.7" cy="86.3" r="1.4" fill="#f4f4f6"/>
  </g>
  <g data-wing="near">${wing(NEAR)}</g>
</g>
</svg>`;
  return markup;
}

// the perch: the bird drawn this many px wide in the strip above the date
export const PERCH_W = 118;
const SHOULDER = { near: 'translate(234 96)', far: 'translate(222 92)' };

/**
 * Fly the bird in over `home` and land it in `perch`. With `fly` false (reduced motion, or the setting off)
 * it just appears perched. Returns a stop function.
 */
export function launchFalcon(home: HTMLElement, perch: HTMLElement, fly: boolean): () => void {
  const host = document.createElement('div');
  host.innerHTML = falconSvg();
  const svg = host.firstElementChild as SVGSVGElement;
  const near = svg.querySelector<SVGGElement>('[data-wing="near"]')!, far = svg.querySelector<SVGGElement>('[data-wing="far"]')!;
  const wings = (deg: number, lag = deg) => {
    near.setAttribute('transform', `${SHOULDER.near} rotate(${f1(deg)})`);
    far.setAttribute('transform', `${SHOULDER.far} rotate(${f1(lag - 8)})`);
  };
  let raf = 0;
  const perched = () => {
    svg.style.cssText = '';
    wings(0);
    perch.appendChild(svg);
  };
  if (!fly) { perched(); return () => { svg.remove(); }; }

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
  svg.style.cssText = 'position:absolute;left:0;top:0;width:400px;height:220px;transform-origin:0 0;will-change:transform';

  const DUR = 2500;
  const end = () => { const h = home.getBoundingClientRect(), p = perch.getBoundingClientRect(); return { x: p.left - h.left, y: p.top - h.top, s: p.width / 400 }; };
  const goal = end();
  // a wide sweep: in low from the left, past close to the viewer, banking up and back round to the perch
  const X = [-W * 0.38, W * 0.62, W * 0.95, goal.x], Y = [H * 0.62, H * 0.86, -H * 0.18, goal.y], S = [1.5, 1.85, 0.9, goal.s];
  const cub = (p: number[], t: number) => { const u = 1 - t; return u * u * u * p[0] + 3 * u * u * t * p[1] + 3 * u * t * t * p[2] + t * t * t * p[3]; };
  // fast as it comes in, easing all the way down to a soft landing
  const travel = (t: number) => 1 - Math.pow(1 - t, 2.4);
  let t0 = 0, last = 0, phase = 0, bank = 0, skip = false;
  const pts: { x: number; y: number; t: number }[] = [];
  const step = (now: number) => {
    if (!t0) t0 = last = now;
    const t = skip ? DUR : Math.min(DUR, now - t0), dt = Math.min(50, now - last) / 1000;
    last = now;
    const k = t / DUR, e = travel(k), g = end();
    X[3] = g.x; Y[3] = g.y; S[3] = g.s; // the perch can move (a resize): keep aiming at it
    const x = cub(X, e), y = cub(Y, e), s = cub(S, e);
    const ahead = travel(Math.min(1, k + 0.02));
    const heading = (Math.atan2(cub(Y, ahead) - y, cub(X, ahead) - x) * 180) / Math.PI;
    // bank toward the heading through a low-pass, levelling out over the last stretch
    const level = Math.min(1, Math.max(0, (k - 0.7) / 0.3));
    bank += (Math.max(-26, Math.min(26, heading)) * (1 - level) - bank) * Math.min(1, dt * 7);
    // wingbeats slow into a glide; the phase is integrated so a changing rate never jumps
    const glide = Math.min(1, Math.max(0, (k - 0.45) / 0.4)), rate = 3.1 * (1 - glide);
    phase += 2 * Math.PI * rate * dt;
    const amp = 52 * (1 - glide) ** 1.5;
    wings(-8 * (1 - glide) + amp * Math.sin(phase), -8 * (1 - glide) + amp * Math.sin(phase - 0.5));
    svg.style.transform = `translate(${f1(x)}px,${f1(y)}px) scale(${s.toFixed(4)}) rotate(${f1(bank)}deg)`;
    if (tc) {
      tc.clearRect(0, 0, W, H);
      pts.push({ x: x + 92 * s, y: y + 62 * s, t });
      while (pts.length && t - pts[0].t > 320) pts.shift();
      tc.strokeStyle = ink; tc.lineCap = 'round';
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], age = 1 - (t - b.t) / 320;
        tc.globalAlpha = 0.5 * age * (1 - level); tc.lineWidth = 2.4 * age * s;
        tc.beginPath(); tc.moveTo(a.x, a.y); tc.lineTo(b.x, b.y); tc.stroke();
      }
      tc.globalAlpha = 1;
    }
    if (t < DUR) { raf = requestAnimationFrame(step); return; }
    layer.remove();
    off();
    perched();
  };
  raf = requestAnimationFrame(step);
  const land = () => { skip = true; };
  const off = () => { removeEventListener('keydown', land, true); removeEventListener('pointerdown', land, true); };
  addEventListener('keydown', land, true);
  addEventListener('pointerdown', land, true);
  return () => { cancelAnimationFrame(raf); off(); layer.remove(); svg.remove(); };
}
