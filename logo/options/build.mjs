// Generates logo/options/index.html (comparison page) and one dark + one light SVG per option.
// Run: node logo/options/build.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const INK = '#00e5ff';

// All marks share a 64x64 grid. "M" = main color (currentColor), "A" = accent (highlighter cyan).
const M = 'currentColor', A = 'var(--ink)';
const options = [
  { id: 'current', name: 'Current', idea: 'What ships today in logo/, as the baseline.',
    vb: '2 2 16 14',
    body: `<path fill="${M}" d="M2.5 14.5c3.2-.6 5.6-2.6 6.8-6.2L10.6 3l1.1 4.4c.9 3.6 3 5.9 5.8 6.9-3.2.9-5.6.4-7.2-1.1-1.5 1.4-4.2 2.1-7.8 1.3z"/>` },

  { id: 'stoop', name: 'Stoop', idea: 'Peregrine from above, wings swept back mid-dive.',
    body: `<path fill="${M}" d="M32 5C35 15 43 31 59 45C49 43.5 41 44 36.5 48.5L34 59H30L27.5 48.5C23 44 15 43.5 5 45C21 31 29 15 32 5Z"/>` },

  { id: 'card-wing', name: 'Card Wing', idea: 'Three lines of a card that taper into a wing. The top line is highlighted.',
    body: `<path fill="${A}" d="M8 12H58L50 22H8Z"/><path fill="${M}" d="M8 28H46L38 38H8Z"/><path fill="${M}" d="M8 44H32L24 54H8Z"/>` },

  { id: 'highlight-f', name: 'Highlight F', idea: 'An F whose crossbar is a highlighter stroke, like the one you cut cards with.',
    body: `<rect fill="${A}" x="12" y="28" width="36" height="11" rx="2"/><path fill="${M}" d="M18 10H50V18H26V54H18Z"/><rect fill="${M}" x="18" y="30" width="22" height="7"/>` },

  { id: 'tear', name: 'Tear', idea: 'The peregrine’s eye with its dark “tear” stripe, the bird’s most recognizable mark.',
    body: `<path fill="${M}" fill-rule="evenodd" d="M32 8A16 16 0 1 1 32 40A16 16 0 1 1 32 8ZM32 15A9 9 0 1 0 32 33A9 9 0 1 0 32 15Z"/><circle fill="${A}" cx="32" cy="24" r="4.5"/><path fill="${M}" d="M20.5 35.5C22.5 37.5 25 39 27.5 40C27 46 25 52 20 58C17 52 17 43 20.5 35.5Z"/>` },

  { id: 'head', name: 'Head', idea: 'Geometric falcon profile: one arc, a hooked beak, and the eye cut out.',
    body: `<path fill="${M}" fill-rule="evenodd" d="M12 57V36A24 24 0 0 1 36 12H42C50.5 12 56 18 56 26C56 30.5 54 33.5 50.5 35.5C51 31.5 49 29 45.5 29H41C37 29 34.5 32 34.5 36V57ZM39 17.5A3.5 3.5 0 1 0 39 24.5A3.5 3.5 0 1 0 39 17.5Z"/>` },

  { id: 'chevrons', name: 'Chevrons', idea: 'Two chevrons diving. Reads at 16px; the lower one is lit.',
    body: `<path fill="${M}" d="M8 10L32 30L56 10V22L32 42L8 22Z"/><path fill="${A}" d="M8 32L32 52L56 32V40L32 60L8 40Z"/>` },

  { id: 'swept-f', name: 'Swept F', idea: 'An F built from swept wing strokes, leaning forward like it’s flying.',
    body: `<path fill="${M}" d="M17 56L24 10H33L26 56Z"/><path fill="${M}" d="M24 10H56L50.5 19H22.6Z"/><path fill="${A}" d="M21.6 28H45L39.5 37H20.2Z"/>` },

  { id: 'crescent', name: 'Crescent', idea: 'One long pointed wing, the shape a falcon makes from below.',
    body: `<path fill="${M}" d="M6 46C18 24 38 11 60 10C45 17 33 31 27 52C21 47.5 14 46 6 46Z"/>` },

  { id: 'tile', name: 'Tile', idea: 'The Stoop mark on a cyan app tile. Built for the Dock and taskbar.',
    tile: true,
    body: `<rect fill="${A}" x="2" y="2" width="60" height="60" rx="14"/><path fill="#0f0f10" d="M32 11C34.4 19 40.8 31.8 53.6 43C45.6 41.8 39.2 42.2 35.6 45.8L33.6 54.2H30.4L28.4 45.8C24.8 42.2 18.4 41.8 10.4 43C23.2 31.8 29.6 19 32 11Z"/>` },
];

