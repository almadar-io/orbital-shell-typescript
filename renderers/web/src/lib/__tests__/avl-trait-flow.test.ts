import { describe, it, expect } from 'vitest';
import type { OrbitalSchema, Trait, TraitEventListener, TraitId } from '@almadar/core';
import { isTraitId } from '@almadar/core';
import { flowNeighbors, traitFlowCanvas, traitFlowGraph } from '../avl-trait-flow';

const listen = (event: string, trait: string): TraitEventListener => ({ event, triggers: event, source: { kind: 'trait', trait } });
const trait = (name: string, o: Partial<Trait> = {}): Trait => ({
  name,
  scope: 'instance',
  stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [] },
  ...o,
});
const from = (behavior: string) => ({ sourceBehavior: { alias: behavior, behavior: `std/behaviors/${behavior}`, originalName: 'X' } });
const id = (s: string): TraitId => {
  if (!isTraitId(s)) throw new Error(`not a trait id: ${s}`);
  return s;
};

const schema: OrbitalSchema = {
  name: 'App',
  orbitals: [{
    name: 'Appointments',
    entity: { name: 'Appointment', fields: [] },
    pages: [],
    traits: [
      trait('Persistor', { emits: [{ event: 'CREATED' }], listens: [listen('SAVE', 'Form')] }),
      trait('Router', { listens: [listen('VIEW', 'List')] }),
      trait('List', { ...from('std-browse'), id: id('trt_list'), emits: [{ event: 'VIEW' }, { event: 'EDIT' }], listens: [listen('CREATED', 'Persistor')], traitEmbedIds: { Text1: id('trt_t1'), Text2: id('trt_t2') } }),
      trait('ListText1', { ...from('ui-typography'), id: id('trt_t1') }),
      trait('ListText2', { ...from('ui-typography'), id: id('trt_t2') }),
      trait('Form', { ...from('std-modal'), emits: [{ event: 'SAVE' }], listens: [listen('EDIT', 'List')] }),
      trait('FormTwo', { ...from('std-modal') }),
      trait('Lonely'),
    ],
  }],
};
const layers = { 'std-browse': 'std' as const, 'std-modal': 'std' as const, 'ui-typography': 'primitive' as const };

describe('traitFlowGraph — an orbital as the units its traits come from', () => {
  const g = traitFlowGraph(schema, 'Appointments', layers);
  const unit = (uid: string) => g.units.find((u) => u.id === uid);

  it('own traits stand alone; composed traits group by the behavior they came from', () => {
    expect(g.units.map((u) => u.id)).toEqual(['trait:Persistor', 'trait:Router', 'trait:Lonely', 'behavior:std-browse', 'behavior:ui-typography', 'behavior:std-modal']);
    expect(unit('behavior:std-modal')).toMatchObject({ traits: ['Form', 'FormTwo'], renderPieces: [] });
  });

  it('an embedded trait counts as a render piece of its group, not a trait', () => {
    expect(unit('behavior:ui-typography')).toMatchObject({ traits: [], renderPieces: ['ListText1', 'ListText2'], column: 'primitive' });
    expect(unit('behavior:std-browse')).toMatchObject({ traits: ['List'], renderPieces: [], column: 'std' });
  });

  it('rolls trait wires up into unit edges carrying their events, never within a unit', () => {
    expect(g.edges.map((e) => `${e.source}>${e.target}:${e.events.join(',')}`).sort()).toEqual([
      'behavior:std-browse>behavior:std-modal:EDIT',
      'behavior:std-browse>trait:Router:VIEW',
      'behavior:std-modal>trait:Persistor:SAVE',
      'trait:Persistor>behavior:std-browse:CREATED',
    ]);
  });

  it('control: without a dependency graph a composed unit sits in the unknown column', () => {
    expect(traitFlowGraph(schema, 'Appointments').units.find((u) => u.id === 'behavior:std-modal')?.column).toBe('unknown');
  });
});

describe('flowNeighbors — one hop each way, so a loop does not light everything', () => {
  const g = traitFlowGraph(schema, 'Appointments', layers);
  it('what triggers the selection and what it triggers', () => {
    const n = flowNeighbors(g.edges, 'behavior:std-browse');
    expect([...n.triggeredBy]).toEqual(['trait:Persistor']);
    expect([...n.triggers].sort()).toEqual(['behavior:std-modal', 'trait:Router']);
  });

  it('control: a unit on the loop does not reach back around it', () => {
    const n = flowNeighbors(g.edges, 'trait:Persistor');
    expect([...n.triggers]).toEqual(['behavior:std-browse']);
    expect(n.triggers.has('behavior:std-modal')).toBe(false);
  });
});

describe('traitFlowCanvas — each wire leaves and arrives on the side facing the other end', () => {
  const canvas = traitFlowCanvas(traitFlowGraph(schema, 'Appointments', layers));
  const sides = (source: string, target: string) => {
    const e = canvas.edges.find((x) => x.source === source && x.target === target);
    return [e?.sourceHandle, e?.targetHandle];
  };

  it('left to right leaves on the right and arrives on the left', () => {
    expect(sides('trait:Persistor', 'behavior:std-browse')).toEqual(['out-right', 'in-left']);
  });

  it('right to left leaves on the left and arrives on the right (no loop across the canvas)', () => {
    expect(sides('behavior:std-modal', 'trait:Persistor')).toEqual(['out-left', 'in-right']);
  });

  it('within one column it loops out on the right', () => {
    expect(sides('behavior:std-browse', 'behavior:std-modal')).toEqual(['out-right', 'in-right']);
  });
});

