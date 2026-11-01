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
  await p.screenshot({ path: `shots/side-${which}.png` });
  await p.close();
}
await shoot('cm');
await shoot('falcon');
await b.close();