// Head iterations. Shared parts on the same 64px grid.
const EYE = 'M39 17.5A3.5 3.5 0 1 0 39 24.5A3.5 3.5 0 1 0 39 17.5Z';
const TEAR = 'M36 26C35.5 31 33 36.5 29 41C28.4 36 29.5 30.5 32.5 26C33.5 25 35.2 25 36 26Z';
const UNDER = 'C53 31 50 29 46 29'; // underside of the beak
const TOOTH = 'C54.2 32.6 53 31.8 51.6 31.8L50.4 29.8C49.2 29.2 47.6 29 46 29'; // the falcon's notched beak
const sharp = (neck = 57, under = UNDER) =>
  `M12 ${neck}V36A24 24 0 0 1 36 12H40C48 12 54 17 55.5 25C56.2 28 56 31 55 34${under}H41C37 29 34.5 32 34.5 36V${neck}Z`;
const ORIGINAL = 'M12 57V36A24 24 0 0 1 36 12H42C50.5 12 56 18 56 26C56 30.5 54 33.5 50.5 35.5C51 31.5 49 29 45.5 29H41C37 29 34.5 32 34.5 36V57Z';

const heads = [
  { id: 'head-0', name: 'Original', idea: 'The Head from the first round, for reference. Its round beak reads a bit like a parrot.',
    body: `<path fill="${M}" fill-rule="evenodd" d="${ORIGINAL}${EYE}"/>` },
  { id: 'head-sharp', name: 'Sharp beak', idea: 'A shorter beak that comes to a hard point. Falcons have small, sharp beaks.',
    body: `<path fill="${M}" fill-rule="evenodd" d="${sharp()}${EYE}"/>` },
  { id: 'head-tear', name: 'Tear', idea: 'Sharp beak plus the dark stripe under the eye, cut out of the face.',
    body: `<path fill="${M}" fill-rule="evenodd" d="${sharp()}${EYE}${TEAR}"/>` },
  { id: 'head-cyan-eye', name: 'Cyan eye', idea: 'The eye is the one lit spot, in the app’s highlighter cyan.',
    body: `<path fill="${M}" d="${sharp()}"/><circle fill="${A}" cx="39" cy="21" r="4"/>` },
  { id: 'head-cyan-tear', name: 'Cyan tear', idea: 'The stripe is drawn in cyan, like a highlighter swipe across the face.',
    body: `<path fill="${M}" fill-rule="evenodd" d="${sharp()}${EYE}"/><path fill="${A}" d="${TEAR}"/>` },
  { id: 'head-tooth', name: 'Notched beak', idea: 'Adds the notch real falcons have in the beak, plus eye and stripe. The most detailed one.',
    body: `<path fill="${M}" fill-rule="evenodd" d="${sharp(57, TOOTH)}${EYE}${TEAR}"/>` },
  { id: 'head-faceted', name: 'Faceted', idea: 'All straight lines, no curves. Sharper and more technical.',
    body: `<path fill="${M}" fill-rule="evenodd" d="M12 57V34L20 20L32 12H44L53 18L56 34L48 29H41L34.5 35V57Z${EYE}"/>` },
  { id: 'head-bold', name: 'Bold', idea: 'Thicker neck and a bigger eye, so it still reads at 16px in the sidebar.',
    body: `<path fill="${M}" fill-rule="evenodd" d="M10 58V36A26 26 0 0 1 36 10H40C49 10 55 16 56.5 25C57.2 29 57 32 56 36C53 32.5 50 31 46 31H44C40 31 38 34 38 38V58ZM40 15.5A4.5 4.5 0 1 0 40 24.5A4.5 4.5 0 1 0 40 15.5Z"/>` },
  { id: 'head-line', name: 'Outline', idea: 'Drawn with one stroke, the same weight as the app’s icons.',
    body: `<path fill="none" stroke="${M}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" d="M12 57V36A24 24 0 0 1 36 12H40C48 12 54 17 55.5 25C56.2 28 56 31 55 34${UNDER}H41C37 29 34.5 32 34.5 36V57"/><circle fill="${M}" cx="39" cy="21" r="3.5"/>` },
  { id: 'head-badge', name: 'Badge', idea: 'The head cut out of a solid circle, with the neck running off the bottom.',
    body: `<mask id="m-badge"><rect width="64" height="64" fill="#fff"/><path fill="#000" fill-rule="evenodd" transform="translate(9 8) scale(.8)" d="${sharp(70)}${EYE}${TEAR}"/></mask><circle fill="${M}" cx="32" cy="32" r="30" mask="url(#m-badge)"/>` },
  { id: 'head-tile', name: 'Tile', idea: 'Dark head with its stripe on a cyan app tile, for the Dock and taskbar.',
    tile: true,
    body: `<clipPath id="c-tile"><rect x="2" y="2" width="60" height="60" rx="14"/></clipPath><rect fill="${A}" x="2" y="2" width="60" height="60" rx="14"/><path clip-path="url(#c-tile)" fill="#0f0f10" fill-rule="evenodd" transform="translate(7 6) scale(.85)" d="${sharp(70)}${EYE}${TEAR}"/>` },
];

