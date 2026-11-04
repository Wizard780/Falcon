// The AI cite formatter end to end: launches the Electron app with no visible window against a stand-in for
// Anthropic, so it needs no real key or credit. Prints ok/FAIL lines, exits 1 on any FAIL.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const seen = [];
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    const body = JSON.parse(raw);
    seen.push({ path: req.url, auth: req.headers.authorization, beta: req.headers['anthropic-beta'], body });
    const n = seen.length;
    const text = body.system[0].text.startsWith('PLAIN') ? 'Doe, Jane. "A Title." Journal, 2020.' : `[[CITE]]\nSmith ${n} [John Smith, professor; May 1, 2024; "Title," Journal, https://example.com/a]\n[[TOKENS]]\nSmith ${n}\n[[END]]`;
    setTimeout(() => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: `msg_${n}`, type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } }));
    }, 300);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
Object.assign(env, { FALCON_USER_DATA: fs.mkdtempSync(`${os.tmpdir()}/falcon-ai-`), FALCON_HEADLESS: '1', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}` });
fs.mkdirSync('shots', { recursive: true });
const results = [];
const want = (ok, what) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`); return ok; };

const app = await electron.launch({ args: ['.'], env });
const win = await app.firstWindow();
await win.waitForSelector('.ProseMirror');
await win.keyboard.press('Escape');
await win.waitForTimeout(300);
const editor = '.ProseMirror';
const cites = () => win.$$eval(`${editor} .f-cite`, (els) => els.map((e) => e.textContent));

// off until you turn it on
await win.click(editor);
await win.keyboard.type('john smith 2024 https://example.com/a');
await win.keyboard.press(`${MOD}+a`);
await win.keyboard.press(`${MOD}+Shift+x`);
await win.waitForTimeout(300);
want(seen.length === 0 && (await win.textContent('.toast')).includes('Settings > AI'), 'with AI off nothing is sent and it says where to turn it on');

// settings
await win.click('.fstrip [aria-label="Settings"]');
await win.click('.st-nav >> text=AI');
await win.waitForTimeout(200);
await win.click('[aria-label="AI features"]');
await win.fill('input[aria-label="Anthropic API key"]', 'test-key-for-the-stand-in');
await win.locator('input[aria-label="AI model"]').focus();
await win.waitForSelector('text=Remove key');
want(true, 'a pasted key saves, and the field gives way to Remove key');
await win.screenshot({ path: 'shots/ai-settings.png' });
want(!(await win.evaluate(() => JSON.stringify(localStorage))).includes('test-key-for-the-stand-in'), 'the key is not in localStorage, so settings files never hold it');
await win.click('text=New preset');
await win.fill('input[aria-label="Preset name"]', 'House style');
await win.fill('textarea[aria-label="Preset prompt"]', 'house rules for {DATE} [[CITE]] [[TOKENS]] [[END]]');
await win.waitForTimeout(100);
await win.click('[aria-label="Close settings"]');
await win.waitForTimeout(200);

// format one
await win.click(editor);
await win.keyboard.press(`${MOD}+a`);
await win.keyboard.press(`${MOD}+Shift+x`);
await win.waitForSelector('.ai-busy');
await win.keyboard.type('zzz');
want(!(await win.textContent(editor)).includes('zzz'), 'typing in the text being worked on does nothing');
await win.waitForSelector(`${editor} .f-cite`);
want((await cites()).join() === 'Smith 1', `the name and year get the cite mark: ${await cites()}`);
want((await win.textContent(editor)).startsWith('Smith 1 [John Smith, professor;'), 'the selection became the cite');
want(!(await win.$('.ai-busy')), 'the tint is gone');
const r = seen[0];
want(r.path.startsWith('/v1/messages') && r.auth === 'Bearer test-key-for-the-stand-in', `request hit the messages endpoint with the key: ${r.path}`);
want(r.beta?.includes('server-side-fallback-2026-07-01') && r.body.fallbacks === 'default' && r.body.model === 'claude-opus-5-5', 'default model with refusal fallbacks');
want(r.body.system[0].text.startsWith('house rules for '), 'the preset in use is what the model gets');
want(!r.body.system[0].text.includes('{DATE}') && r.body.system[0].text.includes(String(new Date().getFullYear())), 'the date is filled in');
await win.screenshot({ path: 'shots/ai-formatted.png' });
await win.keyboard.press(`${MOD}+z`);
await win.waitForTimeout(200);
want((await win.textContent(editor)).startsWith('john smith 2024'), 'one undo brings the text back');
await win.keyboard.press(`${MOD}+Shift+z`);
await win.waitForTimeout(200);

// a second cite, then all of them, through the command center
await win.keyboard.press(`${MOD}+ArrowDown`);
await win.keyboard.press('Enter');
await win.keyboard.type('some body text');
await win.keyboard.press('Enter');
await win.keyboard.type('Jones 9 [old]');
await win.keyboard.press('Home');
for (let i = 0; i < 7; i++) await win.keyboard.press('Shift+ArrowRight');
await win.keyboard.press('F8');
await win.keyboard.press('End');
const before = seen.length;
await win.keyboard.press(`${MOD}+Shift+Space`);
await win.keyboard.type('reformat every cite');
await win.waitForTimeout(300);
await win.keyboard.press('Enter');
await win.waitForSelector('.cf');
want((await win.textContent('.cf')).includes('2 cites go'), 'it says how many requests before it starts');
await win.click('.cf-ok');
await win.waitForFunction((n) => document.querySelector('.toast')?.textContent.includes(`${n} cites reformatted`), 2, { timeout: 8000 });
want(seen.length === before + 2, `two requests: ${seen.length - before}`);
want((await win.textContent(editor)).includes('some body text'), 'body text left alone');
await win.screenshot({ path: 'shots/ai-reformatted.png' });

// any model id, and a prompt of your own that answers with just the cite
await win.click('.fstrip [aria-label="Settings"]');
await win.click('.st-nav >> text=AI');
await win.waitForTimeout(200);
await win.fill('input[aria-label="AI model"]', 'vendor/some-model:v2');
if (!(await win.$('textarea[aria-label="Preset prompt"]'))) await win.click('button:text-is("Edit")');
await win.fill('textarea[aria-label="Preset prompt"]', 'PLAIN mla style please');
await win.waitForTimeout(100);
await win.click('[aria-label="Close settings"]');
await win.waitForTimeout(200);
await win.click(editor);
await win.keyboard.press(`${MOD}+ArrowDown`);
await win.keyboard.press('Enter');
await win.keyboard.type('jane doe 2020');
await win.keyboard.press('Shift+Home');
await win.keyboard.press(`${MOD}+Shift+x`);
await win.waitForFunction(() => document.querySelector('.ProseMirror').textContent.includes('Doe, Jane.'), null, { timeout: 8000 });
want(seen.at(-1).body.model === 'vendor/some-model:v2', `the pasted model goes out as is: ${seen.at(-1).body.model}`);
want(seen.at(-1).body.fallbacks === undefined, 'no fallbacks on a model that may not take them');
want(!(await win.textContent(editor)).includes('jane doe 2020'), 'a plain answer replaces the selection');
await win.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('F8'), null, { timeout: 3000 });
want(true, 'it says the name and date still need marking');

await app.close();
server.close();
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
