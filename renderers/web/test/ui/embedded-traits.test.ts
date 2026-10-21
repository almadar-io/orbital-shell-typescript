import { describe, it, expect } from 'vitest';
import type { ResolvedTrait } from '@almadar/core';
import { collectTraitRefsFromResolvedTrait } from '../../src/lib/embedded-traits';

// Minimal valid ResolvedTrait with a render-ui transition + tick that reference
// embedded `@trait.X` siblings. Regression for the multi-orbital "stuck loading"
// bug: an embed-routed sibling (e.g. a pulled calendar) must be discoverable from
// the page trait that references it, so OrbPreview can add it to the state-machine
// binding set (otherwise its own fetch-success is never heard).
function trait(overrides: Partial<ResolvedTrait>): ResolvedTrait {
  return {
    name: 'PageTrait',
    source: 'inline',
    states: [],
    events: [],
    transitions: [],
    guards: [],
    ticks: [],
    listens: [],
    dataEntities: [],
    ...overrides,
  } as ResolvedTrait;
}

describe('collectTraitRefsFromResolvedTrait', () => {
  it('collects @trait.X references from transition render-ui effects', () => {
    const t = trait({
      transitions: [
        {
          effects: [
            ['render-ui', 'main', { type: 'stack', children: ['@trait.InterviewWeek', { type: 'divider' }] }],
          ],
        },
      ],
    } as Partial<ResolvedTrait>);
    const refs = collectTraitRefsFromResolvedTrait(t);
    expect(refs.has('InterviewWeek')).toBe(true);
  });

  it('collects refs from tick effects too, and ignores non-@trait strings', () => {
    const t = trait({
      ticks: [{ effects: [['render-ui', 'main', { content: '@trait.SidebarMeta', label: 'plain text' }]] }],
    } as Partial<ResolvedTrait>);
    const refs = collectTraitRefsFromResolvedTrait(t);
    expect(refs.has('SidebarMeta')).toBe(true);
    expect(refs.has('plain text')).toBe(false);
  });

  it('returns an empty set for a trait with no embedded refs', () => {
    const t = trait({
      transitions: [{ effects: [['render-ui', 'main', { type: 'data-grid', entity: '@payload.data' }]] }],
    } as Partial<ResolvedTrait>);
    expect(collectTraitRefsFromResolvedTrait(t).size).toBe(0);
  });
});
