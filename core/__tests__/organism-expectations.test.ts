import { describe, it, expect } from 'vitest';
import { OrganismExpectationsSchema, BehaviorDescriptionSchema } from '../index';

describe('orb behaviors expects output', () => {
  const printed = {
    DeskOrbital: {
      expectations: [
        { kind: 'entity', name: 'Order', shape: [{ name: 'total', type: 'number' }] },
        { kind: 'event', traitName: 'OrderFeed', event: 'ORDER_PLACED' },
      ],
      diagnostics: [{ kind: 'event-source-unknown', orbital: 'DeskOrbital', field: 'Gone.Feed.X' }],
    },
    OrderOrbital: { expectations: [], diagnostics: [] },
  };

  it('parses every orbital with its expectations and diagnostics', () => {
    const parsed = OrganismExpectationsSchema.parse(printed);
    expect(parsed.DeskOrbital?.expectations).toHaveLength(2);
    expect(parsed.DeskOrbital?.diagnostics[0]?.kind).toBe('event-source-unknown');
  });

  it('control: an unknown diagnostic kind or a malformed expectation is refused', () => {
    expect(OrganismExpectationsSchema.safeParse({ X: { expectations: [], diagnostics: [{ kind: 'guess', orbital: 'X' }] } }).success).toBe(false);
    expect(OrganismExpectationsSchema.safeParse({ X: { expectations: [{ kind: 'entity' }], diagnostics: [] } }).success).toBe(false);
  });
});

describe('describe carries each orbital\'s derived expectations', () => {
  const orbital = { value: { behavior: './orbitals/shop', orbital: 'DeskOrbital' }, config: {}, knobs: [], borrows: [], traits: [], pages: [] };

  it('parses expects next to borrows', () => {
    const parsed = BehaviorDescriptionSchema.parse({ behavior: './orbitals/shop', config: {}, knobs: [], orbitals: [{ ...orbital, expects: [{ kind: 'page', path: '/orders/:id' }] }] });
    expect(parsed.orbitals[0]?.expects).toEqual([{ kind: 'page', path: '/orders/:id' }]);
  });

  it('control: an orbital without expects is refused', () => {
    expect(BehaviorDescriptionSchema.safeParse({ behavior: './orbitals/shop', config: {}, knobs: [], orbitals: [orbital] }).success).toBe(false);
  });
});
