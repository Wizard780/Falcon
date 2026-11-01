// Settings popup, modeled on T3 Code's: searchable pane list on the left, filled rows on the right.
// Opens from either gear (strip foot or files panel) or Cmd/Ctrl+,. Values persist in localStorage.
(() => {
  const ic = (d) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    general: ic('<path d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6"/><circle cx="10" cy="5" r="1.5"/><circle cx="6" cy="11" r="1.5"/>'),
    look: ic('<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none"/>'),
    editor: ic('<path d="M4 2.5h5.5L12 5v8.5H4z"/><path d="M6 8h4M6 10.5h2.5"/>'),
    format: ic('<path d="M3.5 12.5 7 3.5h2l3.5 9M5 9h6"/>'),
    keys: ic('<rect x="1.8" y="4" width="12.4" height="8" rx="1.8"/><path d="M4.5 6.5h.01M7 6.5h.01M9.5 6.5h.01M12 6.5h-.5M5 9.5h6"/>'),
    timer: ic('<circle cx="8" cy="9" r="5"/><path d="M8 6.5V9l1.5 1.5M6.5 1.8h3"/>'),
    flow: ic('<rect x="2" y="2.5" width="3.5" height="11" rx="1"/><rect x="6.25" y="2.5" width="3.5" height="11" rx="1"/><rect x="10.5" y="2.5" width="3.5" height="11" rx="1"/>'),
    claude: ic('<path d="M8 2v3M8 11v3M2 8h3M11 8h3M3.8 3.8l2 2M10.2 10.2l2 2M12.2 3.8l-2 2M5.8 10.2l-2 2"/>'),
    files: ic('<path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/>'),
    sync: ic('<path d="M13 6.5A5 5 0 0 0 3.6 5M3 9.5A5 5 0 0 0 12.4 11"/><path d="M3.5 2.5V5H6M12.5 13.5V11H10"/>'),
    search: ic('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>'),
    reset: ic('<path d="M3 8a5 5 0 1 0 1.5-3.5"/><path d="M3 2.5V5h2.5"/>'),
    x: ic('<path d="m4.5 4.5 7 7m0-7-7 7"/>'),
  };
  const INKS = ['#00e5ff', '#ffe14d', '#7dff8a', '#ff7ad9', '#b49cff'];

  // t: toggle · s: select · g: segmented · w: swatches · k: keycaps · p: style preview
  const PANES = [
    { id: 'general', name: 'General', icon: 'general', secs: [
      ['Startup', [
        { k: 'launch', t: 'Open on launch', d: 'What Falcon shows when it starts.', s: ['Home', 'Last document', 'Speech document'] },
        { k: 'tabs', t: 'Restore open files', d: 'Reopen the files you had open when you quit.', tg: true },
      ]],
      ['Notifications', [
        { k: 'prepAlert', t: 'Prep time alerts', d: 'Alert at 30 seconds left and when prep runs out, for either side.', s: ['Alert with sound', 'Alert only', 'Off'] },
        { k: 'chime', t: 'Speech timer chime', d: 'A soft chime at one minute left and at time.', tg: true },
      ]],
      ['Confirmations', [
        { k: 'cfClear', t: 'Clear Recent confirmation', d: 'Ask before clearing the Recent list on Home.', tg: false },
        { k: 'cfDel', t: 'Delete card confirmation', d: 'Ask before deleting a card from a speech document.', tg: true },
      ]],
    ]},
    { id: 'appearance', name: 'Appearance', icon: 'look', secs: [
      ['Theme', [
        { k: 'theme', t: 'Interface', d: 'The chrome around your documents.', g: ['Dark', 'Light', 'System'] },
        { k: 'paper', t: 'Document paper', d: 'Read dark documents at night, white ones when you print or share a screen.', g: ['Dark', 'White'] },
        { k: 'ink', t: 'Highlighter', d: 'Your highlight color, also used for the current location in the outline.', w: INKS },
      ]],
      ['Layout', [
        { k: 'density', t: 'Density', d: 'Row height in the files panel and outline.', g: ['Compact', 'Default', 'Roomy'] },
        { k: 'uiSize', t: 'Interface text size', d: 'Doesn’t change document text.', s: ['13 px', '14 px', '15 px', '16 px'] },
      ]],
    ]},
    { id: 'editor', name: 'Editor', icon: 'editor', secs: [
      ['Outline', [
        { k: 'outline', t: 'Show outline pane', d: 'The nav pane on the document’s left edge. Also ⌘\\.', tg: true, live: 'outline' },
        { k: 'depth', t: 'Default outline depth', d: 'How many heading levels the outline opens with.', g: ['1', '2', '3', '4'] },
        { k: 'olCards', t: 'Show card tags in outline', d: 'List each card under its block.', tg: true },
      ]],
      ['Reading', [
        { k: 'readMode', t: 'Read mode', d: 'Shrink everything you won’t read aloud so highlighted text stands out.', s: ['Shrink unhighlighted', 'Hide unhighlighted', 'Off'] },
        { k: 'wpm', t: 'Reading speed', d: 'Used for the time estimate on speech documents.', s: ['250 wpm', '300 wpm', '350 wpm', '400 wpm'] },
      ]],
      ['Pasting', [
        { k: 'plain', t: 'Paste as plain text', d: 'Strip web formatting when pasting an article. ⇧⌘V pastes with formatting.', tg: true },
        { k: 'autocite', t: 'Cite from links', d: 'Paste a URL on an empty cite line and Falcon fills author, date and title.', tg: true },
        { k: 'spell', t: 'Spellcheck', d: 'Underline misspellings in tags and analytics, never in card text.', tg: true },
      ]],
    ]},
    { id: 'formatting', name: 'Formatting', icon: 'format', secs: [
      ['Styles', [
        { k: 'fPocket', t: 'Pocket', p: ['pocket', 'Moratorium Aff'], s: ['26 pt', '24 pt', '22 pt'] },
        { k: 'fHat', t: 'Hat', p: ['hat', 'DIB Advantage'], s: ['22 pt', '20 pt', '18 pt'] },
        { k: 'fBlock', t: 'Block', p: ['block', 'AT Offshoring DA'], s: ['16 pt', '14 pt', '13 pt'] },
        { k: 'fTag', t: 'Tag', p: ['tag', 'Power is the binding constraint'], s: ['13 pt', '12 pt', '11 pt'] },
        { k: 'fCite', t: 'Cite', p: ['cite', '<b>Nystuen 25</b> Senior fellow'], s: ['13 pt', '12 pt', '11 pt'] },
        { k: 'fUnd', t: 'Underline', p: ['und', 'data centers outbid factories'], s: ['11 pt', '10 pt', '9 pt'] },
        { k: 'fEmph', t: 'Emphasis', p: ['emph', 'hollow <span>DIB</span> can’t deter'], s: ['Bold and box', 'Bold only', 'Box only'] },
        { k: 'fHi', t: 'Highlight', p: ['hi', '<span>power is the constraint</span>'], s: ['Current ink', 'Yellow always'] },
        { k: 'fSmall', t: 'Unread text', p: ['small', 'the rest of the paragraph, shrunk so the card stays short'], s: ['8 pt', '6 pt', '4 pt'] },
      ]],
      ['Documents', [
        { k: 'verbatim', t: 'Match Verbatim styles', d: 'Keep style names Verbatim and CardMirror recognize, so files open cleanly for teammates.', tg: true },
      ]],
    ]},
    { id: 'keybindings', name: 'Keybindings', icon: 'keys', secs: [
      ['App', [
        { t: 'Search', k_: ['⌘', 'K'] }, { t: 'Home', k_: ['⌘', 'T'] },
        { t: 'Toggle outline', k_: ['⌘', '\\'] }, { t: 'Settings', k_: ['⌘', ','] },
      ]],
      ['Cutting', [
        { t: 'Paste as plain text', k_: ['F2'] }, { t: 'Condense paragraph', k_: ['F3'] },
        { t: 'Pocket', k_: ['F4'] }, { t: 'Hat', k_: ['F5'] }, { t: 'Block', k_: ['F6'] }, { t: 'Tag', k_: ['F7'] },
        { t: 'Cite', k_: ['F8'] }, { t: 'Underline', k_: ['F9'] }, { t: 'Emphasis', k_: ['F10'] },
        { t: 'Highlight', k_: ['F11'] }, { t: 'Clear formatting', k_: ['F12'] },
      ]],
      ['Speech', [
        { t: 'Send card to speech', k_: ['⌥', '→'] }, { t: 'Start or stop speech timer', k_: ['⌥', 'S'] },
        { t: 'Start or stop our prep', k_: ['⌥', 'P'] },
      ]],
    ]},
    { group: 'Debate' },
    { id: 'speech', name: 'Speech and timers', icon: 'timer', secs: [
      ['Format', [
        { k: 'event', t: 'Event', d: 'Sets speech names and default times.', g: ['Policy', 'LD', 'PF'] },
        { k: 'prep', t: 'Prep time', d: 'Per side, per round.', s: ['8:00', '10:00', '5:00', '4:00', '3:00'] },
        { k: 'cx', t: 'Cross-ex', s: ['3:00', '4:00'] },
      ]],
      ['Speech documents', [
        { k: 'sendTo', t: 'Send cards to', d: 'Where a sent card lands in the speech document.', s: ['End of speech', 'Under current block'] },
        { k: 'nameSpeech', t: 'Name new speech documents', d: 'Uses the tournament and round from Home.', s: ['Speech 1NC', 'Glenbrooks R4 1NC', 'Ask each time'] },
      ]],
    ]},
    { id: 'flowing', name: 'Flowing', icon: 'flow', secs: [
      ['Flow', [
        { k: 'flowLayout', t: 'Layout', d: 'One column per speech, or one sheet per argument.', g: ['Columns', 'Sheets'] },
        { k: 'autoflow', t: 'Flow our speech automatically', d: 'Tags from the speech document fill our column as you read.', tg: true },
        { k: 'flowSide', t: 'Open flow beside document', d: 'Keep the flow on screen while you read.', tg: false },
      ]],
    ]},
    { group: 'Evidence' },
    { id: 'claude', name: 'Claude', icon: 'claude', secs: [
      ['Model', [
        { k: 'model', t: 'Model', d: 'Used for cutting, tagging and search.', s: ['Claude Opus 5.5', 'Claude Sonnet 5.5', 'Claude Haiku 5.5'] },
        { k: 'cutStyle', t: 'Cutting style', d: 'How Claude marks up a card it cuts.', s: ['Underline, highlight, boxes', 'Underline and highlight'] },
      ]],
      ['While you cut', [
        { k: 'sugTag', t: 'Suggest tags', d: 'Offer a plain, readable tag when you add a cite.', tg: true },
        { k: 'sendDoc', t: 'Share the open file', d: 'Let Claude read the open document for context. Nothing is sent until you ask.', tg: true },
      ]],
    ]},
    { id: 'files', name: 'Import and export', icon: 'files', secs: [
      ['Files', [
        { k: 'saveAs', t: 'Save format', s: ['.docx', '.cmir'] },
        { k: 'watch', t: 'Watch Downloads', d: 'Offer to open new .docx files from Downloads in Falcon.', tg: true },
        { k: 'caselist', t: 'Caselist uploads', d: 'Format a copy of each speech for the caselist after the round.', tg: false },
      ]],
    ]},
    { group: 'Account' },
    { id: 'sync', name: 'Sync and devices', icon: 'sync', secs: [
      ['Sync', [
        { k: 'sync', t: 'Sync files', d: 'Keep files, flows and settings the same on every device.', tg: true },
        { k: 'team', t: 'Share new files with', s: ['Only me', 'My team', 'Ask each time'] },
      ]],
    ]},
  ];

  const LS = 'fx-settings';
  const rows = PANES.flatMap((p) => (p.secs || []).flatMap(([, rs]) => rs));
  const def = (r) => (r.tg !== undefined ? r.tg : r.w ? r.w[0] : r.s ? r.s[0] : r.g ? r.g[r.k === 'depth' ? 3 : r.k === 'density' ? 1 : 0] : null);
  const DEFAULTS = Object.fromEntries(rows.filter((r) => r.k).map((r) => [r.k, def(r)]));
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(LS)) || {}; } catch {}
  let V = { ...DEFAULTS, ...(typeof stored === 'object' ? stored : {}) };
  V.outline = localStorage.getItem('fx-outline') !== 'off';
  const save = () => localStorage.setItem(LS, JSON.stringify(V));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // settings that change the prototype right away
  const LIVE = {
    ink: (v) => document.documentElement.style.setProperty('--ink', v),
    outline: (v) => {
      if ((localStorage.getItem('fx-outline') !== 'off') === v) return;
      dispatchEvent(new KeyboardEvent('keydown', { key: '\\', metaKey: true, bubbles: true }));
    },
  };
  LIVE.ink(V.ink);

  const ctl = (r) => {
    if (r.k_) return `<span class="st-keys">${r.k_.map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span>`;
    const v = V[r.k];
    if (r.tg !== undefined) return `<button class="st-tg" role="switch" aria-checked="${!!v}" aria-label="${esc(r.t)}" data-k="${r.k}"></button>`;
    if (r.s) return `<select class="st-sel" aria-label="${esc(r.t)}" data-k="${r.k}">${r.s.map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    if (r.g) return `<div class="st-seg" role="radiogroup" aria-label="${esc(r.t)}" data-k="${r.k}"><span class="pill"></span>${r.g.map((o) => `<button role="radio" aria-checked="${o === v}" ${o === v ? 'data-on' : ''} data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
    if (r.w) return `<div class="st-sw" role="radiogroup" aria-label="${esc(r.t)}" data-k="${r.k}">${r.w.map((o) => `<button role="radio" aria-label="${o}" aria-checked="${o === v}" ${o === v ? 'data-on' : ''} data-v="${o}" style="background:${o}"></button>`).join('')}</div>`;
    return '';
  };
  const row = (r) => `<div class="st-row"><div class="tx"><div class="t">${esc(r.t)}</div>${r.d ? `<div class="d">${esc(r.d)}</div>` : ''}</div>`
    + (r.p ? `<div class="st-pv ${r.p[0]}">${r.p[1]}</div>` : '') + ctl(r) + '</div>';
  const sec = (h, rs) => `<section class="st-sec"><h3>${esc(h)}</h3><div class="st-rows">${rs.map(row).join('')}</div></section>`;

  const back = document.createElement('div');
  back.className = 'st-back';
  back.inert = true; // closed: out of the tab order and the accessibility tree
  back.innerHTML = `<div class="st" role="dialog" aria-modal="true" aria-label="Settings">
    <nav class="st-nav"><label class="st-q">${IC.search}<input type="text" placeholder="Search" aria-label="Search settings" spellcheck="false"><kbd>/</kbd></label>
      <div class="st-list"><span class="st-hl"></span>${PANES.map((p) => p.group ? `<div class="st-grp">${p.group}</div>`
        : `<button class="st-item" data-p="${p.id}"><span class="ic">${IC[p.icon]}</span>${p.name}</button>`).join('')}</div>
      <div class="st-ver">Falcon 0.1 prototype</div></nav>
    <div class="st-main"><header class="st-top"><div class="st-crumb">Settings<span>/</span><b></b></div>
      <button class="st-btn" data-reset>${IC.reset}Restore defaults</button><button class="st-btn st-x" data-close aria-label="Close settings">${IC.x}</button></header>
      <div class="st-body"></div></div></div>`;
  document.body.append(back);
  const $ = (s) => back.querySelector(s);
  const body = $('.st-body'), q = $('.st-q input'), hl = $('.st-hl'), crumb = $('.st-crumb b');
  let pane = 'general', lastFocus = null;

  function pills() {
    back.querySelectorAll('.st-seg').forEach((g) => {
      const on = g.querySelector('[data-on]'), p = g.querySelector('.pill');
      if (!on) return;
      p.style.width = on.offsetWidth + 'px'; p.style.transform = `translateX(${on.offsetLeft}px)`;
      if (!p.hasAttribute('data-ready')) { p.offsetWidth; p.setAttribute('data-ready', ''); } // first placement without the slide
    });
  }
  function moveHl() {
    const on = $('.st-item[data-on]');
    hl.style.opacity = on ? 1 : 0;
    if (on) hl.style.transform = `translateY(${on.offsetTop}px)`;
  }
  function render() {
    const query = q.value.trim().toLowerCase();
    back.querySelectorAll('.st-item').forEach((b) => b.toggleAttribute('data-on', !query && b.dataset.p === pane));
    if (query) {
      const hit = (r) => (r.t + ' ' + (r.d || '') + ' ' + (r.s || r.g || []).join(' ')).toLowerCase().includes(query);
      const found = PANES.filter((p) => p.secs).map((p) => [p.name, p.secs.flatMap(([, rs]) => rs).filter(hit)]).filter(([, rs]) => rs.length);
      crumb.textContent = 'Search';
      body.innerHTML = found.length ? found.map(([n, rs]) => sec(n, rs)).join('') : `<div class="st-none">No settings match “${esc(q.value.trim())}”</div>`;
    } else {
      const p = PANES.find((x) => x.id === pane);
      crumb.textContent = p.name;
      body.innerHTML = p.secs.map(([h, rs]) => sec(h, rs)).join('');
    }
    body.scrollTop = 0;
    moveHl(); pills();
  }
  function set(k, v) {
    V[k] = v; save();
    if (LIVE[k]) LIVE[k](v);
  }

  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.closest('[data-close]')) return close();
    const it = e.target.closest('.st-item');
    if (it) { pane = it.dataset.p; q.value = ''; return render(); }
    if (e.target.closest('[data-reset]')) {
      for (const k in DEFAULTS) set(k, DEFAULTS[k]);
      return render();
    }
    const tg = e.target.closest('.st-tg');
    if (tg) { const v = tg.getAttribute('aria-checked') !== 'true'; tg.setAttribute('aria-checked', v); return set(tg.dataset.k, v); }
    const opt = e.target.closest('.st-seg button, .st-sw button');
    if (opt) {
      const g = opt.parentElement;
      g.querySelectorAll('button').forEach((b) => { const on = b === opt; b.toggleAttribute('data-on', on); b.setAttribute('aria-checked', on); });
      set(g.dataset.k, opt.dataset.v); pills();
    }
  });
  back.addEventListener('change', (e) => { if (e.target.matches('.st-sel')) set(e.target.dataset.k, e.target.value); });
  q.addEventListener('input', render);

  function open(id) {
    if (id) pane = id;
    lastFocus = document.activeElement;
    q.value = '';
    V.outline = localStorage.getItem('fx-outline') !== 'off';
    back.inert = false;
    back.classList.add('open');
    render();
    q.focus({ preventScroll: true });
  }
  function close() {
    back.classList.remove('open');
    back.inert = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  const isOpen = () => back.classList.contains('open');

  // the gear at the foot of the icon strip. This file loads before side.js (so its key handler runs first),
  // so wait for the strip; side.js rewrites the strip, so re-add the gear whenever it goes missing
  const gear = (strip) => {
    if (strip.querySelector('.fs-set')) return;
    const b = document.createElement('button');
    b.className = 'fs-b fs-set'; b.setAttribute('aria-label', 'Settings'); b.title = 'Settings  \u2318,';
    b.innerHTML = ic('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.7M8 12.5v1.7M14.2 8h-1.7M3.5 8H1.8M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2M12.4 12.4l-1.2-1.2M4.8 4.8 3.6 3.6"/>');
    strip.append(b);
  };
  (function hook() {
    const strip = document.querySelector('.fstrip');
    if (!strip) return requestAnimationFrame(hook);
    gear(strip);
    new MutationObserver(() => gear(strip)).observe(strip, { childList: true });
  })();

  document.addEventListener('click', (e) => {
    if (!isOpen() && e.target.closest('[aria-label="Settings"]') && !back.contains(e.target)) { e.preventDefault(); open(); }
  }, true);
  addEventListener('keydown', (e) => {
    if (!e.isTrusted) return; // our own synthetic shortcuts (outline toggle) must reach side.js
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); e.stopImmediatePropagation(); return isOpen() ? close() : open(); }
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (q.value) { q.value = ''; render(); } else close(); return; }
    if (e.key === 'Tab') { // keep focus inside the popup
      const f = [...back.querySelectorAll('button, input, select')].filter((el) => el.offsetParent);
      const i = f.indexOf(document.activeElement), n = f.length;
      e.preventDefault(); e.stopImmediatePropagation();
      f[i < 0 ? 0 : (i + (e.shiftKey ? n - 1 : 1)) % n].focus();
      return;
    }
    if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); return; }
    e.stopImmediatePropagation(); // keep the editor's shortcuts from firing behind the popup
  }, true);
  addEventListener('resize', () => isOpen() && (moveHl(), pills()));

  window.__settings = { open, close };
})();
