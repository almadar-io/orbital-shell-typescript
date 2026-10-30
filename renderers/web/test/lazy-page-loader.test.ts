import { describe, expect, it } from 'vitest';
import type { LazyPage, OrbitalSchema } from '@almadar/core';

import type { LoadResult, LoadedSchema, SchemaLoader } from '@almadar/shell-runtime/loader/schema-loader';
import { loadLazyPage } from '@almadar/shell-runtime/loader/lazy-page';

const post: OrbitalSchema = {
  name: 'BlogWhy',
  orbitals: [
    {
      name: 'BlogWhy',
      entity: { name: 'BlogWhyState', fields: [{ name: 'id', type: 'string', required: true }] },
      traits: [],
      pages: [{ name: 'BlogWhyPage', path: '/blog/why', traits: [] }],
    },
  ],
};

const page: LazyPage = { path: '/blog/why', orbital: 'BlogWhy', orbRef: 'lazy/BlogWhy.orb' };

function serve(files: Record<string, OrbitalSchema>): { loader: SchemaLoader; requested: string[] } {
  const requested: string[] = [];
  const loader: SchemaLoader = {
    async load(importPath, fromPath): Promise<LoadResult<LoadedSchema>> {
      const sourcePath = new URL(importPath, fromPath).href;
      requested.push(sourcePath);
      const body = files[sourcePath];
      return body === undefined
        ? { success: false, error: `${sourcePath}: 404 Not Found` }
        : { success: true, data: { schema: body, sourcePath, importPath } };
    },
    async loadOrbital() {
      throw new Error('loadLazyPage loads whole schemas');
    },
    resolvePath: (importPath, fromPath) => ({ success: true, data: new URL(importPath, fromPath).href }),
    clearCache: () => undefined,
    getCacheStats: () => ({ size: 0 }),
  };
  return { loader, requested };
}

describe('loadLazyPage', () => {
  it('loads the behavior behind a lazy page, relative to the importer .orb', async () => {
    const { loader, requested } = serve({ 'https://site.test/app/lazy/BlogWhy.orb': post });
    const result = await loadLazyPage(loader, page, 'https://site.test/app/site.orb');
    expect(result.success && result.data.name).toBe('BlogWhy');
    expect(requested).toEqual(['https://site.test/app/lazy/BlogWhy.orb']);
  });

  it('fails when the loaded .orb does not carry the expected orbital', async () => {
    const { loader } = serve({ 'https://site.test/app/lazy/BlogWhy.orb': { ...post, orbitals: [{ ...post.orbitals[0], name: 'Other' }] } });
    const result = await loadLazyPage(loader, page, 'https://site.test/app/site.orb');
    expect(result.success).toBe(false);
    expect(!result.success && result.error).toContain('BlogWhy');
  });

  it('fails with the url when the .orb is missing', async () => {
    const { loader } = serve({});
    const result = await loadLazyPage(loader, page, 'https://site.test/app/site.orb');
    expect(!result.success && result.error).toContain('https://site.test/app/lazy/BlogWhy.orb');
  });
});
