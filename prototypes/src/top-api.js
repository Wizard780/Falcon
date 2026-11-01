(() => {
const F = '-apple-system,"Inter",sans-serif';
const EASE = 'cubic-bezier(.23,1,.32,1)';
const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const HL = [['cyan','#00e5ff'],['yellow','#ffe500'],['green','#3ddc84'],['magenta','#ff4fd8'],['blue','#4f8cff'],['red','#ff5a5a']].map(([v,c]) => ({v, c, n: v}));
const FC = [['#000000','Black'],['#1f3864','Dark blue'],['#385623','Dark green'],['#ff0000','Red']].map(([v,n]) => ({v, c: v, n}));
const LN = [['1','Thin'],['2','Medium'],['3','Thick']].map(([v,n]) => ({v, n}));
const KINDS = {
  h: {items: HL, act: 'h'},
  fc: {items: FC, act: 'fontColor'},
  sh: {items: HL, act: 'shade'},
  ln: {items: LN, act: 'line', line: 1}
};
const col = (k, v) => ((KINDS[k].items.find(i => i.v === v) || {}).c) || '';

const I = d => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const PEN = I('<path d="M10.2 2.8l3 3L6.5 12.5H3.5v-3z"/><path d="M8.7 4.3l3 3"/>');
const BUCKET = I('<path d="M7 2.5l5 5-4.5 4.5a1.4 1.4 0 01-2 0L2.5 9a1.4 1.4 0 010-2z"/><path d="M3 8h8.5"/><path d="M13.6 10.6s.9 1.2.9 1.9a.9.9 0 01-1.8 0c0-.7.9-1.9.9-1.9z"/>');
const CARET = I('<path d="M5.5 6.75L8 9.25l2.5-2.5"/>');
const UP = I('<path d="M5.5 9.25L8 6.75l2.5 2.5"/>');
const LINE = I('<path d="M3 8h10"/>');
const CHEV = I('<path d="M6.75 5.5L9.25 8l-2.5 2.5"/>');
const FA = '<b class="fa">A</b>';

const ST = {
  pocket: ['Pocket','pv box'], hat: ['Hat','pv uu'], analytic: ['Analytic','pv an'], cite: ['Cite','pv'],
  e: ['Emphasis','pv u box'], tag: ['Tag','pv'], block: ['Block','pv u'], undertag: ['Undertag','ut'],
  u: ['Underline','u'], clear: ['Clear','']
};
const sb = k => `<button class="b" data-a="${k}"><span class="${ST[k][1]}">${ST[k][0]}</span></button>`;
const sbs = a => a.map(sb).join('');
const pair = (k, a, g, l) => `<span class="pair"><button class="b ic" data-a="${a}" aria-label="${l}" title="${l}"><span class="glyph">${g}${k ? `<i data-bar="${k}"></i>` : ''}</span></button><button class="b cr" data-pop="${k || 'ln'}" aria-label="${l} options" aria-haspopup="menu" aria-expanded="false">${CARET}</button></span>`;
const BIG = `<button class="b sz" data-a="bigger" aria-label="Increase font size" title="Bigger">A${UP}</button>`;
const SMALL = `<button class="b sz" data-a="smaller" aria-label="Decrease font size" title="Smaller">A${CARET}</button>`;
const END = `<div class="end"><button class="b" data-a="send">Send</button><button class="b" data-t="speech" aria-label="Speech timer">8:00</button></div>`;

const CORE = `<div class="g">${sbs(['pocket','tag','hat','block','analytic','undertag'])}</div><div class="g">${sbs(['cite','u','e','clear'])}</div><div class="g">${pair('h','h',PEN,'Highlight')}${pair('sh','shade',BUCKET,'Shading')}${pair('fc','fontColor',FA,'Font color')}${pair('','line',LINE,'Line weight')}${BIG}${SMALL}</div>`;

const BASE = `
.S.r{position:relative;display:flex;align-items:center;height:100%;padding:0 24px;gap:32px;font:500 13px/1 ${F};color:#ececee;-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;box-sizing:border-box}
.S *,.S.pop *{box-sizing:border-box}
.S .b{position:relative;isolation:isolate;appearance:none;border:0;margin:0;background:none;color:inherit;font:inherit;height:32px;padding:0 12px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;cursor:default;transition:transform 160ms ${EASE}}
.S .b::before,.S .b::after{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;opacity:0;pointer-events:none;transition:opacity 150ms ease-out}
.S .b::before{background:rgba(255,255,255,.05)}
.S .b::after{background:linear-gradient(#232326,#1b1b1e);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
@media (hover:hover){.S .b:hover::before{opacity:1}}
.S .b:active::after,.S .b[aria-expanded="true"]::after,.S .b:focus-visible::after{opacity:1;transition-duration:80ms}
.S .b:focus-visible{outline:none}
.S .b:active{transform:scale(.97)}
.S .pv{font:700 14px/1 system-ui,-apple-system,"Inter",sans-serif}
.S .box{padding:4px 8px;border-radius:7px;box-shadow:inset 0 0 0 1px rgba(236,236,238,.55)}
.S .u{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
.S .uu{text-decoration:underline double;text-underline-offset:3px}
.S .an{color:#8aa4d6}
.S .ut{color:#8fae7a;font-style:italic;font-size:14px}
.S .m,.S .cr,.S .sz svg{color:#85858c}
.S .cr{width:20px;padding:0}
.S .ic{padding:0 6px 0 8px}
.S .pair{display:inline-flex}
.S .glyph{position:relative;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px}
.S .glyph i{position:absolute;left:0;right:0;bottom:-4px;height:2px;border-radius:1px;box-shadow:0 0 0 .5px rgba(255,255,255,.14)}
.S .fa{font:600 14px/1 ${F}}
.S .sz{padding:0 8px;gap:2px}
.S .end{margin-left:auto;display:flex;align-items:center;gap:4px}
.S [data-t="speech"]{font:500 12px/1 ui-monospace,"SF Mono",Menlo,monospace;color:#85858c;font-variant-numeric:tabular-nums;min-width:56px}
.S [data-t="speech"][data-on]{color:#ececee}
.S.pop{position:fixed;z-index:2147483000;display:flex;gap:8px;padding:10px;border-radius:12px;background:#1b1b1e;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 12px 32px rgba(0,0,0,.55);opacity:0;transform:scale(.98);transition:opacity 160ms ease-out,transform 180ms ${EASE}}
.S.pop.in{opacity:1;transform:none}
.S.pop button{appearance:none;border:0;margin:0;padding:0;cursor:default;background:none}
.S.pop .sw{width:20px;height:20px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);transition:transform 150ms ${EASE}}
@media (hover:hover){.S.pop .sw:hover{transform:scale(1.12)}.S.pop .ln:hover{color:#ececee}}
.S.pop .sw[aria-current]{box-shadow:0 0 0 2px #1b1b1e,0 0 0 3px #ececee}
.S.pop .ln{width:32px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#85858c}
.S.pop .ln i{width:18px;background:currentColor;border-radius:1px}
.S.pop .ln[aria-current]{color:#ececee}
@media (prefers-reduced-motion:reduce){.S .b,.S .b::before,.S .b::after,.S.pop,.S.pop *{transition:none!important}.S .b:active{transform:none}.S.pop{transform:none}}
`;

function mount(bar, ctx, signal, S, html) {
  const act = (n, a) => { try { ctx.act(n, a); } catch (e) {} };
  const st = {h: 'cyan', fc: '#000000', sh: 'yellow', ln: '1'};
  const root = document.createElement('div');
  root.className = S + ' r';
  root.setAttribute('data-keepsel', '');
  root.innerHTML = html;
  bar.appendChild(root);
  const paintBars = () => { root.querySelectorAll('[data-bar]').forEach(i => { i.style.background = col(i.dataset.bar, st[i.dataset.bar]); }); document.documentElement.style.setProperty('--ink', col('h', st.h) || '#00e5ff'); };
  paintBars();

  let pop = null, trig = null;
  const close = now => {
    if (!pop) return;
    const p = pop; pop = null;
    trig.setAttribute('aria-expanded', 'false'); trig = null;
    p.classList.remove('in');
    if (now || RM()) p.remove(); else setTimeout(() => p.remove(), 150);
  };
  const open = t => {
    if (trig === t) { close(); return; }
    close(true);
    const k = t.dataset.pop, K = KINDS[k];
    const p = pop = document.createElement('div');
    p.className = S + ' pop';
    p.setAttribute('data-keepsel', '');
    p.setAttribute('role', 'menu');
    p.innerHTML = K.items.map(i => K.line
      ? `<button class="ln" role="menuitem" data-v="${i.v}" aria-label="${i.n}"><i style="height:${i.v}px"></i></button>`
      : `<button class="sw" role="menuitem" data-v="${i.v}" aria-label="${i.n}" style="background:${i.c}"></button>`).join('');
    const c = p.querySelector(`[data-v="${st[k]}"]`); if (c) c.setAttribute('aria-current', 'true');
    document.body.appendChild(p);
    const r = t.getBoundingClientRect(), w = p.offsetWidth;
    const x = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8));
    p.style.left = x + 'px';
    p.style.top = (r.bottom + 6) + 'px';
    p.style.transformOrigin = `${r.left + r.width / 2 - x}px 0`;
    trig = t; t.setAttribute('aria-expanded', 'true');
    p.addEventListener('click', e => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      st[k] = b.dataset.v; paintBars(); act(K.act, st[k]); close();
    }, {signal});
    requestAnimationFrame(() => { if (pop === p) p.classList.add('in'); });
  };

  root.addEventListener('click', e => {
    const t = e.target.closest('[data-t="speech"]');
    if (t) { try { ctx.timer.toggleSpeech(); ctx.timer.paintTimer(); } catch (_) {} return; }
    const p = e.target.closest('[data-pop]'); if (p) { open(p); return; }
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, m = {h: 'h', fontColor: 'fc', shade: 'sh', line: 'ln'}[a];
    act(a, m ? st[m] : undefined);
  }, {signal});
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); }, {signal});
  document.addEventListener('pointerdown', e => { if (pop && !pop.contains(e.target) && !trig.contains(e.target)) close(); }, {signal});
  window.addEventListener('resize', () => close(true), {signal});
  signal.addEventListener('abort', () => { if (pop) pop.remove(); pop = null; root.remove(); });
  try { ctx.timer.paintTimer(); } catch (_) {}
  return {root, close};
}

