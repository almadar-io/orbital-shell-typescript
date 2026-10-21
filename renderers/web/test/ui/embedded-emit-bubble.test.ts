// @vitest-environment jsdom
/**
 * R-EMBEDDED-EMIT-BUBBLE — embedded-trait emit bubbling.
 *
 * When a trait's `render-ui` embeds another trait (`@trait.X` / inline
 * `<External.Trait …/>`), the embedded view is rendered inside the host's
 * `TraitScopeProvider` AND wraps itself in its own. The scope context must
 * carry the full ancestor chain (innermost-first), and `useEventBus` must
 * fan every `UI:*` emit out to each scope on the chain so the host trait's
 * subscribers hear emits fired from inside the embedded trait.
 *
 * Regression target: `<UiButton.traits.ButtonRender action={CREATE}/>` inside
 * a host must dispatch on the host's qualified key, not only the hoisted
 * atom's own key.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { EventBusProvider } from '../../src/core';
import { TraitScopeProvider } from '../../src/core';
import { useTraitScopeChain, useTraitScope } from '../../src/core';
import { useEventBus } from '../../src/core';
import type { EventPayload } from '@almadar/core';

function withProviders(
  hostOrbital: string,
  hostTrait: string,
  embeddedTrait: string,
): React.JSX.Element {
  return React.createElement(
    EventBusProvider,
    { isolated: true },
    React.createElement(
      TraitScopeProvider,
      { orbital: hostOrbital, trait: hostTrait },
      React.createElement(
        TraitScopeProvider,
        { orbital: hostOrbital, trait: embeddedTrait },
        React.createElement(InnerCapture, null),
      ),
    ),
  );
}

let capturedBus: { emit: (type: string, payload?: EventPayload) => void; on: (type: string, fn: () => void) => () => void } | null = null;
function InnerCapture(): null {
  const bus = useEventBus();
  capturedBus = bus;
  return null;
}

describe('R-EMBEDDED-EMIT-BUBBLE — scope chain + emit fan-out', () => {
  it('useTraitScopeChain returns innermost-first ancestor chain', () => {
    const { result } = renderHook(() => useTraitScopeChain(), {
      wrapper: ({ children }) =>
        React.createElement(
          TraitScopeProvider,
          { orbital: 'AppOrbital', trait: 'HostManage' },
          React.createElement(
            TraitScopeProvider,
            { orbital: 'AppOrbital', trait: 'InlineButtonRender5' },
            children as React.ReactElement,
          ),
        ),
    });
    expect(result.current.map((s) => s.trait)).toEqual([
      'InlineButtonRender5',
      'HostManage',
    ]);
  });

  it('useTraitScopeChain is referentially stable outside a provider (infinite-rerender regression)', () => {
    const { result, rerender } = renderHook(() => useTraitScopeChain());
    const first = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(first);
    expect(result.current).toEqual([]);
  });

  it('useTraitScope returns the innermost scope only (back-compat)', () => {
    const { result } = renderHook(() => useTraitScope(), {
      wrapper: ({ children }) =>
        React.createElement(
          TraitScopeProvider,
          { orbital: 'AppOrbital', trait: 'HostManage' },
          React.createElement(
            TraitScopeProvider,
            { orbital: 'AppOrbital', trait: 'InlineButtonRender5' },
            children as React.ReactElement,
          ),
        ),
    });
    expect(result.current?.trait).toBe('InlineButtonRender5');
  });

  it('a bare UI:CREATE emit from the embedded trait reaches BOTH the atom and the host', () => {
    const received: string[] = [];
    renderHook(() => InnerCapture, { wrapper: () => withProviders('AppOrbital', 'HostManage', 'InlineButtonRender5') });
    expect(capturedBus).not.toBeNull();

    const unsubHost = capturedBus!.on('UI:AppOrbital.HostManage.CREATE', () => received.push('host'));
    const unsubAtom = capturedBus!.on('UI:AppOrbital.InlineButtonRender5.CREATE', () => received.push('atom'));

    act(() => {
      capturedBus!.emit('UI:CREATE', { id: 'x' });
    });

    expect(received).toContain('atom');
    expect(received).toContain('host');

    unsubHost();
    unsubAtom();
    capturedBus = null;
  });

  it('a non-embedded trait (single scope) does not fan out — only its own key fires', () => {
    const received: string[] = [];
    renderHook(() => InnerCapture, {
      wrapper: () =>
        React.createElement(
          TraitScopeProvider,
          { orbital: 'AppOrbital', trait: 'LonelyTrait' },
          React.createElement(InnerCapture, null),
        ),
    });
    expect(capturedBus).not.toBeNull();
    const unsubOwn = capturedBus!.on('UI:AppOrbital.LonelyTrait.CREATE', () => received.push('own'));
    const unsubOther = capturedBus!.on('UI:AppOrbital.OtherTrait.CREATE', () => received.push('other'));

    act(() => {
      capturedBus!.emit('UI:CREATE');
    });

    expect(received).toEqual(['own']);
    unsubOwn();
    unsubOther();
    capturedBus = null;
  });
});
