import { describe, it, expect } from 'vitest';
import { parseOrbitalSchema } from '../src/types/schema.js';

/**
 * `TraitSchema` is a non-strict `z.object()`, so an undeclared key is not
 * rejected — it is SILENTLY DELETED, and every consumer reading through
 * `parseOrbitalSchema` or a loader sees the field as absent while the schema
 * reports success. That is the failure this file exists to catch: it already
 * cost `id`, `listens`, `effects` and more on trait refs once.
 */
describe('trait effectRow', () => {
  const traitWith = (effectRow?: unknown) => ({
    name: 'BoardPlay',
    linkedEntity: 'Board',
    scope: 'instance' as const,
    stateMachine: {
      states: [{ name: 'idle', isInitial: true }],
      events: [{ key: 'INIT', name: 'INIT' }],
      transitions: [
        { event: 'INIT', from: 'idle', to: 'idle', effects: [['render-ui', 'main', { type: 'box' }]] },
      ],
    },
    ...(effectRow === undefined ? {} : { effectRow }),
  });

  const schemaWith = (effectRow?: unknown) => ({
    name: 'BoardApp',
    orbitals: [
      {
        name: 'BoardOrbital',
        entity: { name: 'Board', fields: [{ name: 'id', type: 'string', required: true }] },
        traits: [traitWith(effectRow)],
        pages: [],
      },
    ],
  });

  it('survives parseOrbitalSchema round-trip (zod must not strip it)', () => {
    const row = [
      { kind: 'render-ui', resource: 'main' },
      { kind: 'render-ui', resource: 'main', site: 'tick' },
      { kind: 'ticks', site: 'tick' },
    ];
    const parsed = parseOrbitalSchema(schemaWith(row));
    expect(parsed.orbitals[0]?.traits[0]).toMatchObject({ effectRow: row });
  });

  it('keeps an unresolved resource flagged rather than dropping the flag', () => {
    // A slot a call site still has to supply must never come back looking like a
    // literal — that would make it compare equal to a real slot name.
    const row = [{ kind: 'render-ui', resource: '@config.surface', resolved: false }];
    const parsed = parseOrbitalSchema(schemaWith(row));
    const trait = parsed.orbitals[0]?.traits[0] as { effectRow?: typeof row };
    expect(trait.effectRow?.[0]?.resolved).toBe(false);
    expect(trait.effectRow?.[0]?.resource).toBe('@config.surface');
  });

  it('is absent on a trait that produces no effects', () => {
    const parsed = parseOrbitalSchema(schemaWith(undefined));
    const trait = parsed.orbitals[0]?.traits[0] as { effectRow?: unknown };
    expect(trait.effectRow).toBeUndefined();
  });
});
