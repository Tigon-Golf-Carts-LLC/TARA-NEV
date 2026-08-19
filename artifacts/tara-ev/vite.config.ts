import path from 'path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin, ViteDevServer } from 'vite';

// Local dev/preview port. Override with PORT if 5173 is taken.
const port = Number(process.env.PORT ?? 5173);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}

// Served from a custom apex domain on GitHub Pages, so the site lives at "/".
// Set BASE_PATH=/<repo-name>/ to publish to a github.io project-page URL
// instead (see README).
const basePath = process.env.BASE_PATH ?? '/';

// Alias/typo URLs that must 301 to their canonical page. `routes.json` is the
// single source of truth: any entry shaped `{ "redirect": "/target/" }` is
// honoured by the dev server here, by the client-side router in App.tsx, and
// by the static redirect pages that scripts/pages-postbuild.mjs writes for
// GitHub Pages (which has no server-side redirect support).
function loadRedirects(): Record<string, string> {
  const routesPath = path.resolve(
    import.meta.dirname,
    'public',
    'content',
    'routes.json',
  );
  const routes: Record<string, { redirect?: string }> = JSON.parse(
    fs.readFileSync(routesPath, 'utf8'),
  );
  const map: Record<string, string> = {};
  for (const [from, entry] of Object.entries(routes)) {
    if (entry.redirect) map[from] = entry.redirect;
  }
  return map;
}

// Canonical origin used for canonical/OG URLs in the prerendered HTML.
const SEO_ORIGIN = process.env.SITE_ORIGIN ?? 'https://taranev.com';
const HOME_TITLE = 'TARA Neighborhood Electric Vehicles';
const HOME_DESCRIPTION =
  'lithium-powered neighborhood electric vehicles designed for neighborhoods, golf courses, resorts, and communities.';
const SITE_ICON = '/images/tara-nev-logo.png';

const absoluteOgUrls = () => ({
  name: 'absolute-og-urls',
  apply: 'build' as const,
  transformIndexHtml(html: string) {
    return html.replace(
      /(<meta\s+(?:property="og:(?:image|url)"|name="(?:image|twitter:image)")\s+content=")(\/[^"]*)(")/g,
      (_m, pre, path, post) => `${pre}${SEO_ORIGIN}${path}${post}`,
    );
  },
});

// ─── Per-route metadata helpers (shared by dev middleware + prerender) ─────────

function escHtml(str: string) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function extractDescription(html: string): string {
  const cleaned = html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const pMatches = [...cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  for (const m of pMatches) {
    const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text.length < 50 || text.includes(' / ')) continue;
    return text.length > 158 ? text.slice(0, 157) + '…' : text;
  }
  const fallback = cleaned.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return fallback.length > 158 ? fallback.slice(0, 157) + '…' : fallback;
}

function extractOgImage(html: string): string {
  // Ignore the shared header/mega-menu so metadata uses the page's own image.
  const pageContent = html.split(/<\/header>/i)[1] || html;
  const SKIP = /logo|favicon|menu-image|icon/i;
  for (const m of pageContent.matchAll(/src=["']([^"']+\.(?:webp|jpg|jpeg|png))["']/gi)) {
    const src = m[1];
    if (SKIP.test(src)) continue;
    if (src.startsWith('/images/') || src.startsWith('/uploads/')) return src;
  }
  return SITE_ICON;
}

function injectRouteMeta(
  shellHtml: string,
  routePath: string,
  routeTitle: string,
  routeDescription: string | undefined,
  contentHtml: string,
  origin: string,
): string {
  const title = routePath === '/' ? HOME_TITLE : routeTitle || HOME_TITLE;
  const description =
    routePath === '/'
      ? HOME_DESCRIPTION
      : routeDescription || extractDescription(contentHtml);
  const ogImage = routePath === '/' ? SITE_ICON : extractOgImage(contentHtml);
  const canonicalUrl = `${origin}${routePath}`;
  const absoluteOgImage = ogImage.startsWith('http') ? ogImage : `${origin}${ogImage}`;

  let html = shellHtml;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(title)}</title>`);
  html = html.replace(
    /<meta\s+name="description"[^>]*\/?>/i,
    `<meta name="description" content="${escHtml(description)}" />`,
  );
  html = html.replace(
    /<meta\s+name="image"[^>]*\/?>/i,
    `<meta name="image" content="${absoluteOgImage}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:title"[^>]*\/?>/i,
    `<meta property="og:title" content="${escHtml(title)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:description"[^>]*\/?>/i,
    `<meta property="og:description" content="${escHtml(description)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:image"[^>]*\/?>/i,
    `<meta property="og:image" content="${absoluteOgImage}" />`,
  );
  html = html.replace(
    /<link\s+rel="canonical"[^>]*\/?>/i,
    `<link rel="canonical" href="${canonicalUrl}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:url"[^>]*\/?>/i,
    `<meta property="og:url" content="${canonicalUrl}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:title"[^>]*\/?>/i,
    `<meta name="twitter:title" content="${escHtml(title)}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:description"[^>]*\/?>/i,
    `<meta name="twitter:description" content="${escHtml(description)}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:image"[^>]*\/?>/i,
    `<meta name="twitter:image" content="${absoluteOgImage}" />`,
  );
  // Embed page content for crawlers
  html = html.replace(
    '<div id="root"></div>',
    `<div id="root" data-prerendered="1">${contentHtml}</div>`,
  );
  return html;
}

