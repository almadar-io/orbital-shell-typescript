/**
 * The `system` slot holds invisible system components (core `effect.ts`); the runtime
 * renderer never mounts it. A compiled client mounts it, so its content must stay
 * out of sight there too (a status line printed under the page footer otherwise).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { UISlotComponent, type UISlotComponentProps } from '../UISlotRenderer';
import { UISlotProvider } from '../../../../providers/UISlotContext';

function slotWith(slot: UISlotComponentProps['slot']) {
  return render(
    <UISlotProvider>
      <UISlotComponent slot={slot} pattern="typography" sourceTrait="Analytics">
        <span role="status">Visit reported</span>
      </UISlotComponent>
    </UISlotProvider>,
  );
}

describe('compiled system slot', () => {
  it('keeps its content mounted but visually hidden', () => {
    slotWith('system');
    const status = screen.getByRole('status');
    expect(status.closest('.sr-only')).not.toBeNull();
  });

  it('control: main slot content stays visible', () => {
    slotWith('main');
    expect(screen.getByRole('status').closest('.sr-only')).toBeNull();
  });
});
