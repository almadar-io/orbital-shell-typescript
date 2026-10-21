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

describe('renderPatternProps and program-as-data props', () => {
  it('passes a sexpr prop through unchanged, embeds and all', () => {
    const out = renderPatternProps({ schema: program }, () => undefined, { schema: sexpr });
    expect(out.schema).toBe(program);
  });

  it('control: a node prop holding a @trait.X still becomes a rendered trait', () => {
    const out = renderPatternProps({ main: '@trait.Header' }, () => undefined, { main: node });
    expect(React.isValidElement(out.main)).toBe(true);
  });
});
