/**
 * `generateQuestions` fixture tests.
 *
 * Covers:
 *   1. Catalog-driven surface — capability + config-key questions
 *      emit deterministically from the matched signature.
 *   2. RuleOverlay coverage — capability questions covered by
 *      `ruleOverlay.rules[].capability` are dropped.
 *   3. Tier filter — `tier: 'internal'` params are excluded;
 *      `domain` and `presentation` survive (axis swap landed in
 *      Almadar_Studio_Questionnaire.md §3).
 *   4. Structural derivation — `deriveInputType` reads
 *      `items.properties`, `properties`, `enumValues` to pick the
 *      richer widget instead of collapsing everything to multiselect.
 */

import { describe, expect, it } from 'vitest';
import type {
  FactoryCallSite,
  FactorySignature,
  RuleOverlay,
} from '../index';
import { deriveInputType, generateQuestions } from '../index';

const ecommerceSignature: FactorySignature = {
  organism: 'std-ecommerce',
  orbital: 'ProductOrbital',
  tier: 'organisms',
  factoryPath: 'fake.ts',
  entities: [
    {
      name: 'Product',
      fields: [
        { name: 'name', type: 'string', required: true },
        { name: 'price', type: 'number', required: true },
      ],
      persistence: 'persistent',
    },
  ],
  traits: [
    {
      name: 'ProductCatalog',
      emittedEvents: [],
      listenedEvents: [],
      overridableConfigKeys: [
        { key: 'navItems', type: '[object]', default: [] },
        { key: 'ownerField', type: 'string', default: 'ownerId' },
      ],
      capabilities: ['privacy', 'audit'],
    },
  ],
  pages: [
    { name: 'ProductPage', defaultPath: '/products', primaryEntity: 'Product' },
  ],
  emittedEvents: [],
  listenedEvents: [],
};

function makeCall(): FactoryCallSite {
  return {
    organism: 'std-ecommerce',
    orbital: 'ProductOrbital',
    factoryPath: 'fake.ts',
    params: {},
  };
}

