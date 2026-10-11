import { describe, it, expect } from 'vitest';
import { routeFile, sitemap, robots } from './prerender-lib.mjs';

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
