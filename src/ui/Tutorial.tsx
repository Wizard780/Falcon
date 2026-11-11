import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { pressedId } from '../editor/keybinds';
import { P, pref } from '../editor/prefs';
import { reducedMotion } from './motion';
import { STEPS, type Step, type TourCtx } from './tutorial-steps';
import './tutorial.css';

// The first-run tour: one step at a time, a glow ring around the thing the step is about, the rest of the
// app dimmed and held back. The steps live in tutorial-steps.ts; App opens the sample doc and closes it.

type Box = { left: number; top: number; width: number; height: number; line?: boolean };
const PAD = 6, GAP = 14, EDGE = 12, GLIDE = 320;

// Every launch since the first release writes these (App's mount effects): a profile without any of them has never
// run Falcon. Other keys don't count: some are written as the modules load, before this is read (display.ts).
const LAUNCH_KEYS = ['falcon.zoom', 'falcon.outline', 'falcon.recents.v1'];
/** Falcon has never run in this profile. Read it on the first render, before the app writes these. */
export const isFreshProfile = (storage: Storage) => LAUNCH_KEYS.every((k) => storage.getItem(k) === null);
/** Start the tour by itself: a fresh profile that hasn't seen it, and a person at the keyboard (not a test driving the page). */
export const shouldAutoStart = () => !navigator.webdriver && !pref(P.tourSeen) && isFreshProfile(localStorage);

/** The elements a step points at, or [] when it points at nothing that's on screen. */
export function targetsOf(s: Step, ctx: TourCtx): Element[] {
  if (!s.target) return [];
  const found = typeof s.target === 'string' ? document.querySelector(s.target) : s.target(ctx);
  return (Array.isArray(found) ? found : found ? [found] : []).filter((e) => e.isConnected && e.getClientRects().length > 0);
}
/** The step after `from` going `dir`, skipping steps whose target isn't there; -1 past the end. Back stops at the first step. */
export function nextStep(steps: Step[], from: number, dir: 1 | -1, has: (s: Step) => boolean): number {
  let i = from + dir;
  while (i >= 0 && i < steps.length && !has(steps[i])) i += dir;
  if (i >= steps.length) return -1;
  return i < 0 ? from : i;
}
const overlaps = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
/** Where the card goes: beside the first target (below, above, right, then left), inside the window and off every target. */
export function placeCard(targets: Box[], w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  if (!targets.length) return { left: Math.round((vw - w) / 2), top: Math.round((vh - h) / 2) };
  const t = targets[0], cx = t.left + t.width / 2, cy = t.top + t.height / 2;
  const clampX = (x: number) => Math.max(EDGE, Math.min(x, vw - w - EDGE)), clampY = (y: number) => Math.max(EDGE, Math.min(y, vh - h - EDGE));
  const spots = [
    { left: clampX(cx - w / 2), top: t.top + t.height + PAD + GAP },
    { left: clampX(cx - w / 2), top: t.top - PAD - GAP - h },
    { left: t.left + t.width + PAD + GAP, top: clampY(cy - h / 2) },
    { left: t.left - PAD - GAP - w, top: clampY(cy - h / 2) },
  ];
  const inside = (p: { left: number; top: number }) => p.left >= EDGE && p.top >= EDGE && p.left + w <= vw - EDGE && p.top + h <= vh - EDGE;
  const clear = (p: { left: number; top: number }) => !targets.some((r) => overlaps({ ...p, width: w, height: h }, { left: r.left - PAD, top: r.top - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD }));
  const best = spots.find((p) => inside(p) && clear(p)) ?? spots.find(inside);
  // nothing fits beside it (a target as big as the window): the bottom right corner, over the target
  return best ?? { left: vw - w - EDGE, top: vh - h - EDGE };
}
/** The ring's edge around a line of text, drawn outside its box (tutorial.css: thinner than a button's 2 px). */
const EDGE_W = 1.5;
/** The target as the ring draws it: padded, and kept inside the window so a tall pane's ring still shows. A line of text
 * gets `room` (the gaps to the lines above and below): there its edge stays within half of each gap, never on a
 * neighbouring line, even when that means sitting just inside the line's own leading. */
