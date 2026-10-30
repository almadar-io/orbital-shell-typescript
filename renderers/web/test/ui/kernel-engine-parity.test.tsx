// @vitest-environment jsdom
// Cases the kernel client engine pins.
import { describe, it, expect, beforeAll } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { useCircuitKernel } from '../../src/hooks/circuit/useCircuitKernel';
import { KERNEL_AVAILABLE, KERNEL_ENGINE, warmKernel, TEST_TYPE_CONTRACT_VERSION, TEST_STAMP } from '../../src/test-support/kernel-engine';
import { circuitReady } from '../../src/test-support/circuit';

const orbitals: OrbitalSchema['orbitals'] = [{
  name: 'Main',
  pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Panel' }] }],
  entity: { name: 'Board', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
  traits: [{
    name: 'Panel',
    linkedEntity: 'Board',
    config: { panelSlot: { type: 'string', default: 'modal' } },
    stateMachine: {
      states: [{ name: 'closed', isInitial: true }, { name: 'open' }],
      events: [],
      transitions: [
        { from: 'closed', to: 'open', event: 'OPEN', effects: [['render-ui', '@config.panelSlot', { type: 'typography', content: 'hello' }]] },
      ],
    },
  }],
}];

async function renderedSlot(engine: typeof KERNEL_ENGINE): Promise<string | undefined> {
  const { result } = renderHook(() => useCircuitKernel({ stamp: TEST_STAMP, orbitals, engine }));
  await circuitReady(result);
  const outcome = await act(async () => result.current.kernel.dispatch({ event: 'OPEN', targetTrait: 'Panel' }));
  const render = (outcome.response.clientEffectsByTrait ?? []).map((e) => e.effect).find((effect) => effect[0] === 'render-ui');
  return render?.[1];
}

describe('render-ui slot argument bound to a trait knob (G-ORBITAL-CORE-027)', () => {
  describe('kernel engine', () => {
    beforeAll(warmKernel);
    it.runIf(KERNEL_AVAILABLE)('the slot is the knob value, not the literal `@config.panelSlot`', async () => {
      expect(await renderedSlot(KERNEL_ENGINE)).toBe('modal');
    });
  });
});
