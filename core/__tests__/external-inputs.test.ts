/**
 * `externalInputsOf` — the one owner of "which events may an outside client send
 * which trait": every `stateMachine.events[]` entry marked `external: true` on an
 * inline trait, with its payload schema and annotations. Hosts (runtime, compiled
 * server), MCP and the verify planner read it; nothing re-derives it.
 */

import { describe, it, expect } from 'vitest';
import { externalInputsOf, findExternalInput, type OrbitalSchema } from '../index';

const schema: OrbitalSchema = {
  name: 'App',
  orbitals: [
    {
      name: 'TaskOrbital',
      entity: { name: 'Task', collection: 'tasks', persistence: 'persistent', fields: [{ name: 'id', type: 'string', required: true }] },
      traits: [
        {
          name: 'TaskPersistor',
          scope: 'instance',
          linkedEntity: 'Task',
          stateMachine: {
            states: [{ name: 'idle', isInitial: true }],
            events: [
              { key: 'INIT', name: 'Init' },
              {
                key: 'DO_CREATE',
                name: 'Do create',
                external: true,
                description: 'Create a task',
                payloadSchema: [{ name: 'title', type: 'string', required: true }],
              },
              { key: 'SAVE', name: 'Save' },
            ],
            transitions: [
              { from: 'idle', to: 'idle', event: 'INIT' },
              { from: 'idle', to: 'idle', event: 'DO_CREATE' },
            ],
          },
        },
      ],
      pages: [],
    },
  ],
};

describe('externalInputsOf', () => {
  it('lists each declared external input with its orbital, trait, payload and annotations', () => {
    expect(externalInputsOf(schema)).toEqual([
      {
        orbital: 'TaskOrbital',
        trait: 'TaskPersistor',
        event: 'DO_CREATE',
        payloadSchema: [{ name: 'title', type: 'string', required: true }],
        description: 'Create a task',
      },
    ]);
  });

  it('control: events without the marker are not inputs', () => {
    expect(externalInputsOf(schema).map((i) => i.event)).not.toContain('SAVE');
    expect(externalInputsOf(schema).map((i) => i.event)).not.toContain('INIT');
  });

  it('an empty program has no inputs', () => {
    expect(externalInputsOf({ name: 'Empty', orbitals: [] })).toEqual([]);
  });
});

describe('findExternalInput', () => {
  it('finds a declared input by orbital, trait and event', () => {
    expect(findExternalInput(schema, 'TaskOrbital', 'TaskPersistor', 'DO_CREATE')?.event).toBe('DO_CREATE');
  });

  it('returns nothing for an event that is not an input, a wrong trait, or a wrong orbital', () => {
    expect(findExternalInput(schema, 'TaskOrbital', 'TaskPersistor', 'SAVE')).toBeUndefined();
    expect(findExternalInput(schema, 'TaskOrbital', 'Other', 'DO_CREATE')).toBeUndefined();
    expect(findExternalInput(schema, 'Other', 'TaskPersistor', 'DO_CREATE')).toBeUndefined();
  });
});
