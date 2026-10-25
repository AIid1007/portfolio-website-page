// Admin studio: prepare photos in the browser and publish them to GitHub in one commit.
// The original file never leaves this device; only the processed copies are uploaded.
(() => {
  const cfg = JSON.parse(document.getElementById('admin-data').textContent);
  const API = 'https://api.github.com';
  const KEY = 'cfr-admin-token';
  const LIST = 'content/photos.json';
  const $ = (s, el = document) => el.querySelector(s);

  const store = {
    get() { try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || ''; } catch { return ''; } },
    set(t, remember) {
      try { (remember ? localStorage : sessionStorage).setItem(KEY, t); (remember ? sessionStorage : localStorage).removeItem(KEY); } catch { /* private mode: keep in memory */ }
    },
    clear() { try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch { /* ignore */ } },
  };

  let token = '';
  let headSha = '';      // commit the list was loaded from
  let entries = [];      // working copy of photos.json (+ internal fields starting with _)
  let removed = new Set(); // published files to delete on publish
  let dirty = false;

  // ---------- GitHub ----------
  async function gh(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).message || res.statusText;
      const err = new Error(`${res.status}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  const repo = `/repos/${cfg.repo}`;

  const b64ToText = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
  const blobToB64 = (blob) => new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = () => bad(r.error);
    r.readAsDataURL(blob);
  });

  async function load() {
    const ref = await gh(`${repo}/git/ref/heads/${cfg.branch}`);
    headSha = ref.object.sha;
    const file = await gh(`${repo}/contents/${LIST}?ref=${headSha}`);
    entries = JSON.parse(b64ToText(file.content));
    removed = new Set();
    dirty = false;
    renderList();
    renderNew();
    updateBar();
  }

  // ---------- connect ----------
  const tokenForm = $('.ad-token');
  const tokenStatus = $('.status', tokenForm);
  const forget = $('[data-forget]');
  const work = $('.ad-work');
  const bar = $('.ad-publish');

  async function connect(t, remember, quiet) {
    token = t.trim();
    if (!token) return;
    tokenStatus.className = 'status';
    tokenStatus.textContent = 'connecting…';
    try {
      const r = await gh(repo);
      if (!r.permissions?.push) throw new Error('This token can read the repository but not write to it. Give it "Contents: Read and write".');
      await load();
      if (!quiet) store.set(token, remember);
      tokenStatus.className = 'status ok';
      tokenStatus.textContent = `Connected to ${cfg.repo}.`;
      tokenForm.token.value = '';
      forget.hidden = false;
      work.hidden = false;
    } catch (e) {
      token = '';
      tokenStatus.className = 'status err';
      tokenStatus.textContent = e.status === 401 ? 'GitHub did not accept that token. Check it has not expired.'
        : e.status === 404 ? `This token cannot see ${cfg.repo}. Check the repository access setting.`
          : e.message;
      work.hidden = true;
      bar.hidden = true;
    }
  }
  tokenForm.addEventListener('submit', (e) => { e.preventDefault(); connect(tokenForm.token.value, tokenForm.remember.checked); });
  forget.addEventListener('click', () => {
    if (dirty && !confirm('You have unpublished changes. Forget the token anyway?')) return;
    store.clear(); token = ''; forget.hidden = true; work.hidden = true; bar.hidden = true;
    tokenStatus.className = 'status'; tokenStatus.textContent = 'Token removed from this browser.';
  });
  addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- image processing ----------
  const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'photo';
  const toBlob = (c, type, q) => new Promise((ok) => c.toBlob(ok, type, q));

  async function decode(file) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { return createImageBitmap(file); }
  }

  // Halve repeatedly before the last step so large originals downscale without shimmering.
  function resize(src, sw, sh, w, h) {
    let cur = src, cw = sw, ch = sh;
    while (cw / 2 >= w * 1.0001 && ch / 2 >= h) {
      const c = document.createElement('canvas');
      c.width = Math.round(cw / 2); c.height = Math.round(ch / 2);
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
      x.drawImage(cur, 0, 0, c.width, c.height);
      cur = c; cw = c.width; ch = c.height;
    }
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const x = out.getContext('2d'); x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, w, h);
    return out;
  }

  function watermark(c) {
    const x = c.getContext('2d');
    const size = Math.max(16, Math.round(Math.min(c.width, c.height) * 0.034));
    const inset = Math.round(Math.min(c.width, c.height) * 0.045);
    x.font = `italic 400 ${size}px "Cormorant Garamond", Georgia, serif`;
    x.textAlign = 'right';
    x.textBaseline = 'alphabetic';
    x.fillStyle = 'rgba(0,0,0,0.28)';
    x.fillText(cfg.handle, c.width - inset + 1, c.height - inset + 1);
    x.fillStyle = 'rgba(255,255,255,0.78)';
    x.fillText(cfg.handle, c.width - inset, c.height - inset);
  }

  // Minimal EXIF (Artist + Copyright) for the JPEG copies. Canvas output carries no other metadata,
  // so GPS and camera data from the original are already gone.
  function exifSegment() {
    const ascii = (s) => s.normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
    const year = new Date().getFullYear();
    const tags = [
      [0x013b, ascii(cfg.name)],
      [0x8298, ascii(`(c) ${year} ${cfg.name} - ${cfg.handle} - All rights reserved`)],
    ].map(([id, s]) => [id, new TextEncoder().encode(s + '\0')]);
    const ifdSize = 2 + tags.length * 12 + 4;
    const dataSize = tags.reduce((a, [, b]) => a + (b.length > 4 ? b.length : 0), 0);
    const tiff = new DataView(new ArrayBuffer(8 + ifdSize + dataSize));
    const bytes = new Uint8Array(tiff.buffer);
    tiff.setUint16(0, 0x4949); tiff.setUint16(2, 42, true); tiff.setUint32(4, 8, true);
    tiff.setUint16(8, tags.length, true);
    let off = 8 + ifdSize;
    tags.forEach(([id, b], i) => {
      const p = 10 + i * 12;
      tiff.setUint16(p, id, true); tiff.setUint16(p + 2, 2, true); tiff.setUint32(p + 4, b.length, true);
      if (b.length <= 4) bytes.set(b, p + 8); else { tiff.setUint32(p + 8, off, true); bytes.set(b, off); off += b.length; }
    });
    tiff.setUint32(10 + tags.length * 12, 0, true);
    const head = new Uint8Array([0xff, 0xe1, 0, 0, 0x45, 0x78, 0x69, 0x66, 0, 0]);
    const len = 2 + 6 + bytes.length;
    head[2] = len >> 8; head[3] = len & 0xff;
    return new Uint8Array([...head, ...bytes]);
  }
  async function withExif(jpeg) {
    const buf = new Uint8Array(await jpeg.arrayBuffer());
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return jpeg;
    return new Blob([buf.slice(0, 2), exifSegment(), buf.slice(2)], { type: 'image/jpeg' });
  }

  async function prepare(file) {
    const bmp = await decode(file);
    await document.fonts?.load?.(`italic 40px "Cormorant Garamond"`).catch(() => {});
    const out = { w: bmp.width, h: bmp.height };
    for (const [kind, edge, mark] of [['tile', cfg.tileEdge, false], ['view', cfg.viewEdge, true]]) {
      const s = Math.min(1, edge / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
      const c = resize(bmp, bmp.width, bmp.height, w, h);
      if (mark) watermark(c);
      const webp = await toBlob(c, 'image/webp', 0.82);
      if (!webp || webp.type !== 'image/webp') throw new Error('This browser cannot make WebP images. Please use Chrome, Edge or Firefox.');
      out[kind] = { w, h, webp, jpg: await withExif(await toBlob(c, 'image/jpeg', 0.84)) };
    }
    bmp.close?.();
    out.preview = URL.createObjectURL(out.tile.jpg);
    return out;
  }

  // ---------- new photos ----------
  const drop = $('.ad-drop');
  const picker = $('input[type=file]', drop);
  const newWrap = $('.ad-new');
  let pending = [];

  const usedSlugs = () => new Set([...entries.filter((e) => e.type === 'photo').map((e) => e.file), ...pending.map((p) => p.file)]);
  function uniqueSlug(base) {
    const used = usedSlugs();
    let s = base, n = 2;
    while (used.has(s)) s = `${base}-${n++}`;
    return s;
  }

  async function addFiles(files) {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      const item = { file: uniqueSlug(slugify(f.name.replace(/\.[^.]+$/, ''))), title: '', theme: cfg.themes[0], alt: '', story: '', date: '', busy: true, name: f.name };
      pending.push(item);
      renderNew();
      try { item.img = await prepare(f); } catch (e) { item.error = e.message || 'Could not read this image.'; }
      item.busy = false;
      renderNew();
      updateBar();
    }
  }
  picker.addEventListener('change', () => { addFiles([...picker.files]); picker.value = ''; });
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); });

  const themeOptions = (sel) => cfg.themes.map((t) => `<option${t === sel ? ' selected' : ''}>${t}</option>`).join('');
  const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function photoFields(e) {
    return `
      <label><span class="label">Title · place, time</span><input data-k="title" value="${esc(e.title)}" placeholder="Mylapore, 6:12 am"></label>
      <label><span class="label">Theme</span><span class="select"><select data-k="theme">${themeOptions(e.theme)}</select></span></label>
      <label class="wide"><span class="label">Alt text · what is in the frame, for search and screen readers</span><textarea data-k="alt" rows="2" placeholder="A fisherman on the rocks swinging a cast net as a wave breaks">${esc(e.alt)}</textarea></label>
      <label class="wide"><span class="label">Story line · optional</span><input data-k="story" value="${esc(e.story)}" placeholder="One sentence about the moment"></label>
      <label><span class="label">Date · optional</span><input data-k="date" type="date" value="${esc(e.date)}"></label>`;
  }

  function bindFields(root, obj) {
    root.querySelectorAll('[data-k]').forEach((el) => {
      const k = el.dataset.k;
      const ev = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        obj[k] = el.type === 'checkbox' ? el.checked : el.value;
        el.removeAttribute('aria-invalid');
        dirty = true; updateBar();
      });
    });
  }

  function renderNew() {
    newWrap.innerHTML = '';
    pending.forEach((p, i) => {
      const card = document.createElement('div');
      card.className = 'ad-item';
      card.innerHTML = `
        <div class="ad-thumb">${p.busy ? '<span>preparing…</span>' : p.error ? `<span class="err">${esc(p.error)}</span>` : `<img src="${p.img.preview}" alt="">`}</div>
        <div class="ad-fields">${photoFields(p)}
          <p class="ad-meta">${esc(p.name)}${p.img ? ` · ${p.img.view.w}×${p.img.view.h} with watermark · ${p.img.tile.w}×${p.img.tile.h} tile` : ''}</p>
        </div>
        <button type="button" class="ad-x" aria-label="Remove ${esc(p.name)}">remove</button>`;
      bindFields(card, p);
      card.querySelector('.ad-x').addEventListener('click', () => { if (p.img) URL.revokeObjectURL(p.img.preview); pending.splice(i, 1); renderNew(); updateBar(); });
      newWrap.append(card);
    });
  }

  // ---------- published list ----------
  const list = $('.ad-list');
  function renderList() {
    list.innerHTML = '';
    entries.forEach((e, i) => {
      const li = document.createElement('li');
      li.className = `ad-item${e.type === 'fact' ? ' is-fact' : ''}`;
      if (e.type === 'fact') {
        li.innerHTML = `
          <div class="ad-thumb ad-fthumb"><span class="kicker">did you know</span></div>
          <div class="ad-fields">
            <label class="wide"><span class="label">Fact · one line</span><textarea data-k="text" rows="2">${esc(e.text)}</textarea></label>
            <label class="wide"><span class="label">Source link · required to publish</span><input data-k="source" type="url" value="${esc(e.source)}" placeholder="https://…"></label>
            <label class="ad-check"><input type="checkbox" data-k="draft"${e.draft ? ' checked' : ''}> draft (hidden from the site)</label>
          </div>`;
      } else {
        li.innerHTML = `
          <div class="ad-thumb"><img src="${cfg.base}/images/tile/${encodeURIComponent(e.file)}.jpg?v=${headSha.slice(0, 7)}" alt="" loading="lazy"></div>
          <div class="ad-fields">${photoFields(e)}<p class="ad-meta">${esc(e.file)}</p></div>`;
      }
      li.querySelector('.ad-thumb img')?.addEventListener('error', (ev) => {
        ev.target.replaceWith(Object.assign(document.createElement('span'), { textContent: 'not live yet' }));
      });
      const tools = document.createElement('div');
      tools.className = 'ad-tools';
      tools.innerHTML = `<button type="button" data-m="-1" aria-label="Move up"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" data-m="1" aria-label="Move down"${i === entries.length - 1 ? ' disabled' : ''}>↓</button><button type="button" class="ad-x">delete</button>`;
      li.append(tools);
      bindFields(li, e);
      tools.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
        const j = i + Number(b.dataset.m);
        [entries[i], entries[j]] = [entries[j], entries[i]];
        dirty = true; renderList(); updateBar();
      }));
      tools.querySelector('.ad-x').addEventListener('click', () => {
        const label = e.type === 'fact' ? 'this fact' : `"${e.title || e.file}"`;
        if (!confirm(`Delete ${label} from the site? Its published image files are removed too.`)) return;
        entries.splice(i, 1);
        if (e.type === 'photo' && !entries.some((o) => o.file === e.file)) removed.add(e.file);
        dirty = true; renderList(); updateBar();
      });
      list.append(li);
    });
  }
  $('[data-add-fact]').addEventListener('click', () => {
    entries.unshift({ type: 'fact', text: '', source: '', draft: true });
    dirty = true; renderList(); updateBar();
    list.querySelector('textarea')?.focus();
  });

  // ---------- validate + publish ----------
  function problems() {
    const out = [];
    const bad = (sel, idx, root) => { const el = root.children[idx]?.querySelector(sel); el?.setAttribute('aria-invalid', 'true'); };
    pending.forEach((p, i) => {
      if (p.busy) out.push(`${p.name} is still being prepared`);
      if (p.error) out.push(`${p.name}: ${p.error}`);
      if (!p.title.trim()) { out.push(`${p.name}: add a title`); bad('[data-k=title]', i, newWrap); }
      if (!p.alt.trim()) { out.push(`${p.name}: add alt text`); bad('[data-k=alt]', i, newWrap); }
    });
    entries.forEach((e, i) => {
      if (e.type === 'fact') {
        if (!e.text?.trim()) { out.push('A fact has no text'); bad('[data-k=text]', i, list); }
        if (!e.draft && !/^https?:\/\//.test(e.source || '')) { out.push('A fact needs a source link (or tick draft)'); bad('[data-k=source]', i, list); }
      } else {
        if (!e.title?.trim()) { out.push(`${e.file}: add a title`); bad('[data-k=title]', i, list); }
        if (!e.alt?.trim()) { out.push(`${e.file}: add alt text`); bad('[data-k=alt]', i, list); }
      }
    });
    return out;
  }

  const summary = $('.ad-summary');
  const publishBtn = $('[data-publish]');
  function updateBar() {
    const n = pending.length;
    const has = n || dirty || removed.size;
    bar.hidden = !token || !has;
    summary.className = 'ad-summary';
    summary.textContent = [n && `${n} new photo${n > 1 ? 's' : ''}`, (dirty || removed.size) && 'edits to the list'].filter(Boolean).join(' + ') + ' not published yet';
  }

  const clean = (e) => {
    if (e.type === 'fact') {
      const f = { type: 'fact', text: e.text.trim(), source: (e.source || '').trim() };
      if (e.sourceLabel) f.sourceLabel = e.sourceLabel;
      if (e.draft) f.draft = true;
      return f;
    }
    return { type: 'photo', file: e.file, title: e.title.trim(), theme: e.theme, alt: e.alt.trim(), story: (e.story || '').trim(), date: e.date || '' };
  };

  publishBtn.addEventListener('click', async () => {
    const errs = problems();
    if (errs.length) { summary.className = 'ad-summary err'; summary.textContent = errs.join(' · '); return; }
    publishBtn.disabled = true;
    const step = (t) => { summary.className = 'ad-summary'; summary.textContent = t; };
    try {
      step('checking for changes made elsewhere…');
      const ref = await gh(`${repo}/git/ref/heads/${cfg.branch}`);
      if (ref.object.sha !== headSha) throw new Error('The site was changed somewhere else since you opened this page. Copy any text you typed, reload, and try again.');

      const tree = [];
      let k = 0;
      const total = pending.length * 4;
      for (const p of pending) {
        for (const kind of ['tile', 'view']) for (const ext of ['webp', 'jpg']) {
          step(`uploading images ${++k}/${total}…`);
          const blob = await gh(`${repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: await blobToB64(p.img[kind][ext]), encoding: 'base64' }) });
          tree.push({ path: `images/${kind}/${p.file}.${ext}`, mode: '100644', type: 'blob', sha: blob.sha });
        }
      }
      for (const f of removed) for (const kind of ['tile', 'view']) for (const ext of ['webp', 'jpg']) {
        tree.push({ path: `images/${kind}/${f}.${ext}`, mode: '100644', type: 'blob', sha: null });
      }
      const next = [...pending.map((p) => ({ ...p, type: 'photo' })), ...entries].map(clean);
      tree.push({ path: LIST, mode: '100644', type: 'blob', content: JSON.stringify(next, null, 2) + '\n' });

      step('saving…');
      const base = await gh(`${repo}/git/commits/${headSha}`);
      const t = await gh(`${repo}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: base.tree.sha, tree }) });
      const parts = [pending.length && `add ${pending.length} photo${pending.length > 1 ? 's' : ''}`, removed.size && `remove ${removed.size}`, 'update photo list'].filter(Boolean);
      const commit = await gh(`${repo}/git/commits`, { method: 'POST', body: JSON.stringify({ message: `Studio: ${parts.join(', ')}`, tree: t.sha, parents: [headSha] }) });
      await gh(`${repo}/git/refs/heads/${cfg.branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });

      pending.forEach((p) => p.img && URL.revokeObjectURL(p.img.preview));
      pending = [];
      await load();
      bar.hidden = false;
      summary.className = 'ad-summary ok';
      summary.innerHTML = `Published. The site rebuilds in a few minutes. <a href="https://github.com/${cfg.repo}/actions" target="_blank" rel="noopener">watch progress ↗</a>`;
      publishBtn.hidden = true;
      setTimeout(() => { publishBtn.hidden = false; updateBar(); }, 12000);
    } catch (e) {
      summary.className = 'ad-summary err';
      summary.textContent = `Not published: ${e.message}`;
    } finally {
      publishBtn.disabled = false;
    }
  });

  // ---------- start ----------
  const saved = store.get();
  if (saved) { forget.hidden = false; connect(saved, true, true); }
})();
