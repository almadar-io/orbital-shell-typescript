// @vitest-environment jsdom
/**
 * G-UI-085: an embedded trait's `(render-ui main null)` must clear what it last painted, the same
 * as a page-level trait's. Its renders live only in the per-trait sidecar (`updateTraitContent`),
 * so `clearBySource` found no slot source and did nothing — learning-math-lab kept the quadratic
 * instrument painted after switching back to the function plot (2026-10-07).
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUISlotManager } from '../../src/hooks/useUISlots';

const sim = { pattern: 'box', props: { children: [] }, slot: 'main' as const, priority: 0 };

describe('clearBySource on an embedded trait', () => {
  it('a null render clears the embedded trait\'s content and tells its frame', () => {
    const { result } = renderHook(() => useUISlotManager());
    const seen: Array<string | null> = [];
    act(() => {
      result.current.updateTraitContent('QuadraticSim', sim);
      result.current.subscribeTrait('QuadraticSim', (content) => seen.push(content === null ? null : content.pattern));
    });
    act(() => result.current.clearBySource('main', 'QuadraticSim'));
    expect(result.current.getTraitContent('QuadraticSim')).toBeNull();
    expect(seen).toEqual([null]);
  });

  it('control: clearing another trait leaves the embedded trait\'s content', () => {
    const { result } = renderHook(() => useUISlotManager());
    act(() => result.current.updateTraitContent('QuadraticSim', sim));
    act(() => result.current.clearBySource('main', 'DerivativeSim'));
    expect(result.current.getTraitContent('QuadraticSim')?.pattern).toBe('box');
  });

  it('control: a null on another slot leaves the embedded trait\'s main content', () => {
    const { result } = renderHook(() => useUISlotManager());
    act(() => result.current.updateTraitContent('QuadraticSim', sim));
    act(() => result.current.clearBySource('sidebar', 'QuadraticSim'));
    expect(result.current.getTraitContent('QuadraticSim')?.pattern).toBe('box');
  });

  it('control: a page-level trait still clears from its slot as before', () => {
    const { result } = renderHook(() => useUISlotManager());
    act(() => {
      result.current.render({ target: 'main', pattern: 'box', props: {}, sourceTrait: 'Catalog' });
    });
    act(() => result.current.clearBySource('main', 'Catalog'));
    expect(result.current.getContent('main')).toBeNull();
  });
});
