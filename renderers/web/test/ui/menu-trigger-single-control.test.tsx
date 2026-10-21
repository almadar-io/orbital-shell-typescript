// @vitest-environment jsdom
/**
 * A render-ui `menu` whose `trigger` is a pattern (the site header's language
 * picker: `trigger: { type: button, … }`) must expose ONE control: the button
 * itself carries the menu semantics. A wrapper that also acts as a button
 * around it is a nested interactive control (axe: nested-interactive).
 */
import React from 'react';
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SlotContentRenderer } from '../../src/components/core/organisms/UISlotRenderer';
import { EventBusProvider } from '../../src/core';

afterEach(cleanup);

const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

function renderMenu(trigger: string | { type: string; label: string; variant?: string; icon?: string }) {
  const content = {
    id: 'menu-id',
    pattern: 'menu',
    props: {
      trigger,
      items: [{ id: 'en', label: 'English', href: '/' }, { id: 'ar', label: 'العربية', href: '/ar' }],
    },
    priority: 0,
  };
  return render(
    <EventBusProvider>
      <SlotContentRenderer content={content} onDismiss={() => {}} />
    </EventBusProvider>,
  );
}

describe('menu trigger is a single control', () => {
  it('a pattern trigger: the button carries aria-haspopup and nothing interactive wraps it', () => {
    renderMenu({ type: 'button', label: 'EN', variant: 'ghost', icon: 'globe' });
    const owners = Array.from(document.querySelectorAll('[aria-haspopup="menu"]'));
    expect(owners).toHaveLength(1);
    const owner = owners[0];
    expect(owner.tagName).toBe('BUTTON');
    expect(owner.parentElement?.closest(INTERACTIVE)).toBeNull();
    expect(owner.querySelector(INTERACTIVE)).toBeNull();
  });

  it('control: clicking that button still opens the menu', () => {
    renderMenu({ type: 'button', label: 'EN', variant: 'ghost' });
    fireEvent.click(screen.getByRole('button', { name: /EN/ }));
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('edge: a plain text trigger gets its own single button wrapper', () => {
    renderMenu('Language');
    const owners = Array.from(document.querySelectorAll('[aria-haspopup="menu"]'));
    expect(owners).toHaveLength(1);
    expect(owners[0].querySelector(INTERACTIVE)).toBeNull();
  });

  it('edge: ArrowDown on the inner button opens the menu', () => {
    renderMenu({ type: 'button', label: 'EN', variant: 'ghost' });
    fireEvent.keyDown(screen.getByRole('button', { name: /EN/ }), { key: 'ArrowDown' });
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('edge: Enter on the inner button is left to the button (the wrapper does not toggle too)', () => {
    renderMenu({ type: 'button', label: 'EN', variant: 'ghost' });
    fireEvent.keyDown(screen.getByRole('button', { name: /EN/ }), { key: 'Enter' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
