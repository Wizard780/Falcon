import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { freshStorage, mountApp, unmountAll } from './app-harness';

const CM = readFileSync('tests/fixtures/cardmirror-settings.json', 'utf8');

afterEach(async () => { await unmountAll(); });

describe('settings file', () => {
  it('brings CardMirror\'s AI settings over, and a blank prompt leaves Falcon\'s in place', async () => {
    await freshStorage();
    const { importSettings } = await import('../src/ui/settings-file');
    const { P, pref } = await import('../src/editor/prefs');
    const file = (prompt: string) => JSON.stringify({ ...JSON.parse(CM), settings: { ...JSON.parse(CM).settings, aiFeaturesEnabled: true, aiModelOverride: 'claude-haiku-4-5', aiProvider: 'openrouter', openrouterModel: 'deepseek/deepseek-chat', aiCitePrompt: prompt } });
    expect(importSettings(file('')).ok).toBe(true);
    expect(pref(P.aiCitePreset)).toBe('');
    expect(importSettings(file('my house style')).ok).toBe(true);
    expect([pref(P.aiOn), pref(P.aiModel), pref(P.aiCitePreset)]).toEqual([true, 'claude-haiku-4-5', 'cardmirror']);
    expect([pref(P.aiProvider), pref(P.aiRouterModel)]).toEqual(['openrouter', 'deepseek/deepseek-chat']);
    expect(JSON.parse(pref(P.aiCitePresets))).toEqual([{ id: 'cardmirror', name: 'My prompt', prompt: 'my house style' }]);
  });
  it('exports settings, not documents, recents or the usage-stats choice, and imports them back exactly', async () => {
    await freshStorage({
      'falcon.wpm1': '250', 'falcon.key.tag': 'F9', 'falcon.find.order': 'position', 'falcon.zoom': '1.3',
      'falcon.autosave.v2': '[]', 'falcon.recents.v1': '[]', 'falcon.session': '[]', 'falcon.usageStats': 'off', 'other.app': 'x',
    });
    const { exportSettings, importSettings } = await import('../src/ui/settings-file');
    const { P, pref, setPref } = await import('../src/editor/prefs');
    const file = exportSettings();
    expect(file.app).toBe('Falcon');
    expect(file.settings).toMatchObject({ wpm1: '250', 'key.tag': 'F9', 'find.order': 'position', zoom: '1.3' });
    expect(Object.keys(file.settings).filter((k) => /autosave|recents|session|usageStats/.test(k))).toEqual([]);
    expect(file.settings['other.app']).toBeUndefined();

    // change things after exporting: the import puts back the file's picture, including defaults it left out
    setPref(P.wpm1, 300);
    setPref(P.citeNearest, false);
    localStorage.setItem('falcon.autosave.v2', '[{"keep":1}]');
    const r = importSettings(JSON.stringify(file));
    expect(r).toMatchObject({ ok: true, from: 'Falcon', applied: Object.keys(file.settings).length });
    expect(pref(P.wpm1)).toBe(250);
    expect(pref(P.citeNearest)).toBe(true);
    expect(localStorage.getItem('falcon.autosave.v2')).toBe('[{"keep":1}]'); // open documents untouched
    expect(localStorage.getItem('falcon.usageStats')).toBe('off');
  });

  it('never lets a file write documents, the usage-stats choice or keys outside Falcon', async () => {
    await freshStorage({ 'falcon.usageStats': 'off' });
    const { importSettings } = await import('../src/ui/settings-file');
    const r = importSettings(JSON.stringify({ app: 'Falcon', version: 1, settings: { 'autosave.v2': 'evil', usageStats: 'on', wpm2: '275', n: 5 } }));
    expect(r).toMatchObject({ ok: true, applied: 1, skipped: 3 });
    expect(localStorage.getItem('falcon.autosave.v2')).toBeNull();
    expect(localStorage.getItem('falcon.usageStats')).toBe('off');
    expect(localStorage.getItem('falcon.wpm2')).toBe('275');
  });

  it('skips values a setting cannot take, and a file with no usable settings changes nothing', async () => {
    await freshStorage({ 'falcon.wpm1': '250', 'falcon.zoom': '1.1' });
    const { importSettings } = await import('../src/ui/settings-file');
    const bad = { zoom: '1000', depth: '9', speech: '-5', highlight: 'foo', citeNearest: 'maybe', 'find.order': 'sideways', '': 'x', 'prefix.send': 'x'.repeat(41), 'no.such': '1' };
    expect(importSettings(JSON.stringify({ app: 'Falcon', version: 1, settings: bad }))).toMatchObject({ ok: false });
    expect(importSettings(JSON.stringify({ app: 'Falcon', version: 1, settings: {} }))).toMatchObject({ ok: false });
    expect([localStorage.getItem('falcon.wpm1'), localStorage.getItem('falcon.zoom')]).toEqual(['250', '1.1']);
    const r = importSettings(JSON.stringify({ app: 'Falcon', version: 1, settings: { ...bad, depth: '2', 'find.order': 'position' } }));
    expect(r).toMatchObject({ ok: true, applied: 2, skipped: Object.keys(bad).length - 2 });
    expect([localStorage.getItem('falcon.depth'), localStorage.getItem('falcon.find.order'), localStorage.getItem('falcon.zoom')]).toEqual(['2', 'position', null]);
  });

  it('every CardMirror value lands on a choice Falcon offers', async () => {
    await freshStorage();
    const { importSettings, exportSettings } = await import('../src/ui/settings-file');
    importSettings(CM);
    const written = exportSettings().settings;
    // re-importing as a Falcon file runs every value through the Falcon checks: none may be skipped
    expect(importSettings(JSON.stringify({ app: 'Falcon', version: 1, settings: written }))).toMatchObject({ ok: true, skipped: 0, applied: Object.keys(written).length });
  });

  it('rejects a file that is not settings and writes nothing', async () => {
    await freshStorage({ 'falcon.wpm1': '250' });
    const { importSettings } = await import('../src/ui/settings-file');
    expect(importSettings('{nope')).toMatchObject({ ok: false });
    expect(importSettings('{"settings": {"foo": 1}}')).toMatchObject({ ok: false });
    expect(importSettings('[1,2]')).toMatchObject({ ok: false });
    expect(localStorage.getItem('falcon.wpm1')).toBe('250');
  });

  it("keeps CardMirror's tag speed of 0 as same as cards", async () => {
    await freshStorage();
    const { importSettings } = await import('../src/ui/settings-file');
    const cm = JSON.parse(CM);
    cm.settings.readers = [{ name: 'Reader 1', wpm: 230, tagWpm: 0 }, { name: 'Reader 2', wpm: 260, tagWpm: 340 }];
    expect(importSettings(JSON.stringify(cm))).toMatchObject({ ok: true });
    expect(['wpm1', 'wpm1.tags', 'wpm2', 'wpm2.tags'].map((k) => localStorage.getItem(`falcon.${k}`))).toEqual(['230', '0', '260', '340']);
  });
  it('carries CardMirror settings over, snapped to the choices Falcon offers', async () => {
    await freshStorage();
    const { importSettings } = await import('../src/ui/settings-file');
    const r = importSettings(CM);
    expect(r).toMatchObject({ ok: true, from: 'CardMirror' });
    const s = (k: string) => localStorage.getItem(`falcon.${k}`);
    expect([s('prefix.send'), s('prefix.read'), s('prefix.marked'), s('savePrefix')]).toEqual(['[F] ', '[R] ', '[MARKED] ', 'on']);
    expect([s('theme'), s('font'), s('zoom'), s('depth'), s('prepMin')]).toEqual(['light', 'verdana', '1.2', '3', '3']);
    expect([s('wpm1'), s('wpm2')]).toEqual(['200', '260']); // any typed speed carries over as is
    expect([s('sz.pocket'), s('sz.hat'), s('sz.tag'), s('sz.undertag')]).toEqual(['26', '22', '14', '12']);
    expect(s('lineHeight')).toBe('1.3');
    expect([s('condense'), s('emphasisBox'), s('spellcheck'), s('highlight'), s('markerColor')]).toEqual(['integrity', 'on', 'on', 'cyan', '#FF0000']);
    expect(s('standardizeHighlightException')).toBe('darkGray'); // every Word highlight color is a choice now
    expect(s('standardizeShadingException')).toBe('#FFFF00');
    expect(s('reference.shrink')).toBe('3');
    if (r.ok) expect(r.applied + r.skipped).toBeGreaterThan(100);
  });

  it("brings CardMirror's shortcuts over: the imported key wins, [] clears, system keys stay out", async () => {
    await freshStorage({});
    const { importSettings } = await import('../src/ui/settings-file');
    const { keyOf } = await import('../src/editor/keybinds');
    const r = importSettings(JSON.stringify({ version: 1, settings: { sendDocPrefix: 'x', ribbonKeyOverrides: {
      applyHighlight: 'Mod-ArrowRight', applyUnderline: 'Mod-7', clearToNormal: 'Mod-ArrowLeft', setTag: 'Mod-4',
      pasteAsText: 'Mod-0', toggleReadMode: 'Mod-Shift-r', openFindReplace: [], condenseNoIntegrity: ['Alt-3'],
      standardizeHighlight: 'Mod-c', reformatAllCites: 'Mod-x', toggleBold: 'Mod-b',
    } } }));
    expect(r.ok && r.keys).toBe(8);
    expect([keyOf('highlight'), keyOf('underline'), keyOf('clear'), keyOf('tag')]).toEqual(['Mod-ArrowRight', 'Mod-7', 'Mod-ArrowLeft', 'Mod-4']);
    expect(keyOf('pastePlain')).toBe('Mod-0');
    expect(keyOf('zoomReset')).toBe(''); // Mod-0 went to paste plain, as in the CardMirror layout
    expect(keyOf('replace')).toBe('');
    expect(keyOf('condenseMerge')).toBe('Alt-3');
    expect(keyOf('standardizeHighlighting')).toBe(''); // Mod-c is Copy: kept out, and said so
    expect(r.ok && r.keysKept?.length).toBe(1);
  });

  it('carries the settings Falcon has a match for, and the search folders', async () => {
    await freshStorage({});
    const { importSettings } = await import('../src/ui/settings-file');
    const r = importSettings(JSON.stringify({ version: 1, settings: {
      sendDocPrefix: 'x', themeAppliesToDocument: false, unboldCites: true, smartPasteConversion: false, speechDocFilenameTemplate: 'Rd {speech}',
      timerFlashEnabled: true, timerFlashSeconds: [5, 3, 1], timerSoundEnabled: true, timerSpeechPresets: [6, 7], lastShadingColor: 'C0C0C0', lastFontColor: 'ff0000',
      navWidth: 318, navSearchLevel: 0, readModeParagraphIntegrity: true, clearFormattingOnNamedStyleToggleOff: false, fileSearchRoots: ['/a', 3, '/b'],
    } }));
    const s = (k: string) => localStorage.getItem(`falcon.${k}`);
    expect([s('paper'), s('citeBold'), s('smartPaste'), s('speechName')]).toEqual(['white', 'off', 'off', 'Rd {speech}']);
    expect([s('lowTime'), s('beep'), s('speech'), s('shading'), s('fontColor')]).toEqual(['10', 'on', '6', '#C0C0C0', '#FF0000']);
    expect([s('outlineWidth'), s('outline.searchLevel'), s('read.paras'), s('styleOffClears')]).toEqual(['318', 'all', 'on', 'off']);
    expect(r.ok && r.folders).toEqual(['/a', '/b']);
  });

  it('imports from Settings and the open app follows: zoom, outline depth, sizes and the note', async () => {
    await freshStorage();
    const app = await mountApp();
    await app.menu('settings');
    const input = document.querySelector<HTMLInputElement>('input[type=file][aria-label="Settings file"]')!;
    const file = new File([CM], 'cardmirror-settings.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await app.act(() => input.dispatchEvent(new Event('change', { bubbles: true })), 100);
    expect(document.documentElement.style.getPropertyValue('--zoom')).toBe('1.2');
    expect(document.documentElement.style.getPropertyValue('--sz-tag')).toBe('14pt');
    expect(document.querySelector('.st')!.textContent).toMatch(/Brought over \d+ settings( and \d+ shortcuts?)? from CardMirror\.( Not brought over: [^.]+\.)? \d+ settings have no Falcon match yet\./);
    // a bad file says so and changes nothing
    Object.defineProperty(input, 'files', { value: [new File(['hello'], 'x.json')], configurable: true });
    await app.act(() => input.dispatchEvent(new Event('change', { bubbles: true })), 100);
    expect(document.querySelector('.st')!.textContent).toContain('That file isn’t valid JSON.');
    expect(document.documentElement.style.getPropertyValue('--zoom')).toBe('1.2');
  });
});
