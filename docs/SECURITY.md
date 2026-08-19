# Security posture

What protects `taranev.com`, what it cannot protect, and what you have to
switch on by hand.

The site is static: prerendered HTML, CSS, images, and one JavaScript bundle,
served by GitHub Pages. There is no server, no database, no login, and no form
that posts anywhere — the contact page opens a `mailto:` link. That removes
most of the attack surface a marketing site normally has. What remains is
transport security and third-party content.

---

## 1. TLS / HTTPS — the part you must enable

**There is nothing to buy or install.** GitHub Pages issues a free
Let's Encrypt certificate for the custom domain automatically. It cannot do so
until DNS actually points at GitHub, which is why the site has no certificate
before the cutover in [`DNS.md`](DNS.md).

Order of operations:

1. Point DNS at GitHub (see [`DNS.md`](DNS.md)).
2. **Settings → Pages → Custom domain:** enter `taranev.com`, save. GitHub
   runs a DNS check.
3. Wait for the certificate. Usually minutes, occasionally up to 24 hours.
4. **Tick "Enforce HTTPS."** This is the switch that matters: it makes GitHub
   answer every `http://` request with a 301 to `https://`. Until it is
   ticked, the site is reachable over plaintext.

The checkbox stays greyed out until the certificate exists. Check back — it is
easy to complete step 2 and never return for step 4.

> Re-saving the custom domain can silently untick Enforce HTTPS. If you ever
> change it, verify the checkbox afterwards.

**Backstop.** `src/main.tsx` redirects `http:` → `https:` from the JavaScript
bundle before React mounts. This is a safety net for the window before Enforce
HTTPS is on, not a substitute for it — by the time it runs, the page has
already travelled over plaintext. Localhost and bare IPs are exempt so local
development still works.

### Verifying

```bash
curl -sI http://taranev.com | head -3     # expect 301 → https://taranev.com/
curl -sI https://taranev.com | head -1    # expect HTTP/2 200
```

---

## 2. Content Security Policy

Injected into every built page by `securityMeta()` in `vite.config.ts`, and
into the redirect stubs by `scripts/pages-postbuild.mjs`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: https://www.taragolfcart.com; font-src 'self' data:;
connect-src 'self'; form-action 'self'; base-uri 'self'; frame-src 'none';
object-src 'none'; upgrade-insecure-requests
```

What this buys:

- **`script-src 'self'`** — no inline scripts, no third-party scripts. If
  someone manages to inject a `<script>` into page content, the browser refuses
  to run it. The site qualifies for this strict setting because the mirrored
  content has no inline event handlers and the bundled site JS has no `eval()`.
- **`upgrade-insecure-requests`** — any `http://` subresource is fetched over
  https instead, so one missed asset cannot cost the page its padlock.
- **`object-src 'none'` / `frame-src 'none'`** — no plugins, no embedded
  frames.
- **`base-uri 'self'`** — blocks `<base>` injection, which would otherwise
  re-point every relative URL on the page.

The two deliberate relaxations:

| Relaxation | Why |
| --- | --- |
| `'unsafe-inline'` for **style** | The mirrored WordPress content carries ~1,550 inline `style=""` attributes. Removing them means rewriting 557 pages. Style injection is far less dangerous than script injection. |
| `https://www.taragolfcart.com` for **img** | Two news posts still hotlink an illustration from the original site (see §4). |

CSP is delivered as `<meta http-equiv>`, because GitHub Pages cannot send
custom response headers. That covers every directive **except**
`frame-ancestors` and `sandbox`, which are header-only — see §3.

**It is enforced only in production builds.** A strict `script-src` would block
Vite's HMR preamble and dev websocket, so `pnpm dev` runs without a policy. If
you add a third-party embed (a map, a video, an analytics tag), it will work in
dev and be blocked in the build — add its origin to `CSP` in `vite.config.ts`.

---

## 3. What a static host cannot do

These need response headers, which GitHub Pages does not let you set:

| Header | Effect of its absence |
| --- | --- |
| `Strict-Transport-Security` (HSTS) | The browser will still try `http://` on a first visit before being redirected. Enforce HTTPS closes the redirect, but not the initial plaintext request. |
| `X-Content-Type-Options: nosniff` | Browsers may MIME-sniff a response. Low impact here — everything served is static with correct extensions. |
| `frame-ancestors` / `X-Frame-Options` | The site can be embedded in someone else's iframe (clickjacking). There is nothing to click that causes an action, so impact is limited to brand misuse. |
| `Permissions-Policy` | Cannot pre-emptively deny camera/microphone/geolocation. Nothing on the site requests them. |

**If you want these,** put Cloudflare (free tier) in front of the site: it can
add all four as transform rules, and it can enable HSTS including preload.
[`DNS.md`](DNS.md) already describes the Cloudflare record setup. Do not enable
HSTS until HTTPS is confirmed working — it is hard to undo, because browsers
cache the instruction for its full `max-age`.

---

## 4. Third-party content

The site is a mirror of a WordPress site, so hotlinks to the original domain
keep turning up. They matter because a third-party host you do not control can
change what it serves at any time, and every request to it leaks the visitor's
IP and referring page.

Fixed:

- **15 pages** loaded a stylesheet from
  `https://www.taragolfcart.com/wp-content/plugins/menu-image/menu-image.css`.
  A hostile or expired host could have restyled or defaced those pages. The
  `<link>` tags were removed. (The "local copy" of that file turned out to be a
  saved nginx *404 page* being served as CSS; it was deleted along with its
  `<link>` in `index.html`.)

Outstanding — **worth fixing**:

- **2 news posts** still hotlink images from `www.taragolfcart.com`:
  `news__golf-cart-fleet-planning-for-tournaments.html` and
  `news__what-are-golf-club-vehicles.html`. Images cannot execute, so this is a
  privacy leak rather than a code-execution risk, but the pages break if that
  host goes away. Download the two files into `public/images/`, repoint the
  `src`, then drop `https://www.taragolfcart.com` from `img-src` in
  `vite.config.ts`.
- **183 `/uploads/…` references** across the news section point at a directory
  that does not exist in this repo — they were already broken before the
  migration. Most are `og:image` targets, so social previews for those posts
  are blank.

### The build guard

`scripts/pages-postbuild.mjs` fails the build on any `http://` subresource in
the output — `src`, `href`, `srcset`, `poster`, `data-src`, or CSS `url()`.
XML namespaces, JSON-LD `@context` values, and library licence comments are
identifiers rather than requests, so they are allowlisted. This is what stops a
future content import from silently reintroducing mixed content.

---

## 5. Supply chain and CI

- `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440` — a package version must
  be at least one day old before pnpm will install it. Most malicious npm
  releases are pulled within hours. **Do not remove this.**
- `pnpm install --frozen-lockfile` in CI: the build fails rather than silently
  resolving a different dependency tree than the committed lockfile.
- The dependency tree is 121 packages, down from 473 before the migration —
  the site itself needs only React, React DOM, and Vite.
- The deploy workflow's `GITHUB_TOKEN` is scoped to `contents: read`,
  `pages: write`, `id-token: write`, and `persist-credentials: false` keeps it
  out of `.git/config` where a build script could read it.

---

## 6. Reporting

`/.well-known/security.txt` (RFC 9116) and `/security.txt` both point to
`info@taranev.com`. **The `Expires` field is 2027-08-13** — an expired
`security.txt` is treated as invalid, so refresh the date before then.
