import { describe, it, expect } from 'vitest';
import type { OrbitalSchema, Trait, TraitEventListener } from '@almadar/core';
import { schemaToSystemGraph, SYSTEM_CHIP } from '../avl-preview-converter';

const trait = (name: string, emits: string[], listens: TraitEventListener[] = []): Trait => ({
  name,
  scope: 'instance',
  emits: emits.map((event) => ({ event })),
  listens,
  stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [] },
});
const from = (orbital: string, t: string, event: string): TraitEventListener => ({ event, triggers: event, source: { kind: 'orbital', orbital, trait: t } });
const orbital = (name: string, traits: Trait[]) => ({ name, entity: { name: `${name}Row`, fields: [{ name: 'a', type: 'string' as const }] }, pages: [], traits });
const schema = (...orbitals: ReturnType<typeof orbital>[]): OrbitalSchema => ({ name: 'App', orbitals });

const byId = (g: ReturnType<typeof schemaToSystemGraph>, id: string) => g.nodes.find((n) => n.id === id);

describe('schemaToSystemGraph — the whole app as a system map', () => {
  const g = schemaToSystemGraph(schema(
    orbital('Intake', [trait('Flow', ['SUBMITTED', 'AMENDED'])]),
    orbital('Patient', [trait('Chart', ['CHARTED'], [from('Intake', 'Flow', 'SUBMITTED'), from('Intake', 'Flow', 'AMENDED')])]),
    orbital('Billing', [trait('Bill', [], [from('Patient', 'Chart', 'CHARTED')])]),
    orbital('Person', [trait('Browse', ['CREATE'])]),
    orbital('Checkin', [trait('Browse', ['CREATE'], [{ event: 'CREATE', triggers: 'CREATE', source: { kind: 'trait', trait: 'Browse' } }])]),
  ));

  it('draws one edge per orbital pair, carrying every event it delivers', () => {
    expect(g.edges.map((e) => [e.source, e.target, e.data?.event])).toEqual([
      ['Intake', 'Patient', 'SUBMITTED, AMENDED'],
      ['Patient', 'Billing', 'CHARTED'],
    ]);
  });

  it('control: two orbitals emitting the same name with trait-scoped listens are not wired', () => {
    expect(g.edges.some((e) => e.source === 'Person' || e.target === 'Checkin')).toBe(false);
  });

  it('lays connected orbitals left to right by event direction', () => {
    const x = (id: string) => byId(g, id)?.position.x ?? -1;
    expect(x('Intake')).toBe(0);
    expect(x('Patient')).toBe(SYSTEM_CHIP.width + SYSTEM_CHIP.gapX);
    expect(x('Billing')).toBe(2 * (SYSTEM_CHIP.width + SYSTEM_CHIP.gapX));
  });

  it('puts orbitals that exchange nothing in a standalone band below the connected one', () => {
    expect(byId(g, '__band_connected')?.data).toMatchObject({ kind: 'system-band', bandKind: 'connected', bandCount: 3 });
    expect(byId(g, '__band_standalone')?.data).toMatchObject({ bandKind: 'standalone', bandCount: 2 });
    const connectedBottom = Math.max(...['Intake', 'Patient', 'Billing'].map((id) => (byId(g, id)?.position.y ?? 0) + SYSTEM_CHIP.height));
    expect(byId(g, 'Person')?.position.y).toBeGreaterThan(connectedBottom);
  });

  it('gives each chip its entity, size and the events it exchanges', () => {
    expect(byId(g, 'Patient')?.data).toMatchObject({ kind: 'system-orbital', entityName: 'PatientRow', fieldCount: 1, traitCount: 1, wireEvents: ['SUBMITTED', 'AMENDED', 'CHARTED'] });
    expect(byId(g, 'Person')?.data.wireEvents).toEqual([]);
  });

  it('a cycle still terminates and keeps every orbital', () => {
    const c = schemaToSystemGraph(schema(
      orbital('A', [trait('T', ['PING'], [from('B', 'T', 'PONG')])]),
      orbital('B', [trait('T', ['PONG'], [from('A', 'T', 'PING')])]),
    ));
    expect(c.nodes.filter((n) => n.data.kind === 'system-orbital').map((n) => n.id).sort()).toEqual(['A', 'B']);
    expect(c.edges).toHaveLength(2);
  });

  it('control: an app with no wires is one standalone band', () => {
    const s = schemaToSystemGraph(schema(orbital('Solo', [trait('T', ['X'])])));
    expect(s.nodes.map((n) => n.id)).toEqual(['__band_standalone', 'Solo']);
    expect(s.edges).toEqual([]);
  });
});
