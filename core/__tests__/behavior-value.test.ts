import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  parseTraitValueLiteral,
  formatTraitValueLiteral,
  applyTraitOverrides,
  isTraitValue,
  parseOrbitalValueLiteral,
  parseBehaviorValueLiteral,
  formatBehaviorValueLiteral,
  applyOrbitalOverrides,
  applyBehaviorOverrides,
  isOrbitalValue,
  OrbitalValueSchema,
  BehaviorValueSchema,
  BehaviorDescriptionSchema,
  TraitDescriptionSchema,
  DescribeTargetSchema,
  KnobFieldSchema,
  type OrbitalValue,
} from '../src/types/behavior-value';
import { JsonValueSchema } from '../src/types/json';
import type { EvaluatedProgram, ProgramValidationIssue, TraitValue } from '../src/types/behavior-value';
import type { EventPayload } from '../src/types/expression';

const kanban: TraitValue = { behavior: 'std/std-kanban', trait: 'KanbanBoard' };

describe('trait value literal', () => {
  it('parses the reference-path spelling', () => {
    expect(parseTraitValueLiteral('std/std-kanban.traits.KanbanBoard')).toEqual(kanban);
    expect(parseTraitValueLiteral('almadar-behaviors/vim-mode.traits.VimMode'))
      .toEqual({ behavior: 'almadar-behaviors/vim-mode', trait: 'VimMode' });
    expect(parseTraitValueLiteral('std/behaviors/std-kanban.traits.KanbanBoard'))
      .toEqual({ behavior: 'std/behaviors/std-kanban', trait: 'KanbanBoard' });
    expect(parseTraitValueLiteral('./orbitals/TaskBoard.traits.TaskBoardView'))
      .toEqual({ behavior: './orbitals/TaskBoard', trait: 'TaskBoardView' });
  });

  it('round-trips through format', () => {
    expect(formatTraitValueLiteral(kanban)).toBe('std/std-kanban.traits.KanbanBoard');
    expect(parseTraitValueLiteral(formatTraitValueLiteral(kanban))).toEqual(kanban);
  });

  it('control: a local embed and malformed paths are not trait-value literals', () => {
    expect(parseTraitValueLiteral('@trait.KanbanBoard')).toBeUndefined();
    expect(parseTraitValueLiteral('std-kanban.traits.KanbanBoard')).toBeUndefined();
    expect(parseTraitValueLiteral('std/std-kanban.orbitals.KanbanOrbital')).toBeUndefined();
    expect(parseTraitValueLiteral('std/std-kanban.traits.')).toBeUndefined();
    expect(parseTraitValueLiteral('std/std-kanban.traits.kanbanBoard')).toBeUndefined();
    expect(parseTraitValueLiteral('std/.traits.KanbanBoard')).toBeUndefined();
    expect(parseTraitValueLiteral('std/other/std-kanban.traits.KanbanBoard')).toBeUndefined();
    expect(parseTraitValueLiteral('../outside/X.traits.Y')).toBeUndefined();
    expect(parseTraitValueLiteral('/abs/X.traits.Y')).toBeUndefined();
  });
});

describe('behavior/apply semantics (applyTraitOverrides)', () => {
  it('records overrides without touching the identity', () => {
    const v = applyTraitOverrides(kanban, { config: { compact: true } });
    expect(v).toEqual({ ...kanban, config: { compact: true } });
    expect(kanban).toEqual({ behavior: 'std/std-kanban', trait: 'KanbanBoard' });
  });

  it('merges config, events and fields key-wise; the later value wins', () => {
    const a = applyTraitOverrides(kanban, { config: { compact: true, title: 'A' }, events: { OPEN: 'SHOW' }, fields: { name: 'title' } });
    const b = applyTraitOverrides(a, { config: { title: 'B' }, events: { CLOSE: 'HIDE' }, fields: { name: 'label' } });
    expect(b.config).toEqual({ compact: true, title: 'B' });
    expect(b.events).toEqual({ OPEN: 'SHOW', CLOSE: 'HIDE' });
    expect(b.fields).toEqual({ name: 'label' });
  });

  it('replaces listens, emitsScope and linkedEntity wholesale', () => {
    const a = applyTraitOverrides(kanban, { listens: [{ event: 'A', triggers: 'B' }], emitsScope: 'internal', linkedEntity: 'Task' });
    const b = applyTraitOverrides(a, { listens: [], emitsScope: 'external', linkedEntity: 'Card' });
    expect(b.listens).toEqual([]);
    expect(b.emitsScope).toBe('external');
    expect(b.linkedEntity).toBe('Card');
  });

  it('control: an empty override is the identity', () => {
    expect(applyTraitOverrides(kanban, {})).toEqual(kanban);
  });
});

