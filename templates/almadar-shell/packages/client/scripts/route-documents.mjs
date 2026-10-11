#!/usr/bin/env node
/**
 * Route documents from the compiler's routes.json: after `vite build`, every
 * declared `access: public` route gets `dist/<route>/index.html` — the built
 * index.html (final hashed assets, normal client startup) with that route's
 * own head (title, description, canonical, social tags, lang/dir, robots) —
 * plus sitemap.xml (public + `indexing: index` routes) and robots.txt. The
 * untouched build is kept as `app-shell.html`: the host's SPA fallback serves
 * it, so a route without its own document never inherits another route's head.
 *
 * Usage: node scripts/route-documents.mjs --manifest ../../routes.json [--dist dist]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `/` → `index.html`, `/ar/blog/why` → `ar/blog/why/index.html`. Routes with `:params` are not static. */
export function routeFile(routePath) {
  if (routePath.split('/').some((segment) => segment.startsWith(':'))) return null;
  const trimmed = routePath.replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? 'index.html' : path.posix.join(trimmed, 'index.html');
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function canonicalUrl(origin, routePath) {
  return `${origin.replace(/\/+$/, '')}${routePath === '/' ? '/' : routePath}`;
}

/** The manifest's routes that get their own document: declared public and concrete. */
export function documentRoutes(manifest) {
  return manifest.routes.filter((r) => r.access === 'public' && routeFile(r.path) !== null);
}

/** Marks a tag as owned by the page head — the client's `usePageHead` replaces exactly these. */
const OWNED = ' data-orb-head';

/** The head tags a route's document owns. */
export function headTags(route, site = {}) {
  // A noindex document carries only the directive — the same tags the
  // client's usePageHead keeps for it (no canonical/social signals).
  if (route.indexing === 'noindex') return ['<meta name="robots" content="noindex"' + OWNED + ' />'];
  const tags = [];
  if (route.description !== undefined) tags.push(`<meta name="description" content="${escapeHtml(route.description)}"${OWNED} />`);
  if (site.origin !== undefined) tags.push(`<link rel="canonical" href="${escapeHtml(canonicalUrl(site.origin, route.path))}"${OWNED} />`);
  if (route.title !== undefined) tags.push(`<meta property="og:title" content="${escapeHtml(route.title)}"${OWNED} />`);
  if (route.description !== undefined) tags.push(`<meta property="og:description" content="${escapeHtml(route.description)}"${OWNED} />`);
  if (site.origin !== undefined) tags.push(`<meta property="og:url" content="${escapeHtml(canonicalUrl(site.origin, route.path))}"${OWNED} />`);
  if (site.name !== undefined) tags.push(`<meta property="og:site_name" content="${escapeHtml(site.name)}"${OWNED} />`);
  if (route.locale) tags.push(`<meta property="og:locale" content="${escapeHtml(route.locale)}"${OWNED} />`);
  // `alternates` arrive from the compiler already narrowed to indexable public translations.
  if (site.origin !== undefined) {
    for (const alt of route.alternates ?? []) {
      tags.push(`<link rel="alternate" hreflang="${escapeHtml(alt.locale)}" href="${escapeHtml(canonicalUrl(site.origin, alt.path))}"${OWNED} />`);
    }
    const fallback = (route.alternates ?? []).find((alt) => alt.locale === route.defaultLocale);
    if (fallback !== undefined) tags.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(canonicalUrl(site.origin, fallback.path))}"${OWNED} />`);
  }
  return tags;
}

/** The built index.html rewritten as `route`'s document. */
export function routeDocument(indexHtml, route, site = {}) {
  let html = appShell(indexHtml, site);
  if (route.locale) {
    html = html.replace(/<html\b[^>]*>/i, () => `<html lang="${escapeHtml(route.locale)}" dir="${escapeHtml(route.dir ?? 'ltr')}">`);
  }
  if (route.title !== undefined) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(route.title)}</title>`);
  }
  const tags = headTags(route, site);
  return tags.length === 0 ? html : html.replace(/<\/head>/i, () => `    ${tags.join('\n    ')}\n  </head>`);
}

/** Canonical, indexable, concrete public URLs. */
export function sitemap(manifest) {
  const origin = manifest.site?.origin;
  if (origin === undefined) return null;
  const urls = documentRoutes(manifest)
    .filter((r) => r.indexing === 'index')
    .map((r) => `  <url><loc>${escapeHtml(canonicalUrl(origin, r.path))}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function robots(manifest) {
  const origin = manifest.site?.origin;
  return origin === undefined
    ? 'User-agent: *\nAllow: /\n'
    : `User-agent: *\nAllow: /\nSitemap: ${origin.replace(/\/+$/, '')}/sitemap.xml\n`;
}

export const APP_SHELL = 'app-shell.html';

/** The built index.html carrying the app's declared `siteName:` and `icon:`, the head of every route that declares none. */
export function appShell(indexHtml, site = {}) {
  let html = indexHtml;
  if (site.name !== undefined) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(site.name)}</title>`);
  }
  if (site.icon !== undefined) {
    html = html.replace(/<link\s+rel="icon"[^>]*>/i, () => `<link rel="icon" href="${escapeHtml(site.icon)}" />`);
  }
  return html;
}

/** Writes every public route's document plus sitemap.xml/robots.txt into `dist`. Returns the files written. */
export function writeRouteDocuments(manifest, dist) {
  const shellPath = path.join(dist, APP_SHELL);
  if (!fs.existsSync(shellPath)) fs.copyFileSync(path.join(dist, 'index.html'), shellPath);
  const indexHtml = appShell(fs.readFileSync(shellPath, 'utf8'), manifest.site);
  fs.writeFileSync(shellPath, indexHtml);
  const written = [APP_SHELL];
  for (const route of documentRoutes(manifest)) {
    const out = path.join(dist, routeFile(route.path));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, routeDocument(indexHtml, { ...route, defaultLocale: manifest.defaultLocale }, manifest.site));
    written.push(path.relative(dist, out));
  }
  const map = sitemap(manifest);
  if (map !== null) {
    fs.writeFileSync(path.join(dist, 'sitemap.xml'), map);
    written.push('sitemap.xml');
  }
  fs.writeFileSync(path.join(dist, 'robots.txt'), robots(manifest));
  written.push('robots.txt');
  return written;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { parseArgs } = await import('node:util');
  const { values } = parseArgs({ options: { manifest: { type: 'string' }, dist: { type: 'string', default: 'dist' } } });
  if (!values.manifest) {
    console.error('usage: route-documents.mjs --manifest <routes.json> [--dist dist]');
    process.exit(2);
  }
  const written = writeRouteDocuments(JSON.parse(fs.readFileSync(values.manifest, 'utf8')), path.resolve(values.dist));
  console.log(`route-documents: ${written.length} file(s) written`);
}
