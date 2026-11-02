import { afterEach, describe, expect, it, vi } from 'vitest';
import { P, pref, resetPrefs, setPref } from '../src/editor/prefs';
import { PRESETS, SYSTEM, addCustomTheme, contrast, customThemes, deleteCustomTheme, isDark, resolveTheme, themeVars, updateCustomTheme } from '../src/ui/theme';

const root = document.documentElement;
afterEach(() => { resetPrefs(); localStorage.removeItem('falcon.themes'); });

describe('themes', () => {
  it('Dark is the default, and keeps the graphite shades exactly', () => {
    expect(pref(P.theme)).toBe('dark');
    expect(root.style.getPropertyValue('--u-deep')).toBe('#0f0f10');
    expect(root.style.getPropertyValue('--u-card')).toBe('#19191b');
    expect(root.style.getPropertyValue('--u-pop')).toBe('#1b1b1e');
    expect(root.dataset.chrome).toBe('dark');
    expect(root.style.getPropertyValue('--page')).toBe('#ffffff');
    expect(root.classList.contains('page-dark')).toBe(false);
  });

  it('picking a theme sets its colors and flags on the root at once', () => {
    setPref(P.theme, 'light');
    expect(root.dataset.chrome).toBe('light');
    expect(root.style.colorScheme).toBe('light');
    expect(root.style.getPropertyValue('--u-deep')).toBe('#f4f4f5');
    // unpinned shades are the text mixed into the background
    expect(root.style.getPropertyValue('--u-raised')).toBe('color-mix(in srgb, #1d1d1f 9%, #f4f4f5)');
    setPref(P.theme, 'night');
    expect(root.dataset.chrome).toBe('dark');
    expect(root.classList.contains('page-dark')).toBe(true);
    expect(root.style.getPropertyValue('--doc-ink')).toBe('#e6e6e6');
  });

  it('a token one theme pins is not left behind by the next', () => {
    setPref(P.theme, 'light');
    expect(root.style.getPropertyValue('--u-well')).toBe('#ffffff');
    setPref(P.theme, 'midnight');
    expect(root.style.getPropertyValue('--u-well')).toBe('color-mix(in srgb, #e4e8f1 6%, #0b0f1a)');
  });

  it('Document paper overrides the theme\'s paper', () => {
    setPref(P.theme, 'light');
    setPref(P.paper, 'dark');
    expect(root.style.getPropertyValue('--page')).toBe('#1e1e20');
    expect(root.classList.contains('page-dark')).toBe(true);
    expect(root.dataset.chrome).toBe('light');
    setPref(P.theme, 'night');
    setPref(P.paper, 'white');
    expect(root.style.getPropertyValue('--page')).toBe('#ffffff');
    expect(root.classList.contains('page-dark')).toBe(false);
  });

  it('System follows the system setting', () => {
    let dark = false;
    vi.stubGlobal('matchMedia', () => ({ matches: dark }));
    expect(resolveTheme(SYSTEM).id).toBe('light');
    dark = true;
    expect(resolveTheme(SYSTEM).id).toBe('dark');
    vi.unstubAllGlobals();
  });

  it('every preset reads: text contrasts with its background, paper text with its paper', () => {
    for (const t of PRESETS) {
      expect(contrast(t.text, t.bg), t.name).toBeGreaterThan(10);
      expect(contrast(t.paperInk, t.paper), t.name).toBeGreaterThan(10);
    }
  });
});

describe('custom themes', () => {
  it('copy a theme, edit its colors and name, and delete it', () => {
    const t = addCustomTheme(resolveTheme('sepia'));
    expect(t.name).toBe('Sepia copy');
    expect(addCustomTheme(resolveTheme('sepia')).name).toBe('Sepia copy 2');
    setPref(P.theme, t.id);
    expect(root.style.getPropertyValue('--u-deep')).toBe('#ebe3d4');
    updateCustomTheme(t.id, { bg: '#102030', text: '#f0f0f0', name: 'Harbor' });
    expect(root.style.getPropertyValue('--u-deep')).toBe('#102030'); // applied live
    expect(root.dataset.chrome).toBe('dark');
    expect(resolveTheme(t.id).name).toBe('Harbor');
    deleteCustomTheme(t.id);
    expect(customThemes().map((x) => x.name)).toEqual(['Sepia copy 2']);
    expect(resolveTheme(t.id).id).toBe('dark'); // a deleted theme falls back to Dark
  });

  it('a new background its text can\'t be read on flips the text; a chosen text color stays', () => {
    const t = addCustomTheme(resolveTheme('sepia')); // dark brown text
    updateCustomTheme(t.id, { bg: '#203040' });
    expect(resolveTheme(t.id).text).toBe('#ededed');
    updateCustomTheme(t.id, { text: '#2a3a4a' }); // the user's own pick, unreadable or not
    expect(resolveTheme(t.id).text).toBe('#2a3a4a');
    updateCustomTheme(t.id, { paper: '#101010' });
    expect(resolveTheme(t.id).paperInk).toBe('#e6e6e6');
    updateCustomTheme(t.id, { paper: '#fafafa' });
    expect(resolveTheme(t.id).paperInk).toBe('#222222');
  });

  it('Restore defaults goes back to Dark but keeps the themes you made', () => {
    const t = addCustomTheme(resolveTheme('light'));
    setPref(P.theme, t.id);
    resetPrefs();
    expect(pref(P.theme)).toBe('dark');
    expect(customThemes().map((x) => x.id)).toEqual([t.id]);
  });

  it('ignores a broken or tampered list', () => {
    localStorage.setItem('falcon.themes', '{nope');
    expect(customThemes()).toEqual([]);
    localStorage.setItem('falcon.themes', JSON.stringify([{ id: 'x', name: 'X', bg: 'red; background: url(evil)', text: '#fff', paper: '#fff', paperInk: '#000' }]));
    expect(customThemes()).toEqual([]);
  });

  it('dark or light is told from the color itself', () => {
    expect(isDark('#0f0f10')).toBe(true);
    expect(isDark('#f4f4f5')).toBe(false);
    expect(themeVars(resolveTheme('contrast'))['--u-sh']).toBe('1');
  });
});
