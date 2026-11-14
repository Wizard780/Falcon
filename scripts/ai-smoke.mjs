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
    seen.push({ path: req.url, auth: req.headers.authorization, beta: req.headers['anthropic-beta'], title: req.headers['x-title'], body });
    const n = seen.length;
    if (req.url.endsWith('/chat/completions')) {
      const content = `[[CITE]]\nRouter ${n} [Ann Lee; 2021; "Title"]\n[[TOKENS]]\nRouter ${n}\n[[END]]`;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: `gen-${n}`, model: body.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] }));
      return;
    }
    const MULTI = '[[CITE]]\nAndrew S. Bowen ’26. Analyst at CRS.\nSarah E. Garding. Analyst at CRS.\nDerek E. Mix. Specialist at CRS.\n“Title.” CRS. August 11, 2026. https://example.gov/a.pdf.\n[[TOKENS]]\nBowen ’26\nGarding\nMix\n[[END]]';
    const text = body.system[0].text.startsWith('MULTI') ? MULTI : body.system[0].text.startsWith('PLAIN') ? 'Doe, Jane. "A Title." Journal, 2020.' : `[[CITE]]\nSmith ${n} [John Smith, professor; May 1, 2024; "Title," Journal, https://example.com/a]\n[[TOKENS]]\nSmith ${n}\n[[END]]`;
    // the app streams (big max output tokens need it), so answer the way the API streams
    const events = [
      ['message_start', { type: 'message_start', message: { id: `msg_${n}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }],
      ['message_stop', { type: 'message_stop' }],
    ];
    setTimeout(() => {
      if (!body.stream) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id: `msg_${n}`, type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } }));
        return;
      }
      res.setHeader('content-type', 'text/event-stream');
      res.end(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''));
    }, 300);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
Object.assign(env, { FALCON_USER_DATA: fs.mkdtempSync(`${os.tmpdir()}/falcon-ai-`), FALCON_HEADLESS: '1', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, OPENROUTER_BASE_URL: `http://127.0.0.1:${server.address().port}/api/v1` });
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
const keyWin = app.waitForEvent('window');
await win.click('text=Add key…');
const kw = await keyWin;
await kw.waitForSelector('#v');
want(await win.evaluate(() => !document.querySelector('input[type=password]')), 'the key is typed into its own window, not the page');
await kw.evaluate(() => document.fonts.ready);
const keyLook = await kw.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, fonts: [...document.fonts].map((f) => f.status).join() }));
want(keyLook.bg === 'rgb(25, 25, 27)' && keyLook.fonts === 'loaded', `the key window has the app's colors and loads its font: ${JSON.stringify(keyLook)}`);
want(await kw.evaluate(() => document.documentElement.scrollHeight <= innerHeight), 'the key window fits its contents');
await kw.fill('#v', 'test-key-for-the-stand-in');
await kw.screenshot({ path: 'shots/ai-key-window.png' });
await kw.press('#v', 'Enter').catch(() => {}); // the window closes itself on save; Remove key below proves it saved
await win.waitForSelector('text=Remove key');
want(true, 'a key typed in the key window saves, and Settings shows Remove key');
await win.screenshot({ path: 'shots/ai-settings.png' });
want(!(await win.evaluate(() => JSON.stringify(localStorage))).includes('test-key-for-the-stand-in'), 'the key is not in localStorage, so settings files never hold it');
const insideCard = () => win.evaluate(() => {
  const row = [...document.querySelectorAll('.st-row')].find((r) => r.textContent.includes('AI cite-creator prompt'));
  const card = row.closest('.st-card').getBoundingClientRect();
  return [...row.querySelectorAll('button, select')].every((e) => e.getBoundingClientRect().right <= card.right - 20);
});
want(await insideCard(), 'the prompt buttons stay inside the card');
// New preset opens the prompt editor, starting from the prompt in use; nothing saves until Save
await win.click('text=New preset');
await win.waitForSelector('.cf.pe');
want((await win.inputValue('textarea[aria-label="Preset prompt"]')).includes('[[TOKENS]]'), 'New preset opens a big editor with the prompt in use in it');
await win.keyboard.press('Escape');
await win.waitForTimeout(150);
want(!(await win.$('.cf.pe')) && !!(await win.$('.st')), 'Esc closes the editor, and Settings stays open');
want((await win.$$eval('select[aria-label="AI cite-creator prompt"] option', (o) => o.length)) === 1, 'and closing it without saving makes no preset');
await win.click('text=New preset');
await win.fill('input[aria-label="Preset name"]', 'House style');
await win.fill('textarea[aria-label="Preset prompt"]', 'house rules for {DATE} [[CITE]] [[TOKENS]] [[END]]');
await win.waitForTimeout(300); // let it fade in for the picture
await win.screenshot({ path: 'shots/ai-prompt-editor.png' });
await win.click('.pe-save');
await win.waitForTimeout(150);
want((await win.$eval('select[aria-label="AI cite-creator prompt"]', (s) => s.selectedOptions[0].textContent)) === '1. House style', 'Save makes the preset and puts it in use');
want(await insideCard(), 'and the buttons still fit with a preset picked');
// Edit reopens it with what was saved
await win.click('.st-row:has-text("AI cite-creator prompt") button:text-is("Edit")');
want((await win.inputValue('textarea[aria-label="Preset prompt"]')).startsWith('house rules') && (await win.inputValue('input[aria-label="Preset name"]')) === 'House style', 'Edit opens the saved preset');
await win.click('.pe-save');
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
const d = new Date();
want(r.body.system[0].text.includes(`for ${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()} `), `the date is filled in, M-D-YYYY like CardMirror: ${r.body.system[0].text.slice(0, 40)}`);
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
await win.click('.st-row:has-text("AI cite-creator prompt") button:text-is("Edit")');
await win.fill('textarea[aria-label="Preset prompt"]', 'PLAIN mla style please');
await win.keyboard.press(`${MOD}+Enter`);
await win.waitForTimeout(100);
want(!(await win.$('.cf.pe')), `${MOD}+Enter saves and closes the editor`);
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

// four or more authors: one line each, in one paragraph; cite mark on the lead, plain bold on the co-authors
await win.click('.fstrip [aria-label="Settings"]');
await win.click('.st-nav >> text=AI');
await win.waitForTimeout(200);
await win.click('.st-row:has-text("AI cite-creator prompt") button:text-is("Edit")');
await win.fill('textarea[aria-label="Preset prompt"]', 'MULTI cme style');
await win.keyboard.press(`${MOD}+Enter`);
await win.waitForTimeout(100);
await win.click('[aria-label="Close settings"]');
await win.waitForTimeout(200);
await win.click(editor);
await win.keyboard.press(`${MOD}+ArrowDown`);
await win.keyboard.press('Enter');
await win.keyboard.type('bowen 8-11 four authors');
await win.keyboard.press('Shift+Home');
await win.keyboard.press(`${MOD}+Shift+x`);
await win.waitForFunction(() => document.querySelector('.ProseMirror').textContent.includes('Garding'), null, { timeout: 8000 });
const multi = await win.$eval(editor, (ed) => {
  const p = [...ed.querySelectorAll('p')].find((x) => x.textContent.includes('Garding'));
  return { brs: p.querySelectorAll('br:not(.ProseMirror-trailingBreak)').length, cite: [...p.querySelectorAll('.f-cite')].map((e) => e.textContent), bold: [...p.querySelectorAll('strong')].map((e) => e.textContent),
    sizes: [...p.querySelectorAll('.f-cite, strong')].map((e) => getComputedStyle(e).fontSize) };
});
want(multi.brs === 3, `a four-author cite keeps its lines, in one paragraph: ${multi.brs} breaks`);
want(multi.cite.join('|') === 'Bowen ’26', `the lead's name and date get the cite mark: ${multi.cite.join('|')}`);
want(multi.bold.join('|') === 'Garding|Mix', `co-authors' last names are just bold: ${multi.bold.join('|')}`);
want(multi.sizes[0] !== multi.sizes[1] && multi.sizes[1] === multi.sizes[2], `and stay text size, not cite size: ${multi.sizes.join(' ')}`);
await (await win.$(`${editor} p:has-text("Garding")`)).screenshot({ path: 'shots/ai-cite-four-authors.png' });
await win.click('.fstrip [aria-label="Settings"]');
await win.click('.st-nav >> text=AI');
await win.waitForTimeout(200);
await win.click('.st-row:has-text("AI cite-creator prompt") button:text-is("Edit")');
await win.fill('textarea[aria-label="Preset prompt"]', 'PLAIN mla style please');
await win.keyboard.press(`${MOD}+Enter`);
await win.waitForTimeout(100);
await win.click('[aria-label="Close settings"]');
await win.waitForTimeout(200);

// OpenRouter: its own key and model, and nothing goes out until both are there
await win.click('.fstrip [aria-label="Settings"]');
await win.click('.st-nav >> text=AI');
await win.waitForTimeout(200);
await win.click('button:text-is("OpenRouter")');
await win.waitForSelector('text=OpenRouter API key');
want(!!(await win.$('text=Add key…')), 'OpenRouter asks for its own key, the Anthropic one does not carry over');
want(await win.inputValue('input[aria-label="AI model"]') === '', 'the model field is OpenRouter\'s own');
const routerKeyWin = app.waitForEvent('window');
await win.click('text=Add key…');
const rw = await routerKeyWin;
await rw.waitForSelector('#v');
await rw.fill('#v', 'router-key-for-the-stand-in');
await rw.press('#v', 'Enter').catch(() => {});
await win.waitForSelector('text=Remove key');
await win.click('[aria-label="Close settings"]');
await win.waitForTimeout(200);
await win.click(editor);
await win.keyboard.press(`${MOD}+ArrowDown`);
await win.keyboard.press('Enter');
await win.keyboard.type('ann lee 2021');
await win.keyboard.press('Shift+Home');
const beforeRouter = seen.length;
await win.keyboard.press(`${MOD}+Shift+x`);
await win.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Paste an OpenRouter model'), null, { timeout: 3000 });
want(seen.length === beforeRouter, 'with no model pasted nothing is sent and it says so');
await win.click('.fstrip [aria-label="Settings"]');
await win.click('.st-nav >> text=AI');
await win.waitForTimeout(200);
await win.fill('input[aria-label="AI model"]', 'deepseek/deepseek-chat');
await win.waitForTimeout(100);
await win.screenshot({ path: 'shots/ai-openrouter.png' });
await win.click('[aria-label="Close settings"]');
await win.waitForTimeout(200);
await win.locator(editor).getByText('ann lee 2021').click({ clickCount: 3 });
await win.keyboard.press(`${MOD}+Shift+x`);
await win.waitForFunction(() => document.querySelector('.ProseMirror').textContent.includes('[Ann Lee; 2021'), null, { timeout: 8000 });
const rr = seen.at(-1);
want(rr.path === '/api/v1/chat/completions' && rr.auth === 'Bearer router-key-for-the-stand-in', `it goes to OpenRouter with OpenRouter's key: ${rr.path}`);
want(rr.body.model === 'deepseek/deepseek-chat' && rr.title === 'Falcon', 'the pasted model goes out as is');
want(rr.body.messages[0].role === 'system' && rr.body.messages[0].content.startsWith('PLAIN') && rr.body.messages[1].content === 'ann lee 2021', 'the prompt goes as the system message, the selection as the user message');
want((await cites()).some((c) => c.startsWith('Router ')), `the reply block still marks the cite: ${await cites()}`);
await win.click('.fstrip [aria-label="Settings"]');
await win.click('.st-nav >> text=AI');
await win.waitForTimeout(200);
await win.click('button:text-is("Anthropic")');
await win.waitForSelector('text=Anthropic API key');
want(await win.inputValue('input[aria-label="AI model"]') === 'vendor/some-model:v2' && !!(await win.$('text=Remove key')), 'switching back finds the Anthropic key and model untouched');

// a big max output tokens: the SDK won't send those without streaming, which used to come back as 'The AI request failed.'
// (Settings is still open on AI, back on Anthropic, from the step above)
await win.fill('input[aria-label="Max output tokens"]', '64000');
await win.click('[aria-label="Close settings"]');
await win.waitForTimeout(200);
const beforeBig = seen.length;
await win.click(editor);
await win.keyboard.press(`${MOD}+ArrowDown`);
await win.keyboard.press('Enter');
await win.keyboard.type('big budget 2024');
await win.keyboard.press('Shift+Home');
await win.keyboard.press(`${MOD}+Shift+x`);
await win.waitForFunction(() => !document.querySelector('.ProseMirror').textContent.includes('big budget 2024'), null, { timeout: 8000 }).catch(() => {});
const big = seen.slice(beforeBig).find((r) => r.path.startsWith('/v1/messages'));
want(big?.body.max_tokens === 64000 && big?.body.stream === true, `64000 max output tokens goes out, streamed: ${JSON.stringify(big && { max: big.body.max_tokens, stream: big.body.stream })}`);
want(!(await win.textContent(editor)).includes('big budget 2024'), 'and the cite comes back');

await app.close();
server.close();
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
