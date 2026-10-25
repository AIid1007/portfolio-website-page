#!/usr/bin/env node
// Builds the static site into dist/ from site.config.json + content/photos.json.
// Fails loudly when the photo list breaks a rule (missing alt text, fact without source,
// oversized image, image still carrying GPS data...).
//
//   npm run build            production build (drafts hidden)
//   npm run build:drafts     include entries marked "draft": true, for local preview
//
// BASE_PATH and SITE_URL env vars override the config (GitHub Actions sets them).

import sharp from 'sharp';
import exifReader from 'exif-reader';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TILE_EDGE, VIEW_EDGE } from './prepare.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const DRAFTS = process.argv.includes('--drafts');

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const entries = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/photos.json'), 'utf8'));

const BASE = (process.env.BASE_PATH ?? config.basePath ?? '').replace(/\/+$/, '');
const SITE = (process.env.SITE_URL || config.siteUrl || 'http://localhost:4173').replace(/\/+$/, '');
const abs = (p) => SITE + p; // p already includes BASE
const url = (p) => `${BASE}${p}`;

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');

// ---------- validate content ----------
const errors = [];
const photos = [];
const facts = [];
const seen = new Set();

for (const [i, e] of entries.entries()) {
  const where = `photos.json entry #${i + 1}`;
  if (e.draft && !DRAFTS) continue;
  if (e.type === 'fact') {
    if (!e.text?.trim()) errors.push(`${where}: fact has no text`);
    if (!/^https?:\/\//.test(e.source || '') && !e.draft) errors.push(`${where}: fact needs a "source" link (http...) before it can be published`);
    facts.push({ id: `fact-${facts.length + 1}`, text: e.text, source: e.source || '', sourceLabel: e.sourceLabel || 'source' });
    continue;
  }
  if (e.type !== 'photo') { errors.push(`${where}: "type" must be "photo" or "fact"`); continue; }
  for (const k of ['file', 'title', 'theme', 'alt']) if (!e[k]?.trim()) errors.push(`${where}: missing "${k}"`);
  if (e.theme && !config.themes.includes(e.theme)) errors.push(`${where}: theme "${e.theme}" is not one of ${config.themes.join(', ')}`);
  if (seen.has(e.file)) errors.push(`${where}: "${e.file}" is listed twice`);
  seen.add(e.file);
  photos.push({ ...e, id: e.file });
}

async function inspect(rel, maxEdge) {
  const file = path.join(ROOT, 'images', rel);
  if (!fs.existsSync(file)) { errors.push(`missing images/${rel} — run: npm run prepare-photo -- <original>`); return null; }
  const m = await sharp(file).metadata();
  if (Math.max(m.width, m.height) > maxEdge) errors.push(`images/${rel} is ${m.width}×${m.height}; over the ${maxEdge}px cap. Re-run prepare-photo.`);
  if (m.exif) {
    try { if (exifReader(m.exif).GPSInfo) errors.push(`images/${rel} still has GPS location data`); } catch { /* unreadable EXIF block: ignore */ }
  }
  return m;
}

for (const p of photos) {
  const t = await inspect(`tile/${p.file}.webp`, TILE_EDGE);
  await inspect(`tile/${p.file}.jpg`, TILE_EDGE);
  const v = await inspect(`view/${p.file}.webp`, VIEW_EDGE);
  await inspect(`view/${p.file}.jpg`, VIEW_EDGE);
  if (t) {
    p.w = t.width; p.h = t.height;
    const { dominant } = await sharp(path.join(ROOT, 'images', `tile/${p.file}.jpg`)).stats();
    p.tone = `rgb(${dominant.r},${dominant.g},${dominant.b})`;
  }
  if (v) { p.vw = v.width; p.vh = v.height; }
}
// every published image must be referenced (stops stray files from shipping)
for (const dir of ['tile', 'view']) {
  for (const f of fs.readdirSync(path.join(ROOT, 'images', dir))) {
    if (!seen.has(f.replace(/\.(webp|jpg)$/, ''))) console.warn(`warning: images/${dir}/${f} is not in photos.json and will not be published`);
  }
}

if (errors.length) {
  console.error('\nBuild stopped:\n  - ' + errors.join('\n  - ') + '\n');
  process.exit(1);
}

// ---------- shared bits ----------
const themesInUse = config.themes.filter((t) => photos.some((p) => p.theme === t));
const ogPhoto = photos.find((p) => p.id === config.ogImage) || photos[0];
const img = (kind, p, ext) => url(`/images/${kind}/${p.file}.${ext}`);

const KOLAM = `<svg class="kolam" width="18" height="18" viewBox="0 0 22 22" aria-hidden="true"><g fill="currentColor">${
  [5, 11, 17].flatMap((y) => [5, 11, 17].map((x) => `<circle cx="${x}" cy="${y}" r="1.4"/>`)).join('')
}</g><path d="M11 1.5C17.5 5 17.5 17 11 20.5 4.5 17 4.5 5 11 1.5Z" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>`;

const ICON = {
  shuffle: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
  reset: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  minus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  chevron: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  close: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

const person = {
  '@type': 'Person',
  '@id': abs(url('/#person')),
  name: config.name,
  url: abs(url('/')),
  jobTitle: 'Photographer',
  sameAs: [config.instagram].filter((s) => s && !s.includes('[')),
  areaServed: config.region,
  knowsAbout: ['Street photography', 'Portrait photography', 'Product photography', 'Real estate photography'],
};

function head({ title, description, path: p, extraLd = [] }) {
  const ld = { '@context': 'https://schema.org', '@graph': [person, ...extraLd] };
  return `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${abs(url(p))}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(config.handle)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${abs(url(p))}">
${ogPhoto ? `<meta property="og:image" content="${abs(img('view', ogPhoto, 'jpg'))}">
<meta property="og:image:width" content="${ogPhoto.vw}">
<meta property="og:image:height" content="${ogPhoto.vh}">
<meta property="og:image:alt" content="${esc(ogPhoto.alt)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#ffffff">
<link rel="icon" href="${url('/assets/favicon.svg')}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Manrope:wght@400;500;600&family=Noto+Serif+Tamil:wght@400;500&display=swap">
<link rel="stylesheet" href="${url('/assets/styles.css')}">
<script>document.documentElement.className='js'</script>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
</head>`;
}

const logo = `<a class="logo" href="${url('/')}">${KOLAM}<span>${esc(config.handle)}</span></a>`;
const copyright = `© ${esc(config.name)} · <a href="${esc(config.instagram)}" rel="me noopener" target="_blank">instagram</a>`;

// ---------- home ----------
const imageLd = photos.map((p) => ({
  '@type': 'ImageObject',
  contentUrl: abs(img('view', p, 'jpg')),
  thumbnailUrl: abs(img('tile', p, 'jpg')),
  name: p.title,
  caption: p.story || p.alt,
  description: p.alt,
  creator: { '@id': person['@id'] },
  creditText: `${config.name} ${config.handle}`,
  copyrightNotice: `© ${config.name} · ${config.handle}`,
  copyrightHolder: { '@id': person['@id'] },
  acquireLicensePage: abs(url('/about/#hire')),
  ...(p.date ? { dateCreated: p.date } : {}),
}));

const indexItems = photos.map((p, i) => `
      <figure class="ix" data-id="${esc(p.id)}" data-theme="${esc(p.theme)}">
        <div class="ix-img" style="aspect-ratio:${p.w}/${p.h};background:${p.tone}">
          <picture>
            <source type="image/webp" srcset="${img('tile', p, 'webp')}">
            <img src="${img('tile', p, 'jpg')}" alt="${esc(p.alt)}" width="${p.w}" height="${p.h}" loading="lazy" decoding="async" draggable="false">
          </picture>
          <button class="ix-hit" type="button" aria-label="Open ${esc(p.title)}"></button>
        </div>
        <figcaption><span class="cap">${esc(p.title)}</span><span class="num">${pad(i + 1)}</span>${p.story ? `<span class="sr">${esc(p.story)}</span>` : ''}</figcaption>
      </figure>`).join('');

const filterSelect = (id) => `<label class="filter"><span>filter ·</span>
          <select id="${id}" aria-label="Filter by theme"><option value="all">all</option>${themesInUse.map((t) => `<option value="${esc(t)}">${esc(t.toLowerCase())}</option>`).join('')}</select>${ICON.chevron}</label>`;

const clientData = {
  base: BASE,
  photos: photos.map((p, i) => ({ id: p.id, n: i + 1, title: p.title, theme: p.theme, alt: p.alt, story: p.story || '', w: p.w, h: p.h, vw: p.vw, vh: p.vh, tone: p.tone, tile: img('tile', p, 'webp'), tileJpg: img('tile', p, 'jpg'), view: img('view', p, 'webp'), viewJpg: img('view', p, 'jpg') })),
  facts,
};

const homeTitle = `${config.name} | Street, people and product photographer, ${config.city}`;
const home = `${head({ title: homeTitle, description: config.description, path: '/', extraLd: imageLd })}
<body class="home" data-view="canvas">
<a class="skip" href="#index">Skip to the photo index</a>
<header class="bar top">
  ${logo}
  <div class="views" role="group" aria-label="View">
    <button type="button" data-view-btn="canvas" aria-pressed="true">canvas view</button>
    <button type="button" data-view-btn="index" aria-pressed="false">index view</button>
  </div>
  <nav class="nav">
    <a class="only-phone" href="#index" data-view-link>index</a>
    <a href="${url('/about/')}">about</a>
    <a class="accent-link only-wide" href="${url('/about/#hire')}">hire me</a>
  </nav>
</header>

<h1 class="sr">${esc(config.name)}: street, people and things photography from ${esc(config.city)} · ${esc(config.handle)}</h1>

<main>
  <section class="canvas-view" id="walk" aria-label="Photo canvas. Drag to explore; use the arrow keys to move and plus or minus to zoom.">
    <div class="stage" tabindex="0">
      <div class="world"></div>
    </div>
    <p class="empty" hidden>Nothing here yet in this theme.</p>
  </section>

  <section class="index-view" id="index" aria-labelledby="index-title">
    <div class="ix-head">
      <h2 id="index-title">Index <span class="count">${photos.length} photograph${photos.length === 1 ? '' : 's'}</span></h2>
      ${filterSelect('filter-index')}
    </div>
    <div class="ix-grid">${indexItems}
    </div>
    <footer class="ix-foot"><span>All images ${copyright} · ${esc(config.handle)}</span></footer>
  </section>
</main>

<footer class="bar bottom">
  <p class="copy only-wide">${copyright}</p>
  <div class="pill">
    <button type="button" class="shuffle" data-act="shuffle">${ICON.shuffle}<span>shuffle</span></button>
    ${filterSelect('filter-canvas')}
  </div>
  <div class="zoom">
    <span class="hint">drag to explore</span>
    <button type="button" class="round only-wide" data-act="reset" aria-label="Reset view">${ICON.reset}</button>
    <button type="button" class="round" data-act="out" aria-label="Zoom out">${ICON.minus}</button>
    <button type="button" class="round" data-act="in" aria-label="Zoom in">${ICON.plus}</button>
  </div>
</footer>

<div class="viewer" role="dialog" aria-modal="true" aria-label="Photo viewer" hidden>
  <header class="bar">
    <span class="v-count only-phone"></span>
    <span class="only-wide">${logo}</span>
    <button type="button" class="v-close" aria-label="Close viewer">close ${ICON.close}</button>
  </header>
  <div class="v-body">
    <div class="v-frame"><canvas class="v-canvas" role="img"></canvas></div>
    <div class="v-meta">
      <div><p class="v-title"></p><p class="v-story"></p></div>
      <div class="v-nav">
        <button type="button" data-v="prev">← prev</button>
        <span class="v-count only-wide"></span>
        <span class="v-swipe only-phone">swipe for the next moment</span>
        <button type="button" data-v="next">next →</button>
      </div>
    </div>
  </div>
</div>

<script type="application/json" id="site-data">${JSON.stringify(clientData).replace(/</g, '\\u003c')}</script>
<script src="${url('/assets/protect.js')}" defer></script>
<script src="${url('/assets/canvas.js')}" defer></script>
</body>
</html>
`;

// ---------- about ----------
const lines = config.rotatingLines?.length ? config.rotatingLines : ['a photographer.'];
const services = config.services.map((s) => `
        <li class="${s.status === 'soon' ? 'soon' : ''}"><span>${esc(s.name)}</span><small>${esc(s.status)}</small></li>`).join('');
const hasEmail = config.email && !config.email.includes('[');
const mailHref = hasEmail ? `mailto:${esc(config.email)}` : '#';
const portrait = config.portrait
  ? `<img src="${url('/images/' + esc(config.portrait))}" alt="Portrait of ${esc(config.name)}" width="260" height="330" draggable="false">`
  : '<span>[Portrait]</span>';

const aboutTitle = `About ${config.name} | Hire a photographer in ${config.city}`;
const aboutDesc = `${config.name} photographs street scenes, people, things and still life in ${config.city}. Portraits, product and real-estate shoots, pricing on request. ${config.handle}`;
const about = `${head({ title: aboutTitle, description: aboutDesc, path: '/about/', extraLd: [{ '@type': 'ProfilePage', mainEntity: { '@id': person['@id'] }, url: abs(url('/about/')) }] })}
<body class="about">
<header class="bar top">
  ${logo}
  <nav class="nav">
    <a href="${url('/')}">back to the walk</a>
    <a class="current only-wide" href="${url('/about/')}" aria-current="page">about</a>
  </nav>
</header>
<main class="about-grid">
  <section class="a-left">
    <h1 class="r-is"><span>${esc(config.heroName)} is…</span>
      <em class="rot" aria-hidden="true">${esc(lines[0])}</em>
      <span class="sr">${lines.map(esc).join(' ')}</span>
    </h1>
    <div class="a-under">
      <div class="portrait">${portrait}</div>
      <div class="tamil">
        <p class="ta" lang="ta">${esc(config.tamil.word)}</p>
        <p class="tr">${esc(config.tamil.translit)}</p>
        <p class="tl">${esc(config.tamil.line)}</p>
      </div>
    </div>
  </section>

  <section class="a-right">
    <h2 class="a-name">${esc(config.name)}</h2>
    <p class="bio">${esc(config.bio)}</p>

    <h3 class="label" id="hire">Hire me for</h3>
    <ul class="services">${services}
    </ul>

    <form class="enquiry" novalidate data-provider="${esc(config.form.provider || '')}" data-id="${esc(config.form.id || '')}" data-email="${hasEmail ? esc(config.email) : ''}">
      <h3 class="form-title">Tell me about the shoot.</h3>
      <div class="row2">
        <label><span class="label">Name</span><input name="name" autocomplete="name" placeholder="Your name" required></label>
        <label><span class="label">Email</span><input name="email" type="email" autocomplete="email" placeholder="you@example.com" required></label>
      </div>
      <label><span class="label">Shoot type</span>
        <span class="select"><select name="shoot">${config.services.map((s) => `<option>${esc(s.name)}</option>`).join('')}<option>Something else</option></select>${ICON.chevron}</span>
      </label>
      <label><span class="label">Message</span><textarea name="message" rows="3" placeholder="Date, place, and the story you want told" required></textarea></label>
      <label class="hp" aria-hidden="true">Leave this empty<input name="company" tabindex="-1" autocomplete="off"></label>
      <p class="status" role="status" aria-live="polite"></p>
      <div class="form-foot">
        <p class="links"><a href="${esc(config.instagram)}" rel="me noopener" target="_blank">instagram</a><a href="${mailHref}">${esc(config.email)}</a></p>
        <button type="submit" class="send">send enquiry</button>
      </div>
    </form>
  </section>
</main>
<footer class="a-foot">All images © ${esc(config.name)} · ${esc(config.handle)}</footer>
<script type="application/json" id="about-data">${JSON.stringify({ lines }).replace(/</g, '\\u003c')}</script>
<script src="${url('/assets/protect.js')}" defer></script>
<script src="${url('/assets/about.js')}" defer></script>
</body>
</html>
`;

// ---------- 404 ----------
const notFound = `${head({ title: `Lost the light | ${config.handle}`, description: 'This page wandered out of frame.', path: '/404.html' }).replace('<meta name="description"', '<meta name="robots" content="noindex">\n<meta name="description"')}
<body class="lost">
<header class="bar top">${logo}</header>
<main class="lost-main">
  <p class="big">This moment<br><em>wandered out of frame.</em></p>
  <p><a class="accent-link" href="${url('/')}">back to the walk</a></p>
</main>
</body>
</html>
`;

// ---------- write ----------
fs.rmSync(DIST, { recursive: true, force: true });
const write = (rel, s) => { const f = path.join(DIST, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
write('index.html', home);
write('about/index.html', about);
write('404.html', notFound);
write('robots.txt', `User-agent: *\nAllow: /\nDisallow: ${url('/g/')}\n\nSitemap: ${abs(url('/sitemap.xml'))}\n`);
const today = new Date().toISOString().slice(0, 10);
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url><loc>${abs(url('/'))}</loc><lastmod>${today}</lastmod>${photos.map((p) => `
    <image:image><image:loc>${abs(img('view', p, 'jpg'))}</image:loc></image:image>`).join('')}
  </url>
  <url><loc>${abs(url('/about/'))}</loc><lastmod>${today}</lastmod></url>
</urlset>
`);
fs.cpSync(path.join(ROOT, 'src'), path.join(DIST, 'assets'), { recursive: true });
for (const dir of ['tile', 'view']) {
  fs.mkdirSync(path.join(DIST, 'images', dir), { recursive: true });
  for (const p of photos) for (const ext of ['webp', 'jpg']) {
    fs.copyFileSync(path.join(ROOT, 'images', dir, `${p.file}.${ext}`), path.join(DIST, 'images', dir, `${p.file}.${ext}`));
  }
}
if (config.portrait) fs.copyFileSync(path.join(ROOT, 'images', config.portrait), path.join(DIST, 'images', config.portrait));
if (fs.existsSync(path.join(ROOT, 'CNAME'))) fs.copyFileSync(path.join(ROOT, 'CNAME'), path.join(DIST, 'CNAME'));
write('.nojekyll', '');

console.log(`Built ${photos.length} photos, ${facts.length} facts → dist/ (base "${BASE || '/'}", site ${SITE})${DRAFTS ? ' [drafts included]' : ''}`);
