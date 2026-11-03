// Launches the Electron app (dev tree, or a packaged build via FALCON_EXE) with no visible window,
// types and formats a card with the real keys, checks the result, and screenshots it.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const { ELECTRON_RUN_AS_NODE, ...env } = process.env; // set by some hosts; it turns Electron into plain Node
const exe = process.env.FALCON_EXE;
env.FALCON_USER_DATA = fs.mkdtempSync(`${os.tmpdir()}/falcon-smoke-`);
// any existing .docx, never picked in a dialog: Save must write it in place, with no dialog
const keptDoc = path.join(fs.mkdtempSync(`${os.tmpdir()}/falcon-kept-`), 'Kept.docx');
fs.writeFileSync(keptDoc, 'old');
const app = await electron.launch(exe ? { executablePath: exe, env: { ...env, FALCON_HEADLESS: '1' } } : { args: ['.'], env: { ...env, FALCON_HEADLESS: '1' } });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('.ProseMirror');
const homeAtLaunch = await win.evaluate(() => !!document.querySelector('.home.open'));
await win.keyboard.press('Escape'); await win.waitForTimeout(400); // close Home
const homeAfterEsc = await win.evaluate(() => !!document.querySelector('.home.open'));
// reopening by path only works for files picked in a dialog before
const strayOpen = await win.evaluate(() => window.falcon.openPath('/etc/hosts.docx').then(() => 'opened', (e) => 'refused: ' + e.message));
await win.click('.ProseMirror');
await win.keyboard.press(`${mod}+a`); await win.keyboard.press('Backspace');
await win.keyboard.type('Electron tag'); await win.keyboard.press('F7'); await win.keyboard.press('Enter');
await win.keyboard.type('Body text in the desktop app');
// a hidden window has no OS focus, so the browser's own caret movement is off; select through the editor instead
const selectLast = (n) => win.evaluate((n) => { const v = window.__falconView; const S = v.state.selection.constructor; const to = v.state.selection.$head.end(); v.dispatch(v.state.tr.setSelection(S.create(v.state.doc, to - n, to))); }, n);
await selectLast(3); await win.keyboard.press('F9'); await win.keyboard.press('F11');
await selectLast(11); await win.keyboard.press('F10');
const map = await win.evaluate(() => window.__falconMarkMap());
// select "Body" in the page and press F9 in the same task, before selectionchange can run (what a
// busy page does with a key right after a selection): the key must format "Body", not the old selection
const raced = await win.evaluate(() => {
  const v = window.__falconView;
  const walk = document.createTreeWalker(v.dom, NodeFilter.SHOW_TEXT);
  let n; while ((n = walk.nextNode()) && !n.data.includes('Body'));
  const r = document.createRange(); const i = n.data.indexOf('Body'); r.setStart(n, i); r.setEnd(n, i + 4);
  getSelection().removeAllRanges(); getSelection().addRange(r);
  v.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', code: 'F9', keyCode: 120, bubbles: true, cancelable: true }));
  return window.__falconMarkMap().split('\n')[1];
});
// Electron builds the window's drag region in document order: drag elements add, no-drag ones cut.
// Replay that and list any visible button whose center ends up draggable (a click there moves the window).
const dragged = await win.evaluate(() => {
  const ops = [...document.querySelectorAll('*')].map((el) => ({ el, r: el.getBoundingClientRect(), a: getComputedStyle(el).getPropertyValue('-webkit-app-region').trim() }))
    .filter((o) => (o.a === 'drag' || o.a === 'no-drag') && o.r.width && o.r.height);
  const inDrag = (x, y) => ops.reduce((d, o) => (x >= o.r.left && x < o.r.right && y >= o.r.top && y < o.r.bottom ? o.a === 'drag' : d), false);
  return [...document.querySelectorAll('button')].filter((b) => b.getClientRects().length && !b.closest('[inert]'))
    .filter((b) => { const r = b.getBoundingClientRect(); return inDrag(r.left + r.width / 2, r.top + r.height / 2); })
    .map((b) => b.getAttribute('aria-label') || b.textContent.trim());
});
const savedInPlace = await win.evaluate((p) => Promise.race([
  window.falcon.saveFile({ path: p, name: 'Kept.docx', data: new Uint8Array([80, 75]) }).then((r) => r?.path ?? 'null'),
  new Promise((ok) => setTimeout(() => ok('dialog'), 3000)),
]), keptDoc);
// a file that was moved away: Save asks where, starting in its old folder (dialog stubbed, so nothing shows)
const gone = path.join(path.dirname(keptDoc), 'Moved.docx');
await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async (_w, o) => { globalThis.__asked = o.defaultPath; return { canceled: true }; }; });
const goneResult = await win.evaluate((p) => window.falcon.saveFile({ path: p, name: 'Moved.docx', data: new Uint8Array([80, 75]) }), gone);
const askedAt = await app.evaluate(() => globalThis.__asked);
// File search: a folder added in Settings (dialog stubbed) lists its .docx files, and Cmd-K opens one of them;
// a .docx outside every allowed folder still can't be opened by path
const searchRoot = fs.mkdtempSync(`${os.tmpdir()}/falcon-search-`);
fs.mkdirSync(path.join(searchRoot, 'Allowed', 'Neg'), { recursive: true });
fs.mkdirSync(path.join(searchRoot, 'Other'));
fs.copyFileSync('.claude/skills/verify-falcon/fixtures/seed.docx', path.join(searchRoot, 'Allowed', 'Neg', 'Zebra Counterplan.docx'));
fs.copyFileSync('.claude/skills/verify-falcon/fixtures/seed.docx', path.join(searchRoot, 'Other', 'Outside.docx'));
await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async (_w, o) => (o.properties.includes('openDirectory') ? { canceled: false, filePaths: [dir] } : { canceled: true, filePaths: [] }); }, path.join(searchRoot, 'Allowed'));
await win.keyboard.press(`${mod}+,`);
await win.click('[aria-label="Settings sections"] button:has-text("File search")');
await win.click('.st-btn:has-text("Add folder")');
const folderRow = await win.waitForSelector('.st-fold output:has-text("1 file")', { timeout: 5000 }).then(() => true, () => false);
await win.screenshot({ path: `shots/electron-file-search-settings-${process.platform}.png`, timeout: 15000 }).catch(() => {});
await win.keyboard.press('Escape'); await win.waitForTimeout(300);
const indexed = await win.evaluate(() => window.falcon.indexedFiles().then((f) => f.map((x) => x.path.split(/[\\/]/).pop())));
const outsideOpen = await win.evaluate((p) => window.falcon.openPath(p).then(() => 'opened', (e) => 'refused: ' + e.message), path.join(searchRoot, 'Other', 'Outside.docx'));
await win.keyboard.press(`${mod}+k`);
await win.waitForSelector('.pk input', { timeout: 5000 });
await win.keyboard.type('zebra cp');
await win.waitForSelector('.pk-row[data-on]:has-text("Zebra Counterplan")', { timeout: 5000 }).catch(() => {});
await win.screenshot({ path: `shots/electron-file-search-${process.platform}.png`, timeout: 15000 }).catch(() => {});
await win.keyboard.press('Enter');
const openedByPalette = await win.waitForSelector('.doc-nm[aria-label="Zebra Counterplan"]', { timeout: 8000 }).then(() => true, () => false);
const paletteGone = !(await win.$('.pk'));
// Search cards: the same folder's cards. Enter opens the file at the card (from a blank doc), Mod-Enter puts a copy of it in the open doc
const caretPara = () => win.evaluate(() => window.__falconView.state.selection.$head.parent.textContent);
await win.keyboard.press(`${mod}+n`); await win.waitForTimeout(300);
await win.keyboard.press(`${mod}+Shift+k`);
await win.waitForSelector('.pk input[aria-label="Search cards"]', { timeout: 5000 });
await win.keyboard.type('warming real');
const cardRow = await win.waitForSelector('.pk-card[data-on]:has-text("Warming is real")', { timeout: 15000 }).then(() => true, () => false);
await win.screenshot({ path: `shots/electron-card-search-${process.platform}.png`, timeout: 15000 }).catch(() => {});
await win.keyboard.press('Enter');
const cardOpened = await win.waitForSelector('.doc-nm[aria-label="Zebra Counterplan"]', { timeout: 8000 }).then(() => true, () => false);
await win.waitForTimeout(300);
const cardCaret = await caretPara();
await win.keyboard.press(`${mod}+n`); await win.waitForTimeout(300);
await win.keyboard.press(`${mod}+Shift+k`);
await win.waitForSelector('.pk input[aria-label="Search cards"]', { timeout: 5000 });
await win.keyboard.type('smith growth');
await win.waitForSelector('.pk-card[data-on]:has-text("Growth is slowing")', { timeout: 5000 }).catch(() => {});
await win.keyboard.press(`${mod}+Enter`);
await win.waitForTimeout(800);
const cardInserted = await win.evaluate(() => window.__falconView.state.doc.textContent);
// Spelling: the page is checked, a misspelled word's right-click menu has the guesses and Add to Dictionary
// (a hidden window never runs the checker, so the menu is built from the params a misspelled word sends),
// an added word lists in Settings and can be removed there, and the setting turns the checking off
const spellAttr = () => win.$eval('.ProseMirror', (e) => e.getAttribute('spellcheck'));
const spellOn = await spellAttr();
const spellMenu = await app.evaluate(({ BrowserWindow }) => {
  const wc = BrowserWindow.getAllWindows()[0].webContents;
  const items = globalThis.falconContextMenu(wc, { misspelledWord: 'Nystuen', dictionarySuggestions: ['Nystrom', 'Nyström'], isEditable: true, selectionText: '', editFlags: { canCut: false, canCopy: false, canPaste: true } });
  items.find((i) => i.label === 'Add to Dictionary').click();
  return items.map((i) => i.label ?? i.role ?? '-').join(',');
});
await new Promise((ok) => setTimeout(ok, 300));
await win.keyboard.press(`${mod}+,`);
await win.click('[aria-label="Settings sections"] button:has-text("Editor")');
const wordListed = await win.waitForSelector('[aria-label="Remove Nystuen from the dictionary"]', { timeout: 5000 }).then(() => true, () => false);
await win.screenshot({ path: `shots/electron-spelling-settings-${process.platform}.png`, timeout: 15000 }).catch(() => {});
await win.click('[aria-label="Remove Nystuen from the dictionary"]').catch(() => {});
const wordGone = await win.waitForSelector('[aria-label="Remove Nystuen from the dictionary"]', { state: 'detached', timeout: 5000 }).then(() => true, () => false);
await new Promise((ok) => setTimeout(ok, 300));
const wordsAfter = await win.evaluate(() => window.falcon.dictionaryWords());
await win.click('[role=switch][aria-label="Check spelling"]');
const spellOff = await spellAttr();
await win.click('[role=switch][aria-label="Check spelling"]');
await win.click('[aria-label="Close settings"]');
// read mode locks the doc: no spellcheck (so no guesses to click), and the menu's Cut deletes nothing.
// Control first: the same Cut outside read mode does cut, then undo puts it back.
const docText = () => win.evaluate(() => window.__falconView.state.doc.textContent);
const cutLast = async () => { await selectLast(4); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.cut()); await win.waitForTimeout(300); };
const before = await docText();
await cutLast();
const cutWorks = (await docText()) !== before;
await win.keyboard.press(`${mod}+z`); await win.waitForTimeout(200);
await win.click('.tools [aria-label="Read mode"]'); await win.waitForTimeout(300);
const readSpell = await spellAttr();
await cutLast();
const readCutKept = (await docText()) === before;
await win.click('.tools [aria-label="Read mode"]'); await win.waitForTimeout(300);
const bridge = await win.evaluate(() => Object.keys(window.falcon || {}).sort().join(','));
const platform = await win.evaluate(() => window.falcon?.platform);
const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()));
const menu = await app.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.items ?? []).map((i) => i.label));
// a theme change reaches the window: its background and the next launch's (userData/theme.json) follow it
await win.click('.fstrip [aria-label="Settings"]');
await win.click('[aria-label="Settings sections"] button:has-text("Appearance")');
await win.click('[aria-label="Theme"] [role=radio][aria-label="Light"]');
await new Promise((ok) => setTimeout(ok, 300));
const winBg = await app.evaluate(({ BrowserWindow, nativeTheme }) => [BrowserWindow.getAllWindows()[0].getBackgroundColor(), nativeTheme.themeSource]);
const themeFile = (() => { try { return JSON.parse(fs.readFileSync(path.join(env.FALCON_USER_DATA, 'theme.json'), 'utf8')); } catch { return null; } })();
await win.click('[aria-label="Theme"] [role=radio][aria-label="System"]');
await new Promise((ok) => setTimeout(ok, 300));
const systemSource = await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource);
await win.click('[aria-label="Theme"] [role=radio][aria-label="Dark"]');
await win.click('[aria-label="Close settings"]');
fs.mkdirSync('shots', { recursive: true });
// Windows doesn't paint hidden windows; on CI runners (no user to disturb) show it without focus to capture it
if (process.env.CI) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.showInactive()));
try { await win.screenshot({ path: `shots/electron-${process.platform}.png`, timeout: 15000 }); }
catch (e) { console.error('screenshot failed:', e.message.split('\n')[0]); process.exitCode = 1; }
// closing with an unsaved doc asks in Falcon's own dialog: Cancel keeps the window, the other button closes it
const winCount = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
const tryClose = () => app.evaluate(({ BrowserWindow }) => { globalThis.falconSkipUnloadGuard = false; BrowserWindow.getAllWindows()[0].close(); });
await tryClose();
const askTitle = await win.waitForSelector('.cf', { timeout: 5000 }).then(() => win.$eval('.cf h2', (h) => h.textContent), () => null);
await win.waitForTimeout(400); // let the dialog finish fading in
await win.screenshot({ path: `shots/electron-confirm-${process.platform}.png`, timeout: 15000 }).catch(() => {});
await win.click('.cf button:not(.cf-ok)');
await win.waitForTimeout(300);
const keptAfterCancel = (await winCount()) === 1 && !(await win.$('.cf'));
await tryClose();
await win.waitForSelector('.cf', { timeout: 5000 }).catch(() => {});
const closedNow = new Promise((ok) => win.once('close', () => ok(true)));
await win.click('.cf-ok').catch(() => {});
const closedAfterOk = await Promise.race([closedNow, new Promise((ok) => setTimeout(() => ok(false), 5000))]);
if (!closedAfterOk) await app.evaluate(() => { globalThis.falconSkipUnloadGuard = true; }); // never hang on a dialog left up
await app.close();