const svgFile = (o, color) => {
  const body = o.body.replaceAll('currentColor', color).replaceAll('var(--ink)', INK);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${o.vb || '0 0 64 64'}">${body}</svg>\n`;
};
const inline = (o, px) => `<svg viewBox="${o.vb || '0 0 64 64'}" width="${px}" height="${px}" aria-hidden="true">${o.body}</svg>`;

mkdirSync(join(here, 'svg'), { recursive: true });

const card = (o) => `
<section class="opt" id="${o.id}">
  <div class="hero dark">${inline(o, 128)}</div>
  <div class="hero light">${inline(o, 128)}</div>
  <div class="meta">
    <h2>${o.name}</h2>
    <p>${o.idea}</p>
  </div>
  <div class="sizes dark">${[16, 20, 32, 48].map((s) => `<span>${inline(o, s)}<em>${s}</em></span>`).join('')}</div>
  <div class="lockup dark">${inline(o, 28)}<b>Falcon</b></div>
  <div class="lockup light">${inline(o, 28)}<b>Falcon</b></div>
  <div class="dl"><a href="svg/${o.id}-white.svg" download>white.svg</a><a href="svg/${o.id}-black.svg" download>black.svg</a></div>
</section>`;

const page = (file, title, sub, options) => {
  for (const o of options) {
    writeFileSync(join(here, 'svg', `${o.id}-white.svg`), svgFile(o, '#ededed'));
    writeFileSync(join(here, 'svg', `${o.id}-black.svg`), svgFile(o, '#0f0f10'));
  }
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root { --deep:#0f0f10; --card:#19191b; --raised:#232325; --tx:#ededed; --mut:#85858b; --ink:${INK};
  --ui:-apple-system,BlinkMacSystemFont,Inter,'Segoe UI',sans-serif; --mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace; }
* { box-sizing:border-box; margin:0; }
body { background:var(--deep); color:var(--tx); font:14px/1.45 var(--ui); padding:48px; -webkit-font-smoothing:antialiased; }
header { max-width:1200px; margin:0 auto 32px; display:flex; align-items:baseline; justify-content:space-between; gap:24px; }
h1 { font-size:20px; font-weight:600; }
header p, .meta p { color:var(--mut); }
.label { font:12px var(--mono); color:var(--mut); }
.grid { max-width:1200px; margin:0 auto; display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:16px; }
.opt { background:var(--card); border-radius:20px; padding:16px; display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.dark { background:var(--deep); color:var(--tx); }
.light { background:#fff; color:#0f0f10; }
.hero { aspect-ratio:1; border-radius:12px; display:grid; place-items:center; }
.meta { grid-column:1/3; padding:8px 4px 4px; }
h2 { font-size:15px; font-weight:600; margin-bottom:2px; }
.sizes { grid-column:1/3; border-radius:12px; display:flex; align-items:flex-end; justify-content:space-around; padding:16px 8px 10px; }
.sizes span { display:flex; flex-direction:column; align-items:center; gap:6px; }
.sizes em { font:11px var(--mono); font-style:normal; color:var(--mut); }
.lockup { border-radius:12px; display:flex; align-items:center; justify-content:center; gap:10px; height:64px; }
.lockup b { font:600 22px var(--ui); }
.dl { grid-column:1/3; display:flex; gap:16px; padding:4px; }
.dl a { font:12px var(--mono); color:var(--mut); text-decoration:none; }
.dl a:hover { color:var(--tx); }
</style></head>
<body>
<header><h1>${title}</h1><p class="label">${sub}</p></header>
<main class="grid">${options.map(card).join('')}</main>
</body></html>
`;
writeFileSync(join(here, file), html);
};

page('index.html', 'Falcon logo options', `${options.length} marks · 64px grid · one accent: highlighter cyan`, options);
page('head.html', 'Head iterations', `${heads.length} takes on the Head mark`, heads);
console.log(`wrote ${options.length} options, ${heads.length} heads`);
