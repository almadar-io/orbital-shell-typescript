import { describe, it, expect, vi, afterEach } from 'vitest';
import { followHref } from '../../core';
import type { NavStackApi } from '../../core';
import { renderHook } from '@testing-library/react';
import { useNavStack } from '../../core';

afterEach(() => vi.restoreAllMocks());

describe('followHref', () => {
  it('loads a path when no nav stack is mounted', () => {
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign });
    const { result } = renderHook(() => useNavStack());
    followHref('/pricing', result.current);
    expect(assign).toHaveBeenCalledWith('/pricing');
  });

  it('control: a real nav stack handles the path in-app', () => {
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign });
    const goTo = vi.fn();
    const api: NavStackApi = { entries: [], canGoBack: false, beginNavigate: vi.fn(), back: vi.fn(), goTo, setCurrentLabel: vi.fn(), registerNavItems: vi.fn() };
    followHref('/pricing', api);
    expect(goTo).toHaveBeenCalledWith('/pricing');
    expect(assign).not.toHaveBeenCalled();
  });
});
