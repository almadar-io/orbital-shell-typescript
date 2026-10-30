/**
 * A `host-ask` client effect (G-ORB-589) is answered by the web host's installed actions, in paint order
 * beside the renders around it; an ask the host cannot answer is refused by name and breaks nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSlotFlush } from '../../src/hooks/circuit/useSlotFlush';
import { registerHostAudio, registerHostSignIn, registerHostSignOut } from '../../src/lib/host-actions';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import type { ClientEffectTuple } from '@almadar/core';

function stubSlots(): UISlotManager & { render: ReturnType<typeof vi.fn> } {
  return {
    slots: {},
    render: vi.fn(() => 'id'),
    clear: vi.fn(),
    clearBySource: vi.fn(),
    clearById: vi.fn(),
    clearAll: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    hasContent: vi.fn(() => false),
    getContent: vi.fn(() => null),
    getTraitContent: vi.fn(() => null),
    subscribeTrait: vi.fn(() => () => undefined),
    updateTraitContent: vi.fn(() => 'id'),
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('useSlotFlush.applyClientEffects — host-ask', () => {
  it('runs the installed sign-out for auth/sign-out and the installed audio for audio/*, and paints the renders beside them', async () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, undefined));
    const heard: string[] = [];
    const offSignOut = registerHostSignOut(() => { heard.push('sign-out'); });
    const offAudio = registerHostAudio((ask) => { heard.push(ask.op); });
    const render: ClientEffectTuple = ['render-ui', 'main', { type: 'typography', content: 'bye' }];
    result.current.applyClientEffects([
      { traitName: 'Chrome', effect: ['host-ask', 'auth/sign-out', []] },
      { traitName: 'Chrome', effect: ['host-ask', 'audio/play-sound', ['click']] },
      { traitName: 'Chrome', effect: render },
    ]);
    await tick();
    offSignOut();
    offAudio();
    expect(heard).toEqual(['sign-out', 'audio/play-sound']);
    expect(slots.render).toHaveBeenCalledTimes(1);
  });

  it('control: a host with no sign-out refuses the ask by name and the other effects still apply', async () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, undefined));
    result.current.applyClientEffects([
      { traitName: 'Chrome', effect: ['host-ask', 'auth/sign-out', []] },
      { traitName: 'Chrome', effect: ['render-ui', 'main', { type: 'typography', content: 'still here' }] },
    ]);
    await tick();
    expect(slots.render).toHaveBeenCalledTimes(1);
  });

  it('returns an auth/sign-in answer by dispatching the declared route event to the asking trait', async () => {
    const slots = stubSlots();
    const dispatched: Array<[string, string, unknown]> = [];
    const { result } = renderHook(() => useSlotFlush(slots, undefined, async (trait, event, payload) => { dispatched.push([trait, event, payload]); }));
    const off = registerHostSignIn(async () => ({ uid: 'u1', email: 'a@b.c' }));
    const ask = (success: string, failure: string): ClientEffectTuple => ['host-ask', 'auth/sign-in', [{ method: 'google' }], { trait: 'SignIn', key: 'k1', success, failure }];
    result.current.applyClientEffects([{ traitName: 'SignIn', effect: ask('SIGNED_IN', 'SIGN_IN_FAILED') }]);
    await tick();
    off();
    result.current.applyClientEffects([{ traitName: 'SignIn', effect: ask('SIGNED_IN', 'SIGN_IN_FAILED') }]);
    await tick();
    expect(dispatched).toEqual([
      ['SignIn', 'SIGNED_IN', { uid: 'u1', email: 'a@b.c', key: 'k1' }],
      ['SignIn', 'SIGN_IN_FAILED', { error: 'no host sign-in is configured for auth/sign-in', kind: 'unavailable', key: 'k1' }],
    ]);
  });
});
