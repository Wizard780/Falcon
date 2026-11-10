// What the app lets go of while the user isn't doing anything: memory after a file opens, closes or swaps in,
// and the caret's blink, which draws a frame every half second (most of what an idle window costs in CPU and GPU).
import { bridge } from '../editor/host';

const REST_AFTER = 5000; // no key, click or scroll for this long: the caret stops blinking and stays shown
const WAKE_PAUSE = 500; // ...and blinks again at the first pause in what woke it (not on the key itself: see wake)
const TRIM_QUIET = 1500;

let last = 0; // the last key, click, drag, wheel or scroll
let resting = false, timer = 0;
const idleFor = () => performance.now() - last;

/** Stop or restart the blink: a class on the root that styles.css turns into `caret-animation: manual` on the
 *  caret's own paragraph and on text boxes. Not the property on the root: it's inherited, so that restyled the
 *  whole page (about 50 ms with a big backfile showing). A caret that doesn't blink is drawn steadily. */
function setRest(on: boolean) {
  resting = on;
  document.documentElement.classList.toggle('f-rest', on);
}

function tick() {
  timer = 0;
  const idle = idleFor();
  if (resting && idle >= WAKE_PAUSE) setRest(false);
  if (!resting && idle >= REST_AFTER) { setRest(true); return; } // stays at rest until the next input
  timer = window.setTimeout(tick, (resting ? WAKE_PAUSE : REST_AFTER) - idle);
}

/** Any input: one timer at most, not one per key. Waking waits for a pause, so the restyle never delays a keystroke. */
function poke() {
  last = performance.now();
  if (!timer) timer = window.setTimeout(tick, resting ? WAKE_PAUSE : REST_AFTER);
}

let installed = false;
export function installQuiet() {
  if (installed) return;
  installed = true;
  for (const t of ['keydown', 'pointerdown', 'wheel', 'scroll', 'compositionstart']) addEventListener(t, poke, { capture: true, passive: true });
  addEventListener('pointermove', (e) => { if (e.buttons) poke(); }, { capture: true, passive: true }); // a drag: no restyle mid-gesture
  poke();
}

let trimTimer = 0;
/** After work that leaves a lot behind (a backfile's import, the doc it replaced): once the user has been still
 *  for a moment, a full GC and Blink's caches. V8 would otherwise keep the garbage for good in a page that's left
 *  alone (300 MB after three backfiles open). It costs about 0.2 s of CPU, none of it a long task. */
export function trimSoon() {
  const trim = (bridge as { trimMemory?: () => void }).trimMemory; // the desktop app's (electron/preload.cjs)
  if (!trim) return;
  window.clearTimeout(trimTimer);
  trimTimer = window.setTimeout(function check() {
    const wait = TRIM_QUIET - idleFor();
    if (wait > 0) trimTimer = window.setTimeout(check, wait);
    else trim();
  }, TRIM_QUIET);
}

export const quietForTests = { reset: () => { window.clearTimeout(timer); window.clearTimeout(trimTimer); timer = trimTimer = 0; installed = false; setRest(false); } };
