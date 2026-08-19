#!/usr/bin/env node
/**
 * pages-postbuild.mjs — turn the Vite build output into a GitHub Pages site.
 *
 * GitHub Pages serves static files only: there is no Node process, so
 * everything the site's old Express host did at request time has to be baked
 * into files at build time instead. This script does that:
 *
 *   1. CNAME       — tells Pages which custom domain serves this site.
 *   2. .nojekyll   — stops Pages running Jekyll, which would otherwise drop
 *                    every file and directory whose name starts with `_`.
 *   3. redirects   — the old server's 301s become real HTML pages that
 *                    redirect (canonical link + meta refresh + JS), because
 *                    Pages cannot issue an HTTP 301.
 *   4. 404.html    — SPA fallback for URLs Pages has no file for, so the
 *                    React app can resolve them client-side.
 *   5. image prune — drops images no page references. The source tree carries
 *                    ~870 MB of unreferenced originals (mostly multi-megabyte
 *                    PNGs whose .webp versions are what pages actually load),
 *                    and a published Pages site may not exceed 1 GB.
 *
 * Run automatically as part of `pnpm build`. Safe to re-run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(__dirname, '..');
const outDir = path.join(artifactDir, 'dist', 'public');
const contentDir = path.join(artifactDir, 'public', 'content');

/** Custom domain for the published site. Empty string = github.io URL only. */
const CUSTOM_DOMAIN = process.env.PAGES_CUSTOM_DOMAIN ?? 'taranev.com';
const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'https://taranev.com';
/** Matches vite.config.ts — "/" for a custom domain, "/<repo>/" for a project page. */
const BASE_PATH = process.env.BASE_PATH ?? '/';

/** A published GitHub Pages site may be no larger than 1 GB. */
const PAGES_SIZE_LIMIT_BYTES = 1024 * 1024 * 1024;

if (!fs.existsSync(outDir)) {
  console.error(
    `[pages] ERROR: build output not found at "${outDir}". Run \`vite build\` first.`,
  );
  process.exit(1);
}

const withBase = (p) => `${BASE_PATH.replace(/\/$/, '')}${p}`;

// ─── 1 + 2. CNAME and .nojekyll ───────────────────────────────────────────────

if (CUSTOM_DOMAIN) {
  fs.writeFileSync(path.join(outDir, 'CNAME'), `${CUSTOM_DOMAIN}\n`, 'utf8');
  console.log(`[pages] CNAME → ${CUSTOM_DOMAIN}`);
} else {
  console.log('[pages] No custom domain configured; skipping CNAME.');
}

fs.writeFileSync(path.join(outDir, '.nojekyll'), '', 'utf8');

// ─── 3. Static redirect pages ─────────────────────────────────────────────────

const routes = JSON.parse(
  fs.readFileSync(path.join(contentDir, 'routes.json'), 'utf8'),
);

