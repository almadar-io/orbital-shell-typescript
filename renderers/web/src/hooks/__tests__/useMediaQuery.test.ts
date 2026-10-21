/**
 * useMediaQuery answers false where there is no media-query support (SSR,
 * jsdom, embedded webviews), instead of throwing; with support it tracks it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMediaQuery } from '../../core';

afterEach(() => { vi.unstubAllGlobals(); });

describe('useMediaQuery', () => {
  it('is false when the environment has no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useMediaQuery('(max-width: 1023.98px)'));
    expect(result.current).toBe(false);
  });

  it('reports the query when matchMedia exists', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    expect(renderHook(() => useMediaQuery('(pointer: coarse)')).result.current).toBe(true);
    expect(renderHook(() => useMediaQuery('(max-width: 10px)')).result.current).toBe(false);
  });
});
