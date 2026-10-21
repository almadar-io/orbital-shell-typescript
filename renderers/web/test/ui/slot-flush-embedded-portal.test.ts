/**
 * G-RUNTIME-010 — std-realtime-chat's "Notify by SMS" is an inline trait
 * embedded in the composer; its `(notify success …)` lowers to
 * `(render-ui toast …)`. `useSlotFlush` routed EVERY render of an embedded
 * trait into its inline frame, so the toast replaced the trait's own button
 * (and dismissing it left nothing). A NOTIFICATION slot (`SLOT_DEFINITIONS`
 * `notification: true` — toast) renders in that slot like any trait's; every
 * other render of an embedded trait fills its frame (owner ruling 2026-09-24:
 * riya's tutorial embeds its live demo, which renders `center`).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSlotFlush } from '../../src/hooks/circuit/useSlotFlush';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import type { ClientEffectTuple } from '@almadar/core';

function stubSlots(): UISlotManager & { render: ReturnType<typeof vi.fn>; updateTraitContent: ReturnType<typeof vi.fn> } {
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

const effect = (slot: string): { traitName: string; effect: ClientEffectTuple } => ({
  traitName: 'SmsNotify',
  effect: ['render-ui', slot, { type: 'alert', message: 'sent' }],
});

describe('embedded trait rendering to the toast notification slot', () => {
  it('renders in that slot, not in the trait frame (applyClientEffects)', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, new Set(['SmsNotify'])));
    result.current.applyClientEffects([], [effect('toast')]);
    expect(slots.updateTraitContent).not.toHaveBeenCalled();
    expect(slots.render).toHaveBeenCalledWith(expect.objectContaining({ target: 'toast', sourceTrait: 'SmsNotify' }));
  });

  it('renders in that slot, not in the trait frame (flushSlot)', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, new Set(['SmsNotify'])));
    result.current.flushSlot('SmsNotify', 'toast', [{ pattern: { type: 'alert', message: 'sent' }, props: {} }]);
    expect(slots.updateTraitContent).not.toHaveBeenCalled();
    expect(slots.render).toHaveBeenCalledWith(expect.objectContaining({ target: 'toast', sourceTrait: 'SmsNotify' }));
  });
});

// riya's tutorial embeds its live demo trait, which renders `center`: an
// embedded trait's non-notification render is its frame content.
describe.each(['center', 'overlay', 'modal', 'drawer'])('embedded trait rendering to the %s slot', (slot) => {
  it('fills the trait frame (applyClientEffects)', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, new Set(['SmsNotify'])));
    result.current.applyClientEffects([], [effect(slot)]);
    expect(slots.updateTraitContent).toHaveBeenCalledWith('SmsNotify', expect.objectContaining({ pattern: 'alert' }));
    expect(slots.render).not.toHaveBeenCalled();
  });

  it('fills the trait frame (flushSlot)', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, new Set(['SmsNotify'])));
    result.current.flushSlot('SmsNotify', slot, [{ pattern: { type: 'alert', message: 'sent' }, props: {} }]);
    expect(slots.updateTraitContent).toHaveBeenCalled();
    expect(slots.render).not.toHaveBeenCalled();
  });
});

describe('control: an embedded trait inline render', () => {
  it('main still fills the trait frame', () => {
    const slots = stubSlots();
    const { result } = renderHook(() => useSlotFlush(slots, new Set(['SmsNotify'])));
    result.current.applyClientEffects([], [effect('main')]);
    expect(slots.updateTraitContent).toHaveBeenCalledWith('SmsNotify', expect.objectContaining({ pattern: 'alert' }));
    expect(slots.render).not.toHaveBeenCalled();
  });
});
