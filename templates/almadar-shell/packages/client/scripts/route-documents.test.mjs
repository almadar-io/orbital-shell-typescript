import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { documentRoutes, routeDocument, sitemap, robots, writeRouteDocuments } from './route-documents.mjs';

const INDEX = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <title>Almadar App</title>
    <script type="module" crossorigin src="/assets/index-AbC123.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`;

const site = { origin: 'https://example.org', name: 'Example', icon: '/icon.svg' };
const manifest = {
  site,
  routes: [
    { path: '/', page: 'Home', locale: 'en', dir: 'ltr', access: 'public', indexing: 'index', title: 'Home', description: 'Welcome' },
    { path: '/ar', page: 'HomeAr', locale: 'ar', dir: 'rtl', access: 'public', indexing: 'index', title: 'الرئيسية', description: 'أهلا' },
    { path: '/terms', page: 'Terms', locale: 'en', dir: 'ltr', access: 'public', indexing: 'noindex', title: 'Terms' },
    { path: '/account', page: 'Account', locale: 'en', dir: 'ltr', access: 'authenticated', indexing: 'noindex', title: 'Account' },
    { path: '/docs', page: 'Docs', locale: 'en', dir: 'ltr' },
    { path: '/posts/:id', page: 'Post', locale: 'en', dir: 'ltr', access: 'public', indexing: 'noindex' },
  ],
};

describe('route documents', () => {
  it('two routes get distinct heads over the same built assets', () => {
    const home = routeDocument(INDEX, manifest.routes[0], site);
    const ar = routeDocument(INDEX, manifest.routes[1], site);
    expect(home).toContain('<title>Home</title>');
    expect(home).toContain('<link rel="canonical" href="https://example.org/" data-orb-head />');
    expect(ar).toContain('<html lang="ar" dir="rtl">');
    expect(ar).toContain('<title>الرئيسية</title>');
    expect(ar).toContain('<link rel="canonical" href="https://example.org/ar" data-orb-head />');
    for (const doc of [home, ar]) {
      expect(doc).toContain('src="/assets/index-AbC123.js"');
      expect(doc.match(/rel="canonical"/g)).toHaveLength(1);
      expect(doc.match(/<title>/g)).toHaveLength(1);
      expect(doc).toContain('<link rel="icon" href="/icon.svg" />');
    }
  });

  it('escapes authored text in every context', () => {
    const doc = routeDocument(INDEX, { path: '/x', locale: 'en', title: '</title><script>alert(1)</script> $& "q"', description: '"><img src=x>' }, site);
    expect(doc).not.toContain('<script>alert');
    expect(doc).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt; $&amp; &quot;q&quot;');
    expect(doc).toContain('content="&quot;&gt;&lt;img src=x&gt;"');
  });

  it('a noindex route says so in its document, carries no canonical or social tags, and stays out of the sitemap', () => {
    const doc = routeDocument(INDEX, manifest.routes[2], site);
    expect(doc).toContain('<meta name="robots" content="noindex" data-orb-head />');
    expect(doc).toContain('<title>Terms</title>');
    expect(doc).not.toContain('rel="canonical"');
    expect(doc).not.toContain('og:');
    expect(sitemap(manifest)).not.toContain('/terms');
  });

  it('only declared public, concrete routes get documents', () => {
    expect(documentRoutes(manifest).map((r) => r.path)).toEqual(['/', '/ar', '/terms']);
  });

  it('the sitemap lists exactly the indexed public routes', () => {
    const xml = sitemap(manifest);
    expect(xml.match(/<loc>/g)).toHaveLength(2);
    expect(xml).not.toContain('/account');
    expect(xml).not.toContain('/docs');
  });

  it('control: no declared origin means no sitemap and a sitemap-less robots', () => {
    expect(sitemap({ routes: manifest.routes })).toBeNull();
    expect(robots({ routes: [] })).toBe('User-agent: *\nAllow: /\n');
  });

  it('writes documents, sitemap and robots into dist', () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'route-docs-'));
    fs.writeFileSync(path.join(dist, 'index.html'), INDEX);
    const written = writeRouteDocuments(manifest, dist);
    expect(written.sort()).toEqual(['app-shell.html', 'ar/index.html', 'index.html', 'robots.txt', 'sitemap.xml', 'terms/index.html']);
    expect(fs.readFileSync(path.join(dist, 'ar/index.html'), 'utf8')).toContain('dir="rtl"');
    expect(fs.existsSync(path.join(dist, 'account/index.html'))).toBe(false);
    const shell = fs.readFileSync(path.join(dist, 'app-shell.html'), 'utf8');
    expect(shell).toContain('<title>Example</title>');
    expect(shell).toContain('<link rel="icon" href="/icon.svg" />');
    expect(shell).not.toContain('data-orb-head');
  });

  it('control: an app declaring no site name or icon keeps the built shell untouched', () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'route-docs-'));
    fs.writeFileSync(path.join(dist, 'index.html'), INDEX);
    writeRouteDocuments({ routes: manifest.routes }, dist);
    expect(fs.readFileSync(path.join(dist, 'app-shell.html'), 'utf8')).toBe(INDEX);
  });

  it('edge: a route without its own title falls back to the site name, escaped', () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'route-docs-'));
    fs.writeFileSync(path.join(dist, 'index.html'), INDEX);
    writeRouteDocuments({ site: { name: 'A & <B>' }, routes: [{ path: '/', page: 'Home', access: 'public' }] }, dist);
    expect(fs.readFileSync(path.join(dist, 'app-shell.html'), 'utf8')).toContain('<title>A &amp; &lt;B&gt;</title>');
    expect(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')).toContain('<title>A &amp; &lt;B&gt;</title>');
  });

  it('a second run rebuilds from the kept shell, never from a rewritten document', () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'route-docs-'));
    fs.writeFileSync(path.join(dist, 'index.html'), INDEX);
    writeRouteDocuments(manifest, dist);
    const once = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    writeRouteDocuments(manifest, dist);
    expect(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')).toBe(once);
    expect(once.match(/rel="canonical"/g)).toHaveLength(1);
  });
});

