/**
 * L3 composition factory: a typed CompositionSpec (blocks + layout + wiring + entity) is
 * checked against each block's declared contract and assembled deterministically into an
 * orbital from the existing builders — no .lolo authored.
 */
import { describe, expect, it } from 'vitest';
import {
  assembleComposition,
  checkComposition,
  compositionSpecOf,
  bindsRecord,
  followEventName,
  resolveBlockContract,
  type CompositionBlockContract,
  type CompositionContext,
  type CompositionSpec,
} from '../src/factory/composition.js';
import { isInlineTrait } from '../src/types/index.js';
import type { OrbitalDefinition, TraitRef } from '../src/types/index.js';

const BROWSE: CompositionBlockContract = {
  configKeys: ['browseLook', 'fields', 'emptyTitle'],
  emits: ['VIEW'],
  triggers: ['INIT', 'REFETCH'],
  listens: [{ event: 'SAVED', triggers: 'INIT', source: { kind: 'trait', trait: 'Rules' } }],
  entityRebindable: true,
};
const COMPOSER: CompositionBlockContract = {
  configKeys: ['placeholder'],
  emits: ['MESSAGE_SENT'],
  triggers: ['INIT', 'SEND'],
  listens: [],
  entityRebindable: false,
};

const FORM: CompositionBlockContract = {
  configKeys: ['submitEvent', 'cancelEvent'],
  declaredConfig: { submitEvent: { type: 'event', default: 'SUBMIT' }, cancelEvent: { type: 'event' } },
  emits: ['@config.submitEvent', '@config.cancelEvent'],
  triggers: ['INIT'],
  listens: [{ event: '@config.submitEvent', triggers: 'INIT', source: { kind: 'trait', trait: 'Rules' } }],
  entityRebindable: false,
};

const ctx: CompositionContext = {
  block: (from, trait) =>
    from === 'std/behaviors/std-browse' && trait === 'BrowseItemBrowse'
      ? BROWSE
      : from === 'std/behaviors/std-thread' && trait === 'ThreadComposer'
        ? COMPOSER
        : from === 'std/behaviors/ui-form' && trait === 'FormSection'
          ? FORM
          : null,
};

function spec(over: Partial<CompositionSpec> = {}): CompositionSpec {
  return {
    orbital: 'ChatPage',
    entity: {
      kind: 'declare',
      entity: { name: 'Message', persistence: 'persistent', collection: 'messages', fields: [{ name: 'body', type: 'string' }] },
    },
    blocks: [
      { name: 'Messages', from: 'std/behaviors/std-browse', as: 'Browse', trait: 'BrowseItemBrowse', config: { browseLook: 'feed' } },
      { name: 'Composer', from: 'std/behaviors/std-thread', as: 'Thread', trait: 'ThreadComposer', config: { placeholder: 'Ask us anything' } },
    ],
    layout: { kind: 'stack', direction: 'vertical', children: [{ kind: 'block', block: 'Messages' }, { kind: 'block', block: 'Composer' }] },
    wiring: [{ fromBlock: 'Composer', event: 'MESSAGE_SENT', toBlock: 'Messages', trigger: 'REFETCH' }],
    page: { name: 'ChatPage', path: '/chat' },
    ...over,
  };
}

function traitRef(traits: OrbitalDefinition['traits'], name: string): TraitRef | undefined {
  return traits.find((t) => typeof t !== 'string' && !isInlineTrait(t) && t.name === name);
}

