/**
 * What the command center lists: every command (each key binding, the fixed keys, the toolbar's extras),
 * every setting with its choices, the headings and cards in the open file, and .docx files (the ones
 * Cmd-K finds). The card library is a separate source, added beside these later.
 */
import { citePresets, currentPreset } from '../editor/ai-cite';
import type { EditorView } from 'prosemirror-view';
import type { Command } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { version } from '../../package.json';
import '../editor/keymap'; // registers the editor's bindings
import { fixedCommands } from '../editor/keymap';
import { BINDINGS, keyOf, keyText } from '../editor/keybinds';
import { P, pref, setPref, type Pref } from '../editor/prefs';
import { readSetting, type SettingSpec } from '../editor/tools';
import { DOC_TOOLS, docToolSettings } from '../editor/doc-tools';
import { CARD_TOOLS, cardToolSettings } from '../editor/card-tools';
import { navSettings } from '../editor/nav-keys';
import { HIGHLIGHTS, HIGHLIGHT_NAMES, LEVEL, schema, type ParaStyle } from '../editor/schema';
import { brushKey } from '../editor/editor';
import { toggleColorMark } from '../editor/commands';
import { fontSizeAt, setFontSize } from '../editor/font-size';
import { buildOutline, type OutlineItem } from '../editor/outline';
import { PRESETS, SYSTEM, customThemes } from './theme';
import { newFileName } from './files';
import { FONT_COLORS } from './swatches';
import type { Arg, Entry, Option } from './command-center';
import type { FileHit } from './file-search';
import type { Recent } from './recents';
import { TEMPLATES_KEY, fileCount, loadTemplates, pathName, templateName, type Template } from './templates';

/** What the command center needs from the app to act. */
export type Ctx = {
  view: EditorView | null;
  /** run an editor command on the open doc; false when it did nothing */
  run: (cmd: Command) => boolean;
  /** an App or Files command, by its binding id */
  app: (id: string) => void;
  /** read mode or a dialog holds this app command back right now */
  blocked: (id: string) => boolean;
  zoom: number; setZoom: (z: number) => void;
  depth: number; setDepth: (d: number) => void;
  showOutline: boolean; setShowOutline: (s: boolean) => void;
  speechMin: number; setSpeechMin: (m: number) => void;
  highlight: string | null; setHighlight: (c: string) => void;
  isSpeech: boolean; toggleSpeech: () => void;
  /** go to outline row i (and peek: scroll there without moving the caret) */
  jump: (i: number) => void; peek: (i: number) => void;
  find: (text: string, replace: boolean) => void;
  openSettings: (page: string, query?: string) => void;
  /** open docs and recent files (the command center adds the indexed folders' files), and how to open one */
  docs?: { id: number; name: string; path?: string }[];
  recents?: Recent[];
  openFile?: (h: FileHit) => void;
  /** can Search blocks read this file (it's open, or the desktop app can read its path) */
  readable?: (h: FileHit) => boolean;
  /** the file's document: the open copy with its unsaved edits, else read from disk */
  fileDoc?: (h: FileHit) => Promise<PMNode | null>;
  /** open every file in a template (desktop only) */
  openTemplate?: (t: Template) => void;
};

/** The clocks live in the toolbar; the command center asks them through an event. */
import { TIMER_EVENT, type TimerRequest } from './timer-event';
import { FORMAT_NAME, FORMAT_PREP, type RoundFormat } from './round-clock';
export { TIMER_EVENT, type TimerRequest };
const timer = (r: TimerRequest) => dispatchEvent(new CustomEvent(TIMER_EVENT, { detail: r }));

export const PAGES: Record<string, string> = {
  general: 'General', appearance: 'Appearance', editor: 'Editor', formatting: 'Formatting', templates: 'Templates', keys: 'Keybindings', speech: 'Speech and timers',
};

// ---------- commands ----------

