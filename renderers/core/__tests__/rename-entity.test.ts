/**
 * `renameEntity` — one structural rename of an entity across a set of orbitals (one organism's
 * files when an app namespaces a colliding organism, owner design 2026-10-04). Every position
 * the compiler's visitors read an entity name from is rewritten; a same-named string anywhere
 * else is not.
 */
import { describe, it, expect } from 'vitest';
import type { OrbitalDefinition, OrbitalSchema, Trait } from '../src/types/index.js';
import { asEntityId } from '../src/types/index.js';
import { atomTraitResolver, entityRenameBlockers, renameEntity, renameEntityInSchema, renameOrbital } from '../src/builders/rename-entity.js';

const trait = (body: Partial<Trait>): Trait => ({
  name: 'StaffManage',
  scope: 'instance',
  linkedEntity: 'Staff',
  stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [{ key: 'LOAD', name: 'Load' }], transitions: [] },
  ...body,
});

function roster(): OrbitalDefinition[] {
  return [
    {
      name: 'StaffOrbital',
      entity: {
        name: 'Staff',
        id: asEntityId('ent_STAFF'),
        persistence: 'persistent',
        collection: 'staff',
        fields: [{ name: 'id', type: 'string' }, { name: 'manager', type: 'relation', relation: { entity: 'Staff' } }],
        read_policy: ['=', '@Staff.ownerId', '@user.id'],
      },
      auxiliaryEntities: [{ name: 'StaffNote', persistence: 'persistent', fields: [{ name: 'about', type: 'relation', relation: { entity: 'Staff' } }] }],
      traits: [trait({
        entityRefIds: { Staff: asEntityId('ent_STAFF') },
        config: { target: { type: 'entity', default: 'Staff' }, label: { type: 'string', default: 'Staff' }, filter: { type: 'unknown', default: '@Staff.status' } },
        stateMachine: {
          states: [{ name: 'idle', isInitial: true }],
          events: [{ key: 'SAVED', name: 'Saved', payloadEntity: 'Staff', payloadSchema: [{ name: 'row', type: 'Staff' }, { name: 'rows', type: '[Staff]' }, { name: 'role', type: 'string', projectedFrom: { type: 'Staff', field: 'role' } }] }],
          transitions: [{
            from: 'idle',
            to: 'idle',
            event: 'SAVED',
            guard: ['=', '@Staff.active', true],
            effects: [
              ['fetch', 'Staff', { id: '@payload.id' }],
              ['persist', 'update', 'Staff', { name: '@payload.name' }],
              ['ref', 'Staff'],
              ['spawn', 'Staff', {}],
              ['render-ui', 'main', { type: 'data-list', entity: 'Staff', title: 'Staff' }],
            ],
          }],
        },
        listens: [{ event: 'PING', triggers: 'PING', source: { kind: 'trait', trait: 'Other' }, guard: ['=', '@Staff.id', '@payload.id'], payloadMapping: { who: '@Staff.name' } }],
      })],
      pages: [{ name: 'StaffPage', path: '/staff', primaryEntity: 'Staff', traits: [{ ref: 'StaffManage', linkedEntity: 'Staff' }] }],
      expects: [{ kind: 'entity', name: 'Staff' }],
    },
  ];
}

const json = (v: unknown): string => JSON.stringify(v);