export function ringBox(r: Box, vw: number, vh: number, room?: { above: number; below: number }): Box {
  const pad = (gap: number) => Math.min(PAD, gap / 2) - EDGE_W - 0.25; // and a little clear, for rounding
  const top = room ? r.top - pad(room.above) : Math.max(4, r.top - PAD), left = Math.max(4, r.left - PAD);
  const bottom = room ? r.top + r.height + pad(room.below) : Math.min(vh - 4, r.top + r.height + PAD);
  return { left, top, width: Math.min(vw - 4, r.left + r.width + PAD) - left, height: bottom - top, ...(room && { line: true }) };
}
const boxOf = (e: Element): Box => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
/** A paragraph of the document: the gaps to the paragraphs drawn next to it (a big one when there's none). */
function roomOf(e: Element): { above: number; below: number } | undefined {
  if (!e.parentElement?.classList.contains('ProseMirror')) return undefined;
  const r = e.getBoundingClientRect(), a = e.previousElementSibling?.getBoundingClientRect(), b = e.nextElementSibling?.getBoundingClientRect();
  return { above: a ? Math.max(0, r.top - a.bottom) : 2 * PAD, below: b ? Math.max(0, b.top - r.bottom) : 2 * PAD };
}
/** The dim: the whole window with a rounded hole per ring (even-odd fill, so clicks in a hole reach the app). */
function dimPath(rings: Box[], vw: number, vh: number) {
  const hole = ({ left: x, top: y, width: w, height: h }: Box) => {
    const r = Math.min(8, w / 2, h / 2);
    return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  };
  return `M0 0H${vw}V${vh}H0Z${rings.map(hole).join('')}`;
}
/** Partway from boxes `a` to `b` (t 0 to 1). A different number of boxes doesn't glide: it's just `b`. */
export function between(a: Box[], b: Box[], t: number): Box[] {
  if (a.length !== b.length || t >= 1) return b;
  const e = 1 - Math.pow(1 - t, 3), at = (x: number, y: number) => x + (y - x) * e;
  return b.map((r, k) => ({ ...r, left: at(a[k].left, r.left), top: at(a[k].top, r.top), width: at(a[k].width, r.width), height: at(a[k].height, r.height) }));
}
// close enough to skip a redraw; tight, so a glide's last frame still lands exactly on the target
const same = (a: Box[], b: Box[]) => a.length === b.length && a.every((r, i) => Math.abs(r.left - b[i].left) < 0.05 && Math.abs(r.top - b[i].top) < 0.05 && Math.abs(r.width - b[i].width) < 0.05 && Math.abs(r.height - b[i].height) < 0.05);

type Props = {
  on: boolean;
  ctx: TourCtx;
  /** App's key handler asks this first while the tour runs: true lets the key through */
  gate: MutableRefObject<((e: KeyboardEvent) => boolean) | null>;
  onEnd: () => void;
};

