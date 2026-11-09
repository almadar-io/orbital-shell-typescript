import React from 'react';
import { describe, it, expect } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { UISlotProvider, useUISlots } from '../../src/providers/UISlotContext';
import { useUISlotManager } from '../../src/hooks/useUISlots';

const LOOP_CAP = 30;

function renderDeclaring(order: () => readonly string[]): { declares: () => number } {
  let declares = 0;
  const Host = (): null => {
    const slots = useUISlots();
    React.useEffect(() => {
      if (declares >= LOOP_CAP) return;
      declares += 1;
      slots.setDeclaredTraitOrder(order());
    }, [slots]);
    return null;
  };
  render(<UISlotProvider><Host /></UISlotProvider>);
  return { declares: () => declares };
}

describe('the UI slot manager settles', () => {
  it('a host declaring the same trait order from an effect keyed on the manager settles after the one real change', async () => {
    const { declares } = renderDeclaring(() => ['First', 'Second']);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(declares()).toBe(2);
  });

  it('edge: an order array rebuilt each time with the same names is the same order', () => {
    const { result } = renderHook(() => useUISlotManager());
    const before = result.current;
    act(() => result.current.setDeclaredTraitOrder(['First', 'Second']));
    const declared = result.current;
    expect(declared).not.toBe(before);
    act(() => result.current.setDeclaredTraitOrder(['First', 'Second']));
    expect(result.current).toBe(declared);
  });

  it('control: a changed order is taken and reorders what the slot shows', () => {
    const { result } = renderHook(() => useUISlotManager());
    act(() => {
      result.current.render({ target: 'main', pattern: 'typography', props: { content: 'b' }, sourceTrait: 'Second' });
      result.current.render({ target: 'main', pattern: 'typography', props: { content: 'a' }, sourceTrait: 'First' });
    });
    act(() => result.current.setDeclaredTraitOrder(['First', 'Second']));
    const firstOrder = JSON.stringify(result.current.slots.main);
    act(() => result.current.setDeclaredTraitOrder(['Second', 'First']));
    expect(JSON.stringify(result.current.slots.main)).not.toBe(firstOrder);
  });

  it('the manager keeps its identity across a re-render that changed nothing', () => {
    const { result, rerender } = renderHook(() => useUISlotManager());
    const before = result.current;
    rerender();
    expect(result.current).toBe(before);
  });

  it('control: the manager changes identity when a slot paints, so its readers see it', () => {
    const { result } = renderHook(() => useUISlotManager());
    const before = result.current;
    act(() => {
      result.current.render({ target: 'main', pattern: 'typography', props: { content: 'x' }, sourceTrait: 'Painter' });
    });
    expect(result.current).not.toBe(before);
    expect(result.current.slots.main).not.toBeNull();
  });
});
