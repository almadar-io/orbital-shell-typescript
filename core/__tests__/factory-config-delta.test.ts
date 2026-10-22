import { describe, expect, it } from 'vitest';

import { overrideDeclaredKnobs, type DeclaredTraitConfig, type OrbitalSchema } from '../src/types/index.js';
import {
  applyParamsToOrb,
  extractManifest,
  paramFieldsFor,
  validateOrbitalFactoryParams,
} from '../src/factory-runtime/index.js';
import { rehydrateKnobDefs } from '../src/factory/knob-defs.js';
import { signatureToParamsSchema } from '../src/factory/params-schema.js';
import type { FactoryConfigParam, FactorySignature, FactorySignatureCatalog } from '../src/factory/types.js';
import { getNestedValue } from '../src/lib/get-nested-value.js';

// ----------------------------------------------------------------------------
// overrideDeclaredKnobs
// ----------------------------------------------------------------------------

describe('overrideDeclaredKnobs', () => {
  const declared: DeclaredTraitConfig = {
    pageSize: { type: 'number', default: 25 },
    title: { type: 'string', default: 'Untitled', label: 'Title' },
  };

  it('folds an override value into the matching knob’s default, leaving other fields intact', () => {
    const out = overrideDeclaredKnobs(declared, { pageSize: 100 });
    expect(out.pageSize).toEqual({ type: 'number', default: 100 });
    expect(out.title).toEqual(declared.title);
  });

  it('throws (ORB_O_CONFIG_UNKNOWN_KEY) for an override key the declaration does not have', () => {
    expect(() => overrideDeclaredKnobs(declared, { bogus: 'x' })).toThrow(/ORB_O_CONFIG_UNKNOWN_KEY/);
  });

  it('is a no-op given an empty override map', () => {
    expect(overrideDeclaredKnobs(declared, {})).toEqual(declared);
  });

  it('canonicalizes a trait-typed knob’s "none" override to null (owner ruling 2026-09-13)', () => {
    const withTrait: DeclaredTraitConfig = {
      ...declared,
      uiTrait: { type: 'trait', default: '@trait.DefaultForm' },
    };
    const out = overrideDeclaredKnobs(withTrait, { uiTrait: 'none' });
    expect(out.uiTrait).toEqual({ type: 'trait', default: null });
  });

  it('leaves a non-trait knob’s literal "none" override untouched (no text heuristic)', () => {
    const withStringKnob: DeclaredTraitConfig = {
      ...declared,
      mode: { type: 'string', default: 'edit' },
    };
    const out = overrideDeclaredKnobs(withStringKnob, { mode: 'none' });
    expect(out.mode).toEqual({ type: 'string', default: 'none' });
  });
});

// ----------------------------------------------------------------------------
// extractManifest / paramFieldsFor — the config-field gate
// ----------------------------------------------------------------------------

const orbitalWithConfig: OrbitalSchema = {
  name: 'fixture',
  orbitals: [
    {
      name: 'PanelOrbital',
      entity: { name: 'Item', fields: [{ name: 'id', type: 'string' as const, required: true }] },
      traits: [],
      pages: [],
      config: {
        pageSize: { type: 'number', default: 25 },
      },
    },
  ],
};

const orbitalWithoutConfig: OrbitalSchema = {
  name: 'fixture',
  orbitals: [
    {
      name: 'PanelOrbital',
      entity: { name: 'Item', fields: [{ name: 'id', type: 'string' as const, required: true }] },
      traits: [],
      pages: [],
    },
  ],
};

describe('extractManifest / paramFieldsFor — config gate', () => {
  it('includes a config param field + configKeys when the orbital declares config', () => {
    const [manifest] = extractManifest(orbitalWithConfig);
    expect(manifest!.paramFields.some((f) => f.name === 'config')).toBe(true);
    expect(manifest!.configKeys).toEqual(['pageSize']);
  });

  it('omits the config param field + configKeys when the orbital declares no config', () => {
    const [manifest] = extractManifest(orbitalWithoutConfig);
    expect(manifest!.paramFields.some((f) => f.name === 'config')).toBe(false);
    expect(manifest!.configKeys).toBeUndefined();
  });

  it('paramFieldsFor agrees with extractManifest for the same orbital', () => {
    const orbital = orbitalWithConfig.orbitals[0]!;
    const fields = paramFieldsFor(orbitalWithConfig, orbital);
    expect(fields).toEqual(extractManifest(orbitalWithConfig)[0]!.paramFields);
  });
});

// ----------------------------------------------------------------------------
// validateOrbitalFactoryParams — config validation
// ----------------------------------------------------------------------------

