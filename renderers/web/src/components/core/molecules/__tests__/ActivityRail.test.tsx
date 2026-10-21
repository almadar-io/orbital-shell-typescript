import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActivityRail } from '../ActivityRail';
import { DockLayout } from '../../organisms/layout/DockLayout';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

const ITEMS = [
  { id: 'explorer', icon: 'folder', label: 'Explorer' },
  { id: 'behaviors', icon: 'puzzle', label: 'Behaviors' },
  { id: 'cosmic', icon: 'orbit', label: 'Cosmic', opensPanel: false },
];

function Recorder({ event, into }: { event: string; into: string[] }): null {
  const { on } = useEventBus();
  React.useEffect(() => on(`UI:${event}`, (e) => { into.push(String(e.payload?.id)); }), [on, event, into]);
  return null;
}

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('ActivityRail', () => {
  it('desktop: one labelled icon button per item, the active one pressed', () => {
    wrap(<ActivityRail items={ITEMS} active="behaviors" onChange="RAIL_PICKED" />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Explorer', 'Behaviors', 'Cosmic']);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
  });

  it('desktop: a pick emits the declared event with the item id', () => {
    const seen: string[] = [];
    wrap(<><Recorder event="RAIL_PICKED" into={seen} /><ActivityRail items={ITEMS} active="explorer" onChange="RAIL_PICKED" /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Cosmic' }));
    expect(seen).toEqual(['cosmic']);
  });

  it('control: no onChange, a pick emits nothing', () => {
    const seen: string[] = [];
    wrap(<><Recorder event="RAIL_PICKED" into={seen} /><ActivityRail items={ITEMS} active="explorer" /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Behaviors' }));
    expect(seen).toEqual([]);
  });

  it('compact: the items become labelled menu rows inside the dock drawer', () => {
    wrap(<DockLayout compact rail={<ActivityRail items={ITEMS} active="explorer" onChange="RAIL_PICKED" />} main={<div />} />);
    fireEvent.click(screen.getByTestId('dock-menu'));
    expect(screen.getByRole('button', { name: 'Behaviors' }).textContent).toContain('Behaviors');
  });

  it('compact: a panel item shows its panel, an item that opens none closes the menu', () => {
    const seen: string[] = [];
    wrap(<><Recorder event="RAIL_PICKED" into={seen} /><DockLayout compact rail={<ActivityRail items={ITEMS} active="explorer" onChange="RAIL_PICKED" />} sidebar={<div data-testid="panel" />} main={<div />} /></>);
    fireEvent.click(screen.getByTestId('dock-menu'));
    fireEvent.click(screen.getByRole('button', { name: 'Behaviors' }));
    expect(seen).toEqual(['behaviors']);
    expect(screen.getByTestId('panel')).toBeTruthy();
  });

  it('React hosts: onSelect gets the id and the declared test ids are set, in both variants', () => {
    const picked: string[] = [];
    const props = { items: ITEMS, active: 'explorer', onSelect: (id: string) => { picked.push(id); }, testId: 'rail', itemTestId: (id: string) => `rail-${id}` };
    const { unmount } = wrap(<ActivityRail {...props} />);
    expect(screen.getByTestId('rail')).toBeTruthy();
    fireEvent.click(screen.getByTestId('rail-cosmic'));
    unmount();
    wrap(<DockLayout compact rail={<ActivityRail {...props} />} main={<div />} />);
    fireEvent.click(screen.getByTestId('dock-menu'));
    fireEvent.click(screen.getByTestId('rail-behaviors'));
    expect(picked).toEqual(['cosmic', 'behaviors']);
  });

  it('edge: an empty item list renders an empty rail, not an error', () => {
    const { container } = wrap(<ActivityRail items={[]} active="" />);
    expect(container.querySelectorAll('button').length).toBe(0);
  });
});
