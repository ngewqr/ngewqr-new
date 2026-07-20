# ngewqr.com

Personal site of Qirui — founder of ADspace, Johor Bahru.

Single static page, no frameworks, no build step. Deployed with GitHub Pages
at [ngewqr.com](https://ngewqr.com).

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The whole site |
| `style.css` | Design tokens (golden-ratio type scale, Fibonacci spacing) + all styling |
| `script.js` | Soft scroll-reveal (site works fully without it) |
| `404.html` | Not-found page, served automatically by GitHub Pages |
| `favicon.svg` | Monogram favicon |
| `apple-touch-icon.png` | iOS home-screen icon |
| `fonts/inter-var-latin.woff2` | Self-hosted Inter (variable, latin subset) |
| `CNAME` | Custom domain for GitHub Pages (`ngewqr.com`) |
| `.nojekyll` | Tells Pages to skip Jekyll processing |
| `robots.txt` | Allows all crawlers |

## Editing recommendations

Cards live in `index.html` under `THINGS I'D RECOMMEND`. To add one, copy an
existing `<a class="card">` (linked) or `<div class="card">` (unlinked) block
inside the relevant `card-grid` and edit the name, one-liner, and pills.
To use a real photo instead of the placeholder icon, swap the inline `<svg>`
in `.tile` for `<img src="img/name.jpg" alt="" loading="lazy" width="600" height="450">`.

## Deploying

1. Repo Settings → Pages → Deploy from a branch → `main` / root.
2. At the domain registrar, point `ngewqr.com` at GitHub Pages:
   - `A` records for the apex: `185.199.108.153`, `185.199.109.153`,
     `185.199.110.153`, `185.199.111.153`
   - `CNAME` record `www` → `ngewqr.github.io`
3. After DNS propagates, enable **Enforce HTTPS** in the Pages settings.