// ─── Dev middleware: serves per-route pre-rendered HTML ───────────────────────

type RouteMeta = {
  file: string;
  title: string;
  description?: string;
  bodyClass: string;
};
type Routes = Record<string, RouteMeta>;

const spaMetaMiddleware = (): Plugin => ({
  name: 'spa-meta-middleware',
  apply: 'serve' as const,
  configureServer(server: ViteDevServer) {
    const artifactDir = path.resolve(import.meta.dirname);
    const publicContentDir = path.join(artifactDir, 'public', 'content');
    const routesPath = path.join(publicContentDir, 'routes.json');

    server.middlewares.use(async (req, res, next) => {
      // Only intercept HTML navigation requests (not assets)
      const accept = req.headers['accept'] ?? '';
      if (!accept.includes('text/html')) return next();

      let reqPath = req.url?.split('?')[0] ?? '/';
      // Strip base path prefix so we match routes.json keys
      const base = basePath.replace(/\/$/, '');
      if (base && reqPath.startsWith(base)) {
        reqPath = reqPath.slice(base.length) || '/';
      }
      if (reqPath !== '/' && !reqPath.endsWith('/')) reqPath += '/';

      // Don't intercept Vite internal requests
      if (reqPath.startsWith('/@') || reqPath.startsWith('/node_modules/')) {
        return next();
      }

      let routes: Routes;
      try {
        routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
      } catch {
        return next();
      }

      const meta = routes[reqPath];
      if (!meta) return next();

      const contentFile = path.join(publicContentDir, meta.file);
      if (!fs.existsSync(contentFile)) return next();

      try {
        const contentHtml = fs.readFileSync(contentFile, 'utf8');
        // Get the shell HTML from Vite's index transform pipeline
        let shellHtml = fs.readFileSync(
          path.join(artifactDir, 'index.html'),
          'utf8',
        );
        // Run Vite's own HTML transforms (so script tags are correct)
        shellHtml = await server.transformIndexHtml(reqPath, shellHtml);

        const pageHtml = injectRouteMeta(
          shellHtml,
          reqPath,
          meta.title,
          meta.description,
          contentHtml,
          SEO_ORIGIN,
        );

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(pageHtml);
      } catch {
        return next();
      }
    });
  },
});

// ─── Post-build pre-renderer ─────────────────────────────────────────────────

const prerenderPlugin = (): Plugin => ({
  name: 'prerender-routes',
  apply: 'build' as const,
  closeBundle() {
    const prerenderScript = path.resolve(import.meta.dirname, 'scripts', 'prerender.mjs');
    if (!fs.existsSync(prerenderScript)) {
      // Hard failure — the prerender script is required for production builds.
      throw new Error('[prerender] prerender.mjs not found — cannot generate per-route HTML.');
    }
    const outDir = path.resolve(import.meta.dirname, 'dist', 'public');
    // Use the *built* index.html as the shell so generated pages reference
    // Vite's hashed /assets/index-*.js bundles, not the TS source entry.
    const shellHtml = path.join(outDir, 'index.html');
    const originArg = SEO_ORIGIN;
    // Let execFileSync throw on non-zero exit — this propagates prerender
    // failures as a build error so broken output is never silently shipped.
    execFileSync(
      process.execPath,
      [
        prerenderScript,
        '--shellHtml', shellHtml,
        '--outDir', outDir,
        '--origin', originArg,
      ],
      { stdio: 'inherit' },
    );
  },
});

export default defineConfig({
  base: basePath,
  plugins: [
    redirectPlugin(),
    absoluteOgUrls(),
    spaMetaMiddleware(),
    prerenderPlugin(),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
  },
});

function redirectPlugin() {
  const handler = (
    server: import('vite').ViteDevServer | import('vite').PreviewServer,
  ) => {
    server.middlewares.use((req, res, next) => {
      const raw = req.url?.split('?')[0] ?? '/';
      // Strip base path prefix so lookup keys always start with '/'.
      const stripped =
        basePath !== '/' && raw.startsWith(basePath.replace(/\/$/, ''))
          ? raw.slice(basePath.replace(/\/$/, '').length) || '/'
          : raw;
      const normalized =
        !stripped.includes('.') && !stripped.endsWith('/')
          ? stripped + '/'
          : stripped;
      const target = loadRedirects()[normalized];
      if (target) {
        res.writeHead(301, { Location: target });
        res.end();
        return;
      }
      next();
    });
  };
  return {
    name: 'canonical-redirects',
    configureServer: handler,
    configurePreviewServer: handler,
  };
}
