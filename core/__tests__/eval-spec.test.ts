/**
 * `EvalSpec` — a generator eval as data: the turns a user types, the structural checks each turn's
 * built program must pass, and what the build must adopt. Read by `orb eval` and the TS reference runner.
 */
import { describe, it, expect } from 'vitest';
import { parseEvalSpec, evalPatternMatches, type EvalSpec, type JsonObject } from '../src/types/index.js';

const vetClinic = {
  id: 'vet-clinic',
  class: 'specific',
  turns: ['a vet clinic with pets, owners, visits and vaccination due dates', 'we call them patients, never pets'],
  checks: [
    { id: 'vet-visits', introducedTurn: 0, nouns: { pattern: 'visit', flags: 'i' }, require: [{ kind: 'entity' }, { kind: 'rendered' }] },
    { id: 'vet-patient-vocabulary', introducedTurn: 1, nouns: { pattern: 'patient', flags: 'i' }, require: [{ kind: 'rendered', on: { pattern: 'pet|patient', flags: 'i' } }] },
  ],
} satisfies EvalSpec & JsonObject;
const firstCheck = vetClinic.checks[0];

describe('parseEvalSpec', () => {
  it('reads a multi-turn spec with checks', () => {
    expect(parseEvalSpec(vetClinic)).toEqual(vetClinic);
  });

  it('reads the build expectations: tier, adopted behaviors, orbitals, forbidden sources', () => {
    const spec = parseEvalSpec({
      id: 'ecommerce-fresh-build',
      class: 'plain',
      turns: ['an online store'],
      checks: [],
      expect: { tiers: ['organism'], adopts: ['std-ecommerce'], orbitals: ['ProductOrbital'], validates: true },
      forbidSources: ['std-cms-site'],
    });
    expect(spec.expect?.adopts).toEqual(['std-ecommerce']);
    expect(spec.forbidSources).toEqual(['std-cms-site']);
  });

  it('edge: a spec with no turns is refused', () => {
    expect(() => parseEvalSpec({ ...vetClinic, turns: [] })).toThrow(/turns/);
  });

  it('edge: an unknown predicate kind is refused', () => {
    const bad = { ...vetClinic, checks: [{ ...firstCheck, require: [{ kind: 'vibes' }] }] };
    expect(() => parseEvalSpec(bad)).toThrow();
  });

  it('edge: a check introduced on a turn the spec does not have is refused', () => {
    const bad = { ...vetClinic, checks: [{ ...firstCheck, introducedTurn: 5 }] };
    expect(() => parseEvalSpec(bad)).toThrow(/introducedTurn/);
  });

  it('edge: an invalid pattern is refused', () => {
    const bad = { ...vetClinic, checks: [{ ...firstCheck, nouns: { pattern: '(' } }] };
    expect(() => parseEvalSpec(bad)).toThrow(/pattern/);
  });

  it('reads the absence, orbital and knob predicates', () => {
    const spec = parseEvalSpec({
      id: 'dashboard-chart-type',
      class: 'specific',
      turns: ['a sales dashboard', 'show revenue as a bar chart', 'drop the forecast page'],
      checks: [
        { id: 'no-hr-records', introducedTurn: 0, nouns: { pattern: 'candidate|hire', flags: 'i' }, require: [{ kind: 'absentEntity' }] },
        { id: 'revenue-bar', introducedTurn: 1, nouns: { pattern: 'revenue', flags: 'i' }, require: [{ kind: 'knob', key: 'chartType', value: 'bar' }] },
        { id: 'forecast-gone', introducedTurn: 2, nouns: { pattern: 'forecast', flags: 'i' }, require: [{ kind: 'orbital', absent: true }] },
      ],
    });
    expect(spec.checks.map((c) => c.require[0]?.kind)).toEqual(['absentEntity', 'knob', 'orbital']);
  });

  it('edge: a knob predicate without a key is refused', () => {
    const bad = { ...vetClinic, checks: [{ ...firstCheck, require: [{ kind: 'knob', value: 'bar' }] }] };
    expect(() => parseEvalSpec(bad)).toThrow();
  });

  it('edge: an unknown tier is refused', () => {
    expect(() => parseEvalSpec({ ...vetClinic, expect: { tiers: ['factory'] } })).toThrow();
  });
});

describe('evalPatternMatches', () => {
  it('matches with the declared flags', () => {
    expect(evalPatternMatches({ pattern: 'visit', flags: 'i' }, 'Visits')).toBe(true);
  });

  it('control: without the i flag case matters', () => {
    expect(evalPatternMatches({ pattern: 'visit' }, 'Visits')).toBe(false);
  });
});