// Search files would only open the other box: files are rows here already
const HIDDEN = new Set(['search', 'commands']);
const NOT_COMMANDS = new Set(['New line', 'Delete back', 'Delete forward']);
/** Words people search for that the label doesn't say. */
const SYN: Record<string, string> = {
  sendCard: 'share partner teammate contact pairing code collaborate', collab: 'pairing code contacts received cards waiting share partner collaborate inbox',
  home: 'start recent', settings: 'preferences options config', outline: 'nav pane navigation sidebar', find: 'search text look for',
  zoomIn: 'bigger magnify', zoomOut: 'smaller', zoomReset: '100% reset zoom', new: 'blank file create', open: 'docx file',
  save: 'write disk', saveAs: 'copy rename export', close: 'tab', nextDoc: 'switch tab', prevDoc: 'switch tab', recentDoc: 'switch tab last previous mru ctrl tab', recentDocBack: 'switch tab mru',
  pastePlain: 'plain text unformatted', condense: 'paragraph integrity spaces', changeCase: 'uppercase lowercase title caps',
  pocket: 'heading style h1', hat: 'heading style h2', block: 'heading style h3', tag: 'heading style card h4', analytic: 'analysis arg',
  undertag: 'annotation note', cite: 'citation author date', copyCite: 'citation duplicate', emphasis: 'box bold',
  highlight: 'highlighter color', shading: 'background shade fill', clear: 'remove formatting plain', shrink: 'minimize unread small',
  regrow: 'unshrink grow undo shrink', read: 'reading present speech', marker: 'mark place stop', number: 'numbering count',
  sub: 'numbering letter', restart: 'numbering', replace: 'substitute', selectSection: 'card', copySection: 'card', deleteSection: 'card remove',
  cardUp: 'reorder', cardDown: 'reorder', sendToSpeech: 'speech doc copy tilde backtick',
  searchCards: 'library evidence find card tag cite author backfile index files',
  compareText: 'diff difference check source match changes side by side',
};
const TOOL_HINTS = new Map([
  ...[...DOC_TOOLS, ...CARD_TOOLS].flatMap((s) => s.items.map((it) => [it.id, it.hint] as const)),
  ['sendToSpeech', 'Copy the selection, or the card or section at the caret, into the speech doc'],
  ['compareText', 'Two texts side by side with the differences marked. The selection becomes Text 1'],
]);
const keyWords = (k: string) => (k ? `${k} ${keyText(k)}` : '');
type Extra = Omit<Entry, 'source'>;
const safe = (f: () => boolean) => () => { try { return f(); } catch { return true; } };

export function commandEntries(ctx: Ctx): Entry[] {
  const can = (cmd: Command) => safe(() => !!ctx.view && cmd(ctx.view.state));
  const out: Entry[] = [];
  for (const b of BINDINGS) {
    if (HIDDEN.has(b.id)) continue;
    const k = keyOf(b.id), cmd = b.run;
    out.push({
      key: `cmd:${b.id}`, source: 'cmd', label: b.label, group: b.group, hint: TOOL_HINTS.get(b.id),
      keywords: `${keyWords(k)} ${SYN[b.id] ?? ''}`, shortcut: k, settings: { page: 'keys', query: b.label },
      run: cmd ? () => ctx.run(cmd) : () => { ctx.app(b.id); return true; },
      // whole-document tools walk the file to find out, so they're never dimmed
      can: cmd ? (b.group === 'Doc tools' ? undefined : can(cmd)) : () => !ctx.blocked(b.id),
    });
  }
  const seen = new Set<string>();
  for (const f of fixedCommands) {
    if (NOT_COMMANDS.has(f.label) || seen.has(f.label)) continue;
    seen.add(f.label);
    out.push({ key: `fix:${f.label}`, source: 'cmd', label: f.label, group: 'Editing', keywords: keyWords(f.key), shortcut: f.key, run: () => ctx.run(f.run), can: can(f.run) });
  }

  const sized = (d: number): Command => (state, dispatch) => setFontSize(fontSizeAt(state) + d)(state, dispatch);
  const brush = (kind: 'highlight' | 'shading'): Command => (state, dispatch) => { dispatch?.(state.tr.setMeta(brushKey, kind)); return true; };
  const extra: Entry[] = ([
    { key: 'x:bigger', label: 'Bigger text', group: 'Format', keywords: 'font size increase grow', run: () => ctx.run(sized(1)) },
    { key: 'x:smaller', label: 'Smaller text', group: 'Format', keywords: 'font size decrease', run: () => ctx.run(sized(-1)) },
    ...FONT_COLORS.map(([c, n]): Extra => ({ key: `x:font:${n}`, label: `Font color: ${n}`, group: 'Format', keywords: 'text ink', run: () => ctx.run(toggleColorMark(schema.marks.color, c)) })),
    { key: 'x:brushH', label: 'Highlight paintbrush', group: 'Format', keywords: 'brush paint drag highlighter', hint: 'Every stretch you select next gets highlighted, or cleared if it already has that color. Esc stops', run: () => ctx.run(brush('highlight')) },
    { key: 'x:brushS', label: 'Background color paintbrush', group: 'Format', keywords: 'brush paint shading', hint: 'Every stretch you select next gets the background color, or loses it if it already has it. Esc stops', run: () => ctx.run(brush('shading')) },
    { key: 'x:speechDoc', label: ctx.isSpeech ? 'Stop using this file as the speech doc' : 'Make this file the speech doc', group: 'Speech', keywords: 'speech doc mark', run: () => { ctx.toggleSpeech(); return true; } },
    { key: 'x:timer', label: 'Start or pause the speech timer', group: 'Speech', keywords: 'clock countdown stopwatch', run: () => { timer({ which: 'speech', op: 'toggle' }); return true; } },
    { key: 'x:timerReset', label: 'Reset the speech timer', group: 'Speech', keywords: 'clock countdown', run: () => { timer({ which: 'speech', op: 'reset' }); return true; } },
    { key: 'x:timerWindow', label: 'Open the timer window', group: 'Speech', keywords: 'clock countdown stopwatch prep round speeches', run: () => { timer({ which: 'speech', op: 'open' }); return true; } },
    { key: 'x:prep', label: 'Start or pause our prep', group: 'Speech', keywords: 'clock countdown prep timer', run: () => { timer({ which: 'prep', op: 'toggle' }); return true; } },
    { key: 'x:prepReset', label: 'Reset our prep', group: 'Speech', keywords: 'clock countdown prep timer', run: () => { timer({ which: 'prep', op: 'reset' }); return true; } },
    { key: 'x:theirPrep', label: 'Start or pause their prep', group: 'Speech', keywords: 'clock countdown prep timer opponent other team', run: () => { timer({ which: 'their', op: 'toggle' }); return true; } },
    { key: 'x:theirPrepReset', label: 'Reset their prep', group: 'Speech', keywords: 'clock countdown prep timer opponent other team', run: () => { timer({ which: 'their', op: 'reset' }); return true; } },
    ...(pref(P.showPrep) ? [] : [{ key: 'x:prepOn', label: 'Show the prep timer in the top bar', group: 'Speech', keywords: 'clock prep time', run: () => { setPref(P.showPrep, true); return true; } }]),
    ...['pockets only', 'down to hats', 'down to blocks', 'down to tags'].map((what, i): Extra => ({
      key: `x:depth${i + 1}`, label: `Outline: ${what}`, group: 'Outline', keywords: `depth level ${i + 1}`, state: ctx.showOutline && ctx.depth === i + 1 ? 'Now' : undefined,
      run: () => { ctx.setDepth(i + 1); ctx.setShowOutline(true); return true; },
    })),
    ...Object.entries(PAGES).map(([id, title]): Extra => ({
      key: `x:page:${id}`, label: `Settings: ${title}`, group: 'Settings', badge: 'SET', keywords: id === 'keys' ? 'shortcuts hotkeys rebind keyboard' : 'preferences',
      run: () => { ctx.openSettings(id); return true; },
    })),
    { key: 'x:about', label: `Falcon ${version}`, group: 'About', keywords: 'version about install update', run: () => { ctx.openSettings('general'); return true; } },
  ] as Extra[]).map((e): Entry => ({ ...e, source: 'cmd' }));
  // one heading per group: Send to speech (a key binding) sits with the other Speech rows
  const all = [...out, ...extra];
  return [...new Set(all.map((e) => e.group))].flatMap((g) => all.filter((e) => e.group === g));
}