describe('generateQuestions', () => {
  it('emits config-key + capability questions when the call site is blank', () => {
    const result = generateQuestions([makeCall()], [ecommerceSignature]);
    const ids = result.map((q) => q.id);
    expect(ids).toContain('ProductOrbital.ProductCatalog.navItems');
    expect(ids).toContain('ProductOrbital.ProductCatalog.ownerField');
    expect(ids).toContain('ProductOrbital.capability.privacy');
    expect(ids).toContain('ProductOrbital.capability.audit');
  });

  it('still emits the question when the call site pre-pinned a value, with the pin as defaultValue', () => {
    const call: FactoryCallSite = {
      ...makeCall(),
      params: {
        traitOverrides: {
          ProductCatalog: {
            config: { navItems: [{ label: 'Home', href: '/' }] },
          },
        },
      },
    };
    const result = generateQuestions([call], [ecommerceSignature]);
    const navQ = result.find(
      (q) => q.id === 'ProductOrbital.ProductCatalog.navItems',
    );
    expect(navQ).toBeDefined();
    // Call-site override becomes the question's defaultValue so the
    // user sees the organism's pre-pin and can confirm or change it.
    expect(navQ?.defaultValue).toEqual([{ label: 'Home', href: '/' }]);
  });

  it('suppresses capability questions covered by ruleOverlay', () => {
    const overlay: RuleOverlay = {
      rules: [
        {
          id: 'r1',
          capability: 'privacy',
          description: 'product privacy',
          appliesTo: ['Product'],
        },
      ],
    };
    const result = generateQuestions(
      [makeCall()],
      [ecommerceSignature],
      overlay,
    );
    const capabilityIds = result
      .filter((q) => q.id.includes('.capability.'))
      .map((q) => q.id);
    expect(capabilityIds).not.toContain('ProductOrbital.capability.privacy');
    expect(capabilityIds).toContain('ProductOrbital.capability.audit');
  });

  it('skips call sites with no signature match in the catalog', () => {
    const call: FactoryCallSite = { ...makeCall(), orbital: 'UnknownOrbital' };
    const result = generateQuestions([call], [ecommerceSignature]);
    expect(result).toHaveLength(0);
  });

  it('emits a question for every overridableConfigKey advertised by the trait', () => {
    const sig: FactorySignature = {
      ...ecommerceSignature,
      traits: [
        {
          ...ecommerceSignature.traits[0],
          overridableConfigKeys: [
            { key: 'someInternalKnob', type: 'string', default: 'x' },
          ],
        },
      ],
    };
    const result = generateQuestions([makeCall()], [sig]);
    const configIds = result
      .filter((q) => q.id.endsWith('.someInternalKnob'))
      .map((q) => q.id);
    expect(configIds).toHaveLength(1);
  });

  it('humanizes the key name into a label when the source carries no @label, with no appended "?"', () => {
    const result = generateQuestions([makeCall()], [ecommerceSignature]);
    const navQ = result.find(
      (q) => q.id === 'ProductOrbital.ProductCatalog.navItems',
    );
    expect(navQ?.question).toBe('Nav Items');
  });

  it('renders an authored @label verbatim, with no appended "?" (noun-phrase label)', () => {
    const sig: FactorySignature = {
      ...ecommerceSignature,
      traits: [
        {
          ...ecommerceSignature.traits[0],
          overridableConfigKeys: [
            { key: 'currency', type: 'string', label: 'Currency for prices' },
          ],
        },
      ],
    };
    const result = generateQuestions([makeCall()], [sig]);
    const q = result.find((r) => r.id.endsWith('.currency'));
    expect(q?.question).toBe('Currency for prices');
  });

  it('renders an authored @label that already ends in "?" with exactly one "?"', () => {
    const sig: FactorySignature = {
      ...ecommerceSignature,
      traits: [
        {
          ...ecommerceSignature.traits[0],
          overridableConfigKeys: [
            { key: 'currency', type: 'string', label: 'What currency?' },
          ],
        },
      ],
    };
    const result = generateQuestions([makeCall()], [sig]);
    const q = result.find((r) => r.id.endsWith('.currency'));
    expect(q?.question).toBe('What currency?');
    expect(q?.question?.match(/\?/g)).toHaveLength(1);
  });

  // The trait name a consumer renders for disambiguation comes from the
  // mutation template — the single owner of the question's target
  // coordinates. It is deliberately NOT mirrored onto DomainQuestion.
  it('carries the verbatim trait name on config-key questions', () => {
    const result = generateQuestions([makeCall()], [ecommerceSignature]);
    const navQ = result.find(
      (q) => q.id === 'ProductOrbital.ProductCatalog.navItems',
    );
    expect(navQ?.mutationTemplate).toMatchObject({
      kind: 'set-trait-override-config',
      traitName: 'ProductCatalog',
    });
  });

  it('pre-fills the answer widget from the param default', () => {
    const result = generateQuestions([makeCall()], [ecommerceSignature]);
    const ownerQ = result.find(
      (q) => q.id === 'ProductOrbital.ProductCatalog.ownerField',
    );
    expect(ownerQ?.defaultValue).toBe('ownerId');
  });

  it('filters out config-key params tagged tier: internal', () => {
    const sig: FactorySignature = {
      ...ecommerceSignature,
      traits: [
        {
          ...ecommerceSignature.traits[0],
          overridableConfigKeys: [
            { key: 'auditPrefix', type: 'string', tier: 'internal' },
            { key: 'currency', type: 'string', tier: 'domain' },
          ],
        },
      ],
    };
    const result = generateQuestions([makeCall()], [sig]);
    const ids = result.map((q) => q.id);
    expect(ids).not.toContain('ProductOrbital.ProductCatalog.auditPrefix');
    expect(ids).toContain('ProductOrbital.ProductCatalog.currency');
  });

  it('propagates tier onto the emitted DomainQuestion', () => {
    const sig: FactorySignature = {
      ...ecommerceSignature,
      traits: [
        {
          ...ecommerceSignature.traits[0],
          overridableConfigKeys: [
            { key: 'currency', type: 'string', tier: 'domain' },
            { key: 'placeholder', type: 'string', tier: 'presentation' },
          ],
        },
      ],
    };
    const result = generateQuestions([makeCall()], [sig]);
    const currencyQ = result.find((q) => q.id.endsWith('.currency'));
    const placeholderQ = result.find((q) => q.id.endsWith('.placeholder'));
    expect(currencyQ?.tier).toBe('domain');
    expect(placeholderQ?.tier).toBe('presentation');
  });
});