describe('checkComposition', () => {
  it('a well-formed spec has no issues', () => {
    expect(checkComposition(spec(), ctx)).toEqual([]);
  });

  it('a block the palette does not declare is refused', () => {
    const issues = checkComposition(spec({ blocks: [...spec().blocks, { name: 'X', from: 'std/behaviors/std-nope', as: 'Nope', trait: 'Nope' }] }), ctx);
    expect(issues.map((i) => i.code)).toContain('unknown-block');
  });

  it('a config key the block does not declare is refused', () => {
    const issues = checkComposition(spec({ blocks: [{ ...spec().blocks[0]!, config: { colour: 'red' } }, spec().blocks[1]!] }), ctx);
    expect(issues).toEqual([expect.objectContaining({ code: 'unknown-config-key', path: 'blocks.Messages.config.colour' })]);
  });

  it('wiring an event the source block does not emit is refused', () => {
    const issues = checkComposition(spec({ wiring: [{ fromBlock: 'Composer', event: 'NOPE', toBlock: 'Messages', trigger: 'REFETCH' }] }), ctx);
    expect(issues.map((i) => i.code)).toEqual(['unknown-event']);
  });

  it('wiring to a trigger the target block cannot handle is refused', () => {
    const issues = checkComposition(spec({ wiring: [{ fromBlock: 'Composer', event: 'MESSAGE_SENT', toBlock: 'Messages', trigger: 'NOPE' }] }), ctx);
    expect(issues.map((i) => i.code)).toEqual(['unknown-trigger']);
  });

  it('a layout slot naming no block is refused, and a block left out of the layout too', () => {
    const issues = checkComposition(spec({ layout: { kind: 'stack', children: [{ kind: 'block', block: 'Ghost' }] } }), ctx);
    expect(issues.map((i) => i.code).sort()).toEqual(['layout-unknown-block', 'unplaced-block', 'unplaced-block']);
  });

  it('rebinding a block that is not rebindable is refused', () => {
    const issues = checkComposition(spec({ blocks: [spec().blocks[0]!, { ...spec().blocks[1]!, linkedEntity: 'Message' }] }), ctx);
    expect(issues.map((i) => i.code)).toEqual(['not-rebindable']);
  });

  it('a persistent declared entity without a collection is refused', () => {
    const issues = checkComposition(spec({ entity: { kind: 'declare', entity: { name: 'Message', persistence: 'persistent', fields: [] } } }), ctx);
    expect(issues).toEqual([expect.objectContaining({ code: 'missing-collection', path: 'entity.collection' })]);
  });

  it('control: a runtime declared entity needs no collection', () => {
    expect(checkComposition(spec({ entity: { kind: 'declare', entity: { name: 'Message', persistence: 'runtime', fields: [] } } }), ctx)).toEqual([]);
  });

  it('two blocks with one name are refused', () => {
    const issues = checkComposition(spec({ blocks: [spec().blocks[0]!, { ...spec().blocks[1]!, name: 'Messages' }] }), ctx);
    expect(issues.map((i) => i.code)).toContain('duplicate-name');
  });
});

describe('assembleComposition', () => {
  it('declared entity: uses, block trait refs, a view trait with block slots, one page', () => {
    const out = assembleComposition(spec(), ctx);
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    const o = out.orbital;
    expect(o.uses).toEqual([
      { from: 'std/behaviors/std-browse', as: 'Browse' },
      { from: 'std/behaviors/std-thread', as: 'Thread' },
    ]);
    // Call-site config in its lowered wire form (what `.lolo` lowering emits for `config { k: v }`).
    expect(traitRef(o.traits, 'Messages')).toMatchObject({ ref: 'Browse.traits.BrowseItemBrowse', config: { browseLook: { type: 'unknown', default: 'feed' } } });
    expect(traitRef(o.traits, 'Composer')).toMatchObject({ ref: 'Thread.traits.ThreadComposer', config: { placeholder: { type: 'unknown', default: 'Ask us anything' } } });
    expect(JSON.stringify(o.traits)).toContain('"@trait.Messages"');
    expect(JSON.stringify(o.traits)).toContain('"@trait.Composer"');
    expect(o.pages).toEqual([{ name: 'ChatPage', path: '/chat', traits: [{ ref: 'ChatPageView' }] }]);
  });

  it('a wired target restates its own listens and adds the wire (a ref listens replaces the set)', () => {
    const out = assembleComposition(spec(), ctx);
    if (!out.ok) throw new Error('assembly failed');
    expect(traitRef(out.orbital.traits, 'Messages')).toMatchObject({
      listens: [...BROWSE.listens, { event: 'MESSAGE_SENT', triggers: 'REFETCH', source: { kind: 'trait', trait: 'Composer' } }],
    });
  });

  it('control: an unwired block keeps its atom listens untouched (no listens override)', () => {
    const out = assembleComposition(spec(), ctx);
    if (!out.ok) throw new Error('assembly failed');
    expect(traitRef(out.orbital.traits, 'Composer')).not.toHaveProperty('listens');
  });

  it('a rebindable block binds the composition entity', () => {
    const out = assembleComposition(spec(), ctx);
    if (!out.ok) throw new Error('assembly failed');
    expect(traitRef(out.orbital.traits, 'Messages')).toMatchObject({ linkedEntity: 'Message' });
    expect(traitRef(out.orbital.traits, 'Composer')).not.toHaveProperty('linkedEntity');
  });

  it('rules import: the orbital imports the rules atom, remaps its page and mounts the view', () => {
    const out = assembleComposition(
      spec({
        entity: { kind: 'import', from: 'almadar-behaviors/std-product', as: 'Product', orbital: 'ProductOrbital', entity: 'Product', page: '/products', only: ['ProductRules'] },
        blocks: [spec().blocks[0]!],
        layout: { kind: 'stack', children: [{ kind: 'block', block: 'Messages' }] },
        wiring: [],
      }),
      ctx,
    );
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    const o = out.orbital;
    expect(o.entity).toBe('Product.orbitals.ProductOrbital.entity');
    expect(o.reference).toEqual({
      ref: 'Product.orbitals.ProductOrbital',
      entity: 'Product',
      only: ['ProductRules'],
      pages: { '/products': '/chat' },
      mounts: { '/products': ['ChatPageView'] },
    });
    expect(o.uses?.[0]).toEqual({ from: 'almadar-behaviors/std-product', as: 'Product' });
    expect(o.pages).toEqual([]);
  });

  it('an invalid spec is not assembled', () => {
    const out = assembleComposition(spec({ wiring: [{ fromBlock: 'Composer', event: 'NOPE', toBlock: 'Messages', trigger: 'REFETCH' }] }), ctx);
    expect(out.ok).toBe(false);
  });
});

