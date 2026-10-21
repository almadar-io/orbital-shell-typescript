// @vitest-environment jsdom
/**
 * A preview whose schema carries arbitrary-value classes gets their CSS from
 * the host's compiler (G-APPS_BUILDER-008); without a compiler nothing happens.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import {
  ArbitraryClassCompilerProvider,
  useArbitraryClassStyles,
  resetArbitraryClassStyles,
  ARBITRARY_CLASS_STYLE_ID,
} from '../ArbitraryClassCompiler';

function schemaWith(className: string): OrbitalSchema {
  return JSON.parse(JSON.stringify({
    name: 'App',
    orbitals: [{
      name: 'Tasks',
      entity: { name: 'Task', fields: [] },
      traits: [{
        name: 'TaskFlow',
        stateMachine: {
          states: [{ name: 'idle', isInitial: true }],
          events: [{ key: 'INIT', name: 'INIT' }],
          transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'box', className }]] }],
        },
      }],
      pages: [],
    }],
  }));
}

function Probe({ schema }: { schema: OrbitalSchema }): null {
  useArbitraryClassStyles(schema);
  return null;
}

const styleText = () => document.getElementById(ARBITRARY_CLASS_STYLE_ID)?.textContent ?? '';

beforeEach(() => {
  resetArbitraryClassStyles();
});

describe('useArbitraryClassStyles', () => {
  it("injects the host compiler's CSS for the schema's arbitrary classes", async () => {
    const compile = vi.fn(async (classes: string[]) => classes.map((c) => `/*${c}*/`).join(''));
    render(
      <ArbitraryClassCompilerProvider compile={compile}>
        <Probe schema={schemaWith('p-4 w-[243px] bg-[#e14b2a]')} />
      </ArbitraryClassCompilerProvider>,
    );
    await waitFor(() => expect(styleText()).toContain('/*w-[243px]*/'));
    expect(compile).toHaveBeenCalledWith(['bg-[#e14b2a]', 'w-[243px]']);
  });

  it('compiles each class once, across renders and previews', async () => {
    const compile = vi.fn(async (classes: string[]) => classes.join(' '));
    const { rerender } = render(
      <ArbitraryClassCompilerProvider compile={compile}>
        <Probe schema={schemaWith('w-[243px]')} />
        <Probe schema={schemaWith('w-[243px]')} />
      </ArbitraryClassCompilerProvider>,
    );
    await waitFor(() => expect(compile).toHaveBeenCalledTimes(1));
    rerender(
      <ArbitraryClassCompilerProvider compile={compile}>
        <Probe schema={schemaWith('w-[243px] h-[10px]')} />
      </ArbitraryClassCompilerProvider>,
    );
    await waitFor(() => expect(compile).toHaveBeenCalledTimes(2));
    expect(compile).toHaveBeenLastCalledWith(['h-[10px]']);
  });

  it('no arbitrary classes, no compile', async () => {
    const compile = vi.fn(async () => '');
    render(
      <ArbitraryClassCompilerProvider compile={compile}>
        <Probe schema={schemaWith('p-4 w-60')} />
      </ArbitraryClassCompilerProvider>,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(compile).not.toHaveBeenCalled();
  });

  it('without a compiler it does nothing', async () => {
    render(<Probe schema={schemaWith('w-[243px]')} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(document.getElementById(ARBITRARY_CLASS_STYLE_ID)).toBeNull();
  });

  it('a failed compile is retried on the next render instead of being remembered', async () => {
    const compile = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('/*ok*/');
    const { rerender } = render(
      <ArbitraryClassCompilerProvider compile={compile}>
        <Probe schema={schemaWith('w-[243px]')} />
      </ArbitraryClassCompilerProvider>,
    );
    await waitFor(() => expect(compile).toHaveBeenCalledTimes(1));
    rerender(
      <ArbitraryClassCompilerProvider compile={compile}>
        <Probe schema={schemaWith('w-[243px] ')} />
      </ArbitraryClassCompilerProvider>,
    );
    await waitFor(() => expect(styleText()).toContain('/*ok*/'));
  });
});