describe('isTraitValue', () => {
  it('accepts the value shape and rejects others', () => {
    expect(isTraitValue(kanban)).toBe(true);
    expect(isTraitValue(applyTraitOverrides(kanban, { config: { a: 1 } }))).toBe(true);
    expect(isTraitValue('std/std-kanban.traits.KanbanBoard')).toBe(false);
    expect(isTraitValue({ behavior: 'std/std-kanban' })).toBe(false);
    expect(isTraitValue(null)).toBe(false);
  });
});

describe('TraitOverridesSchema / TraitValueSchema', () => {
  it('accept the override surface and a value carrying it', async () => {
    const { TraitOverridesSchema, TraitValueSchema } = await import('../src/types/behavior-value');
    expect(TraitOverridesSchema.safeParse({ config: { compact: true }, emitsScope: 'internal' }).success).toBe(true);
    expect(TraitValueSchema.safeParse({ ...kanban, events: { OPEN: 'SHOW' } }).success).toBe(true);
  });

  it('control: reject unknown keys, a bad scope and a value without identity', async () => {
    const { TraitOverridesSchema, TraitValueSchema } = await import('../src/types/behavior-value');
    expect(TraitOverridesSchema.safeParse({ effects: {} }).success).toBe(false);
    expect(TraitOverridesSchema.safeParse({ emitsScope: 'public' }).success).toBe(false);
    expect(TraitValueSchema.safeParse({ trait: 'KanbanBoard' }).success).toBe(false);
    expect(TraitValueSchema.safeParse({ ...kanban, ref: 'X.traits.Y' }).success).toBe(false);
  });
});

describe('program results are event payload data', () => {
  it('validator issues and an evaluated program travel on the bus as-is', () => {
    const errors: ProgramValidationIssue[] = [{ code: 'ORB_X', message: 'broken', line: 3 }];
    const result: EvaluatedProgram = { behavior: './orbitals/X', traits: [], value: { behavior: './orbitals/X' } };
    const failure: EventPayload = { error: 'does not validate', errors };
    const success: EventPayload = { behavior: result.behavior, value: result.value };
    expect(failure.errors).toBe(errors);
    expect(success.behavior).toBe('./orbitals/X');
  });
});

