import { useCallback, useEffect, useRef } from 'react';

const MIN = 0.5, MAX = 3;
const clamp = (z: number) => Math.max(MIN, Math.min(MAX, z));
const round = (z: number) => +clamp(z).toFixed(2);

/**
 * Zoom that moves smoothly, like CardMirror: a pinch follows the fingers, keys and buttons glide to the next step.
 * Frames write --zoom straight to the page; the app's zoom state only hears the value once it stops moving.
 */
export function useSmoothZoom(zoom: number, setZoom: (z: number) => void, scroller: () => HTMLElement | null) {
  const live = useRef(zoom); // what the page shows right now
  const goal = useRef(zoom); // where keys are headed, so quick presses add up
  const raf = useRef(0);
  const idle = useRef(0);

  // zoom set some other way (Settings, a restored file): follow it
  useEffect(() => { if (!raf.current) { live.current = zoom; goal.current = zoom; } }, [zoom]);
  useEffect(() => () => { cancelAnimationFrame(raf.current); clearTimeout(idle.current); }, []);

  // show the page at z, keeping the spot at (x, y) on screen still (the middle when there's no spot)
  const show = useCallback((z: number, x?: number, y?: number) => {
    const sc = scroller(), old = live.current;
    live.current = z;
    document.documentElement.style.setProperty('--zoom', String(z));
    if (!sc || z === old) return;
    const r = sc.getBoundingClientRect();
    const ax = (x ?? r.left + r.width / 2) - r.left, ay = (y ?? r.top + r.height / 2) - r.top;
    const k = z / old;
    sc.scrollLeft = (sc.scrollLeft + ax) * k - ax;
    sc.scrollTop = (sc.scrollTop + ay) * k - ay;
  }, [scroller]);

  const zoomTo = useCallback((z: number, x?: number, y?: number) => {
    const to = (goal.current = round(z));
    cancelAnimationFrame(raf.current);
    clearTimeout(idle.current);
    const from = live.current;
    if (document.documentElement.classList.contains('reduce-motion') || from === to) { show(to, x, y); raf.current = 0; setZoom(to); return; }
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 160);
      show(p < 1 ? from + (to - from) * (1 - (1 - p) ** 3) : to, x, y);
      if (p < 1) raf.current = requestAnimationFrame(step);
      else { raf.current = 0; setZoom(to); }
    };
    raf.current = requestAnimationFrame(step);
  }, [show, setZoom]);

  const zoomBy = useCallback((d: number) => zoomTo(goal.current + d), [zoomTo]);

  // a pinch or Ctrl/Cmd-wheel: dy is the wheel's deltaY, the zoom follows it with no steps
  const zoomWheel = useCallback((dy: number, x: number, y: number) => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    const z = clamp(live.current * Math.exp(-dy / 100));
    show(z, x, y);
    goal.current = round(z);
    clearTimeout(idle.current);
    idle.current = window.setTimeout(() => setZoom(round(live.current)), 200);
  }, [show, setZoom]);

  return { zoomTo, zoomBy, zoomWheel };
}
