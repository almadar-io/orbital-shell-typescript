import { describe, it, expect } from 'vitest';
import {
  applyDeclarationTraitRenames,
  healTraitLedgerRows,
} from '../src/factory-runtime/apply-params-to-orb.js';
import { asTraitId } from '../src/types/index.js';
import type { OrbitalSchema } from '../src/types/index.js';

// FIX-H(c) (battery 2026-08-06 dashboard-edit-title-string): a trait-instance
// rename applied declaration-only left dangling name-based references —
// `@trait.DefaultRevenueChart` in a sibling trait's config knob
// (`DashboardLayout.config.tile2Trait`) and the page trait ref — while
// validate stayed green (the JS runtime resolves those BY NAME at render).
// The rename must rewrite every reference to the old name, keeping the
// dual-carry ids intact so the compiled path's identity_normalize no-ops.

const AT = '2026-08-06T00:00:00.000Z';
const CHART_ID = asTraitId('trt_chart');

function dashboardSchema(): OrbitalSchema {
  return {
    name: 'fixture',
    version: '1.0.0',
    orbitals: [
      {
        name: 'DashboardOrbital',
        entity: { name: 'Revenue', fields: [] },
        traits: [
          {
            ref: 'Std.traits.UiChart',
            id: CHART_ID,
            name: 'DefaultRevenueChart',
          },
          {
            name: 'DashboardLayout',
            id: asTraitId('trt_layout'),
            scope: 'instance',
            linkedEntity: 'Revenue',
            config: {
              tile2Trait: { type: 'trait', default: '@trait.DefaultRevenueChart', refId: CHART_ID },
              // Boundary check: a LONGER name sharing the prefix must not be rewritten.
              tile3Trait: { type: 'trait', default: '@trait.DefaultRevenueChartExtra' },
            },
            traitEmbedIds: { DefaultRevenueChart: CHART_ID },
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }],
              events: [],
              transitions: [
                {
                  from: 'idle',
                  to: 'idle',
                  event: 'INIT',
                  effects: [['render-ui', 'main', '@trait.DefaultRevenueChart']],
                },
              ],
            },
          },
        ],
        pages: [
          {
            name: 'DashPage',
            path: '/dash',
            traits: [{ ref: 'DefaultRevenueChart', refId: CHART_ID }],
          },
        ],
      },
    ],
    ledger: {
      schemaVersion: 1,
      entries: {
        [CHART_ID]: {
          id: CHART_ID,
          kind: 'trait',
          bakedName: 'DefaultRevenueChart',
          curName: 'DefaultRevenueChart',
          renames: [],
          owner: 'workspace',
        },
      },
    },
  };
}

interface LayoutShape {
  config: Record<string, { default?: string; refId?: string }>;
  stateMachine: { transitions: Array<{ effects?: unknown[][] }> };
  traitEmbedIds?: Record<string, string>;
}

describe('applyDeclarationTraitRenames — reference rewrite (FIX-H)', () => {
  it('rewrites config knob tokens, effect-tree embeds, side-map keys, and page refs; ids stay put', () => {
    const out = applyDeclarationTraitRenames(
      dashboardSchema(),
      new Map([['DefaultRevenueChart', 'QuarterlyRevenueChart']]),
      AT,
    );

    const traits = out.orbitals[0]!.traits;
    const chart = traits[0] as { name?: string };
    const layout = traits[1] as LayoutShape;

    // The declaration itself.
    expect(chart.name).toBe('QuarterlyRevenueChart');

    // Config knob default rewritten; the stamped refId is untouched.
    expect(layout.config['tile2Trait']!.default).toBe('@trait.QuarterlyRevenueChart');
    expect(layout.config['tile2Trait']!.refId).toBe(CHART_ID);
    // Prefix boundary: `@trait.DefaultRevenueChartExtra` is not a reference to the renamed trait.
    expect(layout.config['tile3Trait']!.default).toBe('@trait.DefaultRevenueChartExtra');

    // State-machine embed token rewritten; the side-map key follows the token.
    expect(layout.stateMachine.transitions[0]!.effects![0]).toEqual([
      'render-ui',
      'main',
      '@trait.QuarterlyRevenueChart',
    ]);
    expect(layout.traitEmbedIds).toEqual({ QuarterlyRevenueChart: CHART_ID });

    // Page trait ref rewritten; its refId is untouched.
    const pages = out.orbitals[0]!.pages as Array<{ traits: Array<{ ref: string; refId?: string }> }>;
    expect(pages[0]!.traits[0]!.ref).toBe('QuarterlyRevenueChart');
    expect(pages[0]!.traits[0]!.refId).toBe(CHART_ID);

    // Ledger curName follows the declaration, with the audit row appended.
    const row = out.ledger!.entries[CHART_ID]!;
    expect(row.curName).toBe('QuarterlyRevenueChart');
    expect(row.renames).toEqual([{ from: 'DefaultRevenueChart', to: 'QuarterlyRevenueChart', at: AT }]);
  });

  it('does not mutate the input schema', () => {
    const schema = dashboardSchema();
    applyDeclarationTraitRenames(schema, new Map([['DefaultRevenueChart', 'QuarterlyRevenueChart']]), AT);
    const layout = schema.orbitals[0]!.traits[1] as { config: Record<string, { default?: string }> };
    expect(layout.config['tile2Trait']!.default).toBe('@trait.DefaultRevenueChart');
    expect(schema.ledger!.entries[CHART_ID]!.curName).toBe('DefaultRevenueChart');
  });

  it('returns the input unchanged when the rename map is empty', () => {
    const schema = dashboardSchema();
    expect(applyDeclarationTraitRenames(schema, new Map(), AT)).toBe(schema);
  });
});

describe('healTraitLedgerRows (FIX-I(b) reset support)', () => {
  it('moves a stale adopted ledger row back to the re-emitted declaration name', () => {
    const schema = dashboardSchema();
    // Simulate stamp adopting a PRIOR ledger that recorded the rename.
    schema.ledger!.entries[CHART_ID]!.curName = 'QuarterlyRevenueChart';
    const out = healTraitLedgerRows(schema, AT);
    const row = out.ledger!.entries[CHART_ID]!;
    expect(row.curName).toBe('DefaultRevenueChart');
    expect(row.renames).toEqual([{ from: 'QuarterlyRevenueChart', to: 'DefaultRevenueChart', at: AT }]);
  });

  it('resolves a reference-form declaration name from the ref last segment when name is absent', () => {
    const schema = dashboardSchema();
    const chart = schema.orbitals[0]!.traits[0] as { name?: string };
    delete chart.name;
    schema.ledger!.entries[CHART_ID]!.curName = 'QuarterlyRevenueChart';
    const out = healTraitLedgerRows(schema, AT);
    expect(out.ledger!.entries[CHART_ID]!.curName).toBe('UiChart');
  });

  it('is a no-op when declaration and ledger agree, and when there is no ledger', () => {
    const agreed = dashboardSchema();
    expect(healTraitLedgerRows(agreed, AT)).toBe(agreed);
    const noLedger = dashboardSchema();
    delete noLedger.ledger;
    expect(healTraitLedgerRows(noLedger, AT)).toBe(noLedger);
  });
});
