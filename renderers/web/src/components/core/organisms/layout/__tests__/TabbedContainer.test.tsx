import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TabbedContainer } from '../TabbedContainer';
import { EventBusProvider } from '../../../../../core';

const TABS = [
  { id: 'a', label: 'Alpha', content: 'Alpha body' },
  { id: 'b', label: 'Beta', content: 'Beta body', badge: 3 },
];

function renderContainer(props: Partial<React.ComponentProps<typeof TabbedContainer>> = {}) {
  return render(
    <EventBusProvider debug={false}>
      <TabbedContainer tabs={TABS} {...props} />
    </EventBusProvider>,
  );
}

describe('TabbedContainer', () => {
  it('its panel is labelled by an existing tab', () => {
    renderContainer();
    const panel = screen.getByRole('tabpanel');
    expect(document.getElementById(panel.getAttribute('aria-labelledby') ?? '')?.textContent).toContain('Alpha');
  });

  it('switches panels and reports the change', () => {
    const onTabChange = vi.fn();
    renderContainer({ onTabChange });
    act(() => { fireEvent.click(screen.getByRole('tab', { name: /Beta/ })); });
    expect(onTabChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('tabpanel').textContent).toBe('Beta body');
  });

  it('a left-positioned container is a vertical tablist beside its panel', () => {
    renderContainer({ position: 'left' });
    const list = screen.getByRole('tablist');
    expect(list.getAttribute('aria-orientation')).toBe('vertical');
    expect(list.parentElement?.className).toContain('flex-row');
  });

  it('control: a top container is horizontal', () => {
    renderContainer();
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('horizontal');
  });
});
