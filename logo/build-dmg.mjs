// The Mac installer window: Falcon's card gray (so the dark app tile stands out), the mark, and an arrow from the app to Applications.
// Run: node logo/build-dmg.mjs  →  build/background.png and build/background@2x.png (electron-builder
// pairs them into one retina image). The icon spots must match "dmg.contents" in package.json.
import { chromium } from 'playwright';

const HEAD = 'M12 57V36A24 24 0 0 1 36 12H42C50.5 12 56 18 56 26C56 30.5 54 33.5 50.5 35.5C51 31.5 49 29 45.5 29H41C37 29 34.5 32 34.5 36V57ZM39 17.5A3.5 3.5 0 1 0 39 24.5A3.5 3.5 0 1 0 39 17.5Z'; // from build-brand.mjs
const W = 660, H = 400, APP = 180, APPS = 480, ROW = 190; // icon centers, as in dmg.contents

const html = `<html><body style="margin:0">
<div style="position:relative;width:${W}px;height:${H}px;background:#19191b;color:#ededed;font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;-webkit-font-smoothing:antialiased">
  <div style="position:absolute;top:44px;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:10px;font-size:17px;font-weight:600">
    <svg viewBox="12 12 44 45" height="22"><path fill="#ededed" fill-rule="evenodd" d="${HEAD}"/></svg>Falcon
  </div>
  <svg style="position:absolute;left:${APP + 80}px;top:${ROW - 12}px" width="${APPS - APP - 160}" height="24" viewBox="0 0 ${APPS - APP - 160} 24" fill="none" stroke="#5a5a60" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 12H${APPS - APP - 164}M${APPS - APP - 172} 4l8 8-8 8"/>
  </svg>
  <p style="position:absolute;bottom:40px;left:0;right:0;margin:0;text-align:center;font-size:13px;color:#85858b">Drag Falcon into Applications</p>
</div></body></html>`;

const browser = await chromium.launch();
for (const [scale, out] of [[1, 'build/background.png'], [2, 'build/background@2x.png']]) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
  await page.setContent(html);
  await page.screenshot({ path: out });
  await page.close();
}
await browser.close();
console.log('wrote build/background.png, build/background@2x.png');