describe('orbital values', () => {
  const kanban: OrbitalValue = { behavior: 'almadar-std/std-kanban', orbital: 'KanbanOrbital' };

  it('parses and formats the orbital literal; the trait literal stays a trait value', () => {
    expect(parseOrbitalValueLiteral('almadar-std/std-kanban.orbitals.KanbanOrbital')).toEqual(kanban);
    expect(parseBehaviorValueLiteral('almadar-std/std-kanban.orbitals.KanbanOrbital')).toEqual(kanban);
    expect(parseBehaviorValueLiteral('almadar-std/std-kanban.traits.KanbanBoard')).toEqual({ behavior: 'almadar-std/std-kanban', trait: 'KanbanBoard' });
    expect(formatBehaviorValueLiteral(kanban)).toBe('almadar-std/std-kanban.orbitals.KanbanOrbital');
    expect(parseOrbitalValueLiteral('./orbitals/Picked.orbitals.PickedOrbital')).toEqual({ behavior: './orbitals/Picked', orbital: 'PickedOrbital' });
  });

  it('control: a trait literal is not an orbital literal, and malformed names are refused', () => {
    expect(parseOrbitalValueLiteral('almadar-std/std-kanban.traits.KanbanBoard')).toBeUndefined();
    expect(parseOrbitalValueLiteral('almadar-std/std-kanban.orbitals.kanbanOrbital')).toBeUndefined();
    expect(parseOrbitalValueLiteral('Kanban.orbitals.KanbanOrbital')).toBeUndefined();
  });

  it('merges maps key-wise, traits per trait, extend/retype by field name, and replaces the rest', () => {
    const base = applyOrbitalOverrides(kanban, {
      entity: 'Task',
      config: { pageSize: 10, title: 'Board' },
      extend: [{ name: 'priority', type: 'string' }],
      traits: { KanbanBoard: { config: { compact: false }, events: { MOVE: 'SHIFT' } } },
    });
    const next = applyOrbitalOverrides(base, {
      entity: 'Ticket',
      config: { pageSize: 20 },
      extend: [{ name: 'priority', type: 'number' }, { name: 'due', type: 'date' }],
      traits: { KanbanBoard: { config: { compact: true } } },
    });
    expect(next).toEqual({
      behavior: 'almadar-std/std-kanban',
      orbital: 'KanbanOrbital',
      entity: 'Ticket',
      config: { pageSize: 20, title: 'Board' },
      extend: [{ name: 'priority', type: 'number' }, { name: 'due', type: 'date' }],
      traits: { KanbanBoard: { config: { compact: true }, events: { MOVE: 'SHIFT' } } },
    });
    expect(base.entity).toBe('Task');
  });

  it('applyBehaviorOverrides dispatches on the value kind and validates the overrides for that kind', () => {
    expect(applyBehaviorOverrides(kanban, { name: 'Tickets' })).toEqual({ ...kanban, name: 'Tickets' });
    expect(applyBehaviorOverrides({ behavior: 'almadar-std/std-kanban', trait: 'KanbanBoard' }, { config: { compact: true } }))
      .toEqual({ behavior: 'almadar-std/std-kanban', trait: 'KanbanBoard', config: { compact: true } });
  });

  it('control: an import key on a trait value, or an unknown key on an orbital value, is refused', () => {
    expect(() => applyBehaviorOverrides({ behavior: 'almadar-std/std-kanban', trait: 'KanbanBoard' }, { entity: 'Task' })).toThrow();
    expect(() => applyBehaviorOverrides(kanban, { notAnImportKey: true })).toThrow();
  });

  it('guards and schema recognise orbital values only', () => {
    expect(isOrbitalValue(kanban)).toBe(true);
    expect(isOrbitalValue({ behavior: 'almadar-std/std-kanban', trait: 'KanbanBoard' })).toBe(false);
    expect(isTraitValue(kanban)).toBe(false);
    expect(OrbitalValueSchema.safeParse({ ...kanban, persistence: 'persistent', collection: 'tickets' }).success).toBe(true);
    expect(OrbitalValueSchema.safeParse({ ...kanban, ref: 'A.orbitals.B' }).success).toBe(false);
  });
});

describe('behavior/apply twin cases (shared with orbital-core)', () => {
  const CaseSchema = JsonValueSchema;
  const cases = CaseSchema.array().parse(
    JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'behavior-apply', 'cases.json'), 'utf8')),
  );
  for (const raw of cases) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('case must be an object');
    const name = String(raw['name']);
    it(name, () => {
      const run = () => applyBehaviorOverrides(BehaviorValueSchema.parse(raw['value']), raw['overrides'] ?? null);
      if (raw['error'] === true) expect(run).toThrow();
      else expect(run()).toEqual(raw['expected']);
    });
  }
});