function redirectHtml(target) {
  const url = withBase(target);
  const absolute = `${SITE_ORIGIN}${target}`;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Redirecting…</title>
    <link rel="canonical" href="${absolute}" />
    <meta name="robots" content="noindex, follow" />
    <meta http-equiv="refresh" content="0; url=${url}" />
    <script>window.location.replace(${JSON.stringify(url)});</script>
  </head>
  <body>
    <p>This page has moved to <a href="${url}">${absolute}</a>.</p>
  </body>
</html>
`;
}

let redirectCount = 0;
for (const [from, entry] of Object.entries(routes)) {
  if (!entry.redirect) continue;
  const slug = from.replace(/^\/|\/$/g, '');
  const file = path.join(outDir, slug, 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, redirectHtml(entry.redirect), 'utf8');
  redirectCount++;
}
console.log(`[pages] Wrote ${redirectCount} redirect page(s).`);

// ─── 3b. Percent-decoded aliases for percent-encoded routes ───────────────────
//
// A few route keys contain percent-encoded characters (e.g. zero-width spaces
// in a news slug). The prerenderer writes those to a directory whose name has
// the literal "%E2%80%8B" text in it, which a browser request never matches —
// Pages decodes the URL before looking for a file. Copy each such page to its
// decoded path as well so the prerendered HTML is actually served (rather than
// falling through to the SPA shell, which costs the page its crawlable HTML).

let decodedAliases = 0;
for (const routePath of Object.keys(routes)) {
  if (!/%[0-9A-Fa-f]{2}/.test(routePath)) continue;
  let decoded;
  try {
    decoded = decodeURIComponent(routePath);
  } catch {
    continue;
  }
  if (decoded === routePath) continue;

  const encodedFile = path.join(
    outDir,
    routePath.replace(/^\/|\/$/g, ''),
    'index.html',
  );
  if (!fs.existsSync(encodedFile)) continue;

  const decodedFile = path.join(
    outDir,
    decoded.replace(/^\/|\/$/g, ''),
    'index.html',
  );
  fs.mkdirSync(path.dirname(decodedFile), { recursive: true });
  fs.copyFileSync(encodedFile, decodedFile);
  decodedAliases++;
}
if (decodedAliases) {
  console.log(`[pages] Wrote ${decodedAliases} percent-decoded alias page(s).`);
}

// ─── 4. SPA fallback ──────────────────────────────────────────────────────────
//
// Pages serves 404.html for any path it has no file for. Serving the app shell
// there lets App.tsx resolve the URL against routes.json — which is what makes
// percent-encoding variants and any not-yet-prerendered path still work.

// prerender.mjs stashes the untouched shell (empty #root, correct hashed
// asset tags) before it overwrites index.html with the home page.
const shellPath = path.join(outDir, '_shell.html');
if (!fs.existsSync(shellPath)) {
  console.error(
    `[pages] ERROR: shell not found at "${shellPath}". prerender.mjs must run first.`,
  );
  process.exit(1);
}

let notFound = fs.readFileSync(shellPath, 'utf8');
notFound = notFound
  .replace(/<title>[^<]*<\/title>/, '<title>Page not found — TARA NEV</title>')
  .replace(
    /<meta\s+name="robots"[^>]*\/?>/i,
    '<meta name="robots" content="noindex, follow" />',
  )
  // No canonical: this file is served for any unknown URL, so pointing it at
  // one page would tell crawlers every 404 is that page.
  .replace(/<link\s+rel="canonical"[^>]*\/?>/i, '')
  .replace(
    '<div id="root"></div>',
    '<div id="root"><p style="padding:80px 20px;text-align:center">' +
      'Loading…</p></div>',
  );
fs.writeFileSync(path.join(outDir, '404.html'), notFound, 'utf8');
fs.unlinkSync(shellPath);
console.log('[pages] 404.html → SPA fallback shell (noindex).');

// ─── 5. Prune unreferenced images ─────────────────────────────────────────────

function collectText(dir, exts, skip = []) {
  let out = '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skip.some((s) => p.endsWith(s))) continue;
      out += collectText(p, exts, skip);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out += '\n' + fs.readFileSync(p, 'utf8');
    }
  }
  return out;
}

function walkFiles(dir, base = '') {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walkFiles(p, rel));
    else files.push([rel, p, fs.statSync(p).size]);
  }
  return files;
}

const imagesDir = path.join(outDir, 'images');
if (fs.existsSync(imagesDir)) {
  // Every text file in the build output plus the generated JS bundles — an
  // image is kept if its filename appears anywhere in any of them.
  const haystackRaw = collectText(
    outDir,
    ['.html', '.css', '.js', '.json', '.xml', '.txt'],
    ['/images', '/fonts'],
  );
  let haystackDecoded = haystackRaw;
  try {
    haystackDecoded = decodeURIComponent(
      haystackRaw.replace(/%(?![0-9A-Fa-f]{2})/g, '%25'),
    );
  } catch {
    /* leave as-is if the blob has malformed escapes */
  }
  const haystack = `${haystackRaw}\n${haystackDecoded}`;

  let keptBytes = 0;
  let prunedBytes = 0;
  let prunedCount = 0;

  for (const [, abs, size] of walkFiles(imagesDir)) {
    if (haystack.includes(path.basename(abs))) {
      keptBytes += size;
    } else {
      fs.unlinkSync(abs);
      prunedBytes += size;
      prunedCount++;
    }
  }

  // Drop directories left empty by the prune.
  const pruneEmptyDirs = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) pruneEmptyDirs(path.join(dir, entry.name));
    }
    if (dir !== imagesDir && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  };
  pruneEmptyDirs(imagesDir);

  const mb = (b) => `${(b / 1024 / 1024).toFixed(0)} MB`;
  console.log(
    `[pages] Pruned ${prunedCount} unreferenced image(s), ${mb(prunedBytes)}; ` +
      `kept ${mb(keptBytes)}.`,
  );
}

// ─── Size guard ───────────────────────────────────────────────────────────────

const totalBytes = walkFiles(outDir).reduce((sum, [, , size]) => sum + size, 0);
const totalMb = (totalBytes / 1024 / 1024).toFixed(0);

if (totalBytes > PAGES_SIZE_LIMIT_BYTES) {
  console.error(
    `[pages] ERROR: build output is ${totalMb} MB, over the 1 GB GitHub Pages ` +
      'limit. The deploy would be rejected — remove unused assets before ' +
      'publishing.',
  );
  process.exit(1);
}

console.log(`[pages] Build output: ${totalMb} MB (limit 1024 MB). Ready to deploy.`);
