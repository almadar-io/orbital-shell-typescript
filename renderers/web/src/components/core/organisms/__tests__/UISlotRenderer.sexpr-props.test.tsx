// @vitest-environment jsdom
/**
 * A prop the registry types `sexpr` (a program held as data, e.g. `flow-canvas.schema`) passes
 * through untouched: a `@trait.X` inside it is part of the program, never a trait to embed. When it
 * was substituted, the designer's canvas received React elements in place of the app's embeds and
 * drew "Unknown pattern" cards.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import type { PatternPropDef } from '@almadar/core';
import { renderPatternProps } from '../UISlotRenderer';

const program = {
  name: 'App',
  orbitals: [{ name: 'O', traits: [{ name: 'Shell', stateMachine: { transitions: [{ event: 'INIT', effects: [['render-ui', 'main', { type: 'stack', children: ['@trait.Header'] }]] }] } }] }],
};

const sexpr: PatternPropDef = { types: ['sexpr'] };
const node: PatternPropDef = { types: ['node'] };
const payload: PatternPropDef = { types: ['object'], eventPayloadBrand: true };
const dispatches: PatternPropDef = {
  types: ['array'],
  items: { types: ['object'], properties: { kind: { types: ['string'] }, label: { types: ['string'] }, response: { types: ['object'], eventPayloadBrand: true } } },
};
const paintedResponse = { success: true, emittedEvents: [{ event: 'GUEST_PAINTS', payload: { paints: [{ slot: 'main', trait: 'Shell', content: { type: 'stack', children: ['@trait.Search'] } }] } }] };

describe('renderPatternProps and program-as-data props', () => {
  it('passes a sexpr prop through unchanged, embeds and all', () => {
    const out = renderPatternProps({ schema: program }, () => undefined, { schema: sexpr });
    expect(out.schema).toBe(program);
  });

  it('control: a node prop holding a @trait.X still becomes a rendered trait', () => {
    const out = renderPatternProps({ main: '@trait.Header' }, () => undefined, { main: node });
    expect(React.isValidElement(out.main)).toBe(true);
  });

  it('passes an event-payload prop through unchanged, embeds and all', () => {
    const out = renderPatternProps({ emitted: paintedResponse }, () => undefined, { emitted: payload });
    expect(out.emitted).toBe(paintedResponse);
  });

  it('passes an event-payload member of a data array item through unchanged', () => {
    const out = renderPatternProps({ hostDispatches: [{ kind: 'dispatch', label: 'x', response: paintedResponse }] }, () => undefined, { hostDispatches: dispatches });
    const [item] = out.hostDispatches as Array<{ response: typeof paintedResponse }>;
    expect(item.response).toBe(paintedResponse);
  });

  it('control: a member of the same item without the brand still embeds its @trait.X', () => {
    const out = renderPatternProps({ hostDispatches: [{ kind: 'dispatch', label: '@trait.Search', response: paintedResponse }] }, () => undefined, { hostDispatches: dispatches });
    const [item] = out.hostDispatches as Array<{ label: React.ReactNode }>;
    expect(React.isValidElement(item.label)).toBe(true);
  });
});
