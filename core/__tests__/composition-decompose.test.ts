/**
 * The L3 palette comes from real organisms broken into their parts: each organism orbital's
 * trait references (aliases and lowered inline embeds) become ready CompositionBlocks, and a
 * block's contract comes from the atom's own registry trait.
 */
import { describe, expect, it } from 'vitest';
import { blockContractOf, decomposeOrbital } from '../src/factory/composition.js';
import type { OrbitalDefinition, Trait } from '../src/types/index.js';

const browseTrait: Trait = {
  name: 'BrowseItemBrowse',
  scope: 'collection',
  entityRebindable: true,
  config: { browseLook: { type: 'string', default: 'table' }, emptyTitle: { type: 'string', default: '' } },
  emits: [{ event: 'VIEW', scope: 'internal' }, { event: 'EDIT', scope: 'internal' }],
  listens: [{ event: 'SAVED', triggers: 'INIT', source: { kind: 'trait', trait: 'Rules' } }],
  stateMachine: {
    states: [{ name: 'browsing', isInitial: true }],
    events: [{ key: 'INIT', name: 'Init' }, { key: 'REFETCH', name: 'Refetch' }],
    transitions: [
      { from: 'browsing', to: 'browsing', event: 'INIT', effects: [] },
      { from: 'browsing', to: 'browsing', event: 'REFETCH', effects: [] },
      { from: 'browsing', to: 'browsing', event: 'INIT', effects: [] },
    ],
  },
};

describe('blockContractOf', () => {
  it('reads knobs, emitted events, handled triggers, listens and rebindability off the trait', () => {
    expect(blockContractOf(browseTrait)).toEqual({
      configKeys: ['browseLook', 'emptyTitle'],
      declaredConfig: browseTrait.config,
      emits: ['VIEW', 'EDIT'],
      triggers: ['INIT', 'REFETCH'],
      listens: browseTrait.listens,
      entityRebindable: true,
      setsFields: [],
    });
  });

  it('control: a fixed-binding trait with no knobs, emits or listens', () => {
    expect(blockContractOf({ name: 'Bare', scope: 'instance' })).toEqual({
      configKeys: [],
      emits: [],
      triggers: [],
      listens: [],
      entityRebindable: false,
      setsFields: [],
    });
  });
});

const organismOrbital: OrbitalDefinition = {
  name: 'CartOrbital',
  uses: [
    { from: 'std/behaviors/std-browse', as: 'Browse' },
    { from: 'std/behaviors/ui-typography', as: 'Typography' },
  ],
  entity: { name: 'CartItem', fields: [{ name: 'id', type: 'string' }] },
  traits: [
    {
      ref: 'Browse.traits.BrowseItemBrowse',
      name: 'CartLines',
      linkedEntity: 'CartItem',
      config: { browseLook: { type: 'unknown', default: 'feed' }, emptyTitle: 'Your cart is empty' },
    },
    { ref: 'Typography.traits.TypographyRender', name: 'InlineTypographyRender1', config: { content: 'Your cart', variant: 'h1' } },
    { ref: 'Ghost.traits.Nope', name: 'Orphan' },
    { name: 'CartView', scope: 'instance', linkedEntity: 'CartItem' },
  ],
  pages: [],
};

describe('decomposeOrbital', () => {
  it('turns every trait reference with a known alias into a block, with its call-site config unwrapped', () => {
    expect(decomposeOrbital(organismOrbital)).toEqual([
      {
        name: 'CartLines',
        from: 'std/behaviors/std-browse',
        as: 'Browse',
        trait: 'BrowseItemBrowse',
        linkedEntity: 'CartItem',
        config: { browseLook: 'feed', emptyTitle: 'Your cart is empty' },
      },
      {
        name: 'InlineTypographyRender1',
        from: 'std/behaviors/ui-typography',
        as: 'Typography',
        trait: 'TypographyRender',
        config: { content: 'Your cart', variant: 'h1' },
      },
    ]);
  });

  it('control: inline traits and references to an alias the orbital does not use are not blocks', () => {
    const names = decomposeOrbital(organismOrbital).map((b) => b.name);
    expect(names).not.toContain('CartView');
    expect(names).not.toContain('Orphan');
  });
});

describe('blockContractOf — entity fields a block writes', () => {
  const trait: Trait = {
    name: 'Feed',
    scope: 'instance',
    stateMachine: {
      states: [{ name: 'idle', isInitial: true }],
      events: [{ key: 'INIT', name: 'Init' }, { key: 'OPEN', name: 'Open' }],
      transitions: [
        { from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'stack', children: [{ type: 'typography', content: '@entity.name' }, { type: 'typography', content: '@entity.openId' }] }]] },
        { from: 'idle', to: 'idle', event: 'OPEN', effects: [['set', '@entity.selectedId', '@payload.id']] },
      ],
    },
  };

  it('a `set @entity.<field>` effect is a write; a render read is not', () => {
    expect(blockContractOf(trait).setsFields).toEqual(['selectedId']);
  });

  it('a set nested in a control form is found', () => {
    const nested: Trait = { ...trait, stateMachine: { ...trait.stateMachine!, transitions: [{ from: 'idle', to: 'idle', event: 'OPEN', effects: [['do', ['set', '@entity.openId', '@payload.id']]] }] } };
    expect(blockContractOf(nested).setsFields).toEqual(['openId']);
  });

  it('control: a trait with no state machine reads and writes nothing', () => {
    expect(blockContractOf({ name: 'Bare', scope: 'instance' }).setsFields).toEqual([]);
  });
});

describe('blockContractOf — a trait with no declared binding is bound to its orbital\'s record', () => {
  it('an unbound trait takes the orbital\'s primary record, fixed', () => {
    expect(blockContractOf({ name: 'ListingCatalog', scope: 'instance' }, 'Listing')).toMatchObject({ linkedEntity: 'Listing', entityRebindable: false });
  });

  it('control: a declared binding wins over the orbital\'s record', () => {
    expect(blockContractOf({ name: 'Tags', scope: 'instance', linkedEntity: 'Tag' }, 'Listing').linkedEntity).toBe('Tag');
  });

  it('control: with no orbital record given, nothing is assumed', () => {
    expect(blockContractOf({ name: 'Bare', scope: 'instance' }).linkedEntity).toBeUndefined();
  });
});
