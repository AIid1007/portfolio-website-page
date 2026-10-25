// Home: draggable photo canvas, index view and photo viewer.
(() => {
  const data = JSON.parse(document.getElementById('site-data').textContent);
  const body = document.body;
  const stage = document.querySelector('.stage');
  const world = document.querySelector('.world');
  const empty = document.querySelector('.empty');
  const phone = matchMedia('(max-width: 760px)');

  const STEPS = [0.4, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 2.5];
  const MIN = 0.35, MAX = 2.6;
  const TOP = () => (phone.matches ? 64 : 72);
  const BOTTOM = () => (phone.matches ? 120 : 84);
  const pad = (n) => String(n).padStart(2, '0');
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  let view = { x: 0, y: 0, s: 1 };
  let home = { x: 0, y: 0, s: 1 };
  let field = { W: 1, H: 1 };
  let theme = 'all';

  // ---------- build tiles ----------
  const items = [];
  for (const p of data.photos) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tile';
    el.setAttribute('aria-label', `${p.title}. ${p.alt}`);
    el.innerHTML = '<span class="frame"><canvas aria-hidden="true"></canvas></span><span class="meta"><span class="cap"></span><span class="num"></span></span>';
    el.querySelector('.frame').style.background = p.tone;
    el.querySelector('.cap').textContent = p.title;
    el.querySelector('.num').textContent = pad(p.n);
    el.addEventListener('click', (e) => { if (e.detail === 0) openViewer(p.id); }); // keyboard only; taps handled below
    world.append(el);
    items.push({ kind: 'photo', el, p, w: 0, h: 0, x: 0, y: 0 });
  }
  for (const f of data.facts) {
    const el = document.createElement('div');
    el.className = 'fact';
    el.innerHTML = '<span class="kicker">did you know</span><p></p>';
    el.querySelector('p').textContent = f.text;
    if (f.source) {
      const a = document.createElement('a');
      a.href = f.source; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = `${f.sourceLabel} ↗`;
      el.append(a);
    }
    world.append(el);
    items.push({ kind: 'fact', el, f, w: 0, h: 0, x: 0, y: 0 });
  }
  // spread facts among the photos instead of leaving them at the end
  for (const it of items.filter((i) => i.kind === 'fact')) {
    const others = world.querySelectorAll('.tile');
    if (others.length) world.insertBefore(it.el, others[Math.floor(Math.random() * others.length)]);
  }

  // ---------- sizing + non-overlapping layout ----------
  function size(it) {
    const k = phone.matches ? 0.62 : 1;
    if (it.kind === 'fact') {
      it.el.style.width = `${Math.round(240 * k + (phone.matches ? 40 : 0))}px`;
      it.w = it.el.offsetWidth; it.h = it.el.offsetHeight;
      return;
    }
    const r = it.p.w / it.p.h;
    const long = rand(200, 280) * k;
    let w, h;
    if (r >= 1) { w = long * (r > 1.6 ? 1.2 : 1); h = w / r; } else { h = long; w = h * r; }
    it.fw = Math.round(w); it.fh = Math.round(h);
    const frame = it.el.querySelector('.frame');
    frame.style.width = `${it.fw}px`; frame.style.height = `${it.fh}px`;
    it.w = it.fw; it.h = it.fh + 34; // room for the caption
  }

  function layout(list) {
    const gap = phone.matches ? 26 : 46;
    const vw = innerWidth, vh = innerHeight - TOP() - BOTTOM();
    const ratio = clamp(vw / Math.max(vh, 1), 0.55, 2.2);
    const area = list.reduce((a, it) => a + (it.w + gap) * (it.h + gap), 0);
    let W = Math.max(Math.sqrt(area * 2.1 * ratio), Math.max(...list.map((i) => i.w), 0) + gap);
    let H = W / ratio;
    const order = [...list].sort((a, b) => b.w * b.h - a.w * a.h);
    for (let round = 0; round < 40; round++) {
      const placed = [];
      let ok = true;
      for (const it of order) {
        let spot = null;
        for (let t = 0; t < 500 && !spot; t++) {
          const x = rand(0, Math.max(0, W - it.w)), y = rand(0, Math.max(0, H - it.h));
          if (placed.every((o) => x + it.w + gap <= o.x || o.x + o.w + gap <= x || y + it.h + gap <= o.y || o.y + o.h + gap <= y)) spot = { x, y };
        }
        if (!spot) { ok = false; break; }
        it.x = spot.x; it.y = spot.y;
        placed.push({ x: it.x, y: it.y, w: it.w, h: it.h });
      }
      if (ok) break;
      W *= 1.1; H *= 1.1;
    }
    field = { W, H };
  }

  function place(glide) {
    for (const it of items) {
      it.el.classList.toggle('glide', !!glide);
      it.el.style.transform = `translate(${it.x}px, ${it.y}px)`;
    }
  }

  function computeHome() {
    const vw = innerWidth, avail = innerHeight - TOP() - BOTTOM();
    const s = clamp(Math.min(1, (vw - 32) / field.W, (avail + 80) / field.H), 0.5, 1);
    home = { s, x: (vw - field.W * s) / 2, y: TOP() + (avail - field.H * s) / 2 };
  }

  function visible() { return items.filter((it) => !it.el.hidden); }

  function arrange(glide) {
    const list = visible();
    list.forEach(size);
    layout(list);
    place(glide);
    computeHome();
    setView(home, glide);
    empty.hidden = list.length > 0;
  }

  // ---------- view transform ----------
  function apply(glide) {
    world.classList.toggle('glide', !!glide);
    const vw = innerWidth, vh = innerHeight;
    // keep at least part of the field on screen
    view.x = clamp(view.x, vw * 0.5 - field.W * view.s, vw * 0.5);
    view.y = clamp(view.y, vh * 0.5 - field.H * view.s, vh * 0.5);
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
  }
  function setView(v, glide) { view = { ...v }; apply(glide); }
  function zoomAt(pt, s, glide) {
    s = clamp(s, MIN, MAX);
    const wx = (pt.x - view.x) / view.s, wy = (pt.y - view.y) / view.s;
    view = { s, x: pt.x - wx * s, y: pt.y - wy * s };
    apply(glide);
  }
  const center = () => ({ x: innerWidth / 2, y: TOP() + (innerHeight - TOP() - BOTTOM()) / 2 });
  function step(dir) {
    const s = dir > 0 ? STEPS.find((v) => v > view.s + 0.001) ?? MAX : [...STEPS].reverse().find((v) => v < view.s - 0.001) ?? MIN;
    zoomAt(center(), s, true);
  }

  // ---------- pointer: drag, pinch, tap ----------
  const pts = new Map();
  let downAt = null, moved = false, downTile = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('a')) return; // fact source links behave normally
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { downAt = { x: e.clientX, y: e.clientY }; moved = false; downTile = e.target.closest('.tile'); }
    else { moved = true; }
    world.classList.remove('glide');
  });
  stage.addEventListener('pointermove', (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const before = [...pts.values()].map((p) => ({ ...p }));
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      if (!moved && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) { moved = true; stage.classList.add('grabbing'); }
      if (moved) { view.x += e.clientX - prev.x; view.y += e.clientY - prev.y; apply(); }
    } else if (pts.size === 2) {
      const after = [...pts.values()];
      const d0 = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
      const d1 = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
      const m0 = { x: (before[0].x + before[1].x) / 2, y: (before[0].y + before[1].y) / 2 };
      const m1 = { x: (after[0].x + after[1].x) / 2, y: (after[0].y + after[1].y) / 2 };
      view.x += m1.x - m0.x; view.y += m1.y - m0.y;
      if (d0 > 0) zoomAt(m1, view.s * (d1 / d0)); else apply();
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size === 0) {
      stage.classList.remove('grabbing');
      if (!moved && downTile && e.type === 'pointerup') {
        const it = items.find((i) => i.el === downTile);
        if (it) openViewer(it.p.id);
      }
      downTile = null;
    }
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : 1;
    if (e.ctrlKey || e.metaKey) zoomAt({ x: e.clientX, y: e.clientY }, view.s * Math.exp(-e.deltaY * k * 0.01));
    else { view.x -= e.deltaX * k; view.y -= e.deltaY * k; apply(); }
  }, { passive: false });

  // Safari trackpad pinch
  let gs = 1;
  stage.addEventListener('gesturestart', (e) => { e.preventDefault(); gs = view.s; });
  stage.addEventListener('gesturechange', (e) => { e.preventDefault(); zoomAt({ x: e.clientX, y: e.clientY }, gs * e.scale); });

  stage.addEventListener('keydown', (e) => {
    const move = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] }[e.key];
    if (move) { e.preventDefault(); view.x += move[0]; view.y += move[1]; apply(true); }
    else if (e.key === '+' || e.key === '=') step(1);
    else if (e.key === '-' || e.key === '_') step(-1);
    else if (e.key === '0') setView(home, true);
  });

  document.querySelector('.bar.bottom').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'in') step(1);
    if (act === 'out') step(-1);
    if (act === 'reset') setView(home, true);
    if (act === 'shuffle') arrange(true);
  });

  // ---------- lazy drawing onto <canvas> (no plain <img> to save) ----------
  function draw(it) {
    if (it.drawn) return;
    it.drawn = true;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const c = it.el.querySelector('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      c.classList.add('on');
    };
    img.onerror = () => { if (!img.src.endsWith('.jpg')) img.src = it.p.tileJpg; };
    img.src = it.p.tile;
  }
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { const it = items.find((i) => i.el === en.target); if (it) { draw(it); io.unobserve(en.target); } }
    }, { rootMargin: '400px' })
    : null;
  for (const it of items) if (it.kind === 'photo') (io ? io.observe(it.el) : draw(it));

  // ---------- theme filter ----------
  const selects = [...document.querySelectorAll('.filter select')];
  const figures = [...document.querySelectorAll('.ix')];
  const count = document.querySelector('.count');
  function setTheme(t) {
    theme = t;
    selects.forEach((s) => { s.value = t; });
    for (const it of items) it.el.hidden = it.kind === 'fact' ? t !== 'all' : !(t === 'all' || it.p.theme === t);
    let n = 0;
    for (const f of figures) { f.hidden = !(t === 'all' || f.dataset.theme === t); if (!f.hidden) n++; }
    count.textContent = `${n} photograph${n === 1 ? '' : 's'}`;
    arrange(true);
  }
  selects.forEach((s) => s.addEventListener('change', () => setTheme(s.value)));

  // ---------- canvas / index toggle ----------
  const viewBtns = [...document.querySelectorAll('[data-view-btn]')];
  const viewLink = document.querySelector('[data-view-link]');
  function showView(v) {
    body.dataset.view = v;
    viewBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.viewBtn === v)));
    if (viewLink) viewLink.textContent = v === 'index' ? 'canvas' : 'index';
    history.replaceState(null, '', v === 'index' ? '#index' : location.pathname + location.search);
    if (v === 'index') scrollTo(0, 0); else requestAnimationFrame(() => apply());
  }
  viewBtns.forEach((b) => b.addEventListener('click', () => showView(b.dataset.viewBtn)));
  viewLink?.addEventListener('click', (e) => { e.preventDefault(); showView(body.dataset.view === 'index' ? 'canvas' : 'index'); });
  document.querySelector('.skip').addEventListener('click', (e) => { e.preventDefault(); showView('index'); document.getElementById('index-title').setAttribute('tabindex', '-1'); document.getElementById('index-title').focus(); });

  figures.forEach((f) => f.querySelector('.ix-hit').addEventListener('click', () => openViewer(f.dataset.id)));

  // ---------- viewer ----------
  const V = document.querySelector('.viewer');
  const vCanvas = V.querySelector('.v-canvas');
  const vFrame = V.querySelector('.v-frame');
  const vTitle = V.querySelector('.v-title');
  const vStory = V.querySelector('.v-story');
  const vCounts = V.querySelectorAll('.v-count');
  const vClose = V.querySelector('.v-close');
  const vMeta = V.querySelector('.v-meta');
  let list = [], idx = 0, lastFocus = null, token = 0;

  function fit(p) {
    const fw = vFrame.clientWidth, fh = vFrame.clientHeight;
    const s = Math.min(fw / p.vw, fh / p.vh, 1); // never upscale
    vCanvas.style.width = `${Math.round(p.vw * s)}px`;
    vCanvas.style.height = `${Math.round(p.vh * s)}px`;
    vMeta.style.width = `${Math.round(p.vw * s)}px`; // caption lines up with the photo
  }
  function render() {
    const p = list[idx];
    const my = ++token;
    vTitle.textContent = p.title;
    vStory.textContent = p.story;
    vCounts.forEach((c) => { c.textContent = `${pad(idx + 1)} / ${pad(list.length)}`; });
    vCanvas.setAttribute('aria-label', p.alt);
    vCanvas.width = 4; vCanvas.height = Math.max(1, Math.round(4 * p.vh / p.vw));
    const ctx = vCanvas.getContext('2d');
    ctx.fillStyle = p.tone; ctx.fillRect(0, 0, vCanvas.width, vCanvas.height);
    fit(p);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (my !== token) return;
      vCanvas.width = img.naturalWidth; vCanvas.height = img.naturalHeight;
      vCanvas.getContext('2d').drawImage(img, 0, 0);
      vCanvas.classList.remove('fade'); void vCanvas.offsetWidth; vCanvas.classList.add('fade');
    };
    img.onerror = () => { if (!img.src.endsWith('.jpg')) img.src = p.viewJpg; };
    img.src = p.view;
  }
  function openViewer(id) {
    list = data.photos.filter((p) => theme === 'all' || p.theme === theme);
    idx = Math.max(0, list.findIndex((p) => p.id === id));
    if (!list.length) return;
    lastFocus = document.activeElement;
    V.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    render();
    vClose.focus();
  }
  function closeViewer() {
    V.hidden = true;
    document.documentElement.style.overflow = '';
    lastFocus?.focus?.({ preventScroll: true });
  }
  const go = (d) => { idx = (idx + d + list.length) % list.length; render(); };

  vClose.addEventListener('click', closeViewer);
  V.querySelector('[data-v="prev"]').addEventListener('click', () => go(-1));
  V.querySelector('[data-v="next"]').addEventListener('click', () => go(1));
  V.addEventListener('click', (e) => { if (e.target.classList.contains('v-body') || e.target === vFrame) closeViewer(); });
  document.addEventListener('keydown', (e) => {
    if (V.hidden) return;
    if (e.key === 'Escape') closeViewer();
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...V.querySelectorAll('a[href], button')].filter((el) => el.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  let sx = null;
  vCanvas.addEventListener('pointerdown', (e) => { sx = { x: e.clientX, y: e.clientY }; });
  vCanvas.addEventListener('pointerup', (e) => {
    if (!sx) return;
    const dx = e.clientX - sx.x, dy = e.clientY - sx.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    sx = null;
  });

  // ---------- start ----------
  let rw = innerWidth, wasPhone = phone.matches;
  addEventListener('resize', () => {
    if (!V.hidden) fit(list[idx]);
    if (phone.matches !== wasPhone || Math.abs(innerWidth - rw) > 120) { wasPhone = phone.matches; rw = innerWidth; arrange(false); }
    else { computeHome(); apply(); }
  });
  let started = false;
  const start = () => { if (started) return; started = true; arrange(false); if (location.hash === '#index') showView('index'); };
  (document.fonts?.ready || Promise.resolve()).then(start, start); // fact cards are measured, so wait for the serif
  setTimeout(start, 1200);
})();
