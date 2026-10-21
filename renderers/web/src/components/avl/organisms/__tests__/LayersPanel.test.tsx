/**
 * schemaToLayerItems — pure mapper tests (no rendering).
 *
 * Fixture models one orbital with a page, a trait, a transition that
 * renders a pattern into a slot, and a transition with no render-ui effect
 * (to prove empty transitions don't fabricate slot/pattern nodes) — plus a
 * second, otherwise-empty orbital to prove multiple roots stay isolated.
 */
import { describe, it, expect } from 'vitest';
import type { OrbitalSchema } from '@almadar/core';
import { schemaToLayerItems, parseLayerId } from '../LayersPanel';

const schema: OrbitalSchema = {
  name: 'FixtureApp',
  orbitals: [
    {
      name: 'TaskBoard',
      entity: {
        name: 'Task',
        fields: [{ name: 'title', type: 'string' }],
      },
      pages: [{ name: 'TasksPage', path: '/tasks' }],
      traits: [
        {
          name: 'TaskList',
          scope: 'collection',
          linkedEntity: 'Task',
          stateMachine: {
            states: [{ name: 'idle', isInitial: true }, { name: 'loaded' }],
            events: [
              { key: 'LOAD', name: 'Load' },
              { key: 'REFRESH', name: 'Refresh' },
            ],
            transitions: [
              {
                from: 'idle',
                to: 'loaded',
                event: 'LOAD',
                effects: [['render-ui', 'main', { type: 'badge' }]],
              },
              {
                from: 'loaded',
                to: 'loaded',
                event: 'REFRESH',
                effects: [],
              },
            ],
          },
        },
      ],
    },
    {
      name: 'UserProfile',
      entity: {
        name: 'User',
        fields: [{ name: 'name', type: 'string' }],
      },
      pages: [],
      traits: [],
    },
  ],
};

describe('schemaToLayerItems', () => {
  const items = schemaToLayerItems(schema);
  const byId = new Map(items.map((item) => [item.id, item]));

  it('roots one item per orbital, with no parentId', () => {
    expect(byId.get('orbital:TaskBoard')).toMatchObject({ label: 'TaskBoard' });
    expect(byId.get('orbital:TaskBoard')?.parentId).toBeUndefined();
    expect(byId.get('orbital:UserProfile')).toMatchObject({ label: 'UserProfile' });
    expect(byId.get('orbital:UserProfile')?.parentId).toBeUndefined();
  });

  it('nests a page leaf under its owning orbital', () => {
    const page = byId.get('orbital:TaskBoard/page:TasksPage');
    expect(page).toMatchObject({ label: 'TasksPage', parentId: 'orbital:TaskBoard' });
  });

  it('nests a trait under its owning orbital', () => {
    const trait = byId.get('orbital:TaskBoard/trait:TaskList');
    expect(trait).toMatchObject({ label: 'TaskList', parentId: 'orbital:TaskBoard' });
  });

  it('nests transitions under their trait, indexed for stability (not by event name)', () => {
    const t0 = byId.get('orbital:TaskBoard/trait:TaskList/transition:0');
    const t1 = byId.get('orbital:TaskBoard/trait:TaskList/transition:1');
    expect(t0).toMatchObject({ label: 'LOAD', parentId: 'orbital:TaskBoard/trait:TaskList' });
    expect(t1).toMatchObject({ label: 'REFRESH', parentId: 'orbital:TaskBoard/trait:TaskList' });
  });

  it('nests a slot target under its transition, named by the slot', () => {
    const slot = byId.get('orbital:TaskBoard/trait:TaskList/transition:0/slot:main');
    expect(slot).toMatchObject({ label: 'main', parentId: 'orbital:TaskBoard/trait:TaskList/transition:0' });
  });

  it('nests the render-ui root pattern leaf under the slot, labeled with the pattern type', () => {
    const pattern = byId.get('orbital:TaskBoard/trait:TaskList/transition:0/slot:main/pattern:0:root');
    expect(pattern).toMatchObject({
      label: 'badge',
      parentId: 'orbital:TaskBoard/trait:TaskList/transition:0/slot:main',
    });
  });

  it('does not fabricate slot/pattern nodes for a transition with no render-ui effect', () => {
    const hasChildOfEmptyTransition = items.some(
      (item) => item.parentId === 'orbital:TaskBoard/trait:TaskList/transition:1',
    );
    expect(hasChildOfEmptyTransition).toBe(false);
  });

  it('leaves a trait-less, page-less orbital as a childless root', () => {
    const children = items.filter((item) => item.parentId === 'orbital:UserProfile');
    expect(children).toHaveLength(0);
  });

  it('produces globally unique ids', () => {
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every non-root parentId resolves to another item in the list (stable, parseable paths)', () => {
    for (const item of items) {
      if (item.parentId !== undefined) {
        expect(byId.has(item.parentId)).toBe(true);
      }
    }
  });

  it('returns an empty list for a schema with no orbitals', () => {
    expect(schemaToLayerItems({ ...schema, orbitals: [] })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Nested pattern children
// ---------------------------------------------------------------------------

/**
 * container(root)
 *   [0] typography (text: 'Hello')
 *   [1] '@entity.title'          — binding, not a row, but consumes index 1
 *   [2] container
 *     [0] button (label: 'Submit')
 *     [1] typography (text: 'World')
 */
const nestedSchema: OrbitalSchema = {
  name: 'FixtureNested',
  orbitals: [
    {
      name: 'Panel',
      entity: { name: 'Item', fields: [{ name: 'title', type: 'string' }] },
      pages: [],
      traits: [
        {
          name: 'PanelView',
          scope: 'collection',
          linkedEntity: 'Item',
          stateMachine: {
            states: [{ name: 'idle', isInitial: true }],
            events: [{ key: 'LOAD', name: 'Load' }],
            transitions: [
              {
                from: 'idle',
                to: 'idle',
                event: 'LOAD',
                effects: [
                  [
                    'render-ui',
                    'main',
                    {
                      type: 'container',
                      children: [
                        { type: 'typography', text: 'Hello' },
                        '@entity.title',
                        {
                          type: 'container',
                          children: [
                            { type: 'button', label: 'Submit' },
                            { type: 'typography', text: 'World' },
                          ],
                        },
                      ],
                    },
                  ],
                ],
              },
            ],
          },
        },
      ],
    },
  ],
};

describe('schemaToLayerItems — nested pattern children', () => {
  const items = schemaToLayerItems(nestedSchema);
  const byId = new Map(items.map((item) => [item.id, item]));
  const slotId = 'orbital:Panel/trait:PanelView/transition:0/slot:main';

  it('emits a row for the render-ui root, parented to the slot', () => {
    const root = byId.get(`${slotId}/pattern:0:root`);
    expect(root).toMatchObject({ label: 'container', parentId: slotId });
  });

  it('emits a row for every nested pattern, addressed at its raw children-array index', () => {
    const child0 = byId.get(`${slotId}/pattern:0:root.children.0`);
    expect(child0).toMatchObject({
      label: 'typography — Hello',
      parentId: `${slotId}/pattern:0:root`,
    });

    // index 1 is the '@entity.title' binding — no row for it, but its slot
    // in the array is still spent, so the nested container is index 2.
    const nestedContainer = byId.get(`${slotId}/pattern:0:root.children.2`);
    expect(nestedContainer).toMatchObject({
      label: 'container',
      parentId: `${slotId}/pattern:0:root`,
    });

    const grandchild0 = byId.get(`${slotId}/pattern:0:root.children.2.children.0`);
    expect(grandchild0).toMatchObject({
      label: 'button — Submit',
      parentId: `${slotId}/pattern:0:root.children.2`,
    });

    const grandchild1 = byId.get(`${slotId}/pattern:0:root.children.2.children.1`);
    expect(grandchild1).toMatchObject({
      label: 'typography — World',
      parentId: `${slotId}/pattern:0:root.children.2`,
    });
  });

  it('does not fabricate a row for the "@entity.title" binding child', () => {
    expect(byId.has(`${slotId}/pattern:0:root.children.1`)).toBe(false);
  });

  it('the full pattern subtree is exactly 5 rows — one per nested pattern, none for the binding', () => {
    const patternRows = items.filter((item) => item.id.startsWith(`${slotId}/pattern:`));
    expect(patternRows).toHaveLength(5);
  });

  it('round-trips every pattern id through parseLayerId to (SchemaLoc fields, patternPath)', () => {
    const patternRows = items.filter((item) => item.id.startsWith(`${slotId}/pattern:`));
    expect(patternRows.length).toBeGreaterThan(0);
    for (const row of patternRows) {
      const parsed = parseLayerId(row.id);
      expect(parsed).toMatchObject({
        orbitalName: 'Panel',
        traitName: 'PanelView',
        transitionIndex: 0,
        slotName: 'main',
        patternSlotIndex: 0,
      });
      expect(parsed?.patternPath).toBeDefined();
    }

    expect(parseLayerId(`${slotId}/pattern:0:root.children.2.children.1`)).toEqual({
      orbitalName: 'Panel',
      traitName: 'PanelView',
      transitionIndex: 0,
      slotName: 'main',
      patternSlotIndex: 0,
      patternPath: 'root.children.2.children.1',
    });
  });
});

/**
 * `typography` (and other text-bearing patterns) carry their visible text in
 * `content`, not `label`/`text` — `distinguishingSuffix` previously only
 * read the latter two, so sibling `typography` rows were indistinguishable
 * (all labeled plain "typography"). Found via a Playwright layer-drag e2e
 * spec that filters rows by their text content.
 */
const contentSchema: OrbitalSchema = {
  name: 'FixtureContent',
  orbitals: [
    {
      name: 'List',
      entity: { name: 'Item', fields: [{ name: 'title', type: 'string' }] },
      pages: [],
      traits: [
        {
          name: 'ListView',
          scope: 'collection',
          linkedEntity: 'Item',
          stateMachine: {
            states: [{ name: 'idle', isInitial: true }],
            events: [{ key: 'LOAD', name: 'Load' }],
            transitions: [
              {
                from: 'idle',
                to: 'idle',
                event: 'LOAD',
                effects: [
                  [
                    'render-ui',
                    'main',
                    {
                      type: 'stack',
                      children: [
                        { type: 'typography', content: 'Item A' },
                        { type: 'typography', content: 'Item B' },
                      ],
                    },
                  ],
                ],
              },
            ],
          },
        },
      ],
    },
  ],
};

describe('schemaToLayerItems — distinguishingSuffix reads `content`', () => {
  const items = schemaToLayerItems(contentSchema);
  const byId = new Map(items.map((item) => [item.id, item]));
  const slotId = 'orbital:List/trait:ListView/transition:0/slot:main';

  it('labels each typography row with its own `content` text, not the bare pattern type', () => {
    expect(byId.get(`${slotId}/pattern:0:root.children.0`)).toMatchObject({
      label: 'typography — Item A',
    });
    expect(byId.get(`${slotId}/pattern:0:root.children.1`)).toMatchObject({
      label: 'typography — Item B',
    });
  });
});

describe('parseLayerId', () => {
  it('parses every non-pattern level of the id scheme', () => {
    expect(parseLayerId('orbital:TaskBoard')).toEqual({ orbitalName: 'TaskBoard' });
    expect(parseLayerId('orbital:TaskBoard/page:TasksPage')).toEqual({
      orbitalName: 'TaskBoard',
      pageName: 'TasksPage',
    });
    expect(parseLayerId('orbital:TaskBoard/trait:TaskList')).toEqual({
      orbitalName: 'TaskBoard',
      traitName: 'TaskList',
    });
    expect(parseLayerId('orbital:TaskBoard/trait:TaskList/transition:0')).toEqual({
      orbitalName: 'TaskBoard',
      traitName: 'TaskList',
      transitionIndex: 0,
    });
    expect(parseLayerId('orbital:TaskBoard/trait:TaskList/transition:0/slot:main')).toEqual({
      orbitalName: 'TaskBoard',
      traitName: 'TaskList',
      transitionIndex: 0,
      slotName: 'main',
    });
  });

  it('returns null for a malformed id', () => {
    expect(parseLayerId('')).toBeNull();
    expect(parseLayerId('not-an-orbital-id')).toBeNull();
    expect(parseLayerId('orbital:X/bogus:segment')).toBeNull();
  });
});