describe('deriveInputType', () => {
  it('returns text for plain string', () => {
    expect(deriveInputType({ key: 'k', type: 'string' })).toBe('text');
  });

  it('returns number for number / integer', () => {
    expect(deriveInputType({ key: 'k', type: 'number' })).toBe('number');
    expect(deriveInputType({ key: 'k', type: 'integer' })).toBe('number');
  });

  it('returns boolean for boolean', () => {
    expect(deriveInputType({ key: 'k', type: 'boolean' })).toBe('boolean');
  });

  it('returns enum for string with enumValues', () => {
    expect(
      deriveInputType({
        key: 'k',
        type: 'string',
        enumValues: ['a', 'b', 'c'],
      }),
    ).toBe('enum');
  });

  it('returns enum for type=enum', () => {
    expect(deriveInputType({ key: 'k', type: 'enum' })).toBe('enum');
  });

  it('returns listOfObjects for [T] with items.properties', () => {
    expect(
      deriveInputType({
        key: 'navItems',
        type: '[NavItem]',
        items: {
          type: 'object',
          properties: {
            href: { name: 'href', type: 'string' },
            label: { name: 'label', type: 'string' },
          },
        },
      }),
    ).toBe('listOfObjects');
  });

  it('returns multiselect for [string] with enumValues', () => {
    expect(
      deriveInputType({
        key: 'roles',
        type: '[string]',
        enumValues: ['admin', 'editor', 'viewer'],
      }),
    ).toBe('multiselect');
  });

  it('returns tagList for bare [string]', () => {
    expect(deriveInputType({ key: 'tags', type: '[string]' })).toBe('tagList');
  });

  it('returns objectForm for object with properties', () => {
    expect(
      deriveInputType({
        key: 'size',
        type: 'object',
        properties: {
          width: { name: 'width', type: 'number' },
          height: { name: 'height', type: 'number' },
        },
      }),
    ).toBe('objectForm');
  });

  it('falls back to text for unstructured object', () => {
    expect(deriveInputType({ key: 'opaque', type: 'object' })).toBe('text');
  });

  it('falls back to text for unknown type tags', () => {
    expect(deriveInputType({ key: 'k', type: 'WhatIsThis' })).toBe('text');
  });
});

describe('generateQuestions — entity-field question', () => {
  it('emits exactly one multiselect question per call site with a canonical entity', () => {
    const result = generateQuestions([makeCall()], [ecommerceSignature]);
    const entityQs = result.filter((q) => q.id.endsWith('.__entityFields'));
    expect(entityQs).toHaveLength(1);
    expect(entityQs[0].inputType).toBe('multiselect');
  });

  it('gives the entity-field question the correct id', () => {
    const result = generateQuestions([makeCall()], [ecommerceSignature]);
    const q = result.find((q) => q.id.endsWith('.__entityFields'));
    expect(q?.id).toBe('ProductOrbital.__entityFields');
  });

  it('sets mutationTemplate.kind to set-orbital-entity-fields', () => {
    const result = generateQuestions([makeCall()], [ecommerceSignature]);
    const q = result.find((q) => q.id.endsWith('.__entityFields'));
    expect(q?.mutationTemplate.kind).toBe('set-orbital-entity-fields');
  });

  it('sets tier to domain', () => {
    const result = generateQuestions([makeCall()], [ecommerceSignature]);
    const q = result.find((q) => q.id.endsWith('.__entityFields'));
    expect(q?.tier).toBe('domain');
  });

  it('suggestedAnswers lists canonical field names and defaultValue pre-selects all of them', () => {
    const result = generateQuestions([makeCall()], [ecommerceSignature]);
    const q = result.find((q) => q.id.endsWith('.__entityFields'));
    expect(q?.suggestedAnswers).toEqual(['name', 'price']);
    expect(q?.defaultValue).toEqual(['name', 'price']);
  });

  it('fieldCandidates carries EntityField entries keyed by field name', () => {
    const result = generateQuestions([makeCall()], [ecommerceSignature]);
    const q = result.find((q) => q.id.endsWith('.__entityFields'));
    expect(q?.fieldCandidates?.['name']).toMatchObject({ name: 'name', type: 'string' });
    expect(q?.fieldCandidates?.['price']).toMatchObject({ name: 'price', type: 'number' });
  });

  it('emits no entity-field question when the signature has no entities', () => {
    const sig: FactorySignature = { ...ecommerceSignature, entities: [] };
    const result = generateQuestions([makeCall()], [sig]);
    const entityQs = result.filter((q) => q.id.endsWith('.__entityFields'));
    expect(entityQs).toHaveLength(0);
  });

  it('uses the call-site entityName override in the question text', () => {
    const call: FactoryCallSite = {
      ...makeCall(),
      params: { entityName: 'Merchandise' },
    };
    const result = generateQuestions([call], [ecommerceSignature]);
    const q = result.find((q) => q.id.endsWith('.__entityFields'));
    expect(q?.question).toContain('Merchandise');
  });

  it('renders no article and no double space for a PascalCase entity name', () => {
    const call: FactoryCallSite = {
      ...makeCall(),
      params: { entityName: 'ApBill' },
    };
    const result = generateQuestions([call], [ecommerceSignature]);
    const q = result.find((q) => q.id.endsWith('.__entityFields'));
    expect(q?.question).toBe('Fields for ApBill');
    expect(q?.question).not.toMatch(/\ba an?\s/i);
    expect(q?.question).not.toMatch(/ {2,}/);
  });

  it('gives the entity-field question no trait target', () => {
    const result = generateQuestions([makeCall()], [ecommerceSignature]);
    const q = result.find((q) => q.id.endsWith('.__entityFields'));
    expect(q?.mutationTemplate.kind).toBe('set-orbital-entity-fields');
    expect(q?.mutationTemplate).not.toHaveProperty('traitName');
  });
});

