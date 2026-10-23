/**
 * buildTraitIndex — the shared per-trait evaluation index: cross-orbital
 * linkedEntity resolution, config merge precedence, frame keys, V4 ids.
 */
import { describe, it, expect } from 'vitest';
import { buildTraitIndex } from '../../src/runtime/traits/trait-index.js';
import type { OrbitalDefinition, Trait } from '@almadar/core';

const trait = (name: string, extra: Partial<Trait> = {}): Trait =>
  ({
    name,
    stateMachine: {
      states: [{ name: 'idle', isInitial: true }],
      transitions: [],
      events: [],
    },
    ...extra,
  }) as Trait;

const orbital = (name: string, o: Partial<OrbitalDefinition> = {}): OrbitalDefinition =>
  ({
    name,
    entity: { name: `${name}Entity`, fields: [] },
    traits: [],
    ...o,
  }) as OrbitalDefinition;

describe('buildTraitIndex', () => {
  it('indexes traits with host entity, orbital name, and per-trait frame keys', () => {
    const idx = buildTraitIndex([
      orbital('App', {
        entity: { name: 'Note', fields: [], persistence: 'runtime' },
        traits: [trait('Composer'), trait('Viewer')],
      }),
    ]);
    expect(idx.byName.size).toBe(2);
    const composer = idx.byName.get('Composer');
    expect(composer?.entity.name).toBe('Note');
    expect(composer?.orbitalName).toBe('App');
    expect(composer?.frameKey).toBe('Composer');
    expect(composer?.isSharedEntity).toBe(false);
  });

  it('resolves a cross-orbital linkedEntity against every orbital (primary + auxiliary)', () => {
    const idx = buildTraitIndex([
      orbital('Chat', {
        entity: { name: 'ChatChannel', fields: [] },
        traits: [trait('ChannelRail', { linkedEntity: 'ChannelMember' })],
      }),
      orbital('Directory', {
        entity: { name: 'ChannelMember', fields: [], shared: true },
        auxiliaryEntities: [{ name: 'MemberBadge', fields: [] }],
        traits: [trait('BadgeList', { linkedEntity: 'MemberBadge' })],
      }),
    ]);
    const rail = idx.byName.get('ChannelRail');
    expect(rail?.entity.name).toBe('ChannelMember');
    // The shared flag travels with the DECLARATION, wherever it lives.
    expect(rail?.isSharedEntity).toBe(true);
    expect(rail?.frameKey).toBe('$shared::ChannelMember');
    const badge = idx.byName.get('BadgeList');
    expect(badge?.entity.name).toBe('MemberBadge');
    expect(badge?.frameKey).toBe('BadgeList');
    expect(idx.allEntities.map((e) => e.name)).toEqual(
      expect.arrayContaining(['ChatChannel', 'ChannelMember', 'MemberBadge']),
    );
  });

  it('stubs + warns for a genuinely unresolvable linkedEntity', () => {
    const idx = buildTraitIndex([
      orbital('App', {
        entity: { name: 'E', fields: [] },
        traits: [trait('Broken', { linkedEntity: 'Nowhere' })],
      }),
    ]);
    expect(idx.byName.get('Broken')?.entity).toEqual({ name: 'Nowhere', fields: [] });
  });

  it('carries the host orbital V4 id for emit stamping', () => {
    const idx = buildTraitIndex([
      orbital('App', { id: 'orb_1', entity: { name: 'E', fields: [] }, traits: [trait('T')] } as never),
    ]);
    expect(idx.byName.get('T')?.orbitalId).toBe('orb_1');
  });
});