describe('config-named events (`emits @config.submitEvent`)', () => {
  const formBlock = { name: 'LineForm', from: 'std/behaviors/ui-form', as: 'Form', trait: 'FormSection', config: { submitEvent: 'ADD_LINE' } };
  const withForm = (wire: { event: string }, config?: Record<string, string>) =>
    spec({
      blocks: [spec().blocks[0]!, { ...formBlock, ...(config !== undefined ? { config } : {}) }],
      layout: { kind: 'stack', children: [{ kind: 'block', block: 'Messages' }, { kind: 'block', block: 'LineForm' }] },
      wiring: [{ fromBlock: 'LineForm', event: wire.event, toBlock: 'Messages', trigger: 'REFETCH' }],
    });

  it('resolveBlockContract resolves a knob-named event to the call-site value', () => {
    const r = resolveBlockContract(FORM, { submitEvent: 'ADD_LINE' });
    expect(r.contract.emits).toContain('ADD_LINE');
    expect(r.contract.listens[0]).toMatchObject({ event: 'ADD_LINE' });
  });

  it('falls back to the declared default when the call site sets no value', () => {
    expect(resolveBlockContract(FORM, undefined).contract.emits).toContain('SUBMIT');
  });

  it('a knob with no default and no value stays unresolved and is reported', () => {
    const r = resolveBlockContract(FORM, undefined);
    expect(r.unresolved).toEqual(['@config.cancelEvent']);
    expect(r.contract.emits).not.toContain('@config.cancelEvent');
  });

  it('a wire on the resolved event name checks clean and is written resolved', () => {
    const s = withForm({ event: 'ADD_LINE' });
    expect(checkComposition(s, ctx)).toEqual([]);
    const out = assembleComposition(s, ctx);
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    expect(traitRef(out.orbital.traits, 'Messages')).toMatchObject({
      listens: expect.arrayContaining([{ event: 'ADD_LINE', triggers: 'REFETCH', source: { kind: 'trait', trait: 'LineForm' } }]),
    });
  });

  it('control: wiring the raw knob reference is refused and the message names the resolved event', () => {
    const issues = checkComposition(withForm({ event: '@config.submitEvent' }), ctx);
    expect(issues).toEqual([expect.objectContaining({ code: 'unknown-event' })]);
    expect(issues[0]?.message).toContain('ADD_LINE');
  });

  it('a restated atom listen is written with its event resolved', () => {
    const s = spec({
      blocks: [{ ...formBlock }, spec().blocks[1]!],
      layout: { kind: 'stack', children: [{ kind: 'block', block: 'LineForm' }, { kind: 'block', block: 'Composer' }] },
      wiring: [{ fromBlock: 'Composer', event: 'MESSAGE_SENT', toBlock: 'LineForm', trigger: 'INIT' }],
    });
    const out = assembleComposition(s, ctx);
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    expect(traitRef(out.orbital.traits, 'LineForm')).toMatchObject({
      listens: [expect.objectContaining({ event: 'ADD_LINE', triggers: 'INIT' }), expect.objectContaining({ event: 'MESSAGE_SENT' })],
    });
  });
});

