import { expect } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import type { CircuitKernelHandle } from '../hooks/circuit/useCircuitKernel';

/** Wait for the kernel to answer the page's circuit: nothing mounts or dispatches before that. */
export async function circuitReady(result: { current: CircuitKernelHandle }): Promise<void> {
  await waitFor(() => expect(result.current.circuit.status).toBe('ready'));
}

/** Wait for a mounted `useTraitStateMachine` to hold the kernel's circuit: its traits are subscribed and entered after that. */
export async function machineReady(result: { current: { circuit: CircuitKernelHandle['circuit'] } }): Promise<void> {
  await waitFor(() => expect(result.current.circuit.status).toBe('ready'));
  await act(async () => undefined);
}