describe('validateOrbitalFactoryParams — config', () => {
  const manifestWithConfig = {
    organism: 'fixture',
    orbitalName: 'PanelOrbital',
    paramFields: paramFieldsFor(orbitalWithConfig, orbitalWithConfig.orbitals[0]!),
    traitNames: [],
    inlineTraitNames: [],
    configKeys: ['pageSize'],
  };

  const manifestNoConfig = {
    organism: 'fixture',
    orbitalName: 'PanelOrbital',
    paramFields: paramFieldsFor(orbitalWithoutConfig, orbitalWithoutConfig.orbitals[0]!),
    traitNames: [],
    inlineTraitNames: [],
  };

  it('accepts a config override naming only declared keys', () => {
    const result = validateOrbitalFactoryParams(manifestWithConfig, { config: { pageSize: 50 } });
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown config key with the discriminated error', () => {
    const result = validateOrbitalFactoryParams(manifestWithConfig, { config: { bogus: 1 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'unknown-config-key', key: 'bogus', allowed: ['pageSize'] });
  });

  it('rejects a `config` param outright when the manifest declares no configKeys (existing unknown-key path)', () => {
    const result = validateOrbitalFactoryParams(manifestNoConfig, { config: { pageSize: 50 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'unknown-key', key: 'config' });
  });
});

// ----------------------------------------------------------------------------
// applyParamsToOrb — folding params.config onto Orbital.config
// ----------------------------------------------------------------------------

describe('applyParamsToOrb — config delta', () => {
  const manifest = {
    organism: 'fixture',
    orbitalName: 'PanelOrbital',
    paramFields: [],
    traitNames: [],
    inlineTraitNames: [],
    configKeys: ['pageSize'],
  };

  it('applies params.config onto the orbital’s declared config', () => {
    const built = applyParamsToOrb(orbitalWithConfig, 'PanelOrbital', manifest, { config: { pageSize: 100 } });
    expect(built.config).toEqual({ pageSize: { type: 'number', default: 100 } });
  });

  it('carries the declared config through untouched when no override is given', () => {
    const built = applyParamsToOrb(orbitalWithConfig, 'PanelOrbital', manifest, {});
    expect(built.config).toEqual(orbitalWithConfig.orbitals[0]!.config);
  });

  it('leaves `config` absent on the built orbital when none is declared', () => {
    const built = applyParamsToOrb(orbitalWithoutConfig, 'PanelOrbital', manifest, {});
    expect(built.config).toBeUndefined();
  });
});

// ----------------------------------------------------------------------------
// signatureToParamsSchema — config only when declared
// ----------------------------------------------------------------------------

function baseSignature(config?: readonly FactoryConfigParam[]): FactorySignature {
  return {
    organism: 'fixture',
    orbital: 'PanelOrbital',
    tier: 'organisms',
    factoryPath: 'behaviors/functions/app/organisms/fixture.ts',
    entities: [{ name: 'Item', fields: [], persistence: 'persistent' }],
    traits: [],
    pages: [],
    emittedEvents: [],
    listenedEvents: [],
    ...(config !== undefined ? { config } : {}),
  };
}

describe('signatureToParamsSchema — config', () => {
  it('carries a `config` property built from the same knob→schema function, only when signature.config is non-empty', () => {
    const schema = signatureToParamsSchema(
      baseSignature([{ key: 'pageSize', type: 'number', default: 25 }]),
    );
    expect(schema.properties?.config).toEqual({
      type: 'object',
      additionalProperties: false,
      description: "This orbital's own declared knobs (Orbital.config). Only the keys shown are valid.",
      properties: { pageSize: { type: 'number', default: 25 } },
    });
  });

  it('omits `config` entirely when the signature declares none', () => {
    const schema = signatureToParamsSchema(baseSignature());
    expect(schema.properties?.config).toBeUndefined();
  });
});

// ----------------------------------------------------------------------------
// rehydrateKnobDefs — configRefs round-trip
// ----------------------------------------------------------------------------

describe('rehydrateKnobDefs — orbital configRefs', () => {
  it('rehydrates signature.config from configRefs against the catalog knobDefs table', () => {
    const knob: FactoryConfigParam = { key: 'pageSize', type: 'number', default: 25 };
    const wireSignature: FactorySignature = { ...baseSignature(), configRefs: [0] };
    const catalog: FactorySignatureCatalog = {
      generatedFromStdVersion: '0.0.0',
      signatures: [wireSignature],
      knobDefs: [knob],
    };

    const rehydrated = rehydrateKnobDefs(catalog);
    expect(rehydrated.signatures[0]!.config).toEqual([knob]);
    expect(rehydrated.signatures[0]!.configRefs).toBeUndefined();
  });

  it('is a no-op when the catalog carries no knobDefs table', () => {
    const catalog: FactorySignatureCatalog = {
      generatedFromStdVersion: '0.0.0',
      signatures: [baseSignature([{ key: 'pageSize', type: 'number' }])],
    };
    expect(rehydrateKnobDefs(catalog)).toBe(catalog);
  });
});

// ----------------------------------------------------------------------------
// getNestedValue
// ----------------------------------------------------------------------------

describe('getNestedValue', () => {
  const data = { company: { name: 'Acme', address: { city: 'NYC' } }, tags: ['a', 'b'] };

  it('reads a dotless (fast-path) key', () => {
    expect(getNestedValue(data, 'tags')).toEqual(['a', 'b']);
  });

  it('reads a nested dotted path', () => {
    expect(getNestedValue(data, 'company.address.city')).toBe('NYC');
  });

  it('returns undefined for a missing nested path', () => {
    expect(getNestedValue(data, 'company.missing.deeper')).toBeUndefined();
  });

  it('returns undefined for null/undefined input', () => {
    expect(getNestedValue(null, 'a.b')).toBeUndefined();
    expect(getNestedValue(undefined, 'a.b')).toBeUndefined();
  });

  it('bails (does not traverse) when a path segment resolves to an array', () => {
    expect(getNestedValue(data, 'tags.length')).toBeUndefined();
  });

  it('bails when the top-level input itself is an array or a scalar', () => {
    expect(getNestedValue(['a', 'b'], 'length')).toBeUndefined();
    expect(getNestedValue('hello', 'length')).toBeUndefined();
  });
});
