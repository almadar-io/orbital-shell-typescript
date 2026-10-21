import { describe, it, expect } from 'vitest';
import type { OrbitalSchema, Trait, TraitEventListener, TraitId } from '@almadar/core';
import { isInlineTrait, isTraitId } from '@almadar/core';
import { traitEventWires } from '../avl-event-wires';

const tid = (s: string): TraitId => {
  if (!isTraitId(s)) throw new Error(`not a trait id: ${s}`);
  return s;
};

const trait = (name: string, emits: string[], listens: TraitEventListener[]): Trait => ({
  name,
  scope: 'instance',
  emits: emits.map((event) => ({ event })),
  listens,
  stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [] },
});
const listen = (event: string, source?: TraitEventListener['source']): TraitEventListener => ({
  event,
  triggers: event,
  ...(source ? { source } : {}),
});
const schema = (...orbitals: Array<{ name: string; traits: OrbitalSchema['orbitals'][number]['traits'] }>): OrbitalSchema => ({
  name: 'App',
  orbitals: orbitals.map((o) => ({ name: o.name, entity: { name: `${o.name}Row`, fields: [] }, pages: [], traits: o.traits })),
});
const pairs = (s: OrbitalSchema) => traitEventWires(s).map((w) => `${w.emitterOrbital}.${w.emitterTrait}->${w.listenerOrbital}.${w.listenerTrait}:${w.event}`);

describe('traitEventWires — who the runtime actually delivers to', () => {
  it('a trait-scoped listen hears only that trait in its own orbital, even when another orbital emits the same name', () => {
    const s = schema(
      { name: 'A', traits: [trait('Browse', ['CREATE'], []), trait('Form', [], [listen('CREATE', { kind: 'trait', trait: 'Browse' })])] },
      { name: 'B', traits: [trait('Browse', ['CREATE'], []), trait('Form', [], [listen('CREATE', { kind: 'trait', trait: 'Browse' })])] },
    );
    expect(pairs(s)).toEqual(['A.Browse->A.Form:CREATE', 'B.Browse->B.Form:CREATE']);
  });

  it('an orbital-scoped listen hears exactly the named orbital trait', () => {
    const s = schema(
      { name: 'Intake', traits: [trait('Flow', ['SUBMITTED'], [])] },
      { name: 'Other', traits: [trait('Flow', ['SUBMITTED'], [])] },
      { name: 'Patient', traits: [trait('Chart', [], [listen('SUBMITTED', { kind: 'orbital', orbital: 'Intake', trait: 'Flow' })])] },
    );
    expect(pairs(s)).toEqual(['Intake.Flow->Patient.Chart:SUBMITTED']);
  });

  it('a bare listen hears every emitter of the event, as the runtime bus delivers it', () => {
    const s = schema(
      { name: 'A', traits: [trait('Emit', ['PING'], []), trait('Hear', [], [listen('PING')])] },
      { name: 'B', traits: [trait('Emit', ['PING'], [])] },
    );
    expect(pairs(s)).toEqual(['A.Emit->A.Hear:PING', 'B.Emit->A.Hear:PING']);
  });

  it('a legacy dotted listen names its source', () => {
    const s = schema(
      { name: 'A', traits: [trait('Emit', ['PING'], [])] },
      { name: 'B', traits: [trait('Emit', ['PING'], [])] },
      { name: 'C', traits: [trait('Hear', [], [listen('B.Emit.PING')])] },
    );
    expect(pairs(s)).toEqual(['B.Emit->C.Hear:PING']);
  });

  it('control: a trait hearing its own emit is not a wire', () => {
    const s = schema({ name: 'A', traits: [trait('Loop', ['TICK'], [listen('TICK')])] });
    expect(pairs(s)).toEqual([]);
  });

  it('a composed trait is read through its resolved atom under its call-site name', () => {
    const s = schema(
      { name: 'A', traits: [{ ref: 'Lib.traits.Emitter', name: 'Sender', _resolved: trait('Emitter', ['GO'], []) }] },
      { name: 'B', traits: [trait('Hear', [], [listen('GO', { kind: 'orbital', orbital: 'A', trait: 'Sender' })])] },
    );
    expect(pairs(s)).toEqual(['A.Sender->B.Hear:GO']);
  });

  it('control: an unresolved ref contributes nothing', () => {
    const s = schema({ name: 'A', traits: [{ ref: 'Lib.traits.Emitter' }] }, { name: 'B', traits: [trait('Hear', [], [listen('GO')])] });
    expect(pairs(s)).toEqual([]);
  });

  it('a listen naming its source by id matches the emitter by id (the rename-proof path)', () => {
    const emitter = { ...trait('Create', ['SAVE'], []), id: tid('trt_create') };
    const listener = trait('Persistor', [], [listen('SAVE', { kind: 'trait', trait: 'Create', traitId: tid('trt_create') })]);
    expect(pairs(schema({ name: 'A', traits: [emitter, listener] }))).toEqual(['A.Create->A.Persistor:SAVE']);
  });

  it('control: an id that names another trait does not match, whatever the name says', () => {
    const emitter = { ...trait('Create', ['SAVE'], []), id: tid('trt_create') };
    const listener = trait('Persistor', [], [listen('SAVE', { kind: 'trait', trait: 'Create', traitId: tid('trt_other') })]);
    expect(pairs(schema({ name: 'A', traits: [emitter, listener] }))).toEqual([]);
  });
});

describe('traitEventWires — computed once per schema', () => {
  // The pairwise definition the indexed scan must reproduce, wire for wire and in order.
  const reference = (s: OrbitalSchema): string[] => {
    const instances = s.orbitals.flatMap((o) => (o.traits ?? []).flatMap((t) => (isInlineTrait(t) ? [{ orbital: o.name, trait: t }] : [])));
    const out: string[] = [];
    for (const e of instances) for (const emit of e.trait.emits ?? []) for (const l of instances) {
      if (l.orbital === e.orbital && l.trait.name === e.trait.name) continue;
      for (const ln of l.trait.listens ?? []) {
        const scoped = ln.source?.kind === 'trait' ? l.orbital === e.orbital && ln.source.trait === e.trait.name : true;
        if (ln.event === emit.event && scoped) out.push(`${e.orbital}.${e.trait.name}->${l.orbital}.${l.trait.name}:${emit.event}`);
      }
    }
    return out;
  };
  const wide = (n: number): OrbitalSchema => schema(...Array.from({ length: n }, (_, i) => ({
    name: `O${i}`,
    traits: [
      trait('Browse', ['CREATE', `PING${i % 3}`], [listen('SAVED', { kind: 'trait', trait: 'Form' })]),
      trait('Form', ['SAVED'], [listen('CREATE', { kind: 'trait', trait: 'Browse' }), listen(`PING${(i + 1) % 3}`)]),
    ],
  })));

  it('the indexed scan yields exactly the pairwise wires, in schema order', () => {
    const s = wide(12);
    expect(pairs(s)).toEqual(reference(s));
  });

  it('a second call on the same schema reuses the first result', () => {
    const s = wide(4);
    expect(traitEventWires(s)).toBe(traitEventWires(s));
  });

  it('control: a different schema object is computed afresh', () => {
    const s = wide(4);
    const next = { ...s, orbitals: s.orbitals.slice(0, 2) };
    expect(traitEventWires(next)).not.toBe(traitEventWires(s));
    expect(pairs(next)).toEqual(reference(next));
  });
});
