import { describe, it, expect } from 'vitest';
import { routeFile, sitemap, robots, scenesReady } from './prerender-lib.mjs';

const manifest = {
  site: { origin: 'https://orb.almadar.io/' },
  routes: [
    { path: '/', access: 'public', indexing: 'index' },
    { path: '/ar', access: 'public', indexing: 'index' },
    { path: '/posts/:id', access: 'public', indexing: 'index' },
  ],
};

describe('prerender helpers', () => {
  it('maps routes to their index.html', () => {
    expect(routeFile('/')).toBe('index.html');
    expect(routeFile('/ar')).toBe('ar/index.html');
    expect(routeFile('/ar/blog/why')).toBe('ar/blog/why/index.html');
  });

  it('control: a route with params is not static', () => {
    expect(routeFile('/posts/:id')).toBeNull();
  });

  it('lists every concrete indexed public route in the sitemap', () => {
    const xml = sitemap(manifest);
    expect(xml).toContain('<loc>https://orb.almadar.io/</loc>');
    expect(xml).toContain('<loc>https://orb.almadar.io/ar</loc>');
    expect(xml).not.toContain(':id');
  });

  it('points robots at the sitemap', () => {
    expect(robots({ site: { origin: 'https://almadar.io' }, routes: [] })).toContain('Sitemap: https://almadar.io/sitemap.xml');
  });
});

describe('a page is captured once its scene canvases say they are laid out', () => {
  const page = (marks, mounted = true) => {
    globalThis.document = {
      querySelector: (selector) => (selector === '[data-orb-mounted]' && mounted ? {} : null),
      querySelectorAll: () => marks.map((m) => ({ getAttribute: (name) => (name === 'data-orb-ready' ? m : null) })),
    };
  };

  it('a page with no scene canvas is ready as it is', () => {
    page([]);
    expect(scenesReady()).toBe(true);
  });

  it('a page whose every scene canvas is marked ready is ready', () => {
    page(['true', 'true']);
    expect(scenesReady()).toBe(true);
  });

  it('a page whose traits have not mounted yet is not ready, even with no canvas on it', () => {
    page([], false);
    expect(scenesReady()).toBe(false);
  });

  it('control: one scene canvas not yet marked keeps the page waiting', () => {
    page(['true', null]);
    expect(scenesReady()).toBe(false);
  });
});
