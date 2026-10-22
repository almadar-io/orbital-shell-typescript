/**
 * A browser tick tagged `[visible]` pauses while its trait is off screen, so the
 * resolved tick a client runs must carry the tag.
 */
import { describe, it, expect } from 'vitest';
import { parseOrbitalSchema } from '../src/types/schema.js';
import { schemaToIR } from '../src/resolver.js';

const schema = parseOrbitalSchema({
  name: 'TickApp',
  orbitals: [{
    name: 'ClockOrbital',
    entity: { name: 'Clock', persistence: 'runtime', fields: [{ name: 'id', type: 'string', required: true }, { name: 'n', type: 'number' }] },
    traits: [{
      name: 'ClockTrait',
      scope: 'instance',
      linkedEntity: 'Clock',
      stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [] },
      ticks: [
        { name: 'kept', interval: 100, whileVisible: true, effects: [['set', '@entity.n', 1]] },
        { name: 'paused', interval: 100, effects: [['set', '@entity.n', 2]] },
      ],
    }],
    pages: [],
  }],
});

describe('schemaToIR carries a tick\'s visible tag', () => {
  const ticks = schemaToIR(schema, false).traits.get('ClockTrait')?.ticks ?? [];
  it('a [visible] tick resolves with whileVisible', () => {
    expect(ticks.find((t) => t.name === 'kept')?.whileVisible).toBe(true);
  });
  it('control: an untagged tick keeps running off screen', () => {
    expect(ticks.find((t) => t.name === 'paused')?.whileVisible).toBe(false);
  });
});
