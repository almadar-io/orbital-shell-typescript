import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToastSlot } from '../ToastSlot';
import { EventBusProvider } from '../../../../core';

function renderSlot(children: React.ReactNode) {
  return render(
    <EventBusProvider debug={false}>
      <div style={{ containerType: 'inline-size' }}>
        <ToastSlot duration={0}>{children}</ToastSlot>
      </div>
    </EventBusProvider>,
  );
}

describe('ToastSlot', () => {
  it('portals its fixed toast out of the rendering container', () => {
    const { container } = renderSlot('Saved');
    const text = screen.getByText('Saved');
    expect(container.contains(text)).toBe(false);
    expect(document.body.contains(text)).toBe(true);
  });

  it('control: renders nothing without content', () => {
    renderSlot(null);
    expect(screen.queryByText('Saved')).toBeNull();
  });
});