// ---------- settings ----------

type Value = string | number | boolean;
/** One setting: its Settings row (page and label) and how to read and change it. No options = on/off. */
export type SettingDef = { id: string; label: string; page: string; hint?: string; query?: string; get: () => Value; set: (v: Value) => void; options?: [Value, string][]; link?: boolean };

const PENS: [string, string][] = Object.keys(HIGHLIGHTS).map((k) => [k, HIGHLIGHT_NAMES[k]]);
const FONTS: [string, string][] = [['calibri', 'Calibri'], ['arial', 'Arial'], ['verdana', 'Verdana'], ['georgia', 'Georgia'], ['times', 'Times New Roman'], ['comic', 'Comic Sans']];
const UI_FONTS: [string, string][] = [['system', 'System'], ['geist', 'Geist'], ['inter', 'Inter'], ['switzer', 'Switzer'], ['figtree', 'Figtree'], ['halden', 'Halden']]; // Settings.tsx UI_FONTS
const STYLES: [string, string][] = [['normal', 'Normal text'], ['pocket', 'Pocket'], ['hat', 'Hat'], ['block', 'Block'], ['tag', 'Tag'], ['analytic', 'Analytic'], ['undertag', 'Undertag']];
const range = (from: number, to: number, step: number, unit: (n: number) => string): [number, string][] =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => [from + i * step, unit(from + i * step)]);
const pt = (n: number) => `${n} pt`, min = (n: number) => `${n}:00`;
/** Reading speeds in 25 wpm steps, plus the saved one when it was typed in Settings (237), so it shows and cycles from there. */
const speeds = (p: Pref<number>, same?: string): [number, string][] => {
  const v = pref(p), out = range(150, 425, 25, (n) => `${n} wpm`);
  if (v && !out.some(([n]) => n === v)) out.push([v, `${v} wpm`]), out.sort((a, b) => a[0] - b[0]);
  return same ? [[0, same], ...out] : out;
};