describe('renameEntity', () => {
  const [out] = renameEntity(roster(), 'Staff', 'HrPortalStaff', { collection: 'hr_portal_staff' });
  const entity = out!.entity;
  const t = out!.traits[0] as Trait;

  it('renames the declaration, keeps its id, and sets the namespaced collection', () => {
    expect(entity).toMatchObject({ name: 'HrPortalStaff', id: 'ent_STAFF', collection: 'hr_portal_staff' });
  });

  it('rewrites relation targets on the primary and auxiliary entities', () => {
    expect(json(entity)).toContain('"relation":{"entity":"HrPortalStaff"}');
    expect(json(out!.auxiliaryEntities)).toContain('"relation":{"entity":"HrPortalStaff"}');
  });

  it('rewrites @Name tokens in policies, guards, listens and config defaults', () => {
    const text = json(out);
    expect(text).not.toContain('@Staff.');
    expect(text).toContain('@HrPortalStaff.ownerId');
    expect(text).toContain('@HrPortalStaff.active');
    expect(text).toContain('@HrPortalStaff.name');
    expect(text).toContain('@HrPortalStaff.status');
  });

  it('rewrites the entity slot of fetch, persist, ref and spawn', () => {
    const effects = json(t.stateMachine!.transitions[0]!.effects);
    expect(effects).toContain('["fetch","HrPortalStaff"');
    expect(effects).toContain('["persist","update","HrPortalStaff"');
    expect(effects).toContain('["ref","HrPortalStaff"]');
    expect(effects).toContain('["spawn","HrPortalStaff"');
  });

  it('rewrites linkedEntity, primaryEntity, render entity props, expects and payload types', () => {
    expect(t.linkedEntity).toBe('HrPortalStaff');
    expect(json(out!.pages)).toContain('"primaryEntity":"HrPortalStaff"');
    expect(json(out!.pages)).toContain('"linkedEntity":"HrPortalStaff"');
    expect(json(t.stateMachine!.transitions[0]!.effects)).toContain('"entity":"HrPortalStaff"');
    expect(out!.expects).toEqual([{ kind: 'entity', name: 'HrPortalStaff' }]);
    const event = json(t.stateMachine!.events);
    expect(event).toContain('"payloadEntity":"HrPortalStaff"');
    expect(event).toContain('"type":"HrPortalStaff"');
    expect(event).toContain('"type":"[HrPortalStaff]"');
    expect(event).toContain('"projectedFrom":{"type":"HrPortalStaff","field":"role"}');
  });

  it('moves the entityRefIds key with the name, keeping the id', () => {
    expect(t.entityRefIds).toEqual({ HrPortalStaff: 'ent_STAFF' });
  });

  it('an entity-typed config value is renamed; a string-typed value spelled the same is not', () => {
    expect(t.config).toMatchObject({ target: { type: 'entity', default: 'HrPortalStaff' }, label: { type: 'string', default: 'Staff' } });
  });

  it('control: display text and names that are not entity positions keep their spelling', () => {
    expect(json(t.stateMachine!.transitions[0]!.effects)).toContain('"title":"Staff"');
    expect(out!.name).toBe('StaffOrbital');
    expect(json(out!.auxiliaryEntities)).toContain('"name":"StaffNote"');
  });

  it('control: an entity of another name is untouched, and the input is not mutated', () => {
    const input = roster();
    const before = json(input);
    expect(json(renameEntity(input, 'Customer', 'HrPortalCustomer'))).toBe(before);
    renameEntity(input, 'Staff', 'HrPortalStaff');
    expect(json(input)).toBe(before);
  });
});

describe('renameEntityInSchema — the ledger follows the declaration', () => {
  it('the renamed declaration\'s ledger row takes the new name; other rows keep theirs', () => {
    const schema: OrbitalSchema = {
      name: 'hr',
      version: '1.0.0',
      orbitals: roster(),
      ledger: {
        schemaVersion: 1,
        entries: {
          ent_STAFF: { id: asEntityId('ent_STAFF'), kind: 'entity', bakedName: 'Staff', curName: 'Staff', renames: [], owner: 'workspace' },
          ent_OTHER: { id: asEntityId('ent_OTHER'), kind: 'entity', bakedName: 'Other', curName: 'Other', renames: [], owner: 'workspace' },
        },
      },
    };
    const out = renameEntityInSchema(schema, 'Staff', 'HrPortalStaff');
    expect(out.ledger?.entries['ent_STAFF']?.curName).toBe('HrPortalStaff');
    expect(out.ledger?.entries['ent_OTHER']?.curName).toBe('Other');
  });
});

