/**
 * The preview takes the owner of each trait from the kernel's page circuit: while the kernel has not answered it
 * shows the loading state, and a kernel that fails shows the error state naming the cause.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { LOADING_STATE_MARKER, type OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';
import type { KernelModule } from '../../lib/kernel-wire';
import { KERNEL_AVAILABLE, loadTestKernel, TEST_TYPE_CONTRACT_VERSION } from '../../test-support/kernel-engine';

vi.unmock('../../providers/KernelEngineContext');

const schema: OrbitalSchema = {
  typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
  name: 'page-circuit-app',
  version: '1.0.0',
  orbitals: [{
    name: 'Shell',
    entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [{
      name: 'Greeter',
      linkedEntity: 'Item',
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [],
        transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content: 'hello' }]] }],
      },
    }],
    pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Greeter' }] }],
  }],
};

describe('OrbPreview: page circuit', () => {
  it('shows the loading state while the kernel has not answered', () => {
    const loader = vi.fn(() => new Promise<KernelModule>(() => undefined));
    const { container } = render(<OrbPreview schema={schema} isolated kernelLoader={loader} />);
    expect(container.querySelector(`[${LOADING_STATE_MARKER}]`)).not.toBeNull();
    expect(screen.queryByText('hello')).toBeNull();
  });

  it('shows the error state naming the cause when the kernel fails to load', async () => {
    const loader = vi.fn(() => Promise.reject(new Error('kernel gone')));
    render(<OrbPreview schema={schema} isolated kernelLoader={loader} />);
    const error = await screen.findByTestId('page-circuit-error');
    expect(error.textContent).toContain('kernel gone');
  });
});

const describeKernel = KERNEL_AVAILABLE ? describe : describe.skip;

describeKernel('OrbPreview: a kernel that cannot answer the page circuit', () => {
  it('shows the error state, never the loading state forever', async () => {
    const real = await loadTestKernel();
    class WithoutPageCircuit extends real.Kernel {
      override pageCircuit(): string {
        throw new TypeError('kernel.pageCircuit is not a function');
      }
    }
    const loader = vi.fn(() => Promise.resolve({ ...real, Kernel: WithoutPageCircuit }));
    render(<OrbPreview schema={schema} isolated kernelLoader={loader} />);
    const error = await screen.findByTestId('page-circuit-error');
    expect(error.textContent).toContain('pageCircuit');
  });
});
