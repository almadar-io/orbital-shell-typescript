import { describe, expect, it } from 'vitest';

import { inlineTraitRefs, unwrapTraitRef } from '../src/types/index.js';
import type { OrbitalDefinition, Trait, TraitReference } from '../src/types/index.js';

const BASE: Trait = {
  name: 'Counter',
  scope: 'instance',
  linkedEntity: 'Item',
  config: { step: { type: 'number', default: 1, label: 'Step' }, label: { type: 'string', default: 'n' } },
  stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [] },
};

function orbital(...traits: OrbitalDefinition['traits']): OrbitalDefinition {
  return { name: 'O', entity: 'Item', pages: [], traits };
}

describe('unwrapTraitRef', () => {
  it('unwraps a ref wrapper to its resolved trait and returns the call-site config', () => {
    const wrapper: TraitReference = { ref: 'Atom.traits.Counter', config: { step: 5 }, _resolved: BASE };
    expect(unwrapTraitRef(wrapper)).toEqual({ trait: BASE, config: { step: 5 } });
  });

  it('returns an inline trait, a string ref and a wrapper without _resolved unchanged', () => {
    const bare: TraitReference = { ref: 'Atom.traits.Counter', config: { step: 5 } };
    expect(unwrapTraitRef(BASE)).toEqual({ trait: BASE });
    expect(unwrapTraitRef('Counter')).toEqual({ trait: 'Counter' });
    expect(unwrapTraitRef(bare)).toEqual({ trait: bare });
  });

  it('returns no config for a wrapper carrying none', () => {
    expect(unwrapTraitRef({ ref: 'A.traits.Counter', _resolved: BASE })).toEqual({ trait: BASE });
  });
});

describe('inlineTraitRefs', () => {
  it('folds the call-site config onto the resolved trait knobs', () => {
    const [out] = inlineTraitRefs([orbital({ ref: 'A.traits.Counter', config: { step: 5 }, _resolved: BASE })]);
    const [trait] = out.traits;
    expect(trait).toMatchObject({ name: 'Counter', config: { step: { type: 'number', default: 5, label: 'Step' }, label: { type: 'string', default: 'n' } } });
    expect(BASE.config?.step).toEqual({ type: 'number', default: 1, label: 'Step' });
  });

  it('returns the resolved trait as is when the wrapper has no config', () => {
    const [out] = inlineTraitRefs([orbital({ ref: 'A.traits.Counter', _resolved: BASE })]);
    expect(out.traits[0]).toBe(BASE);
  });

  it('leaves an already-inline trait, a string ref and an unresolved wrapper untouched', () => {
    const bare: TraitReference = { ref: 'A.traits.Counter', config: { step: 5 } };
    const [out] = inlineTraitRefs([orbital(BASE, 'Other', bare)]);
    expect(out.traits).toEqual([BASE, 'Other', bare]);
    expect(out.traits[0]).toBe(BASE);
  });

  it('keeps the orbital fields and does not mutate its input', () => {
    const wrapper: TraitReference = { ref: 'A.traits.Counter', config: { step: 5 }, _resolved: BASE };
    const input = [orbital(wrapper)];
    const [out] = inlineTraitRefs(input);
    expect(out).toMatchObject({ name: 'O', entity: 'Item' });
    expect(input[0].traits[0]).toBe(wrapper);
  });
});