const sc = (S, css) => css.split('.S').join('.' + S);
const V = (name, height, extra, html, after) => {
  const S = 'fxt-' + name.toLowerCase();
  return {
    name, height, css: sc(S, BASE + extra),
    render(bar, ctx, signal) { const m = mount(bar, ctx, signal, S, html); if (after) after(m, signal); }
  };
};

const GRID = `.S .g{display:grid;grid-template-rows:32px 32px;grid-auto-flow:column;gap:4px}.S .g>.b{width:100%}`;

const classic = V('Classic', 88, GRID, CORE + END);

const glass = V('Glass', 100, GRID + `
.S.r{padding:0 12px}
.S .slab{position:relative;flex:1;display:flex;align-items:center;gap:32px;padding:8px 12px;border-radius:16px;background:rgba(10,10,10,.82);backdrop-filter:blur(12px) saturate(1.4);-webkit-backdrop-filter:blur(12px) saturate(1.4);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.S .slab .b::before{display:none}
.S .hl{position:absolute;left:0;top:0;width:0;height:0;border-radius:9px;background:linear-gradient(#232326,#1b1b1e);box-shadow:inset 0 1px 0 rgba(255,255,255,.06);opacity:0;pointer-events:none;transition:transform 250ms ${EASE},width 250ms ${EASE},height 250ms ${EASE},opacity 150ms ease-out}
.S .hl.on{opacity:1}
@media (prefers-reduced-motion:reduce){.S .hl{transition:opacity 150ms ease-out}}
`, `<div class="slab"><span class="hl" aria-hidden="true"></span>${CORE}${END}</div>`, (m, signal) => {
  const sl = m.root.querySelector('.slab'), hl = sl.querySelector('.hl');
  let cur = null;
  const go = b => {
    if (b === cur) return;
    const s = sl.getBoundingClientRect(), r = b.getBoundingClientRect();
    const first = !hl.classList.contains('on');
    if (first) hl.style.transition = 'none';
    hl.style.transform = `translate(${r.left - s.left}px,${r.top - s.top}px)`;
    hl.style.width = r.width + 'px';
    hl.style.height = r.height + 'px';
    if (first) { void hl.offsetWidth; hl.style.transition = ''; }
    hl.classList.add('on');
    cur = b;
  };
  const hide = () => { hl.classList.remove('on'); cur = null; };
  sl.addEventListener('pointerover', e => { const b = e.target.closest('.b'); if (b && sl.contains(b)) go(b); }, {signal});
  sl.addEventListener('pointerleave', hide, {signal});
  sl.addEventListener('focusin', e => { const b = e.target.closest('.b'); if (b) go(b); }, {signal});
  sl.addEventListener('focusout', e => { if (!sl.contains(e.relatedTarget) && !sl.matches(':hover')) hide(); }, {signal});
});

