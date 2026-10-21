// G-UI-104 prevention: a host that never loaded the kernel gets the typed error from a conditional render, never a silent fallback.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';

afterEach(() => vi.resetModules());

describe('render-time evaluation without an installed kernel evaluator', () => {
  it('a ConditionalWrapper with a condition throws KernelEvaluatorNotInstalledError', async () => {
    vi.resetModules();
    const { render } = await import('@testing-library/react');
    const core = await import('@almadar/core');
    const { ConditionalWrapper } = await import('../../src/core');
    expect(core.hasKernelEvaluator()).toBe(false);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      render(
        <ConditionalWrapper condition={['=', '@entity.formValues.a', 1]} context={{ formValues: { a: 1 }, globalVariables: {} }}>
          <span>shown</span>
        </ConditionalWrapper>,
      ),
    ).toThrow(core.KernelEvaluatorNotInstalledError);
    quiet.mockRestore();
  });

  it('control: a wrapper with no condition never touches the kernel', async () => {
    vi.resetModules();
    const { render, screen } = await import('@testing-library/react');
    const { ConditionalWrapper } = await import('../../src/core');
    render(
      <ConditionalWrapper context={{ formValues: {}, globalVariables: {} }}>
        <span>shown</span>
      </ConditionalWrapper>,
    );
    expect(screen.getByText('shown')).toBeTruthy();
  });
});