/** Every setting the Settings panel has, labeled the way its row is, so Tab can find the row there. */
export function settingDefs(ctx: Ctx): SettingDef[] {
  const tog = (p: Pref<boolean>, label: string, page: string, hint?: string): SettingDef => ({ id: p.key, label, page, hint, get: () => pref(p), set: (v) => setPref(p, v as boolean) });
  const pick = <T extends string | number>(p: Pref<T>, label: string, page: string, options: [T, string][], hint?: string, query?: string): SettingDef =>
    ({ id: p.key, label, page, hint, query, options, get: () => pref(p), set: (v) => setPref(p, v as T) });
  const spec = (s: SettingSpec): SettingDef => ({
    id: s.key, label: s.label, page: 'editor', hint: s.hint, get: () => readSetting(s),
    set: (v) => localStorage.setItem(s.key, typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v)),
    options: s.kind === 'choice' ? s.options : undefined,
  });
  const size = (p: Pref<number>, style: string, from: number, to: number, step = 1) => pick(p, `${style} size`, 'formatting', range(from, to, step, pt), undefined, style);
  const enterAfter = (st: string, p: Pref<string>) => {
    const n = STYLES.find(([o]) => o === st)![1];
    return pick(p as Pref<string>, `After ${/^[aeiou]/i.test(n) ? 'an' : 'a'} ${n.toLowerCase()}`, 'editor', STYLES, 'What Enter at the end of this heading makes.');
  };
  const themes: [string, string][] = [[SYSTEM, 'System'], ...[...PRESETS, ...customThemes()].map((t): [string, string] => [t.id, t.name])];
  const prep = pref(P.prepMin);
  return [
    // General
    { id: P.openHome.key, label: 'Open on launch', page: 'general', hint: 'What Falcon shows when it starts.', options: [['home', 'Home'], ['doc', 'Last document']],
      get: () => (pref(P.openHome) ? 'home' : 'doc'), set: (v) => setPref(P.openHome, v === 'home') },
    tog(P.reopen, 'Restore open files', 'general', 'Reopen the files you had open when you quit.'),
    tog(P.fileWindows, 'Open files in new windows', 'general', 'Each file and new document gets its own window instead of a tab.'),
    pick(P.lowTime, 'Low time flash', 'general', [[0, 'Off'], [10, '10 s'], [30, '30 s'], [60, '1 min']], 'The running clock flashes red for its last seconds.'),
    tog(P.beep, 'Timer sound', 'general', 'Two short tones when a timer reaches zero.'),
    tog(P.confirmClose, 'Unsaved changes confirmation', 'general', 'Ask before closing a file or quitting with unsaved changes.'),
    tog(P.crashRecovery, 'Crash recovery', 'general', 'Keep a copy of open files, brought back if Falcon closes unexpectedly.'),
    { id: P.recentCount.key, label: 'Recent files', page: 'general', query: 'Recent files count Home list', hint: 'Type it in Settings.', link: true, get: () => String(pref(P.recentCount)), set: () => {} },
    pick(P.newName, 'Name new files', 'general', (['untitled', 'speech', 'date'] as const).map((h) => [h, newFileName(h)]), 'What an Untitled document is called when you first save it.'),
    tog(P.aiOn, 'AI features', 'ai', 'Format cites with AI, on your own API key. Off by default.'),
    pick(P.aiProvider, 'AI provider', 'ai', [['anthropic', 'Anthropic'], ['openrouter', 'OpenRouter']]),
    { id: P.aiModel.key, label: 'AI model', page: 'ai', query: 'AI model claude', hint: 'Type it in Settings.', link: true, get: () => pref(P.aiModel), set: () => {} },
    { id: P.aiRouterModel.key, label: 'OpenRouter model', page: 'ai', query: 'AI model openrouter gpt gemini deepseek', hint: 'Type it in Settings.', link: true, get: () => pref(P.aiRouterModel), set: () => {} },
    pick(P.aiCitePreset, 'AI cite-creator prompt', 'ai', [['', 'Built-in prompt'], ...citePresets().map((f): [string, string] => [f.id, f.name])]),
    { id: P.aiCitePresets.key, label: 'AI cite-creator prompt presets', page: 'ai', query: 'AI cite prompt preset', hint: 'Save them in Settings.', link: true, get: () => currentPreset()?.name ?? 'Built-in prompt', set: () => {} },
    { id: P.aiMaxTokens.key, label: 'AI max output tokens', page: 'ai', query: 'AI max output tokens', hint: 'Type it in Settings.', link: true, get: () => pref(P.aiMaxTokens), set: () => {} },
    { id: TEMPLATES_KEY, label: 'Templates', page: 'templates', query: 'Templates', hint: 'Set them in Settings.', link: true, get: () => String(loadTemplates().length), set: () => {} },
    { id: P.relayUrl.key, label: 'Card sharing relay', page: 'general', query: 'Relay', hint: 'Type it in Settings.', link: true, get: () => pref(P.relayUrl) || 'None', set: () => {} },
    { id: P.speechName.key, label: 'Speech doc name', page: 'general', query: 'Speech doc name filename', hint: 'Type it in Settings.', link: true, get: () => pref(P.speechName), set: () => {} },
    tog(P.savePrefix, 'Prefix Save As copies', 'general', 'Send, Read and Marked Doc copies start with a prefix.'),
    { id: P.prefixSend.key, label: 'Send Doc filename prefix', page: 'general', query: 'Send Doc filename prefix', hint: 'Type it in Settings.', link: true, get: () => pref(P.prefixSend), set: () => {} },
    { id: P.prefixRead.key, label: 'Read Doc filename prefix', page: 'general', query: 'Read Doc filename prefix', hint: 'Type it in Settings.', link: true, get: () => pref(P.prefixRead), set: () => {} },
    { id: P.prefixMarked.key, label: 'Marked Doc filename prefix', page: 'general', query: 'Marked Doc filename prefix', hint: 'Type it in Settings.', link: true, get: () => pref(P.prefixMarked), set: () => {} },
    tog(P.usageStats, 'Share usage statistics', 'general', 'Send anonymous counts of which features get used. Never file names or anything you type.'),
    // Appearance
    pick(P.theme, 'Theme', 'appearance', themes, 'The colors of Falcon and the page.'),
    pick(P.uiFont, 'Interface font', 'appearance', UI_FONTS, 'Menus, tooltips, Settings and the top bar.'),
    pick(P.paper, 'Document paper', 'appearance', [['theme', 'Theme'], ['white', 'White'], ['dark', 'Dark']], 'Dark to read at night in any theme.'),
    { id: 'app.highlight', label: 'Highlighter', page: 'appearance', hint: 'Your highlight color.', options: PENS, get: () => ctx.highlight ?? '', set: (v) => ctx.setHighlight(v as string) },
    { id: 'app.zoom', label: 'Zoom', page: 'appearance', hint: 'How big the page is.', options: [...range(50, 200, 10, (n) => `${n}%`), [250, '250%'], [300, '300%']],
      get: () => Math.round(ctx.zoom * 100), set: (v) => ctx.setZoom((v as number) / 100) },
    tog(P.wheelZoom, 'Zoom with the scroll wheel', 'appearance'),
    pick(P.textWidth, 'Text width', 'appearance', [['full', 'Full'], ['wide', 'Wide'], ['narrow', 'Narrow']]),
    pick(P.margins, 'Margins', 'appearance', [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']]),
    tog(P.railResize, 'Resizable rail', 'appearance', 'Drag the rail\'s right edge to show the names of open files.'),
    pick(P.joinMax, 'Files side by side', 'appearance', [[2, '2'], [3, '3'], [4, '4'], [5, '5']], 'The most files Join shows at once.'),
    pick(P.caret, 'Cursor color', 'appearance', [['auto', 'Text'], ['blue', 'Blue'], ['red', 'Red'], ['ink', 'Highlighter']]),
    pick(P.selection, 'Selection color', 'appearance', [['blue', 'Blue'], ['gray', 'Gray'], ['ink', 'Highlighter']]),
    tog(P.cardBar, 'Mark the current card', 'appearance', 'A thin line beside the card the cursor is in.'),
    tog(P.reduceMotion, 'Reduce motion', 'appearance', 'Turn off animations.'),
    tog(P.launchFalcon, 'Falcon on launch', 'appearance', 'The falcon sweeps in over Home when Falcon starts.'),
    // Editor
    tog(P.spellcheck, 'Check spelling', 'editor', 'Misspelled words get a red underline.'),
    { id: 'app.outline', label: 'Show outline pane', page: 'editor', get: () => ctx.showOutline, set: (v) => ctx.setShowOutline(v as boolean) },
    { id: 'app.depth', label: 'Outline depth', page: 'editor', options: [[1, '1'], [2, '2'], [3, '3'], [4, '4']], get: () => ctx.depth, set: (v) => ctx.setDepth(v as number) },
    pick(P.openDepth, 'Depth for opened files', 'editor', [[0, 'Keep'], [1, '1'], [2, '2'], [3, '3'], [4, '4']]),
    pick(P.cardLinks, 'Card links', 'editor', [['quiet', 'Quiet'], ['page', 'Page slice'], ['off', 'Off']]),
    tog(P.outlinePreview, 'Card preview in the outline', 'editor', 'Rest on a tag in the outline and its card shows beside the pane.'),
    tog(P.readParas, 'Keep paragraphs apart', 'editor', 'In read mode, each paragraph stays on its own line.'),
    tog(P.readWholeCite, 'Show the whole cite', 'editor', 'In read mode, all of a cite line.'),
    tog(P.readUndertags, 'Show undertags', 'editor', 'Undertags stay visible while you read.'),
    tog(P.readShading, 'Show background color', 'editor', 'In read mode, text with a background color shows.'),
    tog(P.readTop, 'Jump to the top', 'editor', 'Turning read mode on or off moves to the start of the file.'),
    pick(P.markerColor, 'Marker color', 'editor', [['#FF0000', 'Red'], ['#0070C0', 'Blue'], ['#00B050', 'Green'], ['#7030A0', 'Purple']]),
    tog(P.markerTime, 'Marker shows the time', 'editor'),
    pick(P.condense, 'F3 condenses to', 'editor', [['integrity', 'Keep paragraphs'], ['merge', 'Merge'], ['pilcrows', 'Merge with ¶']]),
    tog(P.smallPilcrows, 'Small ¶ marks', 'editor'),
    tog(P.pasteCondense, 'Condense after Paste Text', 'editor'),
    tog(P.shrinkProtect, 'Keep omission notes full size', 'editor'),
    tog(P.smartShrink, 'Smart Shrink', 'editor', 'Mod-8 shrinks in one pass instead of cycling sizes.'),
    tog(P.smartQuotes, 'Smart quotes', 'editor'),
    tog(P.smartPaste, 'Smart paste', 'editor', 'Word and Verbatim formatting pastes as cites, underlining and highlights.'),
    tog(P.citeNearest, 'Copy previous cite: first line only', 'editor'),
    tog(P.hlUnderlined, 'Highlight underlined text only', 'editor'),
    tog(P.styleOffClears, 'Clear formatting when underline comes off', 'editor'),
    enterAfter('pocket', P.enterPocket), enterAfter('hat', P.enterHat), enterAfter('block', P.enterBlock),
    enterAfter('tag', P.enterTag), enterAfter('analytic', P.enterAnalytic), enterAfter('undertag', P.enterUndertag),
    ...[...navSettings, ...docToolSettings, ...cardToolSettings].map(spec),
    // Formatting
    size(P.szPocket, 'Pocket', 18, 36, 2), size(P.szHat, 'Hat', 14, 28, 2), size(P.szBlock, 'Block', 12, 22), size(P.szTag, 'Tag', 10, 16),
    size(P.szAnalytic, 'Analytic', 10, 16), size(P.szUndertag, 'Undertag', 8, 14), size(P.szCite, 'Cite', 10, 16), size(P.szNormal, 'Body text', 8, 14),
    { id: P.emphasisBox.key, label: 'Emphasis look', page: 'formatting', query: 'Emphasis', options: [['box', 'Bold and box'], ['bold', 'Bold only']],
      get: () => (pref(P.emphasisBox) ? 'box' : 'bold'), set: (v) => setPref(P.emphasisBox, v === 'box') },
    pick(P.shrinkMin, 'Shrink down to', 'formatting', [[4, '4 pt'], [6, '6 pt'], [8, '8 pt']], 'The smallest size Shrink steps down to.', 'Unread text'),
    pick(P.font, 'Editor font', 'formatting', FONTS),
    pick(P.lineHeight, 'Line spacing', 'formatting', [['1', '1.0'], ['1.2', '1.2'], ['1.3', '1.3'], ['1.5', '1.5'], ['2', '2.0']]),
    tog(P.pocketBox, 'Box around pockets', 'formatting'),
    pick(P.hatLine, 'Hat underline', 'formatting', [['double', 'Double'], ['single', 'Single']]),
    tog(P.citeBold, 'Bold cites', 'formatting'),
    { id: P.colorAnalytic.key, label: 'Analytic color', page: 'formatting', hint: 'Pick it in Settings.', link: true, get: () => pref(P.colorAnalytic), set: () => {} },
    { id: P.colorUndertag.key, label: 'Undertag color', page: 'formatting', hint: 'Pick it in Settings.', link: true, get: () => pref(P.colorUndertag), set: () => {} },
    tog(P.shadingDots, 'Dots on background color', 'formatting'),
    // Speech and timers
    { id: P.round.key, label: 'Round', page: 'speech', hint: 'The speeches the timer window steps through.', options: (['policy', 'ld', 'pf'] as const).map((f) => [f, FORMAT_NAME[f]]),
      get: () => pref(P.round), set: (v) => { const f = v as RoundFormat; setPref(P.round, f); setPref(P.prepMin, f === 'policy' && ctx.speechMin === 9 ? 10 : FORMAT_PREP[f]); } },
    { id: 'app.event', label: 'Event', page: 'speech', hint: 'High school: 8 minute speeches, 8 of prep. College: 9 and 10.', options: [['hs', 'High school'], ['college', 'College']],
      get: () => (ctx.speechMin === 8 && prep === 8 ? 'hs' : ctx.speechMin === 9 && prep === 10 ? 'college' : ''),
      set: (v) => { ctx.setSpeechMin(v === 'hs' ? 8 : 9); setPref(P.prepMin, v === 'hs' ? 8 : 10); } },
    { id: 'app.speech', label: 'Speech length', page: 'speech', options: range(1, 30, 1, min), get: () => ctx.speechMin, set: (v) => ctx.setSpeechMin(v as number) },
    tog(P.showSend, 'Send button', 'speech', 'A Send button beside Read in the top bar.'),
    tog(P.showPrep, 'Prep timer', 'speech', 'Our prep clock in the top bar, beside the speech timer.'),
    pick(P.prepMin, 'Prep time', 'speech', range(1, 15, 1, min)),
    pick(P.wpm1, 'Reader 1: cards', 'speech', speeds(P.wpm1), 'How fast Reader 1 reads highlighted card text.'),
    pick(P.wpm1Tags, 'Reader 1: tags and analytics', 'speech', speeds(P.wpm1Tags, 'Same as cards'), 'How fast Reader 1 reads tags, analytics and cites.'),
    pick(P.wpm2, 'Reader 2: cards', 'speech', speeds(P.wpm2), 'How fast Reader 2 reads highlighted card text.'),
    pick(P.wpm2Tags, 'Reader 2: tags and analytics', 'speech', speeds(P.wpm2Tags, 'Same as cards'), 'How fast Reader 2 reads tags, analytics and cites.'),
  ];
}

/**
 * Settings as rows, named the way CardMirror names them: Toggle <setting> flips it, Cycle <setting> steps to
 * the next choice (Tab lists them all), and "<setting>: <choice>" rows show up once you type.
 */
export function settingEntries(ctx: Ctx): Entry[] {
  return settingDefs(ctx).flatMap((d): Entry[] => {
    const base = { source: 'set' as const, group: PAGES[d.page], hint: d.hint, settings: { page: d.page, query: d.query ?? d.label } };
    const open = () => { ctx.openSettings(d.page, d.query ?? d.label); return true; };
    if (d.link) return [{ ...base, key: `set:${d.id}`, label: d.label, badge: 'SET', run: open }];
    if (!d.options) {
      return [{ ...base, key: `set:${d.id}`, label: `Toggle ${d.label}`, badge: 'TOG', state: d.get() ? 'On' : 'Off', keywords: 'turn on off enable disable', run: () => { d.set(!d.get()); } }];
    }
    const opts = d.options, cur = d.get();
    const i = opts.findIndex(([v]) => v === cur), next = opts[(i + 1) % opts.length];
    const options = (): Option[] => opts.map(([v, n]) => ({ label: n, on: d.get() === v, pick: () => d.set(v) }));
    return [
      { ...base, key: `set:${d.id}`, label: `Cycle ${d.label}`, badge: 'CYC',
        state: `${i >= 0 ? opts[i][1] : '?'} → ${next[1]}`, options, run: () => { d.set(next[0]); } },
      // "light" finds Theme: Light, "green" Highlighter: Green
      ...opts.map(([v, n]): Entry => ({ ...base, key: `set:${d.id}=${v}`, label: `${d.label}: ${n}`, badge: 'SET', typedOnly: true, state: cur === v ? 'Now' : undefined, run: () => { d.set(v); } })),
    ];
  });
}

// ---------- the open file ----------

const STYLE_NAME: Partial<Record<ParaStyle, string>> = { pocket: 'Pocket', hat: 'Hat', block: 'Block', tag: 'Tag', analytic: 'Analytic' };
// CardMirror's badges for headings in a file
const STYLE_BADGE: Partial<Record<ParaStyle, string>> = { pocket: 'POC', hat: 'HAT', block: 'BLK', tag: 'TAG', analytic: 'ANL' };

/** The cite under each outline row (by index), so "smith 24" finds Smith's card. */
export function citesUnder(doc: PMNode): string[] {
  const out: string[] = [];
  let i = -1;
  doc.forEach((n) => {
    if (LEVEL[n.attrs.style as ParaStyle]) { i++; return; }
    if (i < 0 || out[i] !== undefined) return;
    let c = '';
    n.forEach((t) => { if (schema.marks.cite.isInSet(t.marks)) c += `${t.text} `; });
    if (c.trim()) out[i] = c.trim();
  });
  return out;
}

export function headingEntries(ctx: Ctx): Entry[] {
  const v = ctx.view;
  if (!v) return [];
  const items = buildOutline(v.state.doc), cites = citesUnder(v.state.doc);
  return items.map((it, i) => ({
    key: `doc:${i}`, source: 'doc', label: it.text || '(empty heading)', group: STYLE_NAME[it.style] ?? '', badge: STYLE_BADGE[it.style], level: it.level,
    keywords: cites[i] ?? '', hint: cites[i], run: () => { ctx.jump(i); return true; }, peek: () => ctx.peek(i),
  }));
}

/** Rows for a typed value ("zoom 150", "card 12"…), shown first. */
export function argEntries(ctx: Ctx, args: Arg[]): Entry[] {
  return args.map((a): Entry => {
    const base = { key: `arg:${a.kind}`, source: 'arg' as const, group: 'Go' };
    switch (a.kind) {
      case 'zoom': return { ...base, label: `Zoom to ${a.n}%`, group: 'View', run: () => { ctx.setZoom(a.n / 100); return true; } };
      case 'size': return { ...base, label: `Font size ${a.n} pt`, group: 'Format', run: () => ctx.run(setFontSize(a.n)) };
      case 'depth': return { ...base, label: `Outline depth ${a.n}`, group: 'Outline', run: () => { ctx.setDepth(a.n); ctx.setShowOutline(true); return true; } };
      case 'speech': return { ...base, label: `Speech timer: ${a.n} minutes`, group: 'Speech', run: () => { ctx.setSpeechMin(a.n); return true; } };
      case 'prep': return { ...base, label: `Prep timer: ${a.n} minutes`, group: 'Speech', run: () => { setPref(P.prepMin, a.n); setPref(P.showPrep, true); return true; } };
      case 'card': {
        const items = ctx.view ? buildOutline(ctx.view.state.doc) : [];
        const cards = items.map((it, i) => [it, i] as const).filter(([it]) => it.level === 4);
        const hit = cards[a.n - 1];
        if (!hit) return { ...base, label: `No card ${a.n} (this file has ${cards.length})`, can: () => false, run: () => false };
        return { ...base, label: `Go to card ${a.n}: ${hit[0].text || '(empty tag)'}`, run: () => { ctx.jump(hit[1]); return true; }, peek: () => ctx.peek(hit[1]) };
      }
    }
  });
}

/** Rows that take the typed text itself: find it, or replace it. Always last. */
export function textEntries(ctx: Ctx, text: string): Entry[] {
  const t = text.trim();
  if (!t || !ctx.view) return [];
  return [
    { key: 'find', source: 'cmd', label: `Find “${t}” in this file`, group: 'Find', shortcut: keyOf('find'), run: () => { ctx.find(t, false); return true; } },
    { key: 'replace', source: 'cmd', label: `Replace “${t}”…`, group: 'Find', shortcut: keyOf('replace'), run: () => { ctx.find(t, true); return true; } },
  ];
}


// ---------- files ----------

const KIND_NAME = { open: 'Open', recent: 'Recent', file: '', cmd: '' };
/** .docx files as DOCX rows: picking one switches to it when it's open, or opens it. */
/** One row per template: Enter opens its files, Tab goes to it in Settings. A file's name finds it too, more weakly. */
export function templateEntries(ctx: Ctx): Entry[] {
  const open = ctx.openTemplate;
  if (!open) return [];
  return loadTemplates().map((t): Entry => ({
    key: `tpl:${t.id}`, source: 'tpl', label: templateName(t), badge: 'TPL', group: 'Templates', hint: fileCount(t.paths.length),
    keywords: `template ${t.paths.map(pathName).join(' ')}`, settings: { page: 'templates', query: templateName(t) },
    can: () => t.paths.length > 0, run: () => { if (!t.paths.length) return false; open(t); },
  }));
}

export function fileEntries(ctx: Ctx, hits: FileHit[]): Entry[] {
  return hits.map((h): Entry => ({
    key: `file:${h.path ?? h.key}`, source: 'file', label: h.name, badge: 'DOCX',
    group: h.kind === 'file' ? h.folder || 'Files' : KIND_NAME[h.kind], keywords: `${h.folder} docx file`,
    hint: h.path, file: h, run: () => { ctx.openFile?.(h); },
  }));
}

// ---------- blocks in another file (Search blocks) ----------

/** Another file's headings as rows to insert from, with the cite under each card. `items` holds each row's spot in `doc`. */
export function blockEntries(doc: PMNode): { items: OutlineItem[]; entries: Entry[] } {
  const items = buildOutline(doc), cites = citesUnder(doc);
  const entries = items.map((it, i): Entry => ({
    key: `blk:${i}`, source: 'blk', label: it.text || '(empty heading)', group: STYLE_NAME[it.style] ?? '', badge: STYLE_BADGE[it.style],
    level: it.level, keywords: cites[i] ?? '', hint: cites[i],
  }));
  return { items, entries };
}

/** A heading that can fold: a pocket, hat or block with something under it. */
export const canFold = (levels: readonly number[], i: number) => levels[i] <= 3 && (levels[i + 1] ?? 0) > levels[i];

/** Folded when the list opens, as CardMirror does: every block, so a file shows its pockets, hats and blocks. */
export function startFolded(levels: readonly number[]): Set<number> {
  const out = new Set<number>();
  levels.forEach((l, i) => { if (l >= 3 && canFold(levels, i)) out.add(i); });
  return out;
}

/** The rows shown with nothing typed: the file's tree, minus what sits under a folded heading. */
export function visibleTree(levels: readonly number[], folded: ReadonlySet<number>): number[] {
  const out: number[] = [];
  let hideBelow = Infinity;
  levels.forEach((l, i) => {
    if (l <= hideBelow) hideBelow = Infinity;
    if (hideBelow !== Infinity) return;
    out.push(i);
    if (folded.has(i) && canFold(levels, i)) hideBelow = l;
  });
  return out;
}
