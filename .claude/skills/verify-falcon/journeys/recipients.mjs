// Recipients, in dark and in light: added in Settings > Sharing (a bad code first), the same list in the command
// center's Card sharing panel and in Send Card to…, then hidden, moved, starred, sent to with Send Card to starred,
// and removed (caught mid-fold). The codes carry a relay that isn't there, so a send fails naming who it went to.
import path from 'node:path';
import { openFalcon, MOD } from '../lib/falcon.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const { makeIdentity } = await import(path.join(REPO, 'src/collab/crypto.ts'));
const { encodeCode, parseCode } = await import(path.join(REPO, 'src/collab/code.ts'));
const NOWHERE = 'http://127.0.0.1:9';
const code = async () => encodeCode((await makeIdentity()).pub, NOWHERE);

async function journey(theme) {
  const f = await openFalcon(theme === 'dark' ? 'recipients' : 'recipients/light', { storage: theme === 'dark' ? {} : { 'falcon.theme': 'light' } });
  const { page, want } = f;
  const wait = (ms) => page.waitForTimeout(ms);
  const names = (root = '.st') => page.$$eval(`${root} .rcp-row .rcp-nm`, (x) => x.map((n) => n.value));
  const toast = async () => (await page.textContent('.toast').catch(() => '')).trim();
  const command = async (text) => {
    await page.keyboard.press(`${MOD}+Shift+Space`);
    await page.waitForSelector('.cc input');
    await page.fill('.cc input', text);
    await wait(150);
    const row = await page.$eval('.cc-row[data-on] .cc-nm', (x) => x.textContent).catch(() => null);
    await page.keyboard.press('Enter');
    await wait(300);
    return row;
  };
  const sharing = async () => {
    await page.click('.fstrip [aria-label="Settings"]');
    await wait(250);
    await page.click('[aria-label="Settings sections"] button:has-text("Sharing")');
    await wait(250);
  };
  const add = async (c, name) => {
    await page.click('.st .rcp-new');
    await page.fill('.st input[aria-label="Their pairing code"]', c);
    await page.fill('.st input[aria-label="Their name"]', name);
    await page.keyboard.press('Enter');
    await wait(200);
  };
  want(await page.evaluate(() => document.documentElement.dataset.chrome) === theme, `${theme} chrome`);

  // a card to send: a tag at the caret
  await page.click('.ProseMirror:not(.hm-doc)');
  await page.keyboard.type('Trade solves war');
  await page.keyboard.press('F7');

  await sharing();
  const rows = await page.$$eval('.st-row .st-txt > span', (x) => x.map((s) => s.textContent));
  want(rows.slice(0, 4).join('|') === 'Relay?|Your pairing code|Your name|Recipients', `Settings > Sharing: Relay, your code, your name, Recipients (${rows.slice(0, 4).join(', ')})`);
  await page.locator('.st-row:has(.st-txt > span:text-is("Recipients"))').scrollIntoViewIfNeeded();
  await f.shot('settings-empty');
  await page.click('.st .rcp-new');
  await page.fill('.st input[aria-label="Their pairing code"]', 'ABCD-EFGH-IJKL');
  await page.fill('.st input[aria-label="Their name"]', 'Maya Ortiz');
  await page.keyboard.press('Enter');
  await wait(150);
  const bad = parseCode('ABCD-EFGH-IJKL');
  want(!bad.ok && (await page.textContent('.st .rcp-why')) === bad.error, `a bad code is turned down in the row with the parser's reason (${await page.textContent('.st .rcp-why')})`);
  await f.shot('add-bad-code');
  const maya = await code(), dev = await code(), bell = await code();
  const codes = { 'Maya Ortiz': maya, 'Dev Raman': dev, 'Coach Bell': bell };
  const row = (n, root = '.st') => `${root} .rcp-row[data-code="${codes[n]}"]`;
  await page.fill('.st input[aria-label="Their pairing code"]', maya);
  await page.keyboard.press('Enter');
  await wait(200);
  want((await toast()) === 'Added Maya Ortiz', `Add puts them in (${await toast()})`);
  await add(dev, 'Dev Raman');
  await add(bell, 'Coach Bell');
  want((await names()).join() === 'Maya Ortiz,Dev Raman,Coach Bell', `three recipients in the order added (${await names()})`);
  await page.hover(`${row('Dev Raman')} .rcp-cd`);
  await wait(250);
  want(await page.$eval(`${row('Dev Raman')} [data-a="x"]`, (b) => getComputedStyle(b).opacity) === '1', 'hovering a row shows its actions');
  want(await page.$eval(`${row('Maya Ortiz')} [data-a="x"]`, (b) => getComputedStyle(b).opacity) === '0', 'the other rows keep them out of sight');
  await f.shot('settings-three-hover');

  // the same list in the command center's Card sharing panel, and in Send Card to…
  await page.keyboard.press('Escape');
  await wait(250);
  want((await command('card sharing')) === 'Card sharing', 'the command center opens Card sharing');
  want((await names('.cf.co')).join() === 'Maya Ortiz,Dev Raman,Coach Bell', `the panel shows the same list (${await names('.cf.co')})`);
  await page.hover(`${row('Dev Raman', '.cf.co')} .rcp-cd`);
  await wait(250);
  await f.shot('panel');
  // a bad code in the panel's add row: said in the error color (not greyed by the dialog's own text color); Esc shuts the row, then the panel
  await page.click('.cf.co .rcp-new');
  await page.fill('.cf.co input[aria-label="Their pairing code"]', 'ABCD-EFGH-IJKL');
  await page.keyboard.press('Enter');
  await wait(150);
  const errColor = await page.$eval('.cf.co .rcp-why', (e) => getComputedStyle(e).color);
  want(errColor === (theme === 'dark' ? 'rgb(224, 112, 112)' : 'rgb(178, 58, 58)'), `the panel's add row says a bad code in the error color (${errColor})`);
  await page.focus('.cf.co .rcp-add button[type="button"]');
  await page.keyboard.press('Escape');
  await wait(200);
  want(!(await page.$('.cf.co .rcp-add')) && !!(await page.$('.cf.co')), 'Esc on the add row\'s Cancel shuts the row, not the panel');
  await page.keyboard.press('Escape');
  await wait(250);
  await page.click('.ProseMirror:not(.hm-doc) :text("Trade solves war")');
  want((await command('send card to')) === 'Send Card to…', 'the command center finds Send Card to…');
  const picker = () => page.$$eval('.co-pk .nm', (x) => x.map((n) => n.textContent));
  want((await picker()).join() === 'Maya Ortiz,Dev Raman,Coach Bell', `Send Card lists them in order (${await picker()})`);
  await f.shot('picker');
  await page.keyboard.press('Escape');
  await wait(250);

  // hide, move, star, in Settings; Send Card follows
  await sharing();
  await page.hover(`${row('Dev Raman')} .rcp-cd`);
  await page.click(`${row('Dev Raman')} [data-a="hide"]`);
  await wait(150);
  await page.hover(`${row('Coach Bell')} .rcp-cd`);
  await page.click(`${row('Coach Bell')} [data-a="up"]`);
  await wait(150);
  want((await names()).join() === 'Maya Ortiz,Coach Bell,Dev Raman', `Move up moves Coach Bell above Dev Raman (${await names()})`);
  want(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Move Coach Bell up', 'focus stays on the button after the move');
  await page.click(`${row('Coach Bell')} [data-a="star"]`);
  await wait(150);
  await page.click(`${row('Maya Ortiz')} [data-a="star"]`);
  await wait(150);
  const stars = await page.$$eval('.st .rcp-i[data-a="star"]', (b) => b.map((x) => x.getAttribute('aria-pressed')));
  want(stars.join() === 'true,false,false', `one star at a time: it moved to Maya Ortiz (${stars})`);
  await page.mouse.move(5, 5);
  await wait(250);
  want(await page.$eval(`${row('Dev Raman')} [data-a="hide"]`, (b) => b.getAttribute('aria-pressed') === 'true' && getComputedStyle(b).opacity === '1'), 'a hidden one shows its crossed eye without hovering');
  await f.shot('hidden-moved-starred');
  await page.keyboard.press('Escape');
  await wait(250);
  await page.click('.ProseMirror:not(.hm-doc) :text("Trade solves war")');
  await command('send card to');
  want((await picker()).join() === 'Maya Ortiz,Coach Bell', `Send Card leaves out the hidden one and follows the new order (${await picker()})`);
  await page.keyboard.press('Escape');
  await wait(250);
  await page.click('.ProseMirror:not(.hm-doc) :text("Trade solves war")');
  want((await command('send card to starred')) === 'Send Card to starred recipient', 'the command center finds Send Card to starred recipient');
  await page.waitForFunction(() => /Maya Ortiz/.test(document.querySelector('.toast')?.textContent ?? '') && !/Sending/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  want(/Couldn't reach Maya Ortiz's relay/.test(await toast()) && !(await page.$('.co-send')), `Send Card to starred goes straight to Maya Ortiz, no list (${await toast()})`);

  // remove: the row folds shut where it is, focus moves on
  await sharing();
  await page.hover(`${row('Coach Bell')} .rcp-cd`);
  await page.focus(`${row('Coach Bell')} [data-a="x"]`);
  await page.click(`${row('Coach Bell')} [data-a="x"]`);
  await wait(50);
  want(await page.$$eval('.st .co-fold[data-gone] .rcp-nm', (x) => x.map((n) => n.value).join()) === 'Coach Bell', 'the removed row is still there, folding shut');
  await f.shot('removing');
  await wait(400);
  want((await names()).join() === 'Maya Ortiz,Dev Raman', `then it's gone (${await names()})`);
  want(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Remove Dev Raman', 'focus went to the next row\'s Remove');
  await f.shot('removed');
  // kept: a reload has the same list, order, hidden and star
  await page.reload();
  await page.waitForSelector('.ProseMirror');
  await page.keyboard.press('Escape');
  await wait(400);
  await sharing();
  const kept = await page.$$eval('.st .rcp-row', (rs) => rs.map((r) => `${r.querySelector('.rcp-nm').value}${r.hasAttribute('data-hidden') ? ' hidden' : ''}${r.querySelector('[data-a="star"]').getAttribute('aria-pressed') === 'true' ? ' starred' : ''}`));
  want(kept.join() === 'Maya Ortiz starred,Dev Raman hidden', `kept after a reload (${kept})`);
  await f.done();
}

await journey('dark');
await journey('light');
