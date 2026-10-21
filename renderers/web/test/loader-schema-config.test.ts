import { describe, it, expect, afterEach, vi } from 'vitest';
import type { DeclaredTraitConfig } from '@almadar/core';
import { HttpLoader } from '../src/loader/http-loader.js';

// R-ORBITAL-IMPORT-SCHEMA-CONFIG-RUNG-USES-CONSUMER: `loadOrbital` must carry
// the loaded schema's OWN app-level `config` forward as `schemaConfig`, so a
// later consumer resolves the upstream orbital's traits against the schema
// that declared them, never the importing app's config.

const TEST_CONFIG: DeclaredTraitConfig = {
  theme: { type: 'string', default: 'dark' },
};

function buildSchemaJson(config?: DeclaredTraitConfig) {
  return {
    name: 'test-schema',
    orbitals: [
      {
        name: 'TestOrbital',
        entity: { name: 'Thing', fields: [{ name: 'id', type: 'string' }] },
        traits: [],
        pages: [],
      },
    ],
    ...(config ? { config } : {}),
  };
}

describe('HttpLoader.loadOrbital — schemaConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(config?: DeclaredTraitConfig) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify(buildSchemaJson(config)),
      }))
    );
  }

  it('carries the schema\'s declared config as schemaConfig', async () => {
    stubFetch(TEST_CONFIG);
    const loader = new HttpLoader({ basePath: 'https://example.com/schemas' });
    const result = await loader.loadOrbital('./schema.orb');

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data.schemaConfig).toEqual(TEST_CONFIG);
  });

  it('omits schemaConfig when the schema declares no config', async () => {
    stubFetch();
    const loader = new HttpLoader({ basePath: 'https://example.com/schemas' });
    const result = await loader.loadOrbital('./schema.orb');

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data.schemaConfig).toBeUndefined();
    expect('schemaConfig' in result.data).toBe(false);
  });
});
