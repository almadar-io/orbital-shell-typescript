/**
 * A reference-form orbital (`orbital X = Alias.orbitals.Y { … }`) is emitted by
 * the compiler with the placeholder entity `Alias.orbitals.Y.entity`, its
 * import body under `reference`, and no `pages` of its own (they come from the
 * upstream). The core schema must accept that shape, as orbital-core does.
 */
import { describe, it, expect } from 'vitest';
import { safeParseOrbitalSchema } from '../index';

function schemaWith(entity: string, pages?: []) {
  return {
    name: 'App',
    orbitals: [
      {
        name: 'HelpOrbital',
        uses: [{ from: 'std/behaviors/std-agent-assistant', as: 'Agent' }],
        entity,
        traits: [],
        ...(pages ? { pages } : {}),
        reference: { ref: 'Agent.orbitals.AgentAssistantOrbital', omit: ['AssistantDock'] },
      },
    ],
  };
}

describe('reference-form orbital parse', () => {
  it('accepts the emitted placeholder entity and no pages', () => {
    const result = safeParseOrbitalSchema(schemaWith('Agent.orbitals.AgentAssistantOrbital.entity'));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.orbitals[0].pages).toEqual([]);
  });

  it('control: the alias entity form still parses', () => {
    expect(safeParseOrbitalSchema(schemaWith('Agent.entity', [])).success).toBe(true);
  });

  it('edge: a malformed entity reference is still rejected', () => {
    expect(safeParseOrbitalSchema(schemaWith('Agent.orbitals.entity')).success).toBe(false);
    expect(safeParseOrbitalSchema(schemaWith('agent.entity')).success).toBe(false);
  });
});
