// @vitest-environment jsdom
/**
 * `ALL_SLOTS` gap (docs/Almadar_UI_Gaps.md, 2026-09-04): core's `UI_SLOTS`
 * declares `system` ("invisible system components") and `content`, but the
 * hand-listed `ALL_SLOTS` in `useUISlots.ts` omitted both, so
 * `render({target:'system'})` was stored into `sources` but never surfaced
 * — `slots.system` / `getContent('system')` stayed absent because the
 * aggregation loop only iterates `ALL_SLOTS`. `ALL_SLOTS` is now derived
 * from `UI_SLOTS` itself; these tests pin both the coverage invariant and
 * the two previously-missing slots end to end.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { UI_SLOTS } from '@almadar/core';
import { useUISlotManager } from '../../src/hooks/useUISlots';

// The non-game slot vocabulary: everything core declares minus the dotted
// game-namespaced slots (`hud.*`, `overlay.*`) and bare `hud`/`screen`,
// which this manager doesn't route to.
const CORE_NON_GAME_SLOTS = UI_SLOTS.filter(
  (slot) => !slot.includes('.') && slot !== 'hud' && slot !== 'screen',
);

describe('ALL_SLOTS ⊇ core UI_SLOTS non-game set (PREVENTION VERDICT)', () => {
  it('surfaces every core non-game slot through the manager', () => {
    const { result } = renderHook(() => useUISlotManager());

    for (const slot of CORE_NON_GAME_SLOTS) {
      expect(result.current.slots).toHaveProperty(slot);
      expect(result.current.getContent(slot)).toBeNull();
    }
  });
});

describe('system and content slots', () => {
  it('surfaces a render into "system"', () => {
    const { result } = renderHook(() => useUISlotManager());

    act(() => {
      result.current.render({ target: 'system', pattern: 'input-listener', sourceTrait: 'InputListener' });
    });

    expect(result.current.slots.system?.pattern).toBe('input-listener');
    expect(result.current.getContent('system')?.pattern).toBe('input-listener');
  });

  it('surfaces a render into "content"', () => {
    const { result } = renderHook(() => useUISlotManager());

    act(() => {
      result.current.render({ target: 'content', pattern: 'markdown', sourceTrait: 'DocViewer' });
    });

    expect(result.current.slots.content?.pattern).toBe('markdown');
    expect(result.current.getContent('content')?.pattern).toBe('markdown');
  });
});
