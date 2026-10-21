/**
 * A described trait (`behavior/describe`, folded at build time on a static site) draws exactly
 * like the same trait read from a schema: one mapping to the diagram's trait data.
 */
import { describe, it, expect } from 'vitest';
import type { OrbitalSchema, StateMachine, Trait, TraitDescription } from '@almadar/core';
import { programTraits, traitLevelFromDescription, traitLevelFromTrait } from '../avl-schema-parser';
import { describedTransitionLines } from '../avl-play';

const stateMachine: StateMachine = {
  states: [{ name: 'closed', isInitial: true }, { name: 'opened' }],
  events: [{ key: 'OPEN', name: 'Open' }, { key: 'CLOSE', name: 'Close' }],
  transitions: [
    { from: 'closed', to: 'opened', event: 'OPEN', guard: ['not', '@entity.open'], effects: [['set', '@entity.open', true]] },
    { from: 'opened', to: 'closed', event: 'CLOSE', effects: [['set', '@entity.open', false], ['emit', 'DOOR_CLOSED']] },
  ],
};

const described: TraitDescription = {
  value: { behavior: 'std/std-door', trait: 'DoorLife' },
  knobs: [],
  events: { emits: ['DOOR_CLOSED'], listens: ['KNOCK'], transitions: ['OPEN', 'CLOSE'] },
  machine: { linkedEntity: 'Door', stateMachine },
  model: '',
};

describe('traitLevelFromDescription', () => {
  it('maps states, transitions (guard and effect code included) and events', () => {
    const level = traitLevelFromDescription(described);
    expect(level?.name).toBe('DoorLife');
    expect(level?.linkedEntity).toBe('Door');
    expect(level?.states.map((s) => s.name)).toEqual(['closed', 'opened']);
    expect(level?.transitions[0]).toMatchObject({ from: 'closed', to: 'opened', event: 'OPEN', guard: ['not', '@entity.open'], index: 0 });
    expect(level?.transitions[1]?.effects).toEqual([
      { type: 'set', args: ['@entity.open', false] },
      { type: 'emit', args: ['DOOR_CLOSED'] },
    ]);
    expect(level?.emittedEvents).toEqual(['DOOR_CLOSED']);
    expect(level?.listenedEvents).toEqual(['KNOCK']);
  });

  it('draws the same as the trait read from its schema', () => {
    const trait: Trait = {
      name: 'DoorLife',
      scope: 'instance',
      stateMachine,
      emits: [{ event: 'DOOR_CLOSED' }],
      listens: [{ event: 'KNOCK', triggers: 'KNOCK' }],
    };
    expect(traitLevelFromDescription(described)).toEqual(traitLevelFromTrait(trait, 'Door'));
  });

  it('control: a description without a machine (an older orb) draws nothing', () => {
    const { machine: _machine, ...older } = described;
    expect(traitLevelFromDescription(older)).toBeNull();
  });
});

describe('describedTransitionLines (the printed lines of the transition that fired)', () => {
  const twoArms: StateMachine = {
    states: [{ name: 'closed', isInitial: true }, { name: 'opened' }],
    events: [{ key: 'OPEN', name: 'Open' }],
    transitions: [
      { from: 'closed', to: 'opened', event: 'OPEN', guard: ['not', '@entity.locked'] },
      { from: 'closed', to: 'closed', event: 'OPEN' },
      { from: 'opened', to: 'closed', event: 'CLOSE' },
    ],
  };
  const printed: TraitDescription = {
    ...described,
    machine: { linkedEntity: 'Door', stateMachine: twoArms },
    source: { text: 'trait DoorLife', transitions: [{ index: 0, start: 3, end: 4 }, { index: 1, start: 5, end: 5 }, { index: 2, start: 7, end: 8 }] },
  };
  const drawn = traitLevelFromTrait({ name: 'HomeDoorLife', scope: 'instance', stateMachine: twoArms }, 'Door');
  if (!drawn) throw new Error('the running trait has a machine');
  const running = drawn;

  it('finds the arm at the same position among its own from --event--> arms', () => {
    expect(describedTransitionLines(printed, running, running.transitions[1])).toEqual({ start: 5, end: 5 });
    expect(describedTransitionLines(printed, running, running.transitions[2])).toEqual({ start: 7, end: 8 });
  });

  it('control: no printed source, or a transition the description lacks, has no lines', () => {
    const { source: _source, ...unprinted } = printed;
    expect(describedTransitionLines(unprinted, running, running.transitions[0])).toBeUndefined();
    expect(describedTransitionLines(printed, running, { from: 'opened', to: 'opened', event: 'KNOCK', guard: null, effects: [], index: 9 })).toBeUndefined();
  });
});

describe('programTraits', () => {
  it('lists every trait with a machine, with its orbital, and skips a trait without one (control)', () => {
    const schema: OrbitalSchema = {
      name: 'Doors',
      orbitals: [{
        name: 'DoorOrbital',
        entity: { name: 'Door', fields: [{ name: 'open', type: 'boolean' }] },
        traits: [
          { name: 'DoorLife', scope: 'instance', stateMachine },
          { name: 'Plain', scope: 'instance' },
        ],
        pages: [],
      }],
    };
    expect(programTraits(schema).map((t) => [t.orbital, t.trait.name, t.level.linkedEntity])).toEqual([['DoorOrbital', 'DoorLife', 'Door']]);
  });
});
