// Falcon sidebar prototype: three sidebars over the Zen C snapshot. Picker wiring follows PICKER.md.
(() => {
  const root = document.getElementById('cm-root');
  const Z = window.__zen, D = window.CM_DOCS, FX = window.__fx;
  const app = () => root.querySelector('#app');
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tidy = (s) => s.trim().replace(/---/g, ' · ').replace(/ · (1AC|1NC|2AC|2NC|1NR|1AR|2NR|2AR)$/, '');

  const I = {
    logo: '<svg viewBox="0 0 20 20"><path d="M2.5 14.5c3.2-.6 5.6-2.6 6.8-6.2L10.6 3l1.1 4.4c.9 3.6 3 5.9 5.8 6.9-3.2.9-5.6.4-7.2-1.1-1.5 1.4-4.2 2.1-7.8 1.3z" fill="currentColor"/></svg>',
    side: '<svg viewBox="0 0 16 16" fill="none"><rect x="2" y="2.5" width="12" height="11" rx="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M6 2.5v11" stroke="currentColor" stroke-width="1.3"/></svg>',
    search: '<svg viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    doc: '<svg viewBox="0 0 16 16" fill="none"><path d="M4 2.5h5.5L12 5v8.5H4z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6 8h4M6 10.5h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    mic: '<svg viewBox="0 0 16 16" fill="none"><rect x="6" y="2" width="4" height="7.5" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M3.8 8a4.2 4.2 0 0 0 8.4 0M8 12.2V14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 16 16" fill="none"><path d="m4.5 6.5 3.5 3.5 3.5-3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    gear: '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.3"/><path d="M8 1.8v1.7M8 12.5v1.7M14.2 8h-1.7M3.5 8H1.8M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2M12.4 12.4l-1.2-1.2M4.8 4.8 3.6 3.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  };

  // ---------- files and their outlines, read from the real docs ----------
  const FILES = [
    { id: 'send', name: 'Speech 1NC', i: 2, slice: 22, side: 'speech' },
    { id: 'dib', name: 'DIB Advantage', i: 1, side: 'aff' },
    { id: 'grid', name: 'Grid Reliability', i: 7, side: 'aff' },
    { id: 'atoff', name: 'AT Offshoring DA', i: 4, side: 'aff' },
    { id: 'econ', name: 'Econ DA', i: 2, side: 'neg' },
    { id: 'water', name: 'AT Water Shortage', i: 6, side: 'neg' },
  ];
  const DOT = { aff: '#6b9cff', neg: '#ff6b8b' };
  const dp = new DOMParser();
  for (const f of FILES) {
    const kids = [...dp.parseFromString(D[f.i].pm, 'text/html').querySelector('.ProseMirror').children].slice(0, f.slice || Infinity);
    const roots = [];
    let pk = null, hat = null, blk = null;
    const node = (lvl, el, label) => ({ lvl, label, id: el.dataset.id, cards: 0, kids: [] });
    const add = (n, parent) => (parent ? parent.kids : roots).push(n);
    for (const el of kids) {
      if (el.matches('h1.pmd-pocket')) { pk = node(1, el, tidy(el.textContent)); add(pk, null); hat = blk = null; }
      else if (el.matches('h2.pmd-hat')) { hat = node(2, el, tidy(el.textContent)); add(hat, pk); blk = null; }
      else if (el.matches('h3.pmd-block')) { blk = node(3, el, tidy(el.textContent)); add(blk, hat || pk); }
      else if (el.matches('.pmd-card')) {
        const t = el.querySelector('h4.pmd-tag');
        if (t && t.textContent.trim()) add(node(4, t, t.textContent.trim()), blk || hat || pk);
        [pk, hat, blk].forEach((x) => x && x.cards++);
      }
    }
    f.tree = roots;
    f.cards = kids.filter((el) => el.matches('.pmd-card')).length;
  }
  const file = () => FILES.find((f) => f.id === Z.S.left) || FILES[1];
  const flat = (ns) => ns.flatMap((n) => [n, ...flat(n.kids)]);
  const blocks = (f) => flat(f.tree).filter((x) => x.lvl === 2 || x.lvl === 3);

  function scrollToId(id) {
    const el = app().querySelector(`[data-id="${id}"]`), a = app();
    if (el) a.scrollTo({ top: el.getBoundingClientRect().top - a.getBoundingClientRect().top + a.scrollTop - 16, behavior: 'smooth' });
  }
  // the block you're reading: the last heading above the top of the page
  function currentId(sel = 'h1.pmd-pocket, h2.pmd-hat, h3.pmd-block, h4.pmd-tag') {
    const a = app(), top = a.getBoundingClientRect().top + 90;
    let id = null;
    a.querySelectorAll(sel).forEach((h) => { if (h.getBoundingClientRect().top < top) id = h.dataset.id; });
    return id || (flat(file().tree)[0] || {}).id;
  }

  // ---------- pieces ----------
  const row = (cls, attrs, inner) => `<button class="sb-row ${cls}" ${attrs}>${inner}</button>`;
  function fileRows(group) {
    return FILES.filter((f) => f.side === group).map((f) => row('', `data-file="${f.id}"`,
      `<span class="ic">${f.side === 'speech' ? I.mic : I.doc}</span><span class="nm">${esc(f.name)}</span><span class="ct">${f.cards}</span>`)).join('');
  }
  const FILE_SECTIONS = () => `<div class="sb-label">Speech</div><div class="sb-list" data-list="files">${fileRows('speech')}</div>
    <div class="sb-label">Aff</div><div class="sb-list" data-list="files">${fileRows('aff')}</div>
    <div class="sb-label">Neg</div><div class="sb-list" data-list="files">${fileRows('neg')}</div>`;
  // level N opens everything above level N, like CardMirror's 1-4 buttons; a chevron overrides it per node
  let level = +localStorage.getItem('fx-level') || 3;
  const OPEN = new Map();
  let query = '';
  const isOpen = (n) => (OPEN.has(n.id) ? OPEN.get(n.id) : n.lvl < level);
  function nodeHTML(n, q) {
    const hit = (x) => x.label.toLowerCase().includes(q) || x.kids.some(hit);
    if (q && !hit(n)) return '';
    const has = n.kids.length > 0, open = has && (q ? n.kids.some(hit) : isOpen(n));
    const tw = has ? `<span class="ic tw" data-tw>${I.chev}</span>` : '<span class="ic sp"></span>';
    const ct = n.lvl < 4 && n.cards ? `<span class="ct">${n.cards}</span>` : '';
    return `<div class="ol-n">${row(`ol l${n.lvl}`, `data-id="${n.id}" aria-expanded="${open}" style="padding-left:${6 + (n.lvl - 1) * 14}px"`, `${tw}<span class="nm">${esc(n.label)}</span>${ct}`)}`
      + (has ? `<div class="ol-kids"${open ? '' : ' hidden'}>${n.kids.map((k) => nodeHTML(k, q)).join('')}</div>` : '') + '</div>';
  }
  const outline = (f) => f.tree.map((n) => nodeHTML(n, query)).join('') || '<div class="ol-none">Nothing in this file matches.</div>';
  const OUTLINE_HEAD = () => `<div class="ol-head"><span class="sb-label">Outline</span>
      <div class="lv" role="group" aria-label="Outline depth"><span class="lv-hl"></span>${[1, 2, 3, 4].map((n) => `<button data-lv="${n}" aria-label="Show ${['pockets', 'hats', 'blocks', 'tags'][n - 1]}">${n}</button>`).join('')}</div>
      <button class="sb-ico" data-olq aria-label="Filter outline">${I.search}</button></div>
    <input class="ol-q" placeholder="Filter this outline" aria-label="Filter outline" spellcheck="false" hidden>`;
  const HEAD = `<div class="sb-head"><span class="sb-logo">${I.logo}</span><span class="sb-name">Falcon</span><button class="sb-ico" aria-label="Hide sidebar">${I.side}</button></div>`;
  const SEARCH = `<button class="sb-search" data-search>${I.search}<span>Search</span><kbd>⌘K</kbd></button>`;
  const FOOT = `<div class="sb-foot"><span class="sb-ava">G</span><span class="nm">Glenbrooks</span><span class="ct">Round 4</span><button class="sb-ico" style="margin-left:0" aria-label="Settings">${I.gear}</button></div>`;

  // one lit pill per list that slides to the active row
  function track(list) {
    if (list.querySelector('.sb-act')) return;
    const act = document.createElement('span');
    act.className = 'sb-act';
    list.prepend(act);
    requestAnimationFrame(() => requestAnimationFrame(() => list.setAttribute('data-ready', '')));
  }
  function light(list, rowEl) {
    const act = list.querySelector('.sb-act');
    if (!act) return;
    if (!rowEl || !rowEl.offsetHeight) { act.style.opacity = '0'; return; }
    act.style.height = rowEl.offsetHeight + 'px';
    act.style.transform = `translateY(${rowEl.offsetTop}px)`;
    act.style.opacity = '1';
  }

  // shared wiring for a sidebar element that holds file rows and an outline
  function wire(el, signal, { onFile } = {}) {
    el.querySelectorAll('.sb-list').forEach(track);
    function paint() {
      el.querySelectorAll('[data-list="files"]').forEach((l) => light(l, l.querySelector(`[data-file="${Z.S.left}"]`)));
      const ol = el.querySelector('[data-list="outline"]');
      if (!ol) return;
      const id = currentId();
      ol.querySelectorAll('.ol').forEach((r) => r.toggleAttribute('data-on', r.dataset.id === id));
      let r = ol.querySelector(`[data-id="${id}"]`);
      // inside a folded node: light the nearest open ancestor instead
      while (r && !r.offsetHeight) { const k = r.closest('.ol-kids'); r = k ? k.previousElementSibling : null; }
      light(ol, r);
      const lv = el.querySelector('.lv');
      if (lv) {
        const b = lv.querySelector(`[data-lv="${level}"]`);
        lv.querySelectorAll('[data-lv]').forEach((x) => x.toggleAttribute('data-on', x === b));
        lv.querySelector('.lv-hl').style.transform = `translateX(${b.offsetLeft - 2}px)`;
      }
      if (r && r.offsetHeight) {
        const s = el.querySelector('.sb-scroll'), rt = r.getBoundingClientRect(), st = s && s.getBoundingClientRect();
        if (s && (rt.top < st.top + 40 || rt.bottom > st.bottom - 40)) s.scrollTo({ top: s.scrollTop + rt.top - st.top - st.height / 3, behavior: 'smooth' });
      }
    }
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.search !== undefined) return FX.openPalette();
      if (b.dataset.file) { Z.open(b.dataset.file); onFile && onFile(); requestAnimationFrame(paint); return; }
      if (b.dataset.lv) { level = +b.dataset.lv; localStorage.setItem('fx-level', level); OPEN.clear(); return reOutline(); }
      if (b.dataset.olq !== undefined) {
        const q = el.querySelector('.ol-q'); q.hidden = !q.hidden;
        if (q.hidden) { q.value = ''; query = ''; reOutline(); } else q.focus();
        return;
      }
      if (b.classList.contains('ol') && e.target.closest('[data-tw]')) {
        const open = b.getAttribute('aria-expanded') !== 'true';
        OPEN.set(b.dataset.id, open);
        b.setAttribute('aria-expanded', String(open));
        b.nextElementSibling.hidden = !open;
        return requestAnimationFrame(paint);
      }
      if (b.dataset.id) scrollToId(b.dataset.id);
    }, { signal });
    function reOutline() {
      const ol = el.querySelector('[data-list="outline"]');
      ol.innerHTML = outline(file());
      track(ol);
      requestAnimationFrame(paint);
    }
    const qEl = el.querySelector('.ol-q');
    if (qEl) {
      qEl.addEventListener('input', () => { query = qEl.value.trim().toLowerCase(); reOutline(); }, { signal });
      qEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { qEl.value = ''; query = ''; qEl.hidden = true; reOutline(); } }, { signal });
    }
    let raf = 0;
    root.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint); }, { capture: true, passive: true, signal });
    paint();
    return paint;
  }

  // ---------- two panels: files on the left; the outline attached to the open document ----------
  function nav() {
    // files: a slim strip of file icons; hovering it slides the full glass files panel out
    const strip = document.createElement('nav');
    strip.className = 'fstrip';
    strip.setAttribute('aria-label', 'Files');
    const files = document.createElement('aside');
    files.className = 'rail-panel';
    document.body.append(strip, files);
    // outline: docked inside the document area, on the page's left edge, like CardMirror's nav pane
    const olp = document.createElement('aside');
    olp.className = 'olp';
    const ticks = document.createElement('div');
    ticks.className = 'olt';
    root.append(olp, ticks);
    let shown = localStorage.getItem('fx-outline') !== 'off', timer = 0, fctl = null, octl = null;
    const X = '<svg viewBox="0 0 16 16" fill="none"><path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

    // each strip icon sits at the height of its row in the files panel, so opening the panel reads as the strip widening
    function alignStrip() {
      const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
      const at = (el, y) => { if (el) el.style.top = Math.round(y - el.offsetHeight / 2) + 'px'; };
      at(strip.querySelector('.sb-logo'), mid(files.querySelector('.sb-logo')));
      at(strip.querySelector('[data-search]'), mid(files.querySelector('.sb-search')));
      strip.querySelectorAll('[data-file]').forEach((b) => {
        const row = files.querySelector(`[data-file="${b.dataset.file}"]`);
        if (row) at(b, mid(row));
      });
    }
    addEventListener('resize', () => alignStrip());
    function renderFiles() {
      files.innerHTML = `<div class="sb-head"><span class="sb-logo">${I.logo}</span><span class="sb-name">Falcon</span></div>` + SEARCH + `<div class="sb-scroll">${FILE_SECTIONS()}</div>` + FOOT;
      if (fctl) fctl.abort();
      fctl = new AbortController();
      wire(files, fctl.signal, { onFile: () => requestAnimationFrame(() => { OPEN.clear(); query = ''; renderFiles(); renderOutline(); }) });
      strip.innerHTML = `<span class="sb-logo">${I.logo}</span><button class="fs-b" data-search aria-label="Search">${I.search}</button><span class="fs-gap"></span>`
        + FILES.map((x) => `<button class="fs-b" data-file="${x.id}" aria-label="${esc(x.name)}" title="${esc(x.name)}" ${x.id === Z.S.left ? 'data-on' : ''}>${x.side === 'speech' ? I.mic : I.doc}</button>`).join('');
      requestAnimationFrame(alignStrip);
    }
    strip.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.search !== undefined) return FX.openPalette();
      if (b.dataset.file) { Z.open(b.dataset.file); OPEN.clear(); query = ''; renderFiles(); renderOutline(); }
    });
    let ftimer = 0;
    const fopen = () => { clearTimeout(ftimer); files.classList.add('open'); };
    const fclose = () => { clearTimeout(ftimer); ftimer = setTimeout(() => files.classList.remove('open'), 180); };
    strip.addEventListener('pointerenter', fopen);
    files.addEventListener('pointerenter', fopen);
    strip.addEventListener('pointerleave', fclose);
    files.addEventListener('pointerleave', fclose);
    function renderOutline() {
      const f = file();
      olp.innerHTML = `<div class="olp-head"><span class="olp-name">${esc(f.name)}</span><button class="sb-ico" data-olx aria-label="Hide outline (⌘\\)">${X}</button></div>`
        + `<div class="sb-scroll">${OUTLINE_HEAD()}<div class="sb-list" data-list="outline">${outline(f)}</div></div>`;
      ticks.innerHTML = `<div class="rail-ticks">${blocks(f).map((x) => `<span class="rail-tick ${x.lvl === 2 ? 'h' : 'b'}" data-id="${x.id}"></span>`).join('')}</div>`;
      if (octl) octl.abort();
      octl = new AbortController();
      const paint = wire(olp, octl.signal);
      const tk = () => { const id = currentId('h2.pmd-hat, h3.pmd-block'); ticks.querySelectorAll('.rail-tick').forEach((t) => t.toggleAttribute('data-on', t.dataset.id === id)); };
      root.addEventListener('scroll', () => requestAnimationFrame(tk), { capture: true, passive: true, signal: octl.signal });
      tk();
      olp.paint = paint;
    }
    function apply() {
      root.style.setProperty('--nav-width', shown ? '280px' : '28px');
      olp.classList.toggle('shown', shown);
      olp.classList.remove('peek');
      ticks.classList.toggle('shown', !shown);
      localStorage.setItem('fx-outline', shown ? 'on' : 'off');
      olp.paint && requestAnimationFrame(olp.paint);
    }
    const toggle = () => { shown = !shown; apply(); };
    renderFiles();
    renderOutline();
    apply();
    // hidden: hovering the tick strip slides the outline out over the page
    const peek = () => { if (shown) return; clearTimeout(timer); olp.classList.add('peek'); olp.paint && olp.paint(); };
    const unpeek = () => { if (shown) return; clearTimeout(timer); timer = setTimeout(() => olp.classList.remove('peek'), 180); };
    ticks.addEventListener('pointerenter', peek);
    olp.addEventListener('pointerenter', peek);
    olp.addEventListener('pointerleave', unpeek);
    ticks.addEventListener('pointerleave', unpeek);
    olp.addEventListener('click', (e) => { if (e.target.closest('[data-olx]')) toggle(); });
    ticks.addEventListener('click', toggle);
    // ---------- home: what ⌘T opens, and where the app starts ----------
    const home = document.createElement('section');
    home.className = 'home';
    home.setAttribute('aria-label', 'Home');
    root.append(home);
    const HI = {
      plus: '<svg viewBox="0 0 16 16" fill="none"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
      open: '<svg viewBox="0 0 16 16" fill="none"><path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
      star: '<svg viewBox="0 0 16 16"><path d="m8 2.2 1.75 3.6 3.95.55-2.87 2.77.7 3.93L8 11.2l-3.53 1.85.7-3.93L2.3 6.35l3.95-.55z" fill="currentColor"/></svg>',
    };
    const FOLDER = { speech: 'Speeches', aff: 'Moratorium Aff', neg: 'Moratorium Neg' };
    const OPENED = { send: '9:41', dib: '9:12', grid: 'Yesterday', atoff: 'Yesterday', econ: 'Oct 28', water: 'Oct 27' };
    // files from the real recents that are not part of this demo
    const OTHER = [
      { name: 'Edina Jiang Shapiro Neg Yale Round 6', folder: 'Downloads', when: 'Oct 26', side: 'neg' },
      { name: 'AT Implementation · 90 Days Is Enough', folder: 'TPNW Aff', when: 'Oct 25', side: 'aff' },
      { name: 'AT Implementation · Futility Framing', folder: 'TPNW Aff', when: 'Oct 25', side: 'aff' },
    ];
    const hrow = (o) => `<button class="hm-row" ${o.id ? `data-file="${o.id}"` : 'data-other'} data-side="${o.side || ''}">
        <span class="ic">${o.ic}</span><span class="nm">${esc(o.name)}</span><span class="fd">${esc(o.folder)}</span>
        <span class="ct">${o.cards != null ? o.cards + ' cards' : ''}</span><span class="wh">${o.when}</span></button>`;
    const fileRow = (f) => ({ id: f.id, side: f.side, ic: f.side === 'speech' ? I.mic : I.doc, name: f.name, folder: FOLDER[f.side], cards: f.cards, when: OPENED[f.id] });
    let recentsOn = true, texStop = null, tab = 'all';
    const HOME_BG = 'title';
    // the next tournament on the schedule (the prototype has one; the app would read it from the tournament list)
    const NEXT = { name: 'Glenbrooks', round: 4 };
    const TEX = new URLSearchParams(location.search).get('tex') === 'settle' ? 'settle' : 'beam';
    home.dataset.bg = HOME_BG;
    function renderHome() {
      const sp = FILES.find((f) => f.side === 'speech');
      const day = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      home.innerHTML = `<div class="hm-bg" aria-hidden="true"></div><div class="hm-sc"><div class="hm-in">
        <div class="hm-head"><div class="hm-text">
        <p class="hm-date">${day}</p>
        ${HOME_BG === 'title'
          ? `<h1 class="hm-title" aria-label="Falcon, next tournament ${esc(NEXT.name)}"><span class="cube" aria-hidden="true">${[0, 1, 2, 3].map((i) => `<span class="face" data-i="${i}"><span class="ft">${i % 2 ? esc(NEXT.name) : 'Falcon'}</span></span>`).join('')}</span></h1><p class="hm-sub">Round ${NEXT.round} at ${esc(NEXT.name)} is next, ${esc(sp.name)} is the speech doc with ${sp.cards} cards</p>`
          : `<h1 class="hm-title">Glenbrooks, round 4</h1><p class="hm-sub">${esc(sp.name)} is the speech doc, ${sp.cards} cards so far</p>`}
        </div><div class="hm-clock" aria-live="off"></div></div>
        <div class="hm-acts">
          <button class="hm-act" data-new="doc"><span class="ic">${HI.plus}</span><span class="t">New document</span><kbd>⌘N</kbd><span class="d">A blank file</span></button>
          <button class="hm-act" data-new="speech"><span class="ic">${I.mic}</span><span class="t">New speech document</span><kbd>⇧⌘N</kbd><span class="d">Cards you send land here</span></button>
          <button class="hm-act" data-new="open"><span class="ic">${HI.open}</span><span class="t">Open</span><kbd>⌘O</kbd><span class="d">A .docx or .cmir file</span></button>
        </div>
        <div class="hm-lab"><span>Favorites</span></div>
        <div class="hm-list">${hrow({ ic: `<span class="fav">${HI.star}</span>`, name: 'Cutting Board', folder: 'Ryan Files', when: '8:55' })}${hrow({ ...fileRow(FILES[1]), ic: `<span class="fav">${HI.star}</span>` })}</div>
        <div class="hm-lab"><span>Recent</span>${recentsOn ? `<span class="hm-tabs" role="tablist" aria-label="Filter recent">${['All', 'Speech', 'Aff', 'Neg'].map((t) => `<button role="tab" data-tab="${t.toLowerCase()}" aria-selected="${tab === t.toLowerCase()}">${t}</button>`).join('')}<i class="hm-tabs-hl"></i></span><button class="hm-clear" data-clear>Clear</button>` : ''}</div>
        <div class="hm-list" data-recent>${recentsOn ? FILES.map(fileRow).map(hrow).join('') + OTHER.map((o) => hrow({ ...o, ic: I.doc })).join('') : '<p class="hm-none">Files you open show up here</p>'}</div>
      </div></div>`;
      // the one moment on home: a field of highlighter strokes in the ink you are cutting with, gathering under the pointer
      if (texStop) texStop();
      texStop = null;
      const T = window.FX_TEXTURE; if (!T) return;
      // the title's texture: Falcon's own beam by default, ?tex=settle for the textures.dev one
      const head = home.querySelector('.hm-head'), title = home.querySelector('.hm-title');
      home.dataset.tex = TEX;
      texStop = TEX === 'settle' ? T.field(home, head, { scale: 0.5, text: title }) : spinTitle(title);
      home.append(peekEl, undoEl);
      KIT.dots(home.querySelector('.hm-bg'));
      KIT.clock(home.querySelector('.hm-clock'));
      paintTabs(false);
    }
    function paintTabs(animate = true) {
      const wrap = home.querySelector('.hm-tabs'); if (!wrap) return;
      const on = wrap.querySelector(`[data-tab="${tab}"]`), hl = wrap.querySelector('.hm-tabs-hl');
      wrap.querySelectorAll('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b === on)));
      if (!animate) hl.style.transition = 'none';
      hl.style.width = on.offsetWidth + 'px'; hl.style.transform = `translateX(${on.offsetLeft - 2}px)`;
      if (!animate) requestAnimationFrame(() => (hl.style.transition = ''));
      home.querySelectorAll('[data-recent] .hm-row').forEach((r) => { r.hidden = tab !== 'all' && r.dataset.side !== tab; });
    }
    // peek: hovering a file shows its blocks, so you can tell DIB from Grid before opening it
    const peekEl = document.createElement('div'); peekEl.className = 'hm-peek'; peekEl.setAttribute('role', 'tooltip'); home.append(peekEl);
    let peekT = 0, peekFor = null;
    function peekShow(row) {
      const f = FILES.find((x) => x.id === row.dataset.file); if (!f) return;
      const bl = blocks(f).slice(0, 6);
      peekEl.innerHTML = `<p class="pk-h"><span>${esc(f.name)}</span><span class="pk-c">${f.cards} cards</span></p>` + bl.map((b) => `<p class="pk-r l${b.lvl}"><span>${esc(b.label)}</span><span class="pk-c">${b.cards}</span></p>`).join('') + (blocks(f).length > 6 ? `<p class="pk-more">${blocks(f).length - 6} more blocks</p>` : '');
      const r = row.getBoundingClientRect(), hr = home.getBoundingClientRect(), nm = row.querySelector('.nm').getBoundingClientRect();
      const h = peekEl.offsetHeight, below = r.bottom + 8 + h < hr.bottom - 16;
      peekEl.style.left = nm.left - hr.left - 12 + 'px';
      peekEl.style.top = (below ? r.bottom - hr.top + 4 : r.top - hr.top - h - 4) + 'px';
      peekEl.dataset.from = below ? 'top' : 'bottom';
      peekEl.classList.add('open'); peekFor = row;
    }
    function peekHide() { clearTimeout(peekT); peekEl.classList.remove('open'); peekFor = null; }
    home.addEventListener('pointerover', (e) => {
      const row = e.target.closest('.hm-row[data-file]');
      if (row === peekFor) return;
      clearTimeout(peekT);
      if (!row) { peekT = setTimeout(peekHide, 80); return; }
      peekT = setTimeout(() => peekShow(row), peekFor ? 0 : 200);
    });
    home.addEventListener('pointerleave', peekHide);
    home.addEventListener('scroll', peekHide, true);
    // undo: Clear hides the list for five seconds before it counts; hovering the toast pauses the clock
    const undoEl = document.createElement('div'); undoEl.className = 'hm-undo'; undoEl.setAttribute('role', 'status'); home.append(undoEl);
    let undoLeft = 0, undoLast = 0, undoRaf = 0, undoPaused = false;
    function undoShow() {
      undoEl.innerHTML = '<span>Recent cleared</span><button data-undo>Undo</button><i></i>';
      undoEl.classList.add('open'); undoLeft = 5000; undoLast = performance.now();
      cancelAnimationFrame(undoRaf);
      const tick = (now) => {
        if (!undoPaused) undoLeft -= now - undoLast; undoLast = now;
        undoEl.querySelector('i').style.transform = `scaleX(${Math.max(0, undoLeft / 5000)})`;
        if (undoLeft <= 0) return undoHide();
        undoRaf = requestAnimationFrame(tick);
      };
      undoRaf = requestAnimationFrame(tick);
    }
    function undoHide() { cancelAnimationFrame(undoRaf); undoEl.classList.remove('open'); }
    undoEl.addEventListener('pointerenter', () => (undoPaused = true));
    undoEl.addEventListener('pointerleave', () => (undoPaused = false));
    undoEl.addEventListener('click', (e) => { if (e.target.closest('[data-undo]')) { recentsOn = true; undoHide(); renderHome(); } });
    // the title is a block that turns over: Falcon, then the next tournament, every few seconds.
    // Each face carries its own beam; hovering the title holds it still so you can highlight it
    function spinTitle(title) {
      const cube = title.querySelector('.cube'), faces = [...cube.querySelectorAll('.face')];
      const w = Math.max(...faces.map((f) => f.querySelector('.ft').offsetWidth));
      cube.style.width = w + 'px';
      const beams = faces.map((f, i) => window.FX_BEAM(home, f, f.querySelector('.ft'), { intro: i === 0, frame: title }));
      let step = 0, hold = false, t = 0;
      const turn = () => {
        if (hold || !home.classList.contains('open')) return;
        step++;
        cube.style.setProperty('--turn', `${step * 90}deg`);
        faces.forEach((f, i) => f.classList.toggle('front', i === step % 4));
        beams.forEach((b) => b.forget());
      };
      faces[0].classList.add('front');
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      t = setInterval(turn, reduced ? 6000 : 4500);
      title.addEventListener('pointerenter', () => (hold = true));
      title.addEventListener('pointerleave', () => (hold = false));
      return () => { clearInterval(t); beams.forEach((b) => b()); };
    }
    let lastFocus = null;
    const homeOpen = () => home.classList.contains('open');
    function showHome() { home.classList.add('open'); renderHome(); lastFocus = document.activeElement; home.classList.add('open'); const sc = home.querySelector('.hm-sc'); if (sc) sc.scrollTop = 0; }
    function hideHome() { peekHide(); undoHide(); home.classList.remove('open'); if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); }
    window.__home = { show: showHome, hide: hideHome };
    home.addEventListener('click', (e) => {
      const r = e.target.closest('button'); if (!r) return;
      if (r.dataset.file) { peekHide(); Z.open(r.dataset.file); OPEN.clear(); query = ''; renderFiles(); renderOutline(); hideHome(); }
      else if (r.dataset.other !== undefined) FX.toast('Only the six demo files open in this prototype');
      else if (r.dataset.clear !== undefined) { recentsOn = false; peekHide(); renderHome(); undoShow(); }
      else if (r.dataset.tab) { tab = r.dataset.tab; paintTabs(); }
      else if (r.dataset.new) FX.toast({ doc: 'New document', speech: 'New speech document', open: 'Open a file' }[r.dataset.new] + ' is not wired up in the prototype');
    });
    strip.addEventListener('click', (e) => { if (e.target.closest('.sb-logo')) showHome(); else if (e.target.closest('[data-file]')) hideHome(); });
    files.addEventListener('click', (e) => { if (e.target.closest('.sb-logo, .sb-name')) showHome(); else if (e.target.closest('[data-file]')) hideHome(); });
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); e.stopImmediatePropagation(); homeOpen() ? hideHome() : showHome(); }
      else if (e.key === 'Escape' && homeOpen()) { e.stopImmediatePropagation(); hideHome(); }
    }, true);
    if (!new URLSearchParams(location.search).has('doc')) showHome();
    // capture phase so the Zen snapshot's own ⌘\ (split view) never sees it
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); e.stopImmediatePropagation(); toggle(); }
    }, true);
  }
  nav();

  // ---------- harness: PICKER.md wiring; the picker flips the top-panel variants ----------
  const bar = FX.bar;
  const variants = window.FX_TOP || [];
  const styleEl = document.createElement('style');
  document.head.appendChild(styleEl);
  const picker = document.querySelector('.proto-picker');
  const highlight = picker.querySelector('.proto-picker-highlight');
  const items = [...picker.querySelectorAll('.proto-picker-item:not(.proto-picker-replay)')];
  const replay = picker.querySelector('.proto-picker-replay');
  let current = 0, ctrl = null;
  const ctx = { act: FX.act, timer: FX.timer, toast: FX.toast };
  function moveHighlight() {
    const el = items[current];
    highlight.style.width = el.offsetWidth + 'px';
    highlight.style.transform = `translateX(${el.offsetLeft}px)`;
  }
  function mount(i) {
    if (ctrl) ctrl.abort();
    bar.innerHTML = '';
    requestAnimationFrame(() => {
      ctrl = new AbortController();
      const v = variants[i];
      styleEl.textContent = v.css;
      root.style.setProperty('--fx-h', v.height + 'px');
      v.render(bar, ctx, ctrl.signal);
      FX.timer.paintTimer();
    });
  }
  function setActive(i) {
    if (i < 0 || i >= variants.length) return;
    current = i;
    items.forEach((el, j) => {
      el.toggleAttribute('data-active', j === i);
      if (j === i) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current');
    });
    moveHighlight();
    const url = new URL(location);
    url.searchParams.set('v', i + 1);
    history.replaceState(null, '', url);
    mount(i);
  }
  items.forEach((el, i) => el.addEventListener('click', () => { window.__home?.hide(); setActive(i); }));
  replay?.addEventListener('click', () => mount(current));
  window.addEventListener('resize', moveHighlight);
  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= variants.length) setActive(num - 1);
    else if (e.key === 'ArrowRight') setActive((current + 1) % variants.length);
    else if (e.key === 'ArrowLeft') setActive((current - 1 + variants.length) % variants.length);
    else if (e.key === 'r' || e.key === 'R') mount(current);
  });
  setActive((parseInt(new URLSearchParams(location.search).get('v'), 10) || 1) - 1);
  requestAnimationFrame(() => requestAnimationFrame(() => picker.setAttribute('data-ready', '')));
})();
