// @vitest-environment jsdom
/**
 * A trait some `[visible]` tick watches renders inside a layout-neutral
 * wrapper the presence registry tracks; an unwatched trait renders unwrapped.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { TraitScopeProvider } from '../../core';
import { getTraitPresence } from '../../core';

afterEach(() => vi.unstubAllGlobals());

function stubIo(): void {
  vi.stubGlobal('IntersectionObserver', class {
    observe() { /* geometry is not under test here */ }
    unobserve() { /* nothing held */ }
    disconnect() { /* nothing held */ }
  });
}

describe('TraitScopeProvider tracks a watched trait\'s output', () => {
  it('a watched trait\'s output is wrapped and counted as rendered', () => {
    stubIo();
    const release = getTraitPresence().watch(['Spin']);
    const { getByText } = render(<TraitScopeProvider orbital="O" trait="Spin"><span>out</span></TraitScopeProvider>);
    const wrapper = getByText('out').parentElement;
    expect(wrapper?.getAttribute('data-trait-presence')).toBe('Spin');
    expect(getTraitPresence().state(['Spin'])).not.toBe('absent');
    release();
  });

  it('control: an unwatched trait renders with no wrapper', () => {
    stubIo();
    const { getByText } = render(<div data-testid="host"><TraitScopeProvider orbital="O" trait="Idle"><span>out</span></TraitScopeProvider></div>);
    expect(getByText('out').parentElement?.getAttribute('data-testid')).toBe('host');
  });

  it('watching after mount wraps the already rendered trait', () => {
    stubIo();
    const { getByText } = render(<TraitScopeProvider orbital="O" trait="Late"><span>out</span></TraitScopeProvider>);
    let release = (): void => undefined;
    act(() => { release = getTraitPresence().watch(['Late']); });
    expect(getByText('out').parentElement?.getAttribute('data-trait-presence')).toBe('Late');
    act(() => release());
  });
});
