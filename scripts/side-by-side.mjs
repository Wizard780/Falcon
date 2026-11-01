// Opens the same .docx in CardMirror and Falcon and screenshots both at the same scroll spot.
import { chromium } from 'playwright';
const file = process.argv[2];
const needle = process.argv[3] || 'Rejecting the TPNW';
const b = await chromium.launch();
async function shoot(which) {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  // without the File System Access picker, CardMirror falls back to a plain file input Playwright can fill
  await p.addInitScript(() => { delete window.showOpenFilePicker; });
  await p.goto(which === 'cm' ? 'http://localhost:5301/' : (process.env.FALCON_URL || 'http://localhost:5173/'));
  await p.waitForTimeout(1500);
  let chooser;
  if (which === 'cm') {
    await p.keyboard.press('Escape');
    [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Open…', { exact: true }).first().click()]);
  } else {
    [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.keyboard.press('Meta+o')]);
  }
  await chooser.setFiles(file);
  await p.waitForTimeout(3000);
  await p.evaluate((needle) => {
    const el = [...document.querySelectorAll('.ProseMirror h4, .ProseMirror p')].find((e) => e.textContent.includes(needle));
    el?.scrollIntoView({ block: 'start' });
  }, needle);
  await p.waitForTimeout(500);
  if (process.env.READ) {
    // enter read mode (CM: the eye button in its ribbon; Falcon: Mod-Shift-R), then try typing
    if (which === 'cm') await p.locator('button[title*="ead mode" i], button[aria-label*="ead mode" i]').first().click();
    else { await p.locator('.ProseMirror').click({ position: { x: 5, y: 5 } }); await p.keyboard.press('Meta+Shift+r'); }
    await p.waitForTimeout(600);
    const before = await p.evaluate(() => document.querySelector('.ProseMirror').textContent.length);
    await p.keyboard.type('zzz'); await p.keyboard.press('Backspace'); await p.keyboard.press('F9');
    const after = await p.evaluate(() => document.querySelector('.ProseMirror').textContent.length);
    console.log(which, 'typing changed doc length by', after - before);
    await p.evaluate((needle) => [...document.querySelectorAll('.ProseMirror h4')].find((e) => e.textContent.includes(needle))?.scrollIntoView({ block: 'start' }), needle);
    await p.waitForTimeout(300);
  }
  await p.screenshot({ path: `shots/side-${which}${process.env.READ ? '-read' : ''}.png` });
  await p.close();
}
await shoot('cm');
await shoot('falcon');
await b.close();
