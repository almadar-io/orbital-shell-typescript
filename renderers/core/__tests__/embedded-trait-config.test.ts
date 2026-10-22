/**
 * Coverage of `buildResolvedTraitConfigs` forward chaining — in particular
 * the deep-resolution fix: a `@config.<key>` forward nested inside an array
 * or object value (a service wrapper atom's `ComposerSlot { children:
 * [@config.uiTrait] }`) must chain to the embedder's config exactly like a
 * top-level string forward. Pre-fix only top-level strings were chained, so
 * the vessel's `children` kept the literal string and the standalone
 * default form never rendered (blank boot).
 */

import { describe, it, expect } from 'vitest';
import { buildResolvedTraitConfigs, collectForwardedConfigKeys, traitDeclaresConfigForward } from '../src/embedded-trait-config.js';
import type { DeclaredTraitConfig, OrbitalSchema, Trait } from '../src/types/index.js';

const noteEntity = { name: 'Note', persistence: 'runtime' as const, fields: [{ name: 'id', type: 'string' as const, required: true }] };
const emptyStateMachine = { states: [], events: [] };

// Host embeds Slot via `@trait.Slot` in its state machine; Slot forwards
// `@config.uiTrait` from inside a children array.
const schema: OrbitalSchema = {
  name: 'ServiceEmailApp',
  designTokens: {},
  customPatterns: {},
  orbitals: [
    {
      name: 'ServiceEmailOrbital',
      entity: noteEntity,
      pages: [],
      traits: [
        {
          name: 'Host',
          scope: 'instance',
          config: {
            uiTrait: { type: 'string', default: 'DefaultForm' },
            title: { type: 'string', default: 'Send' },
          },
          stateMachine: {
            ...emptyStateMachine,
            transitions: [
              {
                from: 'idle',
                event: 'INIT',
                to: 'idle',
                effects: [['render-ui', 'main', { children: ['@trait.Slot'], type: 'box' }]],
              },
            ],
          },
        },
        {
          name: 'Slot',
          scope: 'instance',
          config: {
            children: { type: 'array', default: ['@config.uiTrait'] },
            gap: { type: 'string', default: 'md' },
            nested: { type: 'object', default: { label: '@config.title', keep: '@config.absent' } },
            plain: { type: 'string', default: '@config.title' },
          },
          stateMachine: { ...emptyStateMachine, transitions: [] },
        },
      ],
    },
  ],
};

describe('buildResolvedTraitConfigs — deep forward chaining', () => {
  const resolved = buildResolvedTraitConfigs(schema);

  it('chains a forward nested inside an array (the ComposerSlot shape)', () => {
    expect(resolved['Slot'].children).toEqual(['DefaultForm']);
  });

  it('chains a forward nested inside an object', () => {
    expect((resolved['Slot'].nested as Record<string, unknown>).label).toBe('Send');
  });

  it('still chains top-level string forwards', () => {
    expect(resolved['Slot'].plain).toBe('Send');
  });

  it('keeps the literal when the referrer lacks the key', () => {
    expect((resolved['Slot'].nested as Record<string, unknown>).keep).toBe('@config.absent');
  });

  it('leaves non-forward values untouched', () => {
    expect(resolved['Slot'].gap).toBe('md');
    expect(resolved['Host'].uiTrait).toBe('DefaultForm');
  });
});

