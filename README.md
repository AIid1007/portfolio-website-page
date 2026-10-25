# #colorsoframki — photography portfolio

A two-page static site (Home canvas + About) built from one photo list, published by GitHub Actions to GitHub Pages.

```
site.config.json      name, Instagram, email, city, bio, rotating lines, services, form  ← edit me
content/photos.json   the photo + fact list, in display order                             ← edit me
images/tile|view/     protected copies made by the prepare script (never originals)
src/                  styles + scripts (canvas, viewer, about, protection)
scripts/              build.mjs, prepare.mjs, serve.mjs
```

## Add a photo (about 5 minutes)

1. Keep the original on your own drive. **Never commit originals.**
2. Run the prepare script on it (needs Node 20+ and `npm install` once):
   ```
   npm run prepare-photo -- ~/Pictures/marina-dawn.jpg
   ```
   It writes `images/tile/marina-dawn.{webp,jpg}` (600 px) and `images/view/marina-dawn.{webp,jpg}`
   (1600 px, `#colorsoframki` watermark baked in), strips GPS/camera data, and writes your copyright into the file.
   A whole folder works too: `npm run prepare-photo -- ~/Pictures/to-publish/`
3. Add one entry to `content/photos.json`:
   ```json
   { "type": "photo", "file": "marina-dawn", "title": "Marina, 6:12 am", "theme": "Street",
     "alt": "What is in the frame, and where", "story": "Optional one-line story", "date": "2026-10-20" }
   ```
   `theme` must be one of the `themes` in `site.config.json`. A filter chip appears only once a theme has a photo.
4. Commit and push (GitHub website or GitHub Desktop). The site rebuilds itself in a few minutes.

To replace a placeholder, prepare your real photo with the same name, e.g.
`npm run prepare-photo -- ~/Pictures/IMG_2041.jpg --name sunset-watch`.

## Add a "did you know" fact

```json
{ "type": "fact", "text": "One surprising line.", "source": "https://link-to-where-you-read-it" }
```
The build refuses to publish a fact without an `http(s)` source. Use `"draft": true` to keep one unpublished
(shown only in `npm run preview`).

## Preview locally

```
npm install
npm run preview      # http://localhost:4173 (drafts included)
```

## The build checks

`npm run build` stops if a photo is missing alt text, title or theme, if a fact has no source,
if a published image is bigger than the size cap, or if an image still carries GPS data.

## Contact form

Set `form` in `site.config.json`:
- `"provider": null`: the button opens the visitor's email app, addressed to `email`.
- `"provider": "formspree", "id": "<form id after /f/>"`
- `"provider": "web3forms", "id": "<access key>"`

Check each service's current free-tier limits before choosing.

## Hosting

GitHub Pages, deployed by `.github/workflows/deploy.yml` on every push to `main`.
One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Custom domain: add a `CNAME` file containing the domain (e.g. `colorsoframki.com`) at the repo root, set the
domain in Settings → Pages, and point DNS as GitHub's docs describe. Paths adapt automatically.

Moving host later (Cloudflare Pages, Netlify…): build command `npm run build`, output folder `dist`,
and set `SITE_URL` (e.g. `https://colorsoframki.com`) as an environment variable.

## Image protection (what it does and doesn't do)

Published files are capped in size, watermarked (viewer size) and stripped of location data. Photos on the
canvas and in the viewer are drawn on `<canvas>`, and right-click, drag and iOS long-press saving are blocked.
That only stops casual saving: screenshots and developer tools still work, which is why the size cap and the
watermark matter most.