console.log(map, '\nplatform:', platform, '| bridge:', bridge, '| visible:', visible, '| menu:', menu);
const want = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } };
// emphasis replaced the underline on "app"; highlight stays on "app"
want(map === 'tag: Electron tag\nnormal: Body text in the [desktop ]{emphasis}[app]{emphasis+highlight:yellow}', `marks: ${JSON.stringify(map)}`);
want(bridge === 'addIndexFolder,checkUpdate,dictionaryWords,forceClose,indexFolders,indexedFiles,installUpdate,onConfirmClose,onMenu,onOpenPaths,onUpdate,openFile,openPath,platform,readClipboardText,removeDictionaryWord,removeIndexFolder,saveFile,searchCards,setMenuKeys,setTheme,track', `preload bridge: ${bridge}`);
want(spellOn === 'true' && spellOff === 'false', `the page is spellchecked, and Check spelling turns it off: ${spellOn} ${spellOff}`);
want(cutWorks && readSpell === 'false' && readCutKept, `read mode: no spellcheck, and the menu's Cut leaves the doc alone (control cut worked: ${cutWorks}): ${readSpell} ${readCutKept}`);
want(spellMenu === 'Nystrom,Nyström,-,Add to Dictionary,-,cut,copy,paste', `a misspelled word's right-click menu: ${spellMenu}`);
want(wordListed && wordGone && wordsAfter.length === 0, `Add to Dictionary lists the word in Settings, and removing it there takes it out: ${wordListed} ${wordGone} ${wordsAfter}`);
want(folderRow, 'Settings > File search > Add folder lists the folder with its file count');
want(indexed.join() === 'Zebra Counterplan.docx', `indexed files are the allowed folder's .docx files: ${indexed}`);
want(outsideOpen.startsWith('refused'), `openPath refuses a .docx outside the allowed folders: ${outsideOpen}`);
want(openedByPalette && paletteGone, 'Cmd-K, typing and Enter opens the indexed file and closes the palette');
want(cardRow && cardOpened && cardCaret === 'Warming is real', `Search cards finds a card by its tag and Enter opens its file at it: ${cardRow} ${cardOpened} ${JSON.stringify(cardCaret)}`);
want(cardInserted.startsWith('Growth is slowingSmith 24'), `Mod-Enter in Search cards puts the card into the open doc: ${JSON.stringify(cardInserted.slice(0, 80))}`);
want(winBg[0].toLowerCase() === '#f4f4f5' && winBg[1] === 'light', `the Light theme sets the window background and native theme: ${winBg}`);
want(systemSource === 'system', `System leaves the native theme on the OS setting, so the page can follow it: ${systemSource}`);
want(themeFile?.bg === '#f4f4f5' && themeFile?.dark === false, `and is kept for the next launch: ${JSON.stringify(themeFile)}`);
want(askTitle === 'Close Falcon without saving?', `closing with an unsaved doc asks in Falcon's dialog: ${askTitle}`);
want(keptAfterCancel, 'Cancel keeps the window open');
want(closedAfterOk, 'Close Without Saving closes the window');
want(homeAtLaunch && !homeAfterEsc, 'Home shows at launch and Esc closes it');
want(strayOpen.startsWith('refused'), `openPath refuses files never picked: ${strayOpen}`);
want(visible.every((v) => !v), 'window stayed hidden (checked before any CI-only capture)');
want(process.platform === 'darwin' || menu.length === 0, 'no menu bar on Windows/Linux (F10 and Alt belong to the editor)');
want(!dragged.length, `buttons under a window-drag region (clicks would be dead): ${dragged.join(', ')}`);
want(savedInPlace === keptDoc && fs.readFileSync(keptDoc, 'utf8') === 'PK', `Save writes any existing .docx in place: ${savedInPlace}`);
want(goneResult === null && askedAt === gone && !fs.existsSync(gone), `a moved file gets Save As in its old folder, not a silent recreate: ${askedAt}`);
want(raced.startsWith('normal: [Body]{underline} text'), `a key right after a new selection formats that selection: ${raced}`);
want(!errors.length, `page errors: ${errors.join('; ')}`);
