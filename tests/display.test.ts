import { beforeEach, describe, expect, it, vi } from 'vitest';

const boot = async () => { vi.resetModules(); await import('../src/ui/display'); };

describe('line spacing on load', () => {
  beforeEach(() => {
    localStorage.clear();
    window.matchMedia = (() => ({ addEventListener() {} })) as unknown as typeof window.matchMedia;
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  const lh = () => localStorage.getItem('falcon.lineHeight');

  it('moves a saved 1.2 to 1.3', async () => {
    localStorage.setItem('falcon.lineHeight', '1.2');
    await boot();
    expect(lh()).toBe('1.3');
    expect(document.documentElement.classList.contains('lh-box')).toBe(true);
  });

  it('leaves other spacings alone', async () => {
    localStorage.setItem('falcon.lineHeight', '1.5');
    await boot();
    expect(lh()).toBe('1.5');
    expect(document.documentElement.classList.contains('lh-box')).toBe(false);
  });

  it('keeps a 1.2 picked after the move', async () => {
    localStorage.setItem('falcon.lineHeight', '1.2');
    await boot();
    localStorage.setItem('falcon.lineHeight', '1.2');
    await boot();
    expect(lh()).toBe('1.2');
  });

  it('uses 1.3 with nothing saved', async () => {
    await boot();
    expect(lh()).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--doc-lh')).toBe('1.3');
  });
});