describe('generateQuestions — structural carriers', () => {
  it('sets itemSchema on listOfObjects questions', () => {
    const sig: FactorySignature = {
      ...ecommerceSignature,
      traits: [
        {
          ...ecommerceSignature.traits[0],
          overridableConfigKeys: [
            {
              key: 'navItems',
              type: '[NavItem]',
              items: {
                type: 'object',
                properties: {
                  href: { name: 'href', type: 'string' },
                  label: { name: 'label', type: 'string' },
                },
              },
            },
          ],
        },
      ],
    };
    const result = generateQuestions([makeCall()], [sig]);
    const q = result.find((r) => r.id.endsWith('.navItems'));
    expect(q?.inputType).toBe('listOfObjects');
    expect(q?.itemSchema?.properties).toBeDefined();
    expect(Object.keys(q?.itemSchema?.properties ?? {})).toEqual([
      'href',
      'label',
    ]);
  });

  it('sets objectSchema on objectForm questions', () => {
    const sig: FactorySignature = {
      ...ecommerceSignature,
      traits: [
        {
          ...ecommerceSignature.traits[0],
          overridableConfigKeys: [
            {
              key: 'size',
              type: 'object',
              properties: {
                width: { name: 'width', type: 'number' },
                height: { name: 'height', type: 'number' },
              },
            },
          ],
        },
      ],
    };
    const result = generateQuestions([makeCall()], [sig]);
    const q = result.find((r) => r.id.endsWith('.size'));
    expect(q?.inputType).toBe('objectForm');
    expect(q?.objectSchema).toBeDefined();
    expect(Object.keys(q?.objectSchema ?? {})).toEqual(['width', 'height']);
  });
});

// A plan line may hold a catalog orbital under the user's own name (rabit's
// `catalogOrbital`). Its questions — and the mutations that answer them —
// belong to that plan orbital; the signature is still the catalog one.
describe('generateQuestions — a call site under the plan\'s own orbital name', () => {
  it('keys ids and mutations on `orbitalName`, resolving the signature through `orbital`', () => {
    const call: FactoryCallSite = { ...makeCall(), orbitalName: 'CatalogItemOrbital' };
    const result = generateQuestions([call], [ecommerceSignature]);
    const navQ = result.find((q) => q.id === 'CatalogItemOrbital.ProductCatalog.navItems');
    expect(navQ?.orbitalName).toBe('CatalogItemOrbital');
    expect(result.every((q) => q.orbitalName === 'CatalogItemOrbital')).toBe(true);
    expect(result.some((q) => q.id.startsWith('ProductOrbital.'))).toBe(false);
  });

  it('two plan orbitals from one catalog orbital get distinct questions', () => {
    const a: FactoryCallSite = { ...makeCall(), orbitalName: 'WorkoutLogOrbital' };
    const b: FactoryCallSite = { ...makeCall(), orbitalName: 'FitnessGoalOrbital' };
    const ids = generateQuestions([a, b], [ecommerceSignature]).map((q) => q.id);
    expect(ids).toContain('WorkoutLogOrbital.ProductCatalog.navItems');
    expect(ids).toContain('FitnessGoalOrbital.ProductCatalog.navItems');
  });
});