const HR = `<div class="st">${sbs(['tag','cite','u','e'])}<button class="b hw" data-a="h" title="Apply highlight">Highlight<i data-bar="h"></i></button>${sbs(['block','hat','pocket','clear'])}<span class="more"><button class="b m" data-more aria-expanded="false" aria-label="More styles">More${CHEV}</button><span class="x" hidden>${sb('analytic')}${sb('undertag')}</span></span></div><div class="cs"><button class="b dot" data-pop="h" aria-label="Highlight color" aria-haspopup="menu" aria-expanded="false"><i data-bar="h"></i></button><button class="b dot" data-pop="fc" aria-label="Font color" aria-haspopup="menu" aria-expanded="false"><i data-bar="fc"></i></button>${BIG}${SMALL}</div>${END}`;

const row = V('Row', 56, `
.S.r{gap:12px;padding:0 12px}
.S .st,.S .more,.S .cs{display:flex;align-items:center;gap:2px}
.S .st .b{padding:0 8px}
.S .x{display:flex;align-items:center;gap:2px;opacity:0;transform:translateX(-6px);transition:opacity 180ms ease-out,transform 220ms ${EASE}}
.S .x.in{opacity:1;transform:none}
.S .x[hidden]{display:none}
.S [data-more]{gap:2px}
.S [data-more] svg{transition:transform 200ms ${EASE}}
.S [data-more][aria-expanded="true"] svg{transform:rotate(180deg)}
.S .cs{transition:transform 220ms ${EASE}}
.S .dot{width:32px;padding:0}
.S .dot i{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}
.S .hw i{position:absolute;left:10px;right:10px;bottom:6px;height:2px;border-radius:1px}
@media (prefers-reduced-motion:reduce){.S .x,.S .cs,.S [data-more] svg{transition:none!important}.S .x{transform:none}}
`, HR, (m, signal) => {
  const R = m.root, zone = R.querySelector('.more'), btn = zone.querySelector('[data-more]'), x = zone.querySelector('.x'), cs = R.querySelector('.cs');
  let isOpen = false, pinned = false, tmr = 0, tok = 0;
  const flip = fn => {
    const a = cs.getBoundingClientRect().left;
    fn();
    const d = a - cs.getBoundingClientRect().left;
    if (!d || RM()) return;
    cs.style.transition = 'none';
    cs.style.transform = `translateX(${d}px)`;
    void cs.offsetWidth;
    cs.style.transition = '';
    cs.style.transform = '';
  };
  const set = o => {
    if (o === isOpen) return;
    isOpen = o;
    btn.setAttribute('aria-expanded', String(o));
    const my = ++tok;
    if (o) {
      flip(() => { x.hidden = false; });
      requestAnimationFrame(() => { if (my === tok) x.classList.add('in'); });
    } else {
      x.classList.remove('in');
      setTimeout(() => { if (my === tok) flip(() => { x.hidden = true; }); }, RM() ? 0 : 120);
    }
  };
  zone.addEventListener('pointerenter', () => { clearTimeout(tmr); tmr = setTimeout(() => set(true), 100); }, {signal});
  zone.addEventListener('pointerleave', () => { clearTimeout(tmr); if (!pinned) tmr = setTimeout(() => set(false), 300); }, {signal});
  btn.addEventListener('click', () => {
    clearTimeout(tmr);
    if (isOpen && pinned) { pinned = false; set(false); } else { pinned = true; set(true); }
  }, {signal});
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen) { pinned = false; set(false); } }, {signal});
  signal.addEventListener('abort', () => clearTimeout(tmr));
});

window.FX_TOP = [classic, glass, row];
})();