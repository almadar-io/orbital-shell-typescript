/**
 * The canvas shows one orbital card (local) or every card (world); a card's
 * state is picked from a dropdown whose options are the orbital's render-ui
 * transitions — one per distinct render for designers, one per transition
 * otherwise, imported behaviors grouped by alias.
 */
import { describe, it, expect } from 'vitest';
import type { OrbitalSchema } from '@almadar/core';
import { stateOptionsOf, canvasViewGraph, initialStateOf, LIVE_STATE, canvasViewChanged, optionForPlayedStep } from '../avl-preview-converter';

const list = { type: 'data-list', entity: 'Task' };
const schema = {
  name: 'canvas-view',
  version: '1.0.0',
  orbitals: [
    {
      name: 'Tasks',
      entity: { name: 'Task', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
      traits: [
        {
          name: 'Browse',
          scope: 'collection',
          linkedEntity: 'Task',
          emits: [{ event: 'TASK_OPENED', scope: 'external' }],
          stateMachine: {
            states: [{ name: 'browsing', isInitial: true }, { name: 'editing' }],
            events: [],
            transitions: [
              { from: 'browsing', to: 'browsing', event: 'INIT', effects: [['render-ui', 'main', { type: 'loading-state' }]] },
              { from: 'browsing', to: 'browsing', event: 'LOADED', effects: [['render-ui', 'main', list]] },
              { from: 'browsing', to: 'browsing', event: 'LOAD_FAILED', effects: [['render-ui', 'main', { type: 'error-state' }]] },
              { from: 'browsing', to: 'browsing', event: 'SAVED', effects: [['render-ui', 'main', list]] },
              { from: 'browsing', to: 'editing', event: 'EDIT', effects: [['render-ui', 'main', { type: 'form' }]] },
              { from: 'editing', to: 'browsing', event: 'CANCEL', effects: [['set', '@entity.id', 'x']] },
            ],
          },
        },
        {
          name: 'Stats',
          scope: 'instance',
          linkedEntity: 'Task',
          sourceBehavior: { alias: 'Stat', behavior: 'std-stat-card' },
          stateMachine: {
            states: [{ name: 'idle', isInitial: true }],
            events: [],
            transitions: [
              { from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'aside', { type: 'stat-card' }]] },
              { from: 'idle', to: 'idle', event: 'REFRESH', effects: [['render-ui', 'aside', { type: 'stat-card', label: 'x' }]] },
            ],
          },
        },
      ],
      pages: [{ name: 'Main', path: '/tasks', traits: [{ ref: 'Browse' }] }],
    },
    {
      name: 'Notes',
      entity: { name: 'Note', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
      traits: [
        {
          name: 'Listen',
          scope: 'instance',
          linkedEntity: 'Note',
          listens: [{ event: 'TASK_OPENED', triggers: 'SHOW', scope: 'external' }],
          stateMachine: {
            states: [{ name: 'idle', isInitial: true }],
            events: [],
            transitions: [{ from: 'idle', to: 'idle', event: 'SHOW', effects: [['set', '@entity.id', 'y']] }],
          },
        },
      ],
      pages: [{ name: 'Notes', path: '/notes', traits: [{ ref: 'Listen' }] }],
    },
  ],
} as OrbitalSchema;

const events = (opts: { data: { transitionEvent?: string } }[]) => opts.map((o) => o.data.transitionEvent);

describe('stateOptionsOf', () => {
  it('designers get one option per distinct render; identical renders merge', () => {
    const { own } = stateOptionsOf(schema, 'Tasks', 'screens');
    expect(events(own)).toEqual(['INIT', 'LOADED', 'LOAD_FAILED', 'EDIT']);
    expect(own.find((o) => o.data.transitionEvent === 'LOADED')?.data.enteredBy).toEqual(['LOADED', 'SAVED']);
  });

  it('two different renders of one state stay apart, and their labels tell them apart', () => {
    const labels = stateOptionsOf(schema, 'Tasks', 'screens').own.map((o) => o.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.filter((l) => l.startsWith('browsing'))).toHaveLength(3);
    expect(labels).toContain('editing');
  });

  it('architects and builders get one option per render-ui transition', () => {
    expect(events(stateOptionsOf(schema, 'Tasks', 'transitions').own)).toEqual(['INIT', 'LOADED', 'LOAD_FAILED', 'SAVED', 'EDIT']);
  });

  it('a transition that renders nothing is never an option', () => {
    expect(events(stateOptionsOf(schema, 'Tasks', 'transitions').own)).not.toContain('CANCEL');
  });

  it('an imported behavior is an option group holding its own states', () => {
    const { groups } = stateOptionsOf(schema, 'Tasks', 'transitions');
    expect(groups.map((g) => [g.alias, g.behaviorName])).toEqual([['Stat', 'std-stat-card']]);
    expect(events(groups[0].options)).toEqual(['INIT', 'REFRESH']);
  });

  it('an option carries the card data a state render needs', () => {
    const edit = stateOptionsOf(schema, 'Tasks', 'screens').own.find((o) => o.data.transitionEvent === 'EDIT');
    expect(edit?.data).toMatchObject({ orbitalName: 'Tasks', traitName: 'Browse', fromState: 'browsing', toState: 'editing', cardLabel: 'screen' });
  });

  it('a trait embedded in another trait\'s render is part of that screen, never a state of its own', () => {
    const embedded = structuredClone(schema);
    const [tasks] = embedded.orbitals;
    const browse = tasks.traits[0];
    if (typeof browse !== 'object' || !('stateMachine' in browse) || !browse.stateMachine) throw new Error('fixture');
    browse.stateMachine.transitions[4].effects = [['render-ui', 'main', { type: 'stack', children: ['@trait.Stats'] }]];
    const { own, groups } = stateOptionsOf(embedded, 'Tasks', 'transitions');
    expect(groups).toEqual([]);
    expect(own.map((o) => o.data.traitName)).not.toContain('Stats');
  });

  it('a list spanning several traits names the trait in each label, so no two entries read alike', () => {
    const twoLayouts = structuredClone(schema);
    const [tasks] = twoLayouts.orbitals;
    const stats = tasks.traits[1];
    if (typeof stats !== 'object' || !('stateMachine' in stats)) throw new Error('fixture');
    tasks.traits.push({ ...structuredClone(stats), name: 'DetailStats' });
    const [group] = stateOptionsOf(twoLayouts, 'Tasks', 'screens').groups;
    const labels = group.options.map((o) => o.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.filter((l) => l.startsWith('DetailStats · '))).toHaveLength(2);
    expect(stateOptionsOf(schema, 'Tasks', 'screens').own.every((o) => !o.label.startsWith('Browse'))).toBe(true);
  });

  it('an orbital with no render-ui transitions has no options', () => {
    expect(stateOptionsOf(schema, 'Notes', 'screens')).toEqual({ own: [], groups: [] });
  });

  it('an unknown orbital has no options', () => {
    expect(stateOptionsOf(schema, 'Missing', 'screens')).toEqual({ own: [], groups: [] });
  });
});

describe('stateOptionsOf — guarded arms of one transition (G-UI-059)', () => {
  // Two INIT arms on `composing` (as std-app-layout has), told apart by their guards
  // and rendering different screens.
  const guarded = {
    ...schema,
    orbitals: [{
      name: 'Shell',
      entity: { name: 'Layout', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
      traits: [{
        name: 'AppLayout',
        scope: 'instance',
        linkedEntity: 'Layout',
        stateMachine: {
          states: [{ name: 'composing', isInitial: true }],
          events: [],
          transitions: [
            { from: 'composing', to: 'composing', event: 'INIT', guard: ['=', '@config.mode', 'a'], effects: [['render-ui', 'main', { type: 'loading-state' }]] },
            { from: 'composing', to: 'composing', event: 'INIT', guard: ['=', '@config.mode', 'b'], effects: [['render-ui', 'main', { type: 'error-state' }]] },
          ],
        },
      }],
      pages: [{ name: 'Main', path: '/', traits: [{ ref: 'AppLayout' }] }],
    }],
  } as OrbitalSchema;

  for (const view of ['screens', 'transitions'] as const) {
    it(`${view}: each arm is its own option — distinct ids and labels`, () => {
      const { own } = stateOptionsOf(guarded, 'Shell', view);
      expect(own.map((o) => o.id)).toEqual(['AppLayout:INIT:composing:composing', 'AppLayout:INIT:composing:composing#2']);
      expect(new Set(own.map((o) => o.label)).size).toBe(2);
      expect(own[1].label).toContain('(guard 2)');
    });
  }

  it('a played step still maps onto the first arm', () => {
    const options = stateOptionsOf(guarded, 'Shell', 'screens');
    expect(optionForPlayedStep(options, { trait: 'AppLayout', event: 'INIT', from: 'composing', to: 'composing' })).toBe('AppLayout:INIT:composing:composing');
  });
});

describe('initialStateOf', () => {
  it('is the INIT state — in designer screens too, where INIT may be one of several events', () => {
    expect(initialStateOf(stateOptionsOf(schema, 'Tasks', 'screens'))).toBe('Browse:INIT:browsing:browsing');
    expect(initialStateOf(stateOptionsOf(schema, 'Tasks', 'transitions'))).toBe('Browse:INIT:browsing:browsing');
  });

  // An orbital whose own states are only overlays (loading / open / error)
  // opens on its imported app layout's INIT screen — never an overlay's
  // intermediate state (std-notes opened on "loading").
  it('without an own INIT render, an imported behavior\'s INIT beats a non-INIT own state', () => {
    const own = stateOptionsOf(schema, 'Tasks', 'transitions');
    const noInit = { ...own, own: own.own.filter((o) => o.data.transitionEvent !== 'INIT') };
    const groupInit = own.groups.flatMap((g) => g.options).find((o) => o.data.transitionEvent === 'INIT');
    expect(groupInit).toBeDefined();
    expect(noInit.own.length).toBeGreaterThan(0);
    expect(initialStateOf(noInit)).toBe(groupInit?.id);
  });

  it('control: with no INIT anywhere, the first own state, then the first imported state', () => {
    const own = stateOptionsOf(schema, 'Tasks', 'transitions');
    const notInit = (o: { data: { transitionEvent?: string } }) => o.data.transitionEvent !== 'INIT';
    const groups = own.groups.map((g) => ({ ...g, options: g.options.filter(notInit) })).filter((g) => g.options.length > 0);
    const ownOnly = own.own.filter(notInit);
    expect(initialStateOf({ own: ownOnly, groups })).toBe(ownOnly[0].id);
    expect(initialStateOf({ own: [], groups })).toBe(groups[0].options[0].id);
  });

  // A modal listed first whose only INIT render fires from `open` (closing it again) is not
  // the screen the app opens on: it starts `closed`, so that INIT never runs on open. The
  // layout whose INIT fires from its initial state is.
  it('an INIT render counts as the opening screen only when it fires from its trait\'s initial state', () => {
    const modalFirst = {
      name: 'opening-screen',
      version: '1.0.0',
      orbitals: [{
        name: 'Providers',
        entity: { name: 'Provider', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        traits: [
          {
            name: 'Create',
            scope: 'instance',
            linkedEntity: 'Provider',
            stateMachine: {
              states: [{ name: 'closed', isInitial: true }, { name: 'open' }],
              events: [],
              transitions: [
                { from: 'closed', to: 'open', event: 'CREATE', effects: [['render-ui', 'modal', { type: 'form' }]] },
                { from: 'open', to: 'closed', event: 'INIT', effects: [['render-ui', 'modal', { type: 'box' }]] },
              ],
            },
          },
          {
            name: 'Shell',
            scope: 'instance',
            linkedEntity: 'Provider',
            stateMachine: {
              states: [{ name: 'composing', isInitial: true }],
              events: [],
              transitions: [{ from: 'composing', to: 'composing', event: 'INIT', effects: [['render-ui', 'main', list]] }],
            },
          },
        ],
        pages: [{ name: 'Providers', path: '/providers', traits: [{ ref: 'Create' }, { ref: 'Shell' }] }],
      }],
    } as OrbitalSchema;
    expect(initialStateOf(stateOptionsOf(modalFirst, 'Providers', 'transitions'))).toBe('Shell:INIT:composing:composing');
    expect(initialStateOf(stateOptionsOf(modalFirst, 'Providers', 'screens'))).toBe('Shell:INIT:composing:composing');
  });

  it('with no render-ui states at all, the live orbital', () => {
    expect(initialStateOf({ own: [], groups: [] })).toBe(LIVE_STATE);
  });
});

describe('canvasViewGraph', () => {
  const base = { view: 'screens' as const };

  it('local shows only the focused orbital, at the origin (its world position is irrelevant)', () => {
    const g = canvasViewGraph(schema, { ...base, scope: 'local', focusedOrbital: 'Notes' });
    expect(g.nodes.map((n) => n.id)).toEqual(['Notes']);
    expect(g.nodes[0].position).toEqual({ x: 0, y: 0 });
    const world = canvasViewGraph(schema, { ...base, scope: 'world', focusedOrbital: 'Notes' });
    expect(world.nodes.find((n) => n.id === 'Notes')?.position).not.toEqual({ x: 0, y: 0 });
    expect(g.worldPositions.Notes).toEqual(world.nodes.find((n) => n.id === 'Notes')?.position);
    expect(g.edges).toEqual([]);
    expect(g.focusedOrbital).toBe('Notes');
  });

  it('local focuses the first orbital when none (or an unknown one) is asked for', () => {
    expect(canvasViewGraph(schema, { ...base, scope: 'local' }).nodes.map((n) => n.id)).toEqual(['Tasks']);
    expect(canvasViewGraph(schema, { ...base, scope: 'local', focusedOrbital: 'Gone' }).focusedOrbital).toBe('Tasks');
  });

  it('world shows every orbital with the cross-orbital edges, and marks the focused card', () => {
    const g = canvasViewGraph(schema, { ...base, scope: 'world', focusedOrbital: 'Notes' });
    expect(g.nodes.map((n) => n.id)).toEqual(['Tasks', 'Notes']);
    expect(g.edges.map((e) => [e.source, e.target])).toEqual([['Tasks', 'Notes']]);
    expect(g.nodes.map((n) => n.data.focused)).toEqual([false, true]);
  });

  it('a card shows its INIT state by default', () => {
    const [card] = canvasViewGraph(schema, { ...base, scope: 'local' }).nodes;
    expect(card.data).toMatchObject({ traitName: 'Browse', transitionEvent: 'INIT' });
  });

  it('an orbital without render-ui states shows the live orbital', () => {
    const [card] = canvasViewGraph(schema, { ...base, scope: 'local', focusedOrbital: 'Notes' }).nodes;
    expect(card.data.traitName).toBeUndefined();
  });

  it('a picked state swaps the card to that state and keeps the card identity', () => {
    const edit = stateOptionsOf(schema, 'Tasks', 'screens').own.find((o) => o.data.transitionEvent === 'EDIT');
    const [card] = canvasViewGraph(schema, { ...base, scope: 'local', stateByOrbital: { Tasks: edit?.id ?? '' } }).nodes;
    expect(card.id).toBe('Tasks');
    expect(card.data).toMatchObject({ traitName: 'Browse', transitionEvent: 'EDIT', toState: 'editing' });
  });

  it('a state inside an imported behavior can be picked', () => {
    const refresh = stateOptionsOf(schema, 'Tasks', 'transitions').groups[0].options[1];
    const [card] = canvasViewGraph(schema, { view: 'transitions', scope: 'local', stateByOrbital: { Tasks: refresh.id } }).nodes;
    expect(card.data).toMatchObject({ traitName: 'Stats', transitionEvent: 'REFRESH' });
  });

  it('a picked state that no longer exists falls back to the INIT state', () => {
    const [card] = canvasViewGraph(schema, { ...base, scope: 'local', stateByOrbital: { Tasks: 'Browse:GONE:browsing:browsing' } }).nodes;
    expect(card.data.transitionEvent).toBe('INIT');
  });

  it('LIVE_STATE picks the live orbital', () => {
    const [card] = canvasViewGraph(schema, { ...base, scope: 'local', stateByOrbital: { Tasks: LIVE_STATE } }).nodes;
    expect(card.data.traitName).toBeUndefined();
  });

  it('an edge keeps its trigger handle only while the source card renders that trigger', () => {
    const g = canvasViewGraph(schema, { ...base, scope: 'world', stateByOrbital: { Tasks: LIVE_STATE } });
    expect(g.edges.every((e) => e.sourceHandle === undefined)).toBe(true);
  });

  it('an empty schema has no cards and no focus', () => {
    const g = canvasViewGraph({ name: 'empty', version: '1.0.0', orbitals: [] } as OrbitalSchema, { ...base, scope: 'local' });
    expect(g).toEqual({ nodes: [], edges: [], focusedOrbital: undefined, worldPositions: {} });
  });
});

// The viewport is re-fitted only when the VIEW changes — first load, Focus/All,
// another orbital, another screen size — never when the workspace updates the
// schema under an unchanged view (that used to zoom out and lose the user's place).
describe('canvasViewChanged', () => {
  const view = { scope: 'local' as const, focusedOrbital: 'Contacts', screenSize: 'laptop' as const };

  it('the first view is a change (fit on load)', () => {
    expect(canvasViewChanged(null, view)).toBe(true);
  });

  it('control: the same view after a schema update is not a change', () => {
    expect(canvasViewChanged(view, { ...view })).toBe(false);
  });

  it('switching Focus/All, the focused orbital, or the screen size is a change', () => {
    expect(canvasViewChanged(view, { ...view, scope: 'world' })).toBe(true);
    expect(canvasViewChanged(view, { ...view, focusedOrbital: 'Deals' })).toBe(true);
    expect(canvasViewChanged(view, { ...view, screenSize: 'mobile' })).toBe(true);
  });

  it('the focused orbital disappearing (focus falls back) is a change', () => {
    expect(canvasViewChanged(view, { ...view, focusedOrbital: undefined })).toBe(true);
  });
});
