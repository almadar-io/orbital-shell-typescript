import { describe, it, expect } from 'vitest';
import { diffSchemaSemantics } from '../src/diff';
import type { OrbitalSchema, TraitRef } from '../src/types';

const schema = (traits: TraitRef[]): OrbitalSchema => ({
  name: 'app',
  orbitals: [{ name: 'FlagOrbital', entity: { name: 'Flag', fields: [{ name: 'id', type: 'string' }] }, traits, pages: [] }],
});

const composed = (config: Record<string, string>, extra: Partial<Exclude<TraitRef, string>> = {}): TraitRef => ({
  ref: 'std-flag.traits.Flag',
  name: 'ListingFlag',
  linkedEntity: 'Flag',
  config,
  ...extra,
});

const inline = (title?: string): TraitRef => ({
  name: 'Local',
  scope: 'instance',
  ...(title !== undefined ? { config: { title: { type: 'string', default: title } } } : {}),
  stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [] },
});

describe('diffSchemaSemantics — composed (ref) traits', () => {
  it('reports a config edit on a composed trait', () => {
    const changes = diffSchemaSemantics(schema([composed({ title: 'Flag a Listing' })]), schema([composed({ title: 'Listings' })]));
    expect(changes).toEqual([{ kind: 'trait-config-changed', orbitalName: 'FlagOrbital', traitName: 'ListingFlag' }]);
  });

  it('reports nothing for an identical composed trait (control)', () => {
    expect(diffSchemaSemantics(schema([composed({ title: 'A' })]), schema([composed({ title: 'A' })]))).toEqual([]);
  });

  it('reports a composed trait added and removed', () => {
    expect(diffSchemaSemantics(schema([]), schema([composed({})]))).toEqual([
      { kind: 'trait-added', orbitalName: 'FlagOrbital', traitName: 'ListingFlag' },
    ]);
    expect(diffSchemaSemantics(schema([composed({})]), schema([]))).toEqual([
      { kind: 'trait-removed', orbitalName: 'FlagOrbital', traitName: 'ListingFlag' },
    ]);
  });

  it('keys a nameless composed trait by its ref', () => {
    const bare: TraitRef = { ref: 'std-flag.traits.Flag', config: { title: 'A' } };
    const edited: TraitRef = { ref: 'std-flag.traits.Flag', config: { title: 'B' } };
    expect(diffSchemaSemantics(schema([bare]), schema([edited]))).toEqual([
      { kind: 'trait-config-changed', orbitalName: 'FlagOrbital', traitName: 'std-flag.traits.Flag' },
    ]);
  });

  it('re-pointing a composed trait to another atom is a remove + add', () => {
    const changes = diffSchemaSemantics(schema([composed({})]), schema([composed({}, { ref: 'std-report.traits.Report' })]));
    expect(changes).toEqual([
      { kind: 'trait-removed', orbitalName: 'FlagOrbital', traitName: 'ListingFlag' },
      { kind: 'trait-added', orbitalName: 'FlagOrbital', traitName: 'ListingFlag' },
    ]);
  });

  it('reports rebinding a composed trait (linkedEntity / events) as event wiring', () => {
    const changes = diffSchemaSemantics(
      schema([composed({})]),
      schema([composed({}, { linkedEntity: 'Listing', events: { SUBMIT: 'FLAG_SUBMITTED' } })]),
    );
    expect(changes).toEqual([{ kind: 'event-wiring-changed', orbitalName: 'FlagOrbital', traitName: 'ListingFlag' }]);
  });

  it('reports a config edit on an inline trait too', () => {
    expect(diffSchemaSemantics(schema([inline('A')]), schema([inline('B')]))).toEqual([
      { kind: 'trait-config-changed', orbitalName: 'FlagOrbital', traitName: 'Local' },
    ]);
  });

  it('an inline trait becoming composed under the same name is a remove + add', () => {
    const asComposed: TraitRef = { ref: 'std-local.traits.Local', name: 'Local' };
    expect(diffSchemaSemantics(schema([inline()]), schema([asComposed]))).toEqual([
      { kind: 'trait-removed', orbitalName: 'FlagOrbital', traitName: 'Local' },
      { kind: 'trait-added', orbitalName: 'FlagOrbital', traitName: 'Local' },
    ]);
  });
});

describe('diffSchemaSemantics — theme', () => {
  const base = schema([]);
  it('an orbital theme change is reported on that orbital', () => {
    const after: OrbitalSchema = { ...base, orbitals: [{ ...base.orbitals[0], theme: 'ocean' }] };
    expect(diffSchemaSemantics(base, after)).toEqual([{ kind: 'theme-changed', orbitalName: 'FlagOrbital' }]);
  });

  it('an app-level theme or token change is reported on every orbital', () => {
    const two: OrbitalSchema = { ...base, orbitals: [base.orbitals[0], { ...base.orbitals[0], name: 'Other' }] };
    expect(diffSchemaSemantics(two, { ...two, theme: 'ocean' })).toEqual([
      { kind: 'theme-changed', orbitalName: 'FlagOrbital' },
      { kind: 'theme-changed', orbitalName: 'Other' },
    ]);
    expect(diffSchemaSemantics(two, { ...two, designTokens: { colors: { primary: '#000' } } })).toHaveLength(2);
  });

  it('an unchanged theme reports nothing (control)', () => {
    const themed: OrbitalSchema = { ...base, theme: 'ocean' };
    expect(diffSchemaSemantics(themed, { ...themed })).toEqual([]);
  });
});
