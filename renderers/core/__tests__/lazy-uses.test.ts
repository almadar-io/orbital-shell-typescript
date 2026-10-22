import { describe, expect, it } from 'vitest';

import { UseDeclarationSchema } from '../src/types/orbital.js';
import { OrbitalSchemaSchema } from '../src/types/schema.js';

/**
 * `uses lazy` keeps a behavior out of the importer's `.orb`: the import is
 * marked `lazy`, and the importer carries only the pages that load it. Both
 * must survive the zod parse (z.object strips unknown keys) or the runtime
 * path silently loses the lazy pages.
 */
describe('lazy uses survive the zod parse', () => {
  const orbital = {
    name: 'SiteHome',
    entity: { name: 'SiteHomeState', fields: [{ name: 'id', type: 'string', required: true }] },
    traits: [],
    pages: [],
  };

  it('keeps the lazy flag on a use declaration', () => {
    const parsed = UseDeclarationSchema.parse({ from: './blog/why', as: 'Why', lazy: true });
    expect(parsed.lazy).toBe(true);
  });

  it('control: an eager use declaration carries no lazy flag', () => {
    const parsed = UseDeclarationSchema.parse({ from: './blog/why', as: 'Why' });
    expect(parsed.lazy).toBeUndefined();
  });

  it('keeps the lazy pages on the schema', () => {
    const lazyPages = [
      { path: '/blog/why', orbital: 'BlogWhy', orbRef: 'lazy/BlogWhy.orb' },
      { path: '/blog/why/:section', orbital: 'BlogWhy', orbRef: 'lazy/BlogWhy.orb' },
    ];
    const parsed = OrbitalSchemaSchema.parse({ name: 'Site', orbitals: [orbital], lazyPages });
    expect(parsed.lazyPages).toEqual(lazyPages);
  });

  it('edge: a lazy page without its orbRef is rejected', () => {
    const result = OrbitalSchemaSchema.safeParse({
      name: 'Site',
      orbitals: [orbital],
      lazyPages: [{ path: '/blog/why', orbital: 'BlogWhy' }],
    });
    expect(result.success).toBe(false);
  });
});
