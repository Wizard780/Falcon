// Builds every Falcon brand asset from the one Head mark ("Original" from logo/options/head.html).
// Run: node logo/build-brand.mjs  →  logo/falcon-*.svg|png, build/icon.png (app icon), public/favicon.svg
import { chromium } from 'playwright';
import fs from 'node:fs';

export const HEAD = 'M12 57V36A24 24 0 0 1 36 12H42C50.5 12 56 18 56 26C56 30.5 54 33.5 50.5 35.5C51 31.5 49 29 45.5 29H41C37 29 34.5 32 34.5 36V57ZM39 17.5A3.5 3.5 0 1 0 39 24.5A3.5 3.5 0 1 0 39 17.5Z';
const BOX = '12 12 44 45'; // the mark's own bounds
const LIGHT = '#ededed', DARK = '#0f0f10';
const symbol = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BOX}"><path fill="${fill}" fill-rule="evenodd" d="${HEAD}"/></svg>`;
// a dark rounded tile with the light head: the app icon (macOS grid: 824px tile in a 1024 canvas) and favicon
const tile = (size, inset, radius) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect x="${inset}" y="${inset}" width="${size - 2 * inset}" height="${size - 2 * inset}" rx="${radius}" fill="${DARK}"/><g transform="translate(${size / 2} ${size / 2}) scale(${(size - 2 * inset) * 0.56 / 45}) translate(-34 -34.5)"><path fill="${LIGHT}" fill-rule="evenodd" d="${HEAD}"/></g></svg>`;

fs.mkdirSync('build', { recursive: true });
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('logo/falcon-symbol-white.svg', symbol(LIGHT));
fs.writeFileSync('logo/falcon-symbol-black.svg', symbol(DARK));
fs.writeFileSync('public/favicon.svg', tile(64, 0, 14));
const appIcon = tile(1024, 100, 185);
fs.writeFileSync('build/icon.svg', appIcon);

const browser = await chromium.launch();
const page = await browser.newPage();
const shot = async (html, w, h, out) => {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
  await page.screenshot({ path: out, omitBackground: true });
};
await shot(appIcon.replace('<svg ', '<svg width="1024" height="1024" '), 1024, 1024, 'build/icon.png');
for (const [tone, fill] of [['white', LIGHT], ['black', DARK]]) {
  // symbol: the mark centered in a square, 80% tall
  await shot(`<div style="width:1024px;height:1024px;display:grid;place-items:center">${symbol(fill).replace('<svg ', '<svg height="820" ')}</div>`, 1024, 1024, `logo/falcon-symbol-${tone}.png`);
  // lockup: mark + wordmark, same layout as the old logo files
  await shot(`<div style="width:1316px;height:552px;display:flex;align-items:center;justify-content:center;gap:56px;font:600 220px -apple-system,BlinkMacSystemFont,Inter,'Segoe UI',sans-serif;color:${fill};letter-spacing:-4px">${symbol(fill).replace('<svg ', '<svg height="230" ')}<span>Falcon</span></div>`, 1316, 552, `logo/falcon-logo-${tone}.png`);
}
await browser.close();
console.log('wrote logo/falcon-{symbol,logo}-{white,black}, build/icon.{svg,png}, public/favicon.svg');