describe('followEventName — an event named under the example config, followed to the block\'s own config', () => {
  const RELAY: CompositionBlockContract = {
    configKeys: ['onEvent'],
    declaredConfig: { onEvent: { type: 'event', default: 'RUN' } },
    emits: [],
    triggers: ['@config.onEvent'],
    listens: [],
    entityRebindable: false,
  };

  it('a knob-named emit the block renames is followed to its new name', () => {
    expect(followEventName(FORM, 'emits', 'CREATE', { submitEvent: 'CREATE' }, { submitEvent: 'CHECKOUT_STARTED' })).toEqual({ ok: true, value: 'CHECKOUT_STARTED' });
  });

  it('a knob the block leaves unset falls to its declared default', () => {
    expect(followEventName(FORM, 'emits', 'CREATE', { submitEvent: 'CREATE' }, undefined)).toEqual({ ok: true, value: 'SUBMIT' });
  });

  it('a knob-named trigger is followed the same way', () => {
    expect(followEventName(RELAY, 'triggers', 'GO', { onEvent: 'GO' }, { onEvent: 'START' })).toEqual({ ok: true, value: 'START' });
  });

  it('control: a literal event keeps its name whatever the config', () => {
    expect(followEventName(BROWSE, 'emits', 'VIEW', { browseLook: 'cards' }, { browseLook: 'table' })).toEqual({ ok: true, value: 'VIEW' });
  });

  it('control: a name the example config does not produce is returned as given (the check reports it)', () => {
    expect(followEventName(FORM, 'emits', 'NOPE', { submitEvent: 'CREATE' }, { submitEvent: 'ADD_LINE' })).toEqual({ ok: true, value: 'NOPE' });
  });

  const PAIR: CompositionBlockContract = {
    configKeys: ['saveEvent', 'closeEvent'],
    declaredConfig: { saveEvent: { type: 'event', default: 'SAVE' }, closeEvent: { type: 'event', default: 'CLOSE' } },
    emits: ['@config.saveEvent', '@config.closeEvent'],
    triggers: [],
    listens: [],
    entityRebindable: false,
  };

  it('two knobs sharing the example name that the block splits apart are refused as ambiguous', () => {
    const r = followEventName(PAIR, 'emits', 'GO', { saveEvent: 'GO', closeEvent: 'GO' }, { saveEvent: 'A', closeEvent: 'B' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('@config.saveEvent');
  });

  it('control: two knobs sharing the example name that stay together follow as one', () => {
    expect(followEventName(PAIR, 'emits', 'GO', { saveEvent: 'GO', closeEvent: 'GO' }, { saveEvent: 'A', closeEvent: 'A' })).toEqual({ ok: true, value: 'A' });
  });

  it('control: a knob with no declared default never names an event, so it is never followed', () => {
    expect(followEventName(FORM, 'emits', 'STOP', { cancelEvent: 'STOP' }, { cancelEvent: 'HALT' })).toEqual({ ok: true, value: 'STOP' });
  });
});

describe('bindsRecord — whether a block can sit on a page about a record', () => {
  const fixed: CompositionBlockContract = { ...COMPOSER, linkedEntity: 'GeoSearchResult' };
  it('a block fixed to another record cannot', () => {
    expect(bindsRecord(fixed, 'Product')).toBe(false);
  });
  it('control: a block fixed to that very record can', () => {
    expect(bindsRecord(fixed, 'GeoSearchResult')).toBe(true);
  });
  it('control: a rebindable block can, whatever it was bound to', () => {
    expect(bindsRecord({ ...BROWSE, linkedEntity: 'GeoSearchResult' }, 'Product')).toBe(true);
  });
  it('control: a block with no binding can', () => {
    expect(bindsRecord(COMPOSER, 'Product')).toBe(true);
  });
});

describe('trait-typed knobs hold a block of this composition', () => {
  const SHELL: CompositionBlockContract = {
    configKeys: ['contentTrait', 'appName'],
    declaredConfig: { contentTrait: { type: 'trait' }, appName: { type: 'string', default: '' } },
    emits: [],
    triggers: ['INIT'],
    listens: [],
    entityRebindable: false,
  };
  const shellCtx: CompositionContext = {
    block: (from, trait) => (from === 'std/behaviors/std-app-layout' && trait === 'AppLayout' ? SHELL : ctx.block(from, trait)),
  };
  const withShell = (contentTrait: string) =>
    spec({
      blocks: [
        spec().blocks[0]!,
        { name: 'Shell', from: 'std/behaviors/std-app-layout', as: 'AppShell', trait: 'AppLayout', config: { contentTrait, appName: 'Shop' } },
      ],
      layout: { kind: 'stack', children: [{ kind: 'block', block: 'Shell' }, { kind: 'block', block: 'Messages' }] },
      wiring: [],
    });

  it('a slot naming a block of the composition checks clean', () => {
    expect(checkComposition(withShell('@trait.Messages'), shellCtx)).toEqual([]);
  });

  it('a slot naming a trait from another app is refused, listing the blocks', () => {
    const issues = checkComposition(withShell('@trait.ChatRoom'), shellCtx);
    expect(issues).toEqual([expect.objectContaining({ code: 'unknown-trait-ref', path: 'blocks.Shell.config.contentTrait' })]);
    expect(issues[0]?.message).toContain('Messages');
  });

  it('a ref path where a slot belongs is refused', () => {
    expect(checkComposition(withShell('AgentSession.traits.AgentConversation'), shellCtx).map((i) => i.code)).toEqual(['unknown-trait-ref']);
  });

  it('control: a string knob is not held to the slot form', () => {
    const s = withShell('@trait.Messages');
    const blocks = [s.blocks[0]!, { ...s.blocks[1]!, config: { contentTrait: '@trait.Messages', appName: '@trait.Whatever' } }];
    expect(checkComposition({ ...s, blocks }, shellCtx)).toEqual([]);
  });
});

describe('compositionSpecOf — a factory-built page read back as a composition', () => {
  const entity = { name: 'Message', persistence: 'persistent' as const, collection: 'messages', fields: [{ name: 'body', type: 'string' as const }] };
  function factoryPage(extra: Partial<OrbitalDefinition> = {}): OrbitalDefinition {
    return {
      name: 'ChatOrbital',
      uses: [
        { from: 'std/behaviors/std-browse', as: 'Browse' },
        { from: 'std/behaviors/std-thread', as: 'Thread' },
      ],
      entity,
      traits: [
        { ref: 'Thread.traits.ThreadComposer', name: 'Composer', config: { placeholder: { type: 'unknown', default: 'Ask us' } } },
        {
          ref: 'Browse.traits.BrowseItemBrowse',
          name: 'Messages',
          linkedEntity: 'Message',
          config: { browseLook: { type: 'unknown', default: 'feed' } },
          listens: [...BROWSE.listens, { event: 'MESSAGE_SENT', triggers: 'REFETCH', source: { kind: 'trait', trait: 'Composer' } }],
        },
      ],
      pages: [{ name: 'ChatPage', path: '/chat', traits: [{ ref: 'Messages' }, { ref: 'Composer' }] }],
      ...extra,
    };
  }

  it('reads blocks, page order as the layout, added listens as wiring, the entity and the page', () => {
    const back = compositionSpecOf(factoryPage(), ctx, new Set());
    if (!back.ok) throw new Error(back.reason);
    expect(back.spec.blocks.map((b) => b.name)).toEqual(['Composer', 'Messages']);
    expect(back.spec.blocks[1]).toMatchObject({ from: 'std/behaviors/std-browse', trait: 'BrowseItemBrowse', config: { browseLook: 'feed' } });
    expect(back.spec.layout).toEqual({ kind: 'stack', direction: 'vertical', children: [{ kind: 'block', block: 'Messages' }, { kind: 'block', block: 'Composer' }] });
    expect(back.spec.wiring).toEqual([{ fromBlock: 'Composer', event: 'MESSAGE_SENT', toBlock: 'Messages', trigger: 'REFETCH' }]);
    expect(back.spec.entity).toEqual({ kind: 'declare', entity });
    expect(back.spec.page).toEqual({ name: 'ChatPage', path: '/chat' });
  });

  it('what it reads checks and assembles', () => {
    const back = compositionSpecOf(factoryPage(), ctx, new Set());
    if (!back.ok) throw new Error(back.reason);
    expect(checkComposition(back.spec, ctx)).toEqual([]);
  });

  it('the app chrome is left out — composition wraps the page itself', () => {
    const page = factoryPage();
    const chromed = factoryPage({
      uses: [...(page.uses ?? []), { from: 'std/behaviors/std-app-layout', as: 'AppShell' }],
      traits: [{ ref: 'AppShell.traits.AppLayout', name: 'ChatAppLayout' }, ...page.traits],
      pages: [{ name: 'ChatPage', path: '/chat', traits: [{ ref: 'ChatAppLayout' }, { ref: 'Messages' }, { ref: 'Composer' }] }],
    });
    const back = compositionSpecOf(chromed, ctx, new Set(['AppShell.traits.AppLayout']));
    if (!back.ok) throw new Error(back.reason);
    expect(back.spec.blocks.map((b) => b.name)).not.toContain('ChatAppLayout');
    expect(JSON.stringify(back.spec.layout)).not.toContain('ChatAppLayout');
  });

  const handwritten = { name: 'Handwritten', scope: 'instance' as const, stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [] } };

  it('an inline trait is carried as a kept part, in its page position', () => {
    const page = factoryPage();
    const back = compositionSpecOf(
      factoryPage({ traits: [...page.traits, handwritten], pages: [{ name: 'ChatPage', path: '/chat', traits: [{ ref: 'Handwritten' }, { ref: 'Messages' }, { ref: 'Composer' }] }] }),
      ctx,
      new Set(),
    );
    if (!back.ok) throw new Error(back.reason);
    expect(back.spec.kept).toEqual([handwritten]);
    expect(back.spec.layout).toEqual({ kind: 'stack', direction: 'vertical', children: [{ kind: 'block', block: 'Handwritten' }, { kind: 'block', block: 'Messages' }, { kind: 'block', block: 'Composer' }] });
    expect(checkComposition(back.spec, ctx)).toEqual([]);
  });

  it('a kept part is assembled verbatim beside the blocks', () => {
    const page = factoryPage();
    const back = compositionSpecOf(factoryPage({ traits: [...page.traits, handwritten] }), ctx, new Set());
    if (!back.ok) throw new Error(back.reason);
    const out = assembleComposition(back.spec, ctx);
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    expect(out.orbital.traits).toContainEqual(handwritten);
  });

  it('control: a wire to a kept part is refused — it is not a block', () => {
    const page = factoryPage();
    const back = compositionSpecOf(factoryPage({ traits: [...page.traits, handwritten] }), ctx, new Set());
    if (!back.ok) throw new Error(back.reason);
    const issues = checkComposition({ ...back.spec, wiring: [{ fromBlock: 'Composer', event: 'MESSAGE_SENT', toBlock: 'Handwritten', trigger: 'INIT' }] }, ctx);
    expect(issues.map((i) => i.code)).toEqual(['unknown-wire-block']);
  });
});

describe('a block another block renders through a trait slot is placed', () => {
  const SLOTTED: CompositionBlockContract = { ...BROWSE, configKeys: [...BROWSE.configKeys, 'avatarSlot'], declaredConfig: { avatarSlot: { type: 'trait' } } };
  const slotCtx: CompositionContext = {
    block: (from, trait) => (from === 'std/behaviors/std-browse' && trait === 'BrowseItemBrowse' ? SLOTTED : ctx.block(from, trait)),
  };
  const withEmbed = (slot: string) =>
    spec({
      blocks: [
        { ...spec().blocks[0]!, config: { browseLook: 'feed', avatarSlot: slot } },
        { ...spec().blocks[1]!, name: 'Avatar' },
      ],
      layout: { kind: 'stack', children: [{ kind: 'block', block: 'Messages' }] },
      wiring: [],
    });

  it('a block named in another block’s slot needs no layout place', () => {
    expect(checkComposition(withEmbed('@trait.Avatar'), slotCtx)).toEqual([]);
  });

  it('control: a block nobody renders is still reported unplaced', () => {
    expect(checkComposition(withEmbed('@trait.Messages'), slotCtx).map((i) => i.code)).toEqual(['unplaced-block']);
  });
});

describe('a fixed-binding part needs the record it is bound to', () => {
  const BOUND: CompositionBlockContract = { ...COMPOSER, linkedEntity: 'CartItem' };
  const boundCtx: CompositionContext = {
    block: (from, trait) => (from === 'std/behaviors/std-thread' && trait === 'ThreadComposer' ? BOUND : ctx.block(from, trait)),
  };

  it('a part bound to another record is refused, naming the record it needs', () => {
    const issues = checkComposition(spec(), boundCtx);
    expect(issues).toEqual([expect.objectContaining({ code: 'entity-mismatch', path: 'blocks.Composer' })]);
    expect(issues[0]?.message).toContain('CartItem');
  });

  it('control: the same part on a record of its own name checks clean', () => {
    const s = spec({ entity: { kind: 'declare', entity: { name: 'CartItem', persistence: 'persistent', collection: 'cart_items', fields: [] } } });
    expect(checkComposition(s, boundCtx)).toEqual([]);
  });
});
