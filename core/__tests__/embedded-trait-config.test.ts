import { describe, it, expect } from 'vitest';
import { collectForwardedConfigKeys, traitDeclaresConfigForward } from '../src/embedded-trait-config.js';
import type { DeclaredTraitConfig, Trait } from '../src/types/index.js';

describe('collectForwardedConfigKeys — nested reads', () => {
  const trait = (config: DeclaredTraitConfig): Trait => ({ name: 'WeeklyStats', scope: 'instance', linkedEntity: 'Note', stateMachine: { states: [], events: [], transitions: [] }, config });

  it('publishes a knob whose token sits inside an array element', () => {
    const traits = [trait({ metrics: { type: 'array', default: [{ label: 'Wins', target: '@config.weeklyWinTarget' }] } })];
    expect([...collectForwardedConfigKeys(traits)]).toEqual(['weeklyWinTarget']);
  });

  it('publishes a folded nested read from its provenance', () => {
    const traits = [trait({ metrics: { type: 'array', default: [{ target: 2 }], nestedForwardedFrom: ['@config.weeklyWinTarget'] } })];
    expect([...collectForwardedConfigKeys(traits)]).toEqual(['weeklyWinTarget']);
  });

  it('control: a dotted nested path publishes nothing', () => {
    const traits = [trait({ metrics: { type: 'array', default: [{ max: '@config.limits.max' }] } })];
    expect(collectForwardedConfigKeys(traits).size).toBe(0);
  });
});

// Twin of `config_type.rs` `trait_config_declares_forward`: a whole-default
// forward or a nested token naming a knob the trait does NOT declare is a
// forward; a nested read of its own knob is not.
describe('traitDeclaresConfigForward — own-knob reads', () => {
  const trait = (config: DeclaredTraitConfig): Trait => ({ name: 'Child', scope: 'instance', stateMachine: { states: [], events: [], transitions: [] }, config });

  it('a whole-default forward is a forward, even under its own name', () => {
    expect(traitDeclaresConfigForward(trait({ title: { type: 'string', default: '@config.title' } }))).toBe(true);
  });

  it('control: a nested read of an own knob is not a forward', () => {
    expect(traitDeclaresConfigForward(trait({
      title: { type: 'string', default: 'Stats' },
      body: { type: 'unknown', default: { type: 'typography', content: '@config.title' } },
    }))).toBe(false);
  });

  it('edge: a nested token naming an undeclared knob is a forward', () => {
    expect(traitDeclaresConfigForward(trait({ body: { type: 'unknown', default: { content: '@config.heading' } } }))).toBe(true);
  });
});
