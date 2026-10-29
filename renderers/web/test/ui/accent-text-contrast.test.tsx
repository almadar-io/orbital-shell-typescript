/**
 * G-ORBITAL-SHELL-TYPESCRIPT-055: text painted on the page or card ground reads `--color-foreground`
 * (which meets 4.5:1 there in all but the three 066 modes), never `--color-accent` (which fails in 15 modes).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { ChoiceButton } from '../../src/components/game/atoms/ChoiceButton';
import { TraitStateViewer, type TraitStateMachineDefinition } from '../../src/components/game/molecules/TraitStateViewer';
import { RuntimeDebugger } from '../../src/components/core/organisms/debug/RuntimeDebugger';

vi.mock('../../src/components/core/organisms/debug/RuntimeDebugger.css', () => ({}));
vi.mock('../../src/lib/traitRegistry', () => ({
  getAllTraits: vi.fn(() => [{ id: 't1', name: 'Door', currentState: 'open', states: ['open'], transitions: [], guards: [], transitionCount: 0, lastTransition: null }]),
  subscribeToTraitChanges: vi.fn(() => () => {}),
}));

const TRAIT: TraitStateMachineDefinition = {
  name: 'Door',
  states: ['closed', 'open'],
  currentState: 'open',
  transitions: [
    { from: 'closed', to: 'open', event: 'OPEN' },
    { from: 'open', to: 'closed', event: 'CLOSE' },
  ],
};

function accentText(container: HTMLElement): string[] {
  return [...container.querySelectorAll('*')]
    .filter((el) => /(^|\s)text-accent(\s|$)/.test(el.getAttribute('class') ?? '') && (el.textContent ?? '').trim() !== '')
    .map((el) => el.textContent ?? '');
}

describe('text on the page ground is not painted in the accent colour', () => {
  it('ChoiceButton: the selected index reads foreground', () => {
    const { container } = render(<EventBusProvider debug={false}><ChoiceButton text="Yes" index={1} selected /></EventBusProvider>);
    expect(accentText(container)).toEqual([]);
  });

  it('TraitStateViewer: transition event captions read foreground (full and compact)', () => {
    for (const variant of ['full', 'compact', 'linear'] as const) {
      const { container, unmount } = render(<TraitStateViewer trait={TRAIT} variant={variant} showTransitions />);
      expect(accentText(container), variant).toEqual([]);
      unmount();
    }
  });

  it('RuntimeDebugger verify bar: trait states read foreground', () => {
    const { container } = render(<EventBusProvider debug={false}><RuntimeDebugger mode="verify" /></EventBusProvider>);
    expect(screen.getByTestId('debugger-verify')).toBeTruthy();
    expect(container.textContent).toContain('Door:open');
    expect(accentText(container)).toEqual([]);
  });

  it('control: the check does see an accent-painted element', () => {
    const { container } = render(<span className="text-accent">x</span>);
    expect(accentText(container)).toEqual(['x']);
  });
});
