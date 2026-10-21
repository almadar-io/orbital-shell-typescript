// @vitest-environment jsdom
/**
 * A guard is drawn as a glyph on its transition and read on hover or focus, so a
 * long guard never stretches the diagram. It is code: `(> @payload.amount 0)` must
 * read left to right even on an RTL page, or the bidi algorithm reorders its
 * parentheses and operators.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AvlStateMachine } from '../AvlStateMachine';
import { EventBusProvider } from '../../../../core';
import { I18nProvider, createTranslate } from '../../../../core';
import type { TraitLevelData } from '../../../../lib/avl-schema-parser';

const CHECKOUT: TraitLevelData = {
  name: 'Checkout',
  linkedEntity: 'Order',
  states: [
    { name: 'pending', isInitial: true, isTerminal: false },
    { name: 'paid', isInitial: false, isTerminal: false },
  ],
  transitions: [
    { from: 'pending', to: 'paid', event: 'PAY', guard: ['>', '@payload.amount', 0], effects: [], index: 0 },
    { from: 'paid', to: 'pending', event: 'RESET', guard: null, effects: [], index: 1 },
  ],
  emittedEvents: [],
  listenedEvents: [],
};

async function labels(direction: 'ltr' | 'rtl'): Promise<HTMLElement[]> {
  render(
    <I18nProvider value={{ locale: direction === 'rtl' ? 'ar' : 'en', direction, t: createTranslate({}) }}>
      <EventBusProvider debug={false}>
        <AvlStateMachine trait={CHECKOUT} />
      </EventBusProvider>
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getAllByTestId('avl-sm-label')).toHaveLength(2));
  return screen.getAllByTestId('avl-sm-label');
}

describe('AvlStateMachine guard glyph', () => {
  it('draws a guarded transition with a focusable glyph named after its guard', async () => {
    const [pay] = await labels('ltr');
    const glyph = pay.querySelector<HTMLElement>('[data-testid="avl-guard-glyph"]');
    expect(glyph).not.toBeNull();
    expect(glyph?.getAttribute('tabindex')).toBe('0');
    expect(glyph?.getAttribute('aria-label')).toContain('(> @payload.amount 0)');
  });

  it('does not print the guard inside the transition label', async () => {
    const [pay] = await labels('ltr');
    const inline = [...pay.querySelectorAll<HTMLElement>('span')].filter((el) => el.textContent?.includes('@payload.amount'));
    expect(inline).toHaveLength(0);
  });

  it('a guarded label is no taller than an unguarded one', async () => {
    const [pay, reset] = await labels('ltr');
    expect(pay.style.height).toBe(reset.style.height);
  });

  it('shows the guard, left to right, when the glyph is focused on an RTL page', async () => {
    const [pay] = await labels('rtl');
    const glyph = pay.querySelector<HTMLElement>('[data-testid="avl-guard-glyph"]');
    if (!glyph) throw new Error('no guard glyph');
    fireEvent.focus(glyph);
    fireEvent.mouseEnter(glyph);
    const code = await waitFor(() => {
      const el = [...document.querySelectorAll<HTMLElement>('[dir="ltr"]')].find((n) => n.textContent === '(> @payload.amount 0)');
      if (!el) throw new Error('guard not shown');
      return el;
    });
    expect(code.getAttribute('dir')).toBe('ltr');
  });

  it('control: an unguarded transition has no guard glyph', async () => {
    const [, reset] = await labels('rtl');
    expect(reset.querySelector('[data-testid="avl-guard-glyph"]')).toBeNull();
  });

  it('control: the event name itself is not forced LTR', async () => {
    const [pay] = await labels('ltr');
    const event = [...pay.querySelectorAll<HTMLElement>('span')].find((el) => el.textContent === 'PAY');
    expect(event?.getAttribute('dir')).toBeNull();
  });
});
