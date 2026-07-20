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

## Editing the Selection

Items live in `index.html` inside `.selection-list`. To add one, copy an
existing `<li class="item">` block and edit the name, traits, and `data-cat`.
`data-cat` is free-form ("tech", "hygiene", ...) — a filter chip is generated
automatically for every category that appears in the list, so new categories
need no other changes. Use an `<a ... target="_blank" rel="noopener">` wrapper
for linked items (keep the &#8599; span) or a plain `<div>` wrapper for
unlinked ones.

## Deploying

1. Repo Settings → Pages → Deploy from a branch → `main` / root.
2. At the domain registrar, point `ngewqr.com` at GitHub Pages:
   - `A` records for the apex: `185.199.108.153`, `185.199.109.153`,
     `185.199.110.153`, `185.199.111.153`
   - `CNAME` record `www` → `ngewqr.github.io`
3. After DNS propagates, enable **Enforce HTTPS** in the Pages settings.