describe('renameEntity — a call-site knob the atom declares entity-typed', () => {
  const lifecycle = (): OrbitalDefinition => ({
    name: 'JournalOrbital',
    entity: { name: 'JournalSummary', persistence: 'persistent', fields: [{ name: 'id', type: 'string' }] },
    uses: [{ from: 'std/behaviors/std-status-lifecycle', as: 'StatusLifecycle' }],
    traits: [{ ref: 'StatusLifecycle.traits.StatusMachine', name: 'JournalStatusLifecycle', linkedEntity: 'JournalSummary', config: { targetEntity: { type: 'unknown', default: 'JournalSummary' }, label: { type: 'unknown', default: 'JournalSummary' } } }],
    pages: [],
  });
  const atomTraitOf = (_orbital: OrbitalDefinition, ref: string): Trait | undefined => (ref === 'StatusLifecycle.traits.StatusMachine'
    ? { name: 'StatusMachine', scope: 'instance', config: { targetEntity: { type: 'entity', default: 'StatusRecord' }, label: { type: 'string', default: 'x' } } }
    : undefined);

  it('renames the value of a knob the referenced atom declares `entity`', () => {
    const [out] = renameEntity([lifecycle()], 'JournalSummary', 'LedgerJournalSummary', { atomTraitOf });
    expect(JSON.stringify(out!.traits[0])).toContain('"targetEntity":{"type":"unknown","default":"LedgerJournalSummary"}');
  });

  it('control: a knob the atom does not declare entity-typed keeps its value', () => {
    const [out] = renameEntity([lifecycle()], 'JournalSummary', 'LedgerJournalSummary', { atomTraitOf });
    expect(JSON.stringify(out!.traits[0])).toContain('"label":{"type":"unknown","default":"JournalSummary"}');
  });

  it('control: without the resolver an unknown-typed knob is not guessed at', () => {
    const [out] = renameEntity([lifecycle()], 'JournalSummary', 'LedgerJournalSummary');
    expect(JSON.stringify(out!.traits[0])).toContain('"targetEntity":{"type":"unknown","default":"JournalSummary"}');
  });
});

describe('renameEntity — a trait\'s effect row', () => {
  const withRow = (): OrbitalDefinition[] => [{
    name: 'ArticleOrbital',
    entity: { name: 'Article', persistence: 'persistent', fields: [{ name: 'id', type: 'string' }] },
    traits: [{ ref: 'ArticleAtom.traits.Editor', name: 'ArticleEditor', effectRow: [{ kind: 'persist', resource: 'Article' }, { kind: 'fetch', resource: 'Article' }, { kind: 'render-ui', resource: 'Article' }] }],
    pages: [],
  }];

  it('renames the entity a persist or fetch use acts on', () => {
    const [out] = renameEntity(withRow(), 'Article', 'CmsArticle');
    const row = JSON.stringify(out!.traits[0]);
    expect(row).toContain('{"kind":"persist","resource":"CmsArticle"}');
    expect(row).toContain('{"kind":"fetch","resource":"CmsArticle"}');
  });

  it('control: a render-ui slot spelled like the entity is a slot, not the entity', () => {
    const [out] = renameEntity(withRow(), 'Article', 'CmsArticle');
    expect(JSON.stringify(out!.traits[0])).toContain('{"kind":"render-ui","resource":"Article"}');
  });
});

