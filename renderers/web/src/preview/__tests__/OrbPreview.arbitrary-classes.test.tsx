/**
 * The preview compiles the arbitrary-value classes its schema renders, through
 * the host's compiler (G-APPS_BUILDER-008).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';
import { ArbitraryClassCompilerProvider, resetArbitraryClassStyles } from '../../providers/ArbitraryClassCompiler';

const schema: OrbitalSchema = JSON.parse(JSON.stringify({
  name: 'styled-app',
  version: '1.0.0',
  orbitals: [{
    name: 'Styled',
    entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [{
      name: 'Show',
      scope: 'instance',
      linkedEntity: 'Item',
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [],
        transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'box', className: 'w-[243px] p-4', children: [{ type: 'typography', content: 'Hi' }] }]] }],
      },
    }],
    pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Show' }] }],
  }],
}));

afterEach(() => resetArbitraryClassStyles());

describe('OrbPreview — arbitrary classes', () => {
  it('asks the host compiler for the classes its schema renders', async () => {
    const compile = vi.fn(async () => '.w-\\[243px\\]{width:243px}');
    render(
      <ArbitraryClassCompilerProvider compile={compile}>
        <OrbPreview schema={schema} isolated />
      </ArbitraryClassCompilerProvider>,
    );
    await waitFor(() => expect(compile).toHaveBeenCalledWith(['w-[243px]']));
  });
});