// W2-J1: two rungs below the referrer chain — the trait's owning orbital's
// declared `config {}` defaults, then the schema's. Each rung only fires on
// a key the previous rung left as a literal `@config.<key>` forward.
describe('buildResolvedTraitConfigs — orbital + schema config rungs', () => {
  it('forwards to orbital.config when no referrer declares the knob', () => {
    const orbitalConfigSchema: OrbitalSchema = {
      name: 'OrbitalConfigApp',
      designTokens: {},
      customPatterns: {},
      orbitals: [
        {
          name: 'Orb',
          entity: noteEntity,
          pages: [],
          config: { title: { type: 'string', default: 'FromOrbital' } },
          traits: [
            {
              name: 'Lone',
              scope: 'instance',
              config: { plain: { type: 'string', default: '@config.title' } },
              stateMachine: { ...emptyStateMachine, transitions: [] },
            },
          ],
        },
      ],
    };

    const resolved = buildResolvedTraitConfigs(orbitalConfigSchema);
    expect(resolved['Lone'].plain).toBe('FromOrbital');
  });

  it('falls to schema.config when neither trait nor orbital declares the knob', () => {
    const schemaConfigSchema: OrbitalSchema = {
      name: 'SchemaConfigApp',
      designTokens: {},
      customPatterns: {},
      config: { title: { type: 'string', default: 'FromSchema' } },
      orbitals: [
        {
          name: 'Orb',
          entity: noteEntity,
          pages: [],
          traits: [
            {
              name: 'Lone',
              scope: 'instance',
              config: { plain: { type: 'string', default: '@config.title' } },
              stateMachine: { ...emptyStateMachine, transitions: [] },
            },
          ],
        },
      ],
    };

    const resolved = buildResolvedTraitConfigs(schemaConfigSchema);
    expect(resolved['Lone'].plain).toBe('FromSchema');
  });

  it('embedder rung still wins over orbital.config and schema.config', () => {
    const layeredSchema: OrbitalSchema = {
      name: 'LayeredConfigApp',
      designTokens: {},
      customPatterns: {},
      config: { title: { type: 'string', default: 'FromSchema' } },
      orbitals: [
        {
          name: 'Orb',
          entity: noteEntity,
          pages: [],
          config: { title: { type: 'string', default: 'FromOrbital' } },
          traits: [
            {
              name: 'Host',
              scope: 'instance',
              config: { title: { type: 'string', default: 'FromEmbedder' } },
              stateMachine: {
                ...emptyStateMachine,
                transitions: [
                  {
                    from: 'idle',
                    event: 'INIT',
                    to: 'idle',
                    effects: [['render-ui', 'main', { children: ['@trait.Slot'], type: 'box' }]],
                  },
                ],
              },
            },
            {
              name: 'Slot',
              scope: 'instance',
              config: { plain: { type: 'string', default: '@config.title' } },
              stateMachine: { ...emptyStateMachine, transitions: [] },
            },
          ],
        },
      ],
    };

    const resolved = buildResolvedTraitConfigs(layeredSchema);
    expect(resolved['Slot'].plain).toBe('FromEmbedder');
  });
});

// G-CROSS-024: a knob read nested in a call-site config value is forwarded,
// both before the resolver folds the token and after (`nestedForwardedFrom`).
describe('collectForwardedConfigKeys — nested reads', () => {
  const trait = (config: DeclaredTraitConfig): Trait => ({ name: 'WeeklyStats', scope: 'instance', linkedEntity: 'Note', stateMachine: { states: [], events: [], transitions: [] }, config });

  it('publishes a knob whose token sits inside an array element', () => {
    const traits = [trait({ metrics: { type: 'array', default: [{ label: 'Wins', target: '@config.weeklyWinTarget' }] } })];
    expect([...collectForwardedConfigKeys(traits)]).toEqual(['weeklyWinTarget']);
  });

  it('publishes a folded nested read from its provenance', () => {
    const traits = [trait({ metrics: { type: 'array', default: [{ target: 2 }], nestedForwardedFrom: ['@config.weeklyWinTarget'] } })];
    expect([...collectForwardedConfigKeys(traits)]).toEqual(['weeklyWinTarget']);
  });

  it('control: a dotted nested path publishes nothing', () => {
    const traits = [trait({ metrics: { type: 'array', default: [{ max: '@config.limits.max' }] } })];
    expect(collectForwardedConfigKeys(traits).size).toBe(0);
  });
});

// Twin of `config_type.rs` `trait_config_declares_forward`: a whole-default
// forward or a nested token naming a knob the trait does NOT declare is a
// forward; a nested read of its own knob is not.
describe('traitDeclaresConfigForward — own-knob reads', () => {
  const trait = (config: DeclaredTraitConfig): Trait => ({ name: 'Child', scope: 'instance', stateMachine: { states: [], events: [], transitions: [] }, config });

  it('a whole-default forward is a forward, even under its own name', () => {
    expect(traitDeclaresConfigForward(trait({ title: { type: 'string', default: '@config.title' } }))).toBe(true);
  });

  it('control: a nested read of an own knob is not a forward', () => {
    expect(traitDeclaresConfigForward(trait({
      title: { type: 'string', default: 'Stats' },
      body: { type: 'unknown', default: { type: 'typography', content: '@config.title' } },
    }))).toBe(false);
  });

  it('edge: a nested token naming an undeclared knob is a forward', () => {
    expect(traitDeclaresConfigForward(trait({ body: { type: 'unknown', default: { content: '@config.heading' } } }))).toBe(true);
  });
});