describe('entityRenameBlockers — an atom that fixes its entity pins the name', () => {
  const app = (): OrbitalDefinition[] => [{
    name: 'WaitlistOrbital',
    entity: { name: 'WaitlistEntry', persistence: 'persistent', fields: [{ name: 'id', type: 'string' }] },
    uses: [{ from: 'std/behaviors/std-waitlist', as: 'Waitlist' }, { from: 'std/behaviors/std-browse', as: 'Browse' }],
    traits: [
      { ref: 'Waitlist.traits.Queue', name: 'WaitlistQueue', linkedEntity: 'WaitlistEntry' },
      { ref: 'Browse.traits.List', name: 'WaitlistList', linkedEntity: 'WaitlistEntry' },
    ],
    pages: [],
  }];
  const atomTraitOf = (_orbital: OrbitalDefinition, ref: string): Trait => ({ name: ref, scope: 'instance', entityRebindable: ref !== 'Waitlist.traits.Queue' });

  it('names each reference trait whose atom binding is not rebindable', () => {
    expect(entityRenameBlockers(app(), 'WaitlistEntry', atomTraitOf)).toEqual([{ orbitalName: 'WaitlistOrbital', traitName: 'WaitlistQueue', traitRef: 'Waitlist.traits.Queue' }]);
  });

  it('control: every binding rebindable → nothing blocks the rename', () => {
    expect(entityRenameBlockers(app(), 'WaitlistEntry', (_o, ref) => ({ name: ref, scope: 'instance', entityRebindable: true }))).toEqual([]);
  });
});

describe('renameEntity — an entity-kind type argument', () => {
  // `OrbitalDefinition.traits` (`TraitRef`) does not declare `typeArgs` though `.orb` references carry it
  // (G-CORE-016), so the fixture enters the way a `.orb` does: parsed JSON.
  const generic = (): OrbitalDefinition[] => JSON.parse(JSON.stringify([{
    name: 'DeploymentOrbital',
    entity: { name: 'Deployment', persistence: 'persistent', fields: [{ name: 'id', type: 'string' }] },
    traits: [{ ref: 'Approval.traits.ApprovalGateReview', name: 'DeploymentApproval', typeArgs: { p: 'Deployment', e: 'Deployment' } }],
    pages: [],
  }]));
  const atomTraitOf = (): Trait => ({ name: 'ApprovalGateReview', scope: 'instance', typeParams: [{ kind: 'Entity', name: 'p' }, { kind: 'Event', name: 'e' }] });

  it('renames the argument of a parameter the atom declares Entity-kind', () => {
    const [out] = renameEntity(generic(), 'Deployment', 'OpsDeployment', { atomTraitOf });
    expect(JSON.stringify(out!.traits[0])).toContain('"p":"OpsDeployment"');
  });

  it('control: an argument of another kind spelled the same keeps its value', () => {
    const [out] = renameEntity(generic(), 'Deployment', 'OpsDeployment', { atomTraitOf });
    expect(JSON.stringify(out!.traits[0])).toContain('"e":"Deployment"');
  });
});

describe('renameEntity — a reference that binds its atom\'s entity implicitly', () => {
  const slots = (): OrbitalDefinition[] => [{
    name: 'InterviewScheduleOrbital',
    entity: { name: 'InterviewSlot', persistence: 'persistent', fields: [{ name: 'id', type: 'string' }] },
    traits: [{ ref: 'Slots.traits.SlotBoard', name: 'InterviewSlotBoard' }, { ref: 'Other.traits.Panel', name: 'InterviewPanel' }],
    pages: [],
  }];
  const atomTraitOf = (_o: OrbitalDefinition, ref: string): Trait => (ref === 'Slots.traits.SlotBoard'
    ? { name: 'SlotBoard', scope: 'instance', linkedEntity: 'InterviewSlot', entityRebindable: true }
    : { name: 'Panel', scope: 'instance', linkedEntity: 'PanelRow', entityRebindable: true });

  it('a reference with no linkedEntity whose atom binds the renamed entity gets the binding made explicit', () => {
    const [out] = renameEntity(slots(), 'InterviewSlot', 'AtsInterviewSlot', { atomTraitOf });
    expect(out!.traits[0]).toMatchObject({ ref: 'Slots.traits.SlotBoard', linkedEntity: 'AtsInterviewSlot' });
  });

  it('control: a reference whose atom binds another entity stays implicit', () => {
    const [out] = renameEntity(slots(), 'InterviewSlot', 'AtsInterviewSlot', { atomTraitOf });
    expect(out!.traits[1]).toEqual({ ref: 'Other.traits.Panel', name: 'InterviewPanel' });
  });

  it('an implicit binding to an atom that fixes its entity blocks the rename', () => {
    const fixed = (_o: OrbitalDefinition, ref: string): Trait => ({ name: ref, scope: 'instance', linkedEntity: ref === 'Slots.traits.SlotBoard' ? 'InterviewSlot' : 'PanelRow', entityRebindable: false });
    expect(entityRenameBlockers(slots(), 'InterviewSlot', fixed)).toEqual([{ orbitalName: 'InterviewScheduleOrbital', traitName: 'InterviewSlotBoard', traitRef: 'Slots.traits.SlotBoard' }]);
  });
});

