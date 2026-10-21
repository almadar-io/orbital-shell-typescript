import { describe, it, expect } from 'vitest';
import { buildOrbitalsByTrait } from '../../src/lib/orbitalsByTrait';

// Regression for the multi-orbital "stuck loading" bug: a trait auto-pulled
// into an orbital by the compiler's sibling-pull (e.g. an embedded @trait
// calendar) is NOT in the source orbital's `traits[]`. If the orbital map is
// built from the source schema only, the pulled trait gets no entry, its
// self-subscription (`UI:<orbital>.<trait>.<event>`) is never registered, and
// its own fetch-success (CalendarEventLoaded) is never heard → it sticks in
// `loading`. Backfilling from the resolved page bindings fixes it.
describe('buildOrbitalsByTrait', () => {
  const schema = {
    orbitals: [
      {
        name: 'InterviewScheduleOrbital',
        // InterviewWeek is NOT declared here — it is sibling-pulled at resolve.
        traits: [
          { ref: 'AppShell.traits.AppLayout', name: 'InterviewScheduleAppLayout' },
          { name: 'InterviewScheduleList' },
        ],
        pages: [{ path: '/interviews' }],
      },
      {
        name: 'JobOpeningOrbital',
        traits: [{ name: 'JobOpeningCatalog' }],
        pages: [{ path: '/jobs' }],
      },
    ],
  };

  it('maps source-declared traits to their orbital', () => {
    const map = buildOrbitalsByTrait(schema);
    expect(map.InterviewScheduleAppLayout).toBe('InterviewScheduleOrbital');
    expect(map.InterviewScheduleList).toBe('InterviewScheduleOrbital');
    expect(map.JobOpeningCatalog).toBe('JobOpeningOrbital');
  });

  it('backfills an auto-pulled sibling from the resolved page → its orbital', () => {
    const resolvedPages = [
      { path: '/interviews', traitNames: ['InterviewScheduleAppLayout', 'InterviewScheduleList', 'InterviewWeek'] },
    ];
    const map = buildOrbitalsByTrait(schema, resolvedPages);
    // The fix: the pulled sibling now resolves to its page's orbital.
    expect(map.InterviewWeek).toBe('InterviewScheduleOrbital');
  });

  it('lets source-declared mappings win over the IR backfill', () => {
    // JobOpeningCatalog is declared in JobOpeningOrbital; even if a resolved
    // page on another orbital lists it, the source mapping must not be clobbered.
    const resolvedPages = [
      { path: '/interviews', traitNames: ['JobOpeningCatalog'] },
    ];
    const map = buildOrbitalsByTrait(schema, resolvedPages);
    expect(map.JobOpeningCatalog).toBe('JobOpeningOrbital');
  });

  it('returns an empty map for a schema with no orbitals', () => {
    expect(buildOrbitalsByTrait(undefined)).toEqual({});
    expect(buildOrbitalsByTrait({ orbitals: [] })).toEqual({});
  });
});