export function Tutorial({ on, ctx, gate, onEnd }: Props) {
  const [i, setI] = useState(-1);
  const [rings, setRings] = useState<Box[]>([]);
  const [anchor, setAnchor] = useState<Box | null>(null);
  const [goal, setGoal] = useState<Box[]>([]); // the targets as drawn: the card is placed from these, not the glide
  const shown = useRef<Box[]>([]); // the rings as last drawn, where the next step's glide starts
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight });
  const [moving, setMoving] = useState(false);
  const card = useRef<HTMLDivElement>(null), next = useRef<HTMLButtonElement>(null);
  const iRef = useRef(i);
  iRef.current = i;
  const has = (s: Step) => !s.target || !!s.optional || targetsOf(s, ctx).length > 0;
  const end = useRef(onEnd);
  end.current = onEnd;
  const go = (dir: 1 | -1) => {
    const n = nextStep(STEPS, iRef.current, dir, has);
    if (n < 0) end.current(); else if (n !== iRef.current) setI(n);
  };
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => { shown.current = []; setI(on ? nextStep(STEPS, -1, 1, has) : -1); }, [on]); // eslint-disable-line react-hooks/exhaustive-deps

  // keys: Esc ends the tour, the step's own shortcuts and the card's buttons get through, nothing else
  useEffect(() => {
    if (!on) return;
    gate.current = (e) => {
      if (e.key === 'Escape') { end.current(); return false; }
      if ((e.target as Element | null)?.closest?.('.tour-card')) return true;
      const keys = STEPS[iRef.current]?.keys;
      return !!keys && !!pressedId(e, keys);
    };
    return () => { gate.current = null; };
  }, [on, gate]);

  // each step: its setup runs, its cleanup runs when it ends either way; then follow its target every frame
  useEffect(() => {
    if (i < 0) return;
    const s = STEPS[i];
    if (!s.enter) next.current?.focus({ preventScroll: true });
    s.enter?.(ctx);
    const glide = !reducedMotion(), from = shown.current, t0 = performance.now();
    setMoving(glide);
    const still = window.setTimeout(() => setMoving(false), GLIDE + 80);
    let raf = 0, timer = 0, lastW = 0, lastH = 0, lastNear: Box | null | undefined, lastGoal: Box[] | null = null;
    const frame = () => {
      const vw = innerWidth, vh = innerHeight;
      // measured every frame, so the ring follows the target through scrolling, resizing and layout changes;
      // from one step to the next it glides, and the dim's holes go with it
      const els = targetsOf(s, ctx), at = els.map(boxOf);
      const want = els.map((e, k) => ringBox(at[k], vw, vh, roomOf(e)));
      if (!lastGoal || !same(at, lastGoal)) { lastGoal = at; setGoal(at); }
      const now = glide ? between(from, want, (performance.now() - t0) / GLIDE) : want;
      if (!same(now, shown.current)) { shown.current = now; setRings(now); }
      const n = s.near?.(ctx)?.getBoundingClientRect();
      const near = n ? { left: n.left, top: n.top, width: n.width, height: n.height } : null;
      if (lastNear === undefined || !(near && lastNear ? same([near], [lastNear]) : near === lastNear)) { lastNear = near; setAnchor(near); }
      if (vw !== lastW || vh !== lastH) { lastW = vw; lastH = vh; setSize({ w: vw, h: vh }); }
      // a hands-on step done: a moment to see it worked, then on
      if (!timer && s.done?.(ctx)) timer = window.setTimeout(() => goRef.current(1), 700);
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); clearTimeout(still); s.leave?.(ctx); };
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  // the card beside the first target, measured as drawn
  useLayoutEffect(() => {
    const c = card.current;
    if (!c) return;
    const p = placeCard(anchor ? [anchor, ...goal] : goal, c.offsetWidth, c.offsetHeight, size.w, size.h);
    c.style.left = `${p.left}px`;
    c.style.top = `${p.top}px`;
  }, [goal, anchor, size, i]);

  if (!on || i < 0) return null;
  const s = STEPS[i];
  const last = nextStep(STEPS, i, 1, has) < 0;
  const body = typeof s.body === 'function' ? s.body() : s.body;
  return (
    <div className="tour" data-moving={moving || undefined}>
      <svg className="tour-dim" width={size.w} height={size.h} aria-hidden="true">
        <path d={dimPath(rings, size.w, size.h)} fillRule="evenodd" />
      </svg>
      {s.look && <div className="tour-block" />}
      {rings.map((r, k) => <div key={k} className="tour-ring" data-line={r.line || undefined} style={{ transform: `translate(${r.left}px, ${r.top}px)`, width: r.width, height: r.height }} />)}
      <div ref={card} className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-t" aria-describedby="tour-b">
        <h2 id="tour-t">{s.title}</h2>
        <p id="tour-b">{body}</p>
        <div className="tour-foot">
          <span className="tour-n">{i + 1} of {STEPS.length}</span>
          <button className="tour-skip" onClick={() => end.current()}>Skip</button>
          {i > 0 && <button onClick={() => go(-1)}>Back</button>}
          <button ref={next} className="tour-next" onClick={() => go(1)}>{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
