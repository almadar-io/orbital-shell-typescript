// @vitest-environment jsdom
/**
 * The compiled path's `[visible]` gate: a generated trait asks whether its
 * tick may fire. Watching starts on mount, so the trait's output is tracked.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useTickVisibility } from '../useTickVisibility';
import { getTraitPresence } from '../../core';

afterEach(() => vi.unstubAllGlobals());

describe('useTickVisibility', () => {
  it('watches the group while mounted and lets an unrendered trait fire', () => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
    let canFire: () => boolean = () => false;
    function Probe() { canFire = useTickVisibility(['Gate']); return null; }
    const view = render(<Probe />);
    expect(getTraitPresence().isWatched('Gate')).toBe(true);
    expect(canFire()).toBe(true);
    view.unmount();
    expect(getTraitPresence().isWatched('Gate')).toBe(false);
  });
});
