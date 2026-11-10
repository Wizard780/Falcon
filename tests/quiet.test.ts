// The caret stops blinking once the user is still, never mid-keystroke, and memory is trimmed only while still.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const trimMemory = vi.fn();
let q: typeof import('../src/ui/quiet');
beforeAll(async () => {
  (globalThis as unknown as { falcon: object }).falcon = { trimMemory }; // the desktop bridge, read as host.ts loads
  q = await import('../src/ui/quiet');
});
const anim = () => document.documentElement.style.getPropertyValue('caret-animation');
const key = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
const REST_AFTER = 5000, WAKE_PAUSE = 500, TRIM_QUIET = 1500; // quiet.ts's

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }); trimMemory.mockClear(); });
afterEach(() => { q.quietForTests.reset(); vi.useRealTimers(); });

describe('caret rest', () => {
  it('stops the blink after a few still seconds, not before', () => {
    q.installQuiet();
    vi.advanceTimersByTime(REST_AFTER - 100);
    expect(anim()).toBe('');
    key(); // typing keeps it blinking
    vi.advanceTimersByTime(REST_AFTER - 100);
    expect(anim()).toBe('');
    vi.advanceTimersByTime(100);
    expect(anim()).toBe('manual');
  });

  it('a key at rest restyles nothing until the first pause, then blinks again, then rests again', () => {
    q.installQuiet();
    vi.advanceTimersByTime(REST_AFTER);
    expect(anim()).toBe('manual');
    key();
    expect(anim()).toBe('manual'); // not in the keystroke: the caret is drawn steadily meanwhile
    for (let i = 0; i < 5; i++) { vi.advanceTimersByTime(200); key(); } // steady typing: still no restyle
    expect(anim()).toBe('manual');
    vi.advanceTimersByTime(WAKE_PAUSE);
    expect(anim()).toBe('');
    vi.advanceTimersByTime(REST_AFTER);
    expect(anim()).toBe('manual');
  });

  it('a scroll or click wakes it too', () => {
    q.installQuiet();
    vi.advanceTimersByTime(REST_AFTER);
    window.dispatchEvent(new Event('wheel'));
    vi.advanceTimersByTime(WAKE_PAUSE);
    expect(anim()).toBe('');
    vi.advanceTimersByTime(REST_AFTER);
    window.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(WAKE_PAUSE);
    expect(anim()).toBe('');
  });

  it('a drag puts off waking until it stops', () => {
    q.installQuiet();
    vi.advanceTimersByTime(REST_AFTER);
    window.dispatchEvent(new MouseEvent('pointerdown'));
    for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(100); window.dispatchEvent(new MouseEvent('pointermove', { buttons: 1 })); }
    expect(anim()).toBe('manual');
    vi.advanceTimersByTime(WAKE_PAUSE);
    expect(anim()).toBe('');
  });
});

describe('trimSoon', () => {
  it('trims once, after the user has been still for a moment', () => {
    q.installQuiet();
    q.trimSoon(); q.trimSoon(); // asked twice: one trim
    vi.advanceTimersByTime(TRIM_QUIET - 100);
    key();
    vi.advanceTimersByTime(TRIM_QUIET - 100);
    expect(trimMemory).not.toHaveBeenCalled(); // waits out the typing
    vi.advanceTimersByTime(200);
    expect(trimMemory).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(trimMemory).toHaveBeenCalledTimes(1);
  });
});
