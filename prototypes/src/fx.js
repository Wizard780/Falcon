// Falcon top-panel prototype, round 2: three layouts built from one dark glass pill. Picker wiring follows PICKER.md.
(() => {
  const root = document.getElementById('cm-root');
  const Z = window.__zen;
  const D = window.CM_DOCS;
  const FILE_ID = ['tpnw', 'dib', 'econ', 'techno', 'atoff', 'town', 'water', 'grid', 'ore', 'solv'];
  const short = (f) => f.replace(/\.docx$/, '').replace(/^Data[- ]Centers---/, '').replace(/^Space-Col---/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const app = () => root.querySelector('#app');
  const pm = () => app().querySelector('.ProseMirror');
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isRound = () => document.documentElement.hasAttribute('data-fx-round');

  // the doc is editable in the prototype so formatting is real
  const setEditable = (on) => root.querySelectorAll('#app .ProseMirror').forEach((e) => (e.contentEditable = on ? 'true' : 'false'));
  setEditable(true);

  // ---------- the pill: a sliding highlight follows the pointer and rests on [data-rest] ----------
  function pill(el) {
    const hl = document.createElement('span');
    hl.className = 'fx-hl';
    el.prepend(hl);
    const to = (b) => {
      if (!b || !b.offsetWidth) { hl.style.opacity = '0'; return; }
      hl.style.width = b.offsetWidth + 'px';
      hl.style.transform = `translateX(${b.offsetLeft}px)`;
      hl.style.opacity = '1';
    };
    const rest = () => to([...el.querySelectorAll('button[data-rest]')].find((b) => b.offsetWidth));
    el.addEventListener('pointerover', (e) => { const b = e.target.closest('button'); if (b && el.contains(b)) to(b); });
    el.addEventListener('pointerleave', rest);
    el.rest = rest;
    rest();
    requestAnimationFrame(() => requestAnimationFrame(() => el.setAttribute('data-ready', '')));
    return el;
  }

  const toastEl = document.createElement('div');
  toastEl.className = 'fx-p fx-toast';
  document.body.appendChild(toastEl);
  let toastT;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  // ---------- formatting ----------
  function selRange() {
    const s = getSelection();
    if (!s.rangeCount) return null;
    const r = s.getRangeAt(0);
    return pm().contains(r.commonAncestorContainer) ? r : null;
  }
  // grow a range to whole words, the way the highlighter should snap
  function snap(r) {
    const a = r.startContainer, b = r.endContainer;
    if (a.nodeType === 3) { let i = r.startOffset; while (i > 0 && /\S/.test(a.data[i - 1])) i--; r.setStart(a, i); }
    if (b.nodeType === 3) { let i = r.endOffset; while (i < b.data.length && /[\w’'-]/.test(b.data[i])) i++; r.setEnd(b, i); }
    return r;
  }
  function wrap(cls, attrs = {}) {
    const r = selRange();
    if (!r || r.collapsed) return toast('Select some card text first');
    snap(r);
    const span = document.createElement('span');
    span.className = cls;
    for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
    span.appendChild(r.extractContents());
    r.insertNode(span);
    getSelection().removeAllRanges();
  }
  function clearFmt() {
    const r = selRange();
    if (!r || r.collapsed) return toast('Select some card text first');
    pm().querySelectorAll('.pmd-underline,.pmd-highlight,.pmd-emphasis').forEach((el) => { if (r.intersectsNode(el)) el.replaceWith(...el.childNodes); });
    getSelection().removeAllRanges();
  }
  const BLOCK = { pocket: ['h1', 'pmd-pocket'], hat: ['h2', 'pmd-hat'], block: ['h3', 'pmd-block'], tag: ['h4', 'pmd-tag'], analytic: ['p', 'pmd-analytic'], undertag: ['p', 'pmd-undertag'] };
  function setBlock(kind) {
    const r = selRange();
    if (!r) return toast('Put the cursor in a paragraph first');
    let n = r.startContainer;
    while (n && n.parentElement !== pm() && !(n.parentElement && n.parentElement.classList.contains('pmd-card'))) n = n.parentElement;
    if (!n || n.nodeType !== 1) return;
    const [tag, cls] = BLOCK[kind];
    const el = document.createElement(tag);
    el.className = cls;
    el.innerHTML = n.innerHTML;
    n.replaceWith(el);
  }
  function currentCardName() {
    const r = selRange();
    let n = r ? r.startContainer : null;
    while (n && n !== pm() && !(n.classList && n.classList.contains('pmd-card'))) n = n.parentNode;
    const t = n && n.classList && n.classList.contains('pmd-card') ? n.querySelector('.pmd-tag') : null;
    if (t) { const s = t.textContent.trim(); return s.length > 44 ? s.slice(0, 44) + '…' : s; }
    const heads = [...pm().querySelectorAll('h3.pmd-block')];
    const top = app().getBoundingClientRect().top + 60;
    const h = heads.filter((e) => e.getBoundingClientRect().top < top).pop() || heads[0];
    return h ? h.textContent.trim() : 'this block';
  }
  let hiColor = 'cyan';
  const ACT = {
    pocket: () => setBlock('pocket'), hat: () => setBlock('hat'), block: () => setBlock('block'), tag: () => setBlock('tag'),
    cite: () => wrap('pmd-cite'), u: () => wrap('pmd-underline'), e: () => wrap('pmd-emphasis'),
    h: (color = hiColor) => { hiColor = color; wrap('pmd-highlight', { 'data-highlight': color, 'data-highlight-band': 'light' }); },
    analytic: () => setBlock('analytic'), undertag: () => setBlock('undertag'),
    fontColor: (c = '#1f3864') => wrap('pmd-fc', { style: `color:${c}` }),
    bigger: () => wrap('pmd-fs', { style: 'font-size:1.15em' }), smaller: () => wrap('pmd-fs', { style: 'font-size:.87em' }),
    clear: clearFmt,
    send: () => toast(`Sent “${currentCardName()}” to your speech doc`),
    drop: () => toast(`${T.name} sent to SpeechDrop`),
    search: () => openPalette(),
  };
  // keep the text selection when a pill button is clicked
  document.addEventListener('mousedown', (e) => { if (e.target.closest('.fx-p button, [data-keepsel] button, [data-keepsel]')) e.preventDefault(); });

  // ---------- timer ----------
  const SPEECH = [['1AC', 8], ['CX', 3], ['1NC', 8], ['2AC', 8], ['2NC', 8], ['1NR', 5], ['1AR', 5], ['2NR', 5], ['2AR', 5]];
  const T = { name: '1AC', left: 480, run: false, prep: { A: 480, N: 480 }, prepOn: null };
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  function paintTimer() {
    document.querySelectorAll('[data-t="speech"]').forEach((e) => { e.textContent = fmt(T.left); e.toggleAttribute('data-on', T.run); });
    document.querySelectorAll('[data-t="name"]').forEach((e) => (e.textContent = T.name));
    document.querySelectorAll('[data-prep]').forEach((e) => { e.textContent = `${e.dataset.prep === 'A' ? 'Aff' : 'Neg'} ${fmt(T.prep[e.dataset.prep])}`; e.toggleAttribute('data-on', T.prepOn === e.dataset.prep); });
  }
  setInterval(() => {
    if (T.run && T.left > 0) T.left--;
    if (T.run && T.left === 0) { T.run = false; toast(`${T.name} time is up`); }
    if (T.prepOn && T.prep[T.prepOn] > 0) T.prep[T.prepOn]--;
    if (T.run || T.prepOn) paintTimer();
  }, 1000);
  const toggleSpeech = () => { T.run = !T.run; if (T.run) T.prepOn = null; paintTimer(); };
  const togglePrep = (side) => { T.prepOn = T.prepOn === side ? null : side; if (T.prepOn) T.run = false; paintTimer(); };
  const pickSpeech = (name) => { T.name = name; T.left = SPEECH.find((x) => x[0] === name)[1] * 60; T.run = false; paintTimer(); };

  // ---------- ⌘K: every block and card in all 10 files, plus commands ----------
  let INDEX = null;
  function buildIndex() {
    INDEX = [];
    const dp = new DOMParser();
    D.forEach((d, i) => {
      const doc = dp.parseFromString(d.pm, 'text/html'), file = short(d.file);
      doc.querySelectorAll('h3.pmd-block').forEach((h) => INDEX.push({ k: 'block', name: h.textContent.trim(), file, doc: FILE_ID[i], id: h.dataset.id }));
      // a card is found by its author line ("Segers 26") as well as its tag
      doc.querySelectorAll('h4.pmd-tag').forEach((h) => {
        const t = h.textContent.trim(), c = h.nextElementSibling && h.nextElementSibling.querySelector('.pmd-cite, strong');
        if (t) INDEX.push({ k: 'card', name: (c ? c.textContent.trim() + '  ' : '') + t, file, doc: FILE_ID[i], id: h.dataset.id });
      });
    });
  }
  const COMMANDS = [
    ['Send to speech doc', '`', ACT.send], ['Underline', 'F9', ACT.u], ['Emphasis', 'F10', ACT.e], ['Highlight', 'F11', ACT.h], ['Clear formatting', 'F12', ACT.clear],
    ['Pocket', 'F4', ACT.pocket], ['Hat', 'F5', ACT.hat], ['Block', 'F6', ACT.block], ['Tag', 'F7', ACT.tag],
    ['Start or pause the timer', '', toggleSpeech], ['Aff prep', '', () => togglePrep('A')], ['Neg prep', '', () => togglePrep('N')],
    ['Reopen closed tab', '⌘⇧T', () => toast('Reopened AT Water Shortage')],
  ].map(([name, ds, run]) => ({ k: 'cmd', name, ds, run }));
  let recent = ['Send to speech doc', 'Highlight', 'Tag'];

  let pal = null;
  function openPalette() {
    if (pal) return;
    if (!INDEX) buildIndex();
    const saved = selRange() && selRange().cloneRange();
    const scrim = document.createElement('div');
    scrim.className = 'fx-scrim';
    const box = document.createElement('div');
    box.className = 'fx-p fx-pal';
    box.setAttribute('role', 'dialog');
    box.innerHTML = '<input placeholder="Search blocks, cards and commands" aria-label="Search" spellcheck="false"><div class="fx-list" role="listbox"></div>';
    document.body.append(scrim, box);
    requestAnimationFrame(() => { scrim.classList.add('open'); box.classList.add('open'); });
    const input = box.querySelector('input'), list = box.querySelector('.fx-list');
    let rows = [], on = 0;
    function render() {
      const toks = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const match = (x) => toks.every((t) => (x.name + ' ' + (x.file || '')).toLowerCase().includes(t));
      if (!toks.length) rows = [...recent.map((n) => COMMANDS.find((c) => c.name === n)), ...INDEX.filter((x) => x.k === 'block' && x.doc === Z.S.left).slice(0, 7)];
      else {
        const first = (x) => (x.name.toLowerCase().startsWith(toks[0]) ? 0 : 1);
        rows = [...COMMANDS.filter(match).slice(0, 4), ...INDEX.filter((x) => x.k === 'block' && match(x)).sort((a, b) => first(a) - first(b)).slice(0, 7), ...INDEX.filter((x) => x.k === 'card' && match(x)).slice(0, 5)];
      }
      list.innerHTML = rows.map((x, i) => `<div class="fx-row" role="option" data-i="${i}"><span class="nm">${esc(x.name)}</span><span class="ds">${esc(x.k === 'cmd' ? x.ds : x.file)}</span></div>`).join('')
        || '<div class="fx-empty">Nothing matches. Try a card author, like segers.</div>';
      on = 0; paint();
    }
    function paint() {
      list.querySelectorAll('.fx-row').forEach((r) => r.toggleAttribute('data-on', +r.dataset.i === on));
      const el = list.querySelector('[data-on]'); if (el) el.scrollIntoView({ block: 'nearest' });
    }
    function run(x) {
      close();
      if (!x) return;
      if (x.k !== 'cmd') return jumpTo(x);
      recent = [x.name, ...recent.filter((n) => n !== x.name)].slice(0, 3);
      if (saved) { const s = getSelection(); s.removeAllRanges(); s.addRange(saved); }
      x.run();
    }
    function close() {
      scrim.classList.remove('open'); box.classList.remove('open');
      setTimeout(() => { scrim.remove(); box.remove(); }, 200);
      pal = null;
    }
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); on = Math.min(rows.length - 1, on + 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); on = Math.max(0, on - 1); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(rows[on]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    list.addEventListener('mousemove', (e) => { const r = e.target.closest('.fx-row'); if (r && +r.dataset.i !== on) { on = +r.dataset.i; paint(); } });
    list.addEventListener('click', (e) => { const r = e.target.closest('.fx-row'); if (r) run(rows[+r.dataset.i]); });
    scrim.addEventListener('click', close);
    pal = { close };
    render();
    input.focus();
  }
  function jumpTo(x) {
    if (Z.S.left !== x.doc) Z.open(x.doc);
    setEditable(!isRound());
    requestAnimationFrame(() => {
      const el = app().querySelector(`[data-id="${x.id}"]`), a = app();
      if (el) a.scrollTo({ top: el.getBoundingClientRect().top - a.getBoundingClientRect().top + a.scrollTop - 24, behavior: 'smooth' });
    });
  }
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal ? pal.close() : openPalette(); }
  });

  // ---------- shared ----------
  const B = (a, label) => `<button data-a="${a}">${label}</button>`;
  const STYLES = B('pocket', 'Pocket') + B('hat', 'Hat') + B('block', 'Block') + B('tag', 'Tag') + B('cite', 'Cite');
  const MARKS = B('u', 'Underline') + B('e', 'Emphasis') + B('h', 'Highlight') + B('clear', 'Clear');
  const TIMER = '<button data-t="speech">8:00</button><button data-prep="A">Aff 8:00</button><button data-prep="N">Neg 8:00</button>';
  function bindActions(el, signal) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.a && ACT[b.dataset.a]) return ACT[b.dataset.a]();
      if (b.dataset.prep) return togglePrep(b.dataset.prep);
      if (b.dataset.t === 'speech') return toggleSpeech();
    }, { signal });
  }
  function make(html, cls = '') {
    const el = document.createElement('div');
    el.className = 'fx-p ' + cls;
    el.innerHTML = html;
    return el;
  }

  // ---------- 1. Bar: a quiet band at the top holding a row of pills ----------
  function bar1(bar, signal) {
    root.style.setProperty('--fx-h', '56px');
    const ps = [make(STYLES), make(MARKS), make(B('send', 'Send') + B('search', 'Search')), make(TIMER)];
    ps.forEach((p) => { p.classList.add('fx-in'); bar.appendChild(p); pill(p); bindActions(p, signal); });
  }

  // ---------- 2. Dock: no top panel at all; one pill floats over the bottom of the page ----------
  function dock(bar, signal) {
    root.style.setProperty('--fx-h', '0px');
    const p = make(STYLES + '<span class="gap"></span>' + MARKS + '<span class="gap"></span>' + B('send', 'Send') + '<span class="gap"></span><button data-t="speech">8:00</button>', 'fx-dock fx-in');
    root.appendChild(p);
    pill(p);
    bindActions(p, signal);
    signal.addEventListener('abort', () => p.remove());
  }

  // ---------- 3. Morph: one pill that shows only what the moment needs ----------
  function morph(bar, signal) {
    root.style.setProperty('--fx-h', '56px');
    const p = make(`
      <div class="set" data-s="rest"><button data-m="prep">Prep</button><button data-m="round">Round</button><span class="gap"></span>${B('search', 'Search')}<button data-t="speech">8:00</button></div>
      <div class="set" data-s="sel" hidden>${MARKS}${B('tag', 'Tag')}${B('send', 'Send')}<span class="note" data-wc></span></div>
      <div class="set" data-s="round" hidden><button data-m="prep">Prep</button><button data-m="round">Round</button><span class="gap"></span><button data-menu data-t="name">1AC</button><button data-t="speech">8:00</button><button data-prep="A">Aff 8:00</button><button data-prep="N">Neg 8:00</button><span class="gap"></span>${B('drop', 'Send to SpeechDrop')}</div>`, 'fx-morph fx-in');
    bar.appendChild(p);
    pill(p);
    bindActions(p, signal);
    const menu = make(SPEECH.map(([n, m]) => `<button data-speech="${n}"><span>${n}</span><span>${m} min</span></button>`).join(''), 'fx-menu');
    root.appendChild(menu);
    pill(menu);
    signal.addEventListener('abort', () => { menu.remove(); document.documentElement.removeAttribute('data-fx-round'); setEditable(true); });

    let cur = null;
    function show(s) {
      if (s === cur) return;
      cur = s;
      p.querySelectorAll('.set').forEach((el) => (el.hidden = el.dataset.s !== s));
      const set = p.querySelector(`.set[data-s="${s}"]`);
      set.classList.remove('fx-swap'); void set.offsetWidth; set.classList.add('fx-swap');
      p.querySelectorAll('[data-m]').forEach((b) => {
        const on = b.dataset.m === (isRound() ? 'round' : 'prep');
        b.toggleAttribute('data-rest', on);
        b.toggleAttribute('data-on', on);
      });
      p.style.width = set.offsetWidth + 8 + 'px';
      p.rest();
    }
    function setMode(m) {
      document.documentElement.toggleAttribute('data-fx-round', m === 'round');
      setEditable(m !== 'round');
      getSelection().removeAllRanges();
      cur = null;
      show(m === 'round' ? 'round' : 'rest');
    }
    p.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.m) setMode(b.dataset.m);
      if (b.hasAttribute('data-menu')) {
        const r = b.getBoundingClientRect(), o = root.getBoundingClientRect();
        menu.style.left = r.left - o.left - 4 + 'px';
        menu.style.top = r.bottom - o.top + 10 + 'px';
        menu.classList.toggle('open');
      }
    }, { signal });
    menu.addEventListener('click', (e) => { const b = e.target.closest('[data-speech]'); if (b) { pickSpeech(b.dataset.speech); menu.classList.remove('open'); } }, { signal });
    document.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target) && !e.target.closest('[data-menu]')) menu.classList.remove('open'); }, { signal });
    document.addEventListener('selectionchange', () => {
      if (isRound()) return;
      const r = selRange();
      if (r && !r.collapsed && r.toString().trim()) {
        const n = r.toString().trim().split(/\s+/).length;
        p.querySelector('[data-wc]').textContent = `${n} word${n === 1 ? '' : 's'}`;
        show('sel');
      } else show('rest');
    }, { signal });
    document.addEventListener('keydown', (e) => {
      if (!isRound() || e.code !== 'Space') return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
      e.preventDefault(); toggleSpeech();
    }, { signal });
    p.style.width = 'auto';
    show('rest');
    requestAnimationFrame(() => (p.style.width = p.querySelector('.set[data-s="rest"]').offsetWidth + 8 + 'px'));
  }

  // ---------- this round explores the sidebar; the top panel stays on Bar ----------
  const bar = document.createElement('header');
  bar.id = 'fx-bar';
  root.prepend(bar);
  window.__fx = { bar, openPalette, toast, act: (name, arg) => ACT[name] && ACT[name](arg), timer: { T, fmt, toggleSpeech, togglePrep, paintTimer } };
})();
