// Falcon's own texture: the title is ruled with rows of short hairline dashes, like a line of small print.
// A beam follows the pointer across it; dashes under the beam swell into bars and take the highlighter ink,
// so passing over the word reads as highlighting it. Built for the home title, clipped to its letters.
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const PITCH = 6, HAIR = 1, FULL = 5, SIGMA = 34;
  let n = 0;
  // a small seeded random, so the "words" in each row are the same on every load
  const rnd = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  function beam(root, layer, textEl, opts = {}) {
    let svg = null, dashes = [], raf = 0, last = 0, rt = 0;
    let bx = 0, vx = 0, tx = 0, act = 0, target = 0, box = null;
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    // an element's box in the layer's own coordinates, from offsets, so 3D transforms on the layer don't matter
    function local(el) {
      let x = 0, y = 0, n = el;
      while (n && n !== layer) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
      return { left: x, top: y, width: el.offsetWidth, height: el.offsetHeight, right: x + el.offsetWidth, bottom: y + el.offsetHeight };
    }
    function build() {
      if (svg) svg.remove();
      dashes = [];
      const w = layer.clientWidth, h = layer.clientHeight;
      if (!w || !h) return;
      const er = local(textEl), cs = getComputedStyle(textEl);
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      textEl.appendChild(probe);
      const base = local(probe).top;
      probe.remove();
      svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      svg.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;display:block;overflow:hidden;pointer-events:none;color:var(--texture-ink);fill:currentColor`;
      const id = 'fx-beam-' + (++n);
      const cp = document.createElementNS(NS, 'clipPath');
      cp.id = id;
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', er.left + parseFloat(cs.paddingLeft));
      t.setAttribute('y', base);
      t.style.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      t.style.letterSpacing = cs.letterSpacing;
      t.textContent = textEl.textContent;
      cp.appendChild(t);
      svg.appendChild(cp);
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('clip-path', `url(#${id})`);
      svg.appendChild(g);
      // rows only where the letters are
      const top = er.top, bottom = er.bottom, left = er.left, right = er.right;
      const r = rnd(7);
      for (let y = top + PITCH / 2; y < bottom; y += PITCH) {
        let x = left - r() * 24;
        while (x < right) {
          const len = 6 + Math.floor(r() * 30);
          const el = document.createElementNS(NS, 'rect');
          el.setAttribute('x', x.toFixed(1));
          el.setAttribute('width', len);
          el.setAttribute('rx', 0.6);
          g.appendChild(el);
          dashes.push({ el, cx: x + len / 2, y, f: -1 });
          x += len + 3 + Math.floor(r() * 3);
        }
      }
      layer.appendChild(svg);
      paint(0);
    }
    // each dash keeps its own ink level: it inks fast when the beam reaches it and dries slowly after,
    // so a sweep leaves a short fading trail, like a real highlighter pass
    const ATTACK = 26, RELEASE = 5;
    let by = 0, sweep = null;
    function paint(dt) {
      let busy = false;
      const speed = Math.min(1.6, Math.abs(vx) / 700), dir = Math.sign(vx);
      for (const d of dashes) {
        const dx = d.cx - bx;
        // the beam stretches out behind the direction it moves and stays tight in front
        const trailing = dir !== 0 && Math.sign(dx) === -dir;
        const sg = SIGMA * (trailing ? 1 + speed : 1 - 0.25 * speed);
        const dy = d.y - by;
        const gy = 0.55 + 0.45 * Math.exp(-(dy * dy) / (2 * 46 * 46));
        const goal = Math.exp(-(dx * dx) / (2 * sg * sg)) * gy * act;
        const prev = d.f < 0 ? 0 : d.f;
        const rate = goal > prev ? ATTACK : RELEASE;
        let f = dt === 0 ? goal : prev + (goal - prev) * (1 - Math.exp(-rate * dt));
        if (Math.abs(goal - f) < 0.004) f = goal; else busy = true;
        const drawn = d.drawn ?? -1;
        d.f = f;
        if (drawn >= 0 && Math.abs(f - drawn) < 0.003 && !(f === 0 && drawn !== 0)) continue;
        d.drawn = f;
        const hgt = HAIR + (FULL - HAIR) * f;
        d.el.setAttribute('y', (d.y - hgt / 2).toFixed(2));
        d.el.setAttribute('height', hgt.toFixed(2));
        d.el.style.fill = f < 0.02 ? '' : `color-mix(in srgb, var(--texture-hot) ${Math.round(Math.min(1, f * 1.5) * 100)}%, var(--texture-ink))`;
      }
      return busy;
    }
    // the beam trails the pointer on a critically damped spring and fades in and out with hover
    function tick(now) {
      const dt = Math.min(last ? (now - last) / 1000 : 1 / 60, 1 / 30);
      last = now;
      if (sweep) {
        // one pass across the word when home opens
        const t = Math.max(0, Math.min(1, (now - sweep.t0) / sweep.dur)), e = 1 - Math.pow(1 - t, 3);
        tx = sweep.x0 + (sweep.x1 - sweep.x0) * e; by = sweep.y;
        target = t < 0.82 ? 1 : 0;
        if (t >= 1) sweep = null;
      }
      if (reduced()) { bx = tx; act = target; vx = 0; }
      else {
        const k = 260, c = 2 * Math.sqrt(k);
        vx += (k * (tx - bx) - c * vx) * dt;
        bx += vx * dt;
        act += (target - act) * (1 - Math.exp(-(target > act ? 14 : 8) * dt));
      }
      const busy = paint(reduced() ? 0 : dt);
      if (sweep || busy || Math.abs(tx - bx) > 0.3 || Math.abs(vx) > 1 || Math.abs(target - act) > 0.005) raf = requestAnimationFrame(tick);
      else { raf = 0; last = 0; }
    }
    const wake = () => { if (!raf) raf = requestAnimationFrame(tick); };
    const onMove = (e) => {
      // measure the unrotated frame on every move: the layer itself may be mid-turn in 3D
      box = (opts.frame || layer).getBoundingClientRect();
      const lr = local(textEl), er = { left: box.left + lr.left, right: box.left + lr.right, top: box.top + lr.top, bottom: box.top + lr.bottom };
      const over = e.clientY > er.top - 24 && e.clientY < er.bottom + 24 && e.clientX > er.left - 48 && e.clientX < er.right + 48;
      const x = e.clientX - box.left;
      if (over) sweep = null;
      if (over && act < 0.02) { bx = x; vx = 0; }
      tx = x;
      by = e.clientY - box.top;
      if (!sweep) target = over ? 1 : 0;
      wake();
    };
    const onLeave = () => { if (!sweep) { target = 0; wake(); } };
    function intro() {
      if (reduced() || !dashes.length) return;
      const er = local(textEl);
      const x0 = er.left - 40, x1 = er.right + 40;
      bx = tx = x0; vx = 0;
      sweep = { t0: performance.now() + 220, dur: 1100, x0, x1, y: er.top + er.height * 0.55 };
      wake();
    }
    const onResize = () => { box = null; clearTimeout(rt); rt = setTimeout(build, 120); };
    const onScroll = () => { box = null; };
    const forget = () => { box = null; };
    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave);
    addEventListener('resize', onResize);
    root.addEventListener('scroll', onScroll, { passive: true, capture: true });
    build();
    if (opts.intro !== false) intro();
    const stop = () => {
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
      removeEventListener('resize', onResize);
      root.removeEventListener('scroll', onScroll, { capture: true });
      cancelAnimationFrame(raf);
      if (svg) svg.remove();
    };
    stop.forget = forget;
    return stop;
  }
  window.FX_BEAM = beam;
})();
