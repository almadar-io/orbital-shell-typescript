import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tabs, type TabItem } from '../Tabs';
import { EventBusProvider } from '../../../../core';

const ITEMS: TabItem[] = [
  { id: 'overview', label: 'Overview', content: 'Overview body' },
  { id: 'health', label: 'Health', content: 'Health body', disabled: true },
  { id: 'billing', label: 'Billing', content: 'Billing body' },
];

function renderTabs(props: Partial<React.ComponentProps<typeof Tabs>> = {}) {
  return render(
    <EventBusProvider debug={false}>
      <Tabs items={ITEMS} {...props} />
    </EventBusProvider>,
  );
}

describe('Tabs ARIA (APG tabs)', () => {
  it('the panel is labelled by a tab that exists', () => {
    renderTabs();
    const panel = screen.getByRole('tabpanel');
    const label = document.getElementById(panel.getAttribute('aria-labelledby') ?? '');
    expect(label).toBe(screen.getByRole('tab', { name: 'Overview' }));
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-controls')).toBe(panel.id);
  });

  it('a tab whose panel is not rendered here (event-driven content) controls nothing', () => {
    render(
      <EventBusProvider debug={false}>
        <Tabs items={[{ id: 'overview', label: 'Overview', event: 'SHOW_OVERVIEW' }, { id: 'billing', label: 'Billing', event: 'SHOW_BILLING' }]} />
      </EventBusProvider>,
    );
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Overview' }).hasAttribute('aria-controls')).toBe(false);
  });

  it('two Tabs on one page never share ids', () => {
    render(
      <EventBusProvider debug={false}>
        <Tabs items={ITEMS} />
        <Tabs items={ITEMS} />
      </EventBusProvider>,
    );
    const ids = screen.getAllByRole('tab').map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('roving tabindex: only the selected tab is in the Tab order', () => {
    renderTabs();
    expect(screen.getAllByRole('tab').map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('arrow keys skip a disabled tab', () => {
    renderTabs();
    const overview = screen.getByRole('tab', { name: 'Overview' });
    overview.focus();
    act(() => { fireEvent.keyDown(overview, { key: 'ArrowRight' }); });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Billing' }));
    expect(screen.getByRole('tabpanel').textContent).toBe('Billing body');
  });

  it('a vertical strip declares its orientation', () => {
    renderTabs({ orientation: 'vertical' });
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('vertical');
  });

  it('selecting a tab does not change its font weight (no width shift)', () => {
    renderTabs();
    const before = screen.getByRole('tab', { name: 'Billing' }).innerHTML;
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Billing' })); });
    const after = screen.getByRole('tab', { name: 'Billing' });
    expect(after.className).not.toMatch(/font-(bold|semibold)/);
    expect(after.innerHTML.match(/font-\w+/g)).toEqual(before.match(/font-\w+/g));
  });

  it('control: a disabled tab ignores clicks', () => {
    renderTabs();
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Health' })); });
    expect(screen.getByRole('tabpanel').textContent).toBe('Overview body');
  });
});
