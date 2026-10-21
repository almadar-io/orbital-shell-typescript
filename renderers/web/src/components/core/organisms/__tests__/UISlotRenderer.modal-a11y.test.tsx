import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { UISlotComponent } from '../UISlotRenderer';
import { UISlotProvider, useUISlots } from '../../../../providers/UISlotContext';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

function Harness({ slot }: { slot: 'modal' | 'drawer' }) {
  const { render: renderSlot, clear } = useUISlots();
  return (
    <>
      <button
        data-testid="open"
        onClick={() =>
          renderSlot({
            target: slot,
            pattern: 'test-pattern',
            props: { title: 'Create item', children: <input aria-label="Name" /> },
          })
        }
      >
        Open
      </button>
      <button data-testid="clear" onClick={() => clear(slot)}>
        Clear
      </button>
      <UISlotComponent slot={slot} portal />
    </>
  );
}

const mount = (slot: 'modal' | 'drawer' = 'modal') =>
  render(
    <UISlotProvider>
      <Harness slot={slot} />
    </UISlotProvider>,
  );

describe('UISlotRenderer modal slot is a real dialog', () => {
  it('exposes a named, modal dialog and moves focus in', () => {
    mount();
    const opener = screen.getByTestId('open');
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Create item' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Escape closes it and returns focus to the opener', async () => {
    mount();
    const opener = screen.getByTestId('open');
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Create item' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => {});
    fireEvent.animationEnd(dialog);
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('control: nothing is a dialog before the slot is filled', () => {
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has no axe violations', async () => {
    mount();
    fireEvent.click(screen.getByTestId('open'));
    const v = await axeViolations(document.body);
    expect(describeViolations(v)).toEqual([]);
  });
});