describe('atomTraitResolver — a reference resolved through the orbital\'s uses', () => {
  const atom: OrbitalSchema = {
    name: 'std-status-lifecycle',
    version: '1.0.0',
    orbitals: [{ name: 'StatusOrbital', entity: { name: 'StatusRecord', persistence: 'persistent', fields: [{ name: 'id', type: 'string' }] }, traits: [{ name: 'StatusMachine', scope: 'instance', linkedEntity: 'StatusRecord', entityRebindable: true }], pages: [] }],
  };
  const host: OrbitalDefinition = { name: 'JournalOrbital', entity: 'Journal.entity', uses: [{ from: 'std/behaviors/std-status-lifecycle', as: 'StatusLifecycle' }], traits: [], pages: [] };
  const loads: string[] = [];
  const resolve = atomTraitResolver((behavior) => { loads.push(behavior); return behavior === 'std-status-lifecycle' ? atom : null; });

  it('finds the atom\'s trait declaration by alias and trait name', () => {
    expect(resolve(host, 'StatusLifecycle.traits.StatusMachine')).toMatchObject({ name: 'StatusMachine', entityRebindable: true });
  });

  it('control: an alias the orbital does not import, or an unknown trait, resolves to nothing', () => {
    expect(resolve(host, 'Other.traits.StatusMachine')).toBeUndefined();
    expect(resolve(host, 'StatusLifecycle.traits.Missing')).toBeUndefined();
  });

  it('loads each behavior once', () => {
    resolve(host, 'StatusLifecycle.traits.StatusMachine');
    expect(loads.filter((b) => b === 'std-status-lifecycle')).toHaveLength(1);
  });
});

describe('renameOrbital — an orbital held under another name', () => {
  const organism = (): OrbitalDefinition[] => [
    { name: 'ProductOrbital', entity: 'Product.entity', traits: [], pages: [] },
    {
      name: 'CartItemOrbital',
      entity: 'CartItem.entity',
      traits: [{
        name: 'CartItemAddToCart',
        scope: 'instance',
        listens: [
          { event: 'ADD_TO_CART', triggers: 'ADD_TO_CART', source: { kind: 'orbital', orbital: 'ProductOrbital', trait: 'ProductBrowseList' } },
          { event: 'PING', triggers: 'PING', source: { kind: 'trait', trait: 'ProductOrbital' } },
        ],
      }],
      pages: [],
    },
  ];

  it('renames the declaration and every listen sourced from it', () => {
    const out = renameOrbital(organism(), 'ProductOrbital', 'EcommerceProductOrbital');
    expect(out[0]!.name).toBe('EcommerceProductOrbital');
    expect(JSON.stringify(out[1])).toContain('"source":{"kind":"orbital","orbital":"EcommerceProductOrbital","trait":"ProductBrowseList"}');
  });

  it('control: a trait-kind source spelled like the orbital is a trait name, not the orbital', () => {
    const out = renameOrbital(organism(), 'ProductOrbital', 'EcommerceProductOrbital');
    expect(JSON.stringify(out[1])).toContain('"source":{"kind":"trait","trait":"ProductOrbital"}');
  });
});
