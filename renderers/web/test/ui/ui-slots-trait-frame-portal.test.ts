/**
 * G-RUNTIME-010 — the per-trait index a TraitFrame reads held a trait's most
 * recent render in ANY slot, so an embedded trait's `(notify …)` toast became
 * its frame content and replaced its own button. A notification render
 * (toast — `SLOT_DEFINITIONS` `notification: true`) leaves the frame as it
 * was; any other render is the trait's presentation (riya's embedded demo
 * renders `center`).
 */
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useUISlotManager } from '../../src/hooks/useUISlots';

describe('trait frame content vs portal renders', () => {
  it('a toast render keeps the trait frame content', () => {
    const { result } = renderHook(() => useUISlotManager());
    act(() => {
      result.current.render({ target: 'main', pattern: 'button', props: { label: 'Notify by SMS' }, sourceTrait: 'SmsNotify' });
    });
    act(() => {
      result.current.render({ target: 'toast', pattern: 'alert', props: { message: 'sent' }, sourceTrait: 'SmsNotify' });
    });
    expect(result.current.getTraitContent('SmsNotify')?.pattern).toBe('button');
  });

  it.each(['center', 'overlay', 'modal', 'drawer'] as const)('a %s render is the trait frame content', (slot) => {
    const { result } = renderHook(() => useUISlotManager());
    act(() => {
      result.current.render({ target: slot, pattern: 'game-canvas', props: {}, sourceTrait: 'RiyaOwPreview' });
    });
    expect(result.current.getTraitContent('RiyaOwPreview')?.pattern).toBe('game-canvas');
  });

  it('dismissing the toast leaves the trait frame content', () => {
    const { result } = renderHook(() => useUISlotManager());
    act(() => {
      result.current.render({ target: 'main', pattern: 'button', props: {}, sourceTrait: 'SmsNotify' });
      result.current.render({ target: 'toast', pattern: 'alert', props: {}, sourceTrait: 'SmsNotify' });
    });
    act(() => {
      result.current.clearBySource('toast', 'SmsNotify');
    });
    expect(result.current.getTraitContent('SmsNotify')?.pattern).toBe('button');
  });

  it('control: a later inline render replaces the frame content', () => {
    const { result } = renderHook(() => useUISlotManager());
    act(() => {
      result.current.render({ target: 'main', pattern: 'button', props: {}, sourceTrait: 'SmsNotify' });
    });
    act(() => {
      result.current.render({ target: 'main', pattern: 'typography', props: {}, sourceTrait: 'SmsNotify' });
    });
    expect(result.current.getTraitContent('SmsNotify')?.pattern).toBe('typography');
  });
});
