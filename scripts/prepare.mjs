#!/usr/bin/env node
// Turns an original photo into the two protected copies the site publishes.
//
//   npm run prepare-photo -- path/to/original.jpg [--name slug]
//   npm run prepare-photo -- path/to/folder/          (every jpg/png/tif/webp/heic inside)
//
// For each original it writes, into images/:
//   tile/<slug>.webp|.jpg   ~600 px long edge, no watermark (canvas + index)
//   view/<slug>.webp|.jpg   ~1600 px long edge, #colorsoframki watermark baked in (viewer)
// All camera metadata (including GPS location) is dropped; only copyright + artist are written.
// Originals are never copied into the repository.

import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));

export const TILE_EDGE = 600;
export const VIEW_EDGE = 1600;
const EXTS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.heic', '.avif']);

const slugify = (s) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'photo';

function watermarkSvg(w, h) {
  const size = Math.max(16, Math.round(Math.min(w, h) * 0.034));
  const inset = Math.round(Math.min(w, h) * 0.045);
  const text = config.handle || '#colorsoframki';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <style>.wm{font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-style:italic;font-size:${size}px}</style>
  <text x="${w - inset + 1}" y="${h - inset + 1}" text-anchor="end" class="wm" fill="#000" fill-opacity="0.28">${text}</text>
  <text x="${w - inset}" y="${h - inset}" text-anchor="end" class="wm" fill="#fff" fill-opacity="0.78">${text}</text>
</svg>`);
}

function exifFor() {
  const year = new Date().getFullYear();
  const who = config.name || '';
  return {
    IFD0: {
      Artist: who,
      Copyright: `(c) ${year} ${who} - ${config.handle || ''} - All rights reserved`,
    },
  };
}

export async function prepare(input, slug, outDir = path.join(ROOT, 'images')) {
  const base = sharp(input, { failOn: 'none' }).rotate(); // apply camera orientation, then forget it
  const meta = await base.metadata();
  if (!meta.width) throw new Error(`Not an image: ${input}`);

  const outputs = [];
  for (const [kind, edge, mark] of [['tile', TILE_EDGE, false], ['view', VIEW_EDGE, true]]) {
    fs.mkdirSync(path.join(outDir, kind), { recursive: true });
    let img = base.clone().resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true });
    const { data, info } = await img.toBuffer({ resolveWithObject: true });
    let pipe = sharp(data);
    if (mark) pipe = pipe.composite([{ input: watermarkSvg(info.width, info.height), top: 0, left: 0 }]);
    // sharp drops all input metadata unless asked to keep it; withExif writes only these tags.
    const flat = await pipe.toColourspace('srgb').toBuffer();
    for (const [ext, enc] of [['webp', (p) => p.webp({ quality: 82 })], ['jpg', (p) => p.jpeg({ quality: 84, mozjpeg: true })]]) {
      const file = path.join(outDir, kind, `${slug}.${ext}`);
      await enc(sharp(flat).withExif(exifFor())).toFile(file);
      outputs.push(path.relative(ROOT, file));
    }
  }
  return outputs;
}

async function main() {
  const args = process.argv.slice(2);
  const nameIdx = args.indexOf('--name');
  const forced = nameIdx >= 0 ? args.splice(nameIdx, 2)[1] : null;
  if (!args.length) {
    console.log('Usage: npm run prepare-photo -- <original or folder> [--name slug]');
    process.exit(1);
  }
  const files = args.flatMap((a) =>
    fs.statSync(a).isDirectory()
      ? fs.readdirSync(a).filter((f) => EXTS.has(path.extname(f).toLowerCase())).map((f) => path.join(a, f))
      : [a]);
  if (forced && files.length > 1) throw new Error('--name only works with a single file');

  for (const file of files) {
    if (path.resolve(file).startsWith(path.join(ROOT, 'images'))) throw new Error('Pass the original, not a published copy');
    const slug = slugify(forced || path.basename(file, path.extname(file)));
    const out = await prepare(file, slug);
    console.log(`\n✓ ${file}\n  ${out.join('\n  ')}`);
    console.log(`  Add to content/photos.json:\n  { "type": "photo", "file": "${slug}", "title": "", "theme": "Street", "alt": "", "story": "", "date": "" }`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
