# TARA Neighborhood Electric Vehicles

Marketing site for TARA electric golf carts, NEVs, and utility vehicles —
557 pages (home, T1/T2/T3 vehicle series, ~25 product pages, accessories,
support/warranty/safety, cases, about, contact, and a large news/blog section).

**Hosting:** static site published to **GitHub Pages** from
`.github/workflows/deploy-pages.yml`. Every push to `main` rebuilds and
redeploys. There is no server and no backend.

---

## Quick start

```bash
pnpm install
pnpm dev        # local dev server on http://localhost:5173
pnpm build      # full production build → artifacts/tara-ev/dist/public
pnpm preview    # serve the production build locally
pnpm typecheck
```

Requires Node 22+ and pnpm 10+.

---

## Publishing to GitHub Pages

One-time setup in the GitHub repo:

1. **Settings → Pages → Build and deployment → Source:** choose
   **GitHub Actions**. (Not "Deploy from a branch" — this repo builds via a
   workflow.)
2. **Settings → Pages → Custom domain:** enter `taranev.com` and save.
3. Once DNS has propagated and the certificate is issued, tick
   **Enforce HTTPS** on the same page. **This is the step that secures the
   site** — until it is ticked, `http://` is served in plaintext rather than
   redirected. See [`docs/SECURITY.md`](docs/SECURITY.md).

After that, every push to `main` publishes automatically. You can also
re-publish without a commit from **Actions → Deploy to GitHub Pages → Run
workflow**.

### DNS records

See [`docs/DNS.md`](docs/DNS.md) for the exact records to create at your
registrar.

### Security

See [`docs/SECURITY.md`](docs/SECURITY.md) for the HTTPS setup, the Content
Security Policy, what a static host cannot enforce, and the remaining
third-party hotlinks worth cleaning up.

### Publishing without a custom domain

To publish at `https://<org>.github.io/TARA-NEV/` instead, build with the repo
name as the base path and no CNAME:

```bash
BASE_PATH=/TARA-NEV/ PAGES_CUSTOM_DOMAIN= SITE_ORIGIN=https://tigon-golf-carts-llc.github.io/TARA-NEV pnpm build
```

(Add those as `env:` on the workflow's build step to make it permanent.)

---

## How the site is built

The site is a **static content mirror** of the original WordPress site, not a
hand-built component tree — that approach keeps 557 pages pixel-identical
without reimplementing each template.

- Page content lives in `artifacts/tara-ev/public/content/*.html`, one file per
  page (slugs use `__` for `/`). **To edit page text, edit the corresponding
  HTML file.**
- `public/content/routes.json` maps each URL path → content file, title,
  description, body class. It is the single source of truth for routing
  **and** for redirects.
- `src/App.tsx` fetches the content file for `location.pathname`, injects it,
  then loads the original behaviour script `public/js/jquery.min_index.js`
  (menus, sliders, tabs). It also appends the site-wide footer, the 0%
  financing CTA, and the Call Now button.
- `scripts/prerender.mjs` runs after `vite build` and writes a complete static
  HTML file per route (correct `<title>`, description, canonical, OG/Twitter
  tags, plus the page content embedded in `#root`). This is what crawlers and
  first-paint see; React then takes over.
- Original site CSS is `public/css/site.css`;
  images are in `public/images/`, fonts in `public/fonts/`. All assets are
  localized — nothing loads from `cdn.globalso.com`.

Navigation uses normal full-page loads, matching the original site.

### `scripts/pages-postbuild.mjs`

GitHub Pages serves static files only, so everything the old Replit Express
server did at request time is now baked in at build time:

| Concern | How it's handled |
| --- | --- |
| Custom domain | Writes `CNAME` into the build output |
| Jekyll | Writes `.nojekyll` so `_`-prefixed paths survive |
| 301 redirects | Writes a real HTML redirect page (canonical + meta refresh) for each `{"redirect": "..."}` entry in `routes.json` |
| Unknown URLs | Copies the app shell to `404.html` (marked `noindex`) so the SPA can resolve the path client-side |
| Percent-encoded slugs | Also writes each such page at its percent-decoded path, since Pages decodes the URL before looking for a file |
| Size limit | Prunes images no page references, then hard-fails if the output exceeds Pages' 1 GB cap |
| Mixed content | Hard-fails the build on any `http://` subresource, which would cost the page its HTTPS padlock |

**About the image prune:** the source tree carries ~870 MB of unreferenced
image originals — mostly multi-megabyte PNGs whose `.webp` versions are what
pages actually load. They stay in the repo but are dropped from the published
output, taking it from ~1.3 GB (over the Pages limit, so it would be rejected)
to ~410 MB. The prune keeps any file whose name appears in any built HTML,
CSS, JS, JSON, XML, or TXT — including the sitemaps.

---

## Content rules

### Client-requested removals (do NOT restore)

The client asked for these to be deleted site-wide. A past merge accidentally
restored them once — never bring them back when regenerating page content:

- **Mautic inquiry form** — any `mauticform` markup, the external form script
  from `formcs.globalso.com`, vendored `public/js/form-generate.js` /
  `public/js/mautic-form.js`, and `<section class="inquiry-form-wrap">`
- **Floating contact sidebar** — `<ul class="right_nav">` and the inquiry popup
  `<div class="inquiry-pop-bd">`
- **WhatsApp widget** — `#whatsapp` / `#whatsappMain`
- **Original footer** — `<footer class="web-footer">` (replaced by the
  `#tara-footer` block in `App.tsx`)

`artifacts/tara-ev/scripts/verify-removals.sh` runs as part of `pnpm build`
and fails the build if any of these reappear.

### Contact

The contact page uses a plain `mailto:` link and the dealership phone line
(844-844-3432). There is no form backend — GitHub Pages cannot run one. If a
submit-to-inbox form is wanted later, it needs a third-party form endpoint
(Formspree, Basin, Netlify Forms) or a serverless function elsewhere.

### Gotchas

- Do not rewrite `public/content/*.html` image URLs back to
  `cdn.globalso.com` — all assets are localized on purpose.
- Analytics/tracking scripts (GTM, LinkedIn) from the original pages were
  stripped and should stay out.
- This is a clone/migration of the client's own site — keep content identical
  to the original unless asked.
- The Content Security Policy is applied to **builds only**, not `pnpm dev`.
  A third-party embed (map, video, analytics tag) will work in dev and be
  blocked in the build until you add its origin to `CSP` in `vite.config.ts`.

---

## Repository layout

```
.github/workflows/deploy-pages.yml   Build + publish to GitHub Pages
docs/DNS.md                          DNS records for the custom domain
docs/SECURITY.md                     HTTPS setup, CSP, and known exposures
artifacts/tara-ev/                   The site
  index.html                         App shell (base <head>, meta defaults)
  vite.config.ts                     Build config, redirects, CSP, prerender hook
  src/App.tsx                        Content loader + site-wide footer/CTA
  src/structuredData.ts              Per-route JSON-LD
  public/content/                    Page HTML + routes.json
  public/{css,js,images,fonts}/      Localized original assets
  public/{robots.txt,sitemap*.xml}   SEO files
  scripts/prerender.mjs              Static HTML per route
  scripts/pages-postbuild.mjs        GitHub Pages packaging + security guards
  scripts/verify-removals.sh         Guard for client-requested removals
TARA Golf Cart Models/               Source photography (not published)
attached_assets/                     Working assets (not published)
screenshots/                         Reference screenshots (not published)
```

Only `artifacts/tara-ev/dist/public` is published; the top-level asset folders
are kept for reference and never reach the site.