describe('language alternates', () => {
  const homeAlternates = [{ locale: 'en', path: '/' }, { locale: 'ar', path: '/ar' }];
  const localized = {
    site,
    defaultLocale: 'en',
    routes: [
      { path: '/', page: 'HomeEN', locale: 'en', dir: 'ltr', access: 'public', indexing: 'index', title: 'Home', alternates: homeAlternates },
      { path: '/ar', page: 'HomeAR', locale: 'ar', dir: 'rtl', access: 'public', indexing: 'index', title: 'الرئيسية', alternates: homeAlternates },
      { path: '/docs', page: 'Docs', locale: 'en', dir: 'ltr', access: 'public', indexing: 'index', title: 'Docs' },
    ],
  };

  function written(m) {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'route-docs-'));
    fs.writeFileSync(path.join(dist, 'index.html'), INDEX);
    writeRouteDocuments(m, dist);
    return (file) => fs.readFileSync(path.join(dist, file), 'utf8');
  }

  it('each translation links every translation and the default locale as x-default', () => {
    const read = written(localized);
    for (const file of ['index.html', 'ar/index.html']) {
      const doc = read(file);
      expect(doc).toContain('<link rel="alternate" hreflang="en" href="https://example.org/" data-orb-head />');
      expect(doc).toContain('<link rel="alternate" hreflang="ar" href="https://example.org/ar" data-orb-head />');
      expect(doc).toContain('<link rel="alternate" hreflang="x-default" href="https://example.org/" data-orb-head />');
    }
  });

  it('control: a route with no translations carries no alternates', () => {
    expect(written(localized)('docs/index.html')).not.toContain('hreflang');
  });

  it('edge: without an origin there are no absolute alternates to write', () => {
    expect(written({ ...localized, site: { name: 'Example' } })('index.html')).not.toContain('hreflang');
  });
});