describe('behavior description (orb behaviors describe on a behavior or orbital)', () => {
  const described = {
    behavior: './orbitals/shop',
    config: { appName: { type: 'string', default: 'Shop' } },
    knobs: [{ name: 'appName', type: 'string' }],
    orbitals: [
      {
        value: { behavior: './orbitals/shop', orbital: 'ItemOrbital' },
        config: {},
        knobs: [],
        entity: { name: 'Item', fields: [{ name: 'id', type: 'string', required: true }, { name: 'tone', type: 'enum', values: ['warm', 'cool'] }] },
        borrows: ['Note'],
        expects: [{ kind: 'entity', name: 'Note' }],
        traits: [{ trait: 'ItemList', config: { layout: { type: 'string', values: ['grid', 'rows'], default: 'grid' } }, knobs: [{ name: 'layout', type: 'string', values: ['grid', 'rows'] }, { name: 'columns', type: '[object]', properties: [{ name: 'key', type: 'string', required: true }] }], events: { emits: [], listens: [], transitions: ['OPEN'] } }],
        pages: [{ name: 'ItemsPage', path: '/items' }],
      },
      { value: { behavior: './orbitals/shop', orbital: 'NoteOrbital' }, config: {}, knobs: [], borrows: [], expects: [], traits: [], pages: [] },
    ],
  };

  it('parses what orb prints', () => {
    const parsed = BehaviorDescriptionSchema.parse(described);
    expect(parsed.orbitals[0]?.borrows).toEqual(['Note']);
    expect(parsed.orbitals[1]?.entity).toBeUndefined();
  });

  it('a description names the behaviors it imports; control: one without imports omits them', () => {
    expect(BehaviorDescriptionSchema.parse({ ...described, uses: ['almadar-behaviors/std-snake-loop'] }).uses).toEqual(['almadar-behaviors/std-snake-loop']);
    expect(BehaviorDescriptionSchema.parse(described).uses).toBeUndefined();
  });

  it('a trait says whether another record may rebind it, a page which traits it mounts; control: an older orb omits both', () => {
    const [item, note] = described.orbitals;
    const withFlags = { ...described, orbitals: [{ ...item!, traits: item!.traits.map((t) => ({ ...t, rebindable: true })), pages: [{ name: 'ItemsPage', path: '/items', traits: ['ItemList'] }] }, note!] };
    const parsed = BehaviorDescriptionSchema.parse(withFlags);
    expect(parsed.orbitals[0]?.traits[0]?.rebindable).toBe(true);
    expect(parsed.orbitals[0]?.pages[0]?.traits).toEqual(['ItemList']);
    const older = BehaviorDescriptionSchema.parse(described);
    expect(older.orbitals[0]?.traits[0]?.rebindable).toBeUndefined();
    expect(older.orbitals[0]?.pages[0]?.traits).toBeUndefined();
  });

  it('a trait names the trait it composes and its capability tags; control: an older orb omits both', () => {
    const [item, note] = described.orbitals;
    const tagged = { ...described, orbitals: [{ ...item!, traits: item!.traits.map((t) => ({ ...t, ref: 'Door.traits.DoorLife', capabilities: ['hinged'] })) }, note!] };
    const parsed = BehaviorDescriptionSchema.parse(tagged);
    expect(parsed.orbitals[0]?.traits[0]?.ref).toBe('Door.traits.DoorLife');
    expect(parsed.orbitals[0]?.traits[0]?.capabilities).toEqual(['hinged']);
    const older = BehaviorDescriptionSchema.parse(described);
    expect(older.orbitals[0]?.traits[0]?.ref).toBeUndefined();
    expect(older.orbitals[0]?.traits[0]?.capabilities).toBeUndefined();
    expect(() => BehaviorDescriptionSchema.parse({ ...tagged, orbitals: [{ ...item!, traits: item!.traits.map((t) => ({ ...t, capabilities: 'hinged' })) }, note!] })).toThrow();
  });

  it('a page carries its menu label and icon; control: a page without them omits both', () => {
    const [item, note] = described.orbitals;
    const withMenu = { ...described, orbitals: [{ ...item!, pages: [{ name: 'ItemsPage', path: '/items', label: 'Items', icon: 'list' }] }, note!] };
    expect(BehaviorDescriptionSchema.parse(withMenu).orbitals[0]?.pages[0]).toMatchObject({ label: 'Items', icon: 'list' });
    expect(BehaviorDescriptionSchema.parse(described).orbitals[0]?.pages[0]?.label).toBeUndefined();
  });

  it('an orbital lists the controls it forwards to its embedder; a malformed entry is refused; control: an older orb omits them', () => {
    const [item, note] = described.orbitals;
    const withForwards = (forwards: unknown) => ({ ...described, orbitals: [{ ...item!, forwards }, note!] });
    expect(BehaviorDescriptionSchema.parse(withForwards([{ trait: 'ItemList', event: 'EDIT', via: ['detail-panel.actions'] }])).orbitals[0]?.forwards).toEqual([{ trait: 'ItemList', event: 'EDIT', via: ['detail-panel.actions'] }]);
    expect(BehaviorDescriptionSchema.safeParse(withForwards([{ trait: 'ItemList' }])).success).toBe(false);
    expect(BehaviorDescriptionSchema.parse(described).orbitals[0]?.forwards).toBeUndefined();
  });

  it('a trait lists its domain events (orbital and trait descriptions); control: an older orb omits them', () => {
    const [item, note] = described.orbitals;
    const withDomain = { ...described, orbitals: [{ ...item!, traits: item!.traits.map((t) => ({ ...t, events: { ...t.events, domain: ['OPEN'] } })) }, note!] };
    expect(BehaviorDescriptionSchema.parse(withDomain).orbitals[0]?.traits[0]?.events.domain).toEqual(['OPEN']);
    expect(BehaviorDescriptionSchema.parse(described).orbitals[0]?.traits[0]?.events.domain).toBeUndefined();
    const trait = { value: { behavior: './orbitals/shop', trait: 'ItemList' }, knobs: [], events: { emits: [], listens: ['OPEN'], transitions: ['OPEN'], domain: ['OPEN'] }, model: '' };
    expect(TraitDescriptionSchema.parse(trait).events.domain).toEqual(['OPEN']);
    expect(TraitDescriptionSchema.safeParse({ ...trait, events: { ...trait.events, domain: 'OPEN' } }).success).toBe(false);
  });

  it('a trait description carries its printed source with each transition\'s lines; a malformed one is refused; control: an older orb omits it', () => {
    const trait = { value: { behavior: 'std/std-door', trait: 'DoorLife' }, knobs: [], events: { emits: [], listens: [], transitions: ['OPEN'] }, model: '' };
    const source = { text: 'trait DoorLife -> Door {\n  initial: closed\n  state closed {\n    OPEN -> opened\n  }\n}', transitions: [{ index: 0, start: 4, end: 4 }] };
    expect(TraitDescriptionSchema.parse({ ...trait, source }).source?.transitions[0]).toEqual({ index: 0, start: 4, end: 4 });
    expect(TraitDescriptionSchema.safeParse({ ...trait, source: { text: 'x', transitions: [{ index: 0, start: 4 }] } }).success).toBe(false);
    expect(TraitDescriptionSchema.parse(trait).source).toBeUndefined();
  });

  it('a trait description carries its state machine as the program runs it; a malformed one is refused; control: an older orb omits it', () => {
    const trait = { value: { behavior: 'std/std-door', trait: 'DoorLife' }, knobs: [], events: { emits: [], listens: [], transitions: ['OPEN', 'CLOSE'] }, model: '' };
    const machine = {
      linkedEntity: 'Door',
      stateMachine: {
        states: [{ name: 'closed', isInitial: true }, { name: 'opened' }],
        events: [{ key: 'OPEN', name: 'OPEN' }, { key: 'CLOSE', name: 'CLOSE' }],
        transitions: [
          { from: 'closed', to: 'opened', event: 'OPEN', guard: ['not', '@entity.open'], effects: [['set', '@entity.open', true]] },
          { from: 'opened', to: 'closed', event: 'CLOSE', effects: [['set', '@entity.open', false]] },
        ],
      },
    };
    const parsed = TraitDescriptionSchema.parse({ ...trait, machine });
    expect(parsed.machine?.linkedEntity).toBe('Door');
    expect(parsed.machine?.stateMachine.transitions[0]?.guard).toEqual(['not', '@entity.open']);
    expect(parsed.machine?.stateMachine.transitions[1]?.effects).toEqual([['set', '@entity.open', false]]);
    expect(TraitDescriptionSchema.safeParse({ ...trait, machine: { linkedEntity: 'Door' } }).success).toBe(false);
    expect(TraitDescriptionSchema.safeParse({ ...trait, machine: { ...machine, stateMachine: { ...machine.stateMachine, states: [] } } }).success).toBe(false);
    expect(TraitDescriptionSchema.parse(trait).machine).toBeUndefined();
  });

  it('an entity says whether it is stored or page-only; an unknown kind is refused; control: an older orb omits it', () => {
    const [item, note] = described.orbitals;
    const withKind = (persistence: string) => ({ ...described, orbitals: [{ ...item!, entity: { ...item!.entity!, persistence } }, note!] });
    expect(BehaviorDescriptionSchema.parse(withKind('persistent')).orbitals[0]?.entity?.persistence).toBe('persistent');
    expect(BehaviorDescriptionSchema.parse(withKind('runtime')).orbitals[0]?.entity?.persistence).toBe('runtime');
    expect(BehaviorDescriptionSchema.safeParse(withKind('cached')).success).toBe(false);
    expect(BehaviorDescriptionSchema.parse(described).orbitals[0]?.entity?.persistence).toBeUndefined();
  });

  it('an entity says whether it is the identity record; control: an older orb omits it', () => {
    const [item, note] = described.orbitals;
    const parsed = BehaviorDescriptionSchema.parse({ ...described, orbitals: [{ ...item!, entity: { ...item!.entity!, identity: true } }, note!] });
    expect(parsed.orbitals[0]?.entity?.identity).toBe(true);
    expect(BehaviorDescriptionSchema.parse(described).orbitals[0]?.entity?.identity).toBeUndefined();
  });

  it('a knob carries its current default, a list of structs included', () => {
    const navItems = [{ label: 'Home', href: '/' }, { label: 'Admin', href: '/admin', roles: ['owner'] }];
    const knobs = [{ name: 'appName', type: 'string', default: 'Shop' }, { name: 'navItems', type: '[object]', default: navItems, properties: [{ name: 'label', type: 'string', required: true }] }];
    const parsed = BehaviorDescriptionSchema.parse({ ...described, knobs });
    expect(parsed.knobs.map((k) => k.default)).toEqual(['Shop', navItems]);
  });

  it('control: a knob with an unknown key is still refused', () => {
    expect(BehaviorDescriptionSchema.safeParse({ ...described, knobs: [{ name: 'appName', type: 'string', initial: 'Shop' }] }).success).toBe(false);
  });

  it('control: an orbital without its borrows is refused', () => {
    const { borrows: _dropped, ...withoutBorrows } = described.orbitals[0]!;
    expect(BehaviorDescriptionSchema.safeParse({ ...described, orbitals: [withoutBorrows] }).success).toBe(false);
  });

  it('describes a trait value, an orbital value or a bare behavior', () => {
    expect(DescribeTargetSchema.parse(kanban)).toEqual(kanban);
    expect(DescribeTargetSchema.parse({ behavior: 'std/std-kanban', orbital: 'KanbanOrbital' })).toEqual({ behavior: 'std/std-kanban', orbital: 'KanbanOrbital' });
    expect(DescribeTargetSchema.parse({ behavior: 'almadar-behaviors/std-store-solution' })).toEqual({ behavior: 'almadar-behaviors/std-store-solution' });
  });

  it('control: an unknown key or a missing behavior is refused', () => {
    expect(DescribeTargetSchema.safeParse({ behavior: 'std/std-kanban', bogus: 1 }).success).toBe(false);
    expect(DescribeTargetSchema.safeParse({ orbital: 'KanbanOrbital' }).success).toBe(false);
  });
});

describe('KnobFieldSchema forwardedFrom', () => {
  it('accepts the knob a value forwards; control: an unknown key is still refused', () => {
    expect(KnobFieldSchema.safeParse({ name: 'navItems', type: '[object]', default: [], forwardedFrom: '@config.navItems' }).success).toBe(true);
    expect(KnobFieldSchema.safeParse({ name: 'navItems', type: '[object]', forwardedBy: '@config.navItems' }).success).toBe(false);
  });
});
