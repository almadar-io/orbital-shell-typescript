import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../Sidebar';
import { Navigation } from '../Navigation';
import { ProgressDots } from '../ProgressDots';
import { Carousel } from '../Carousel';
import { FilterGroup } from '../FilterGroup';
import { TableView } from '../TableView';
import { DataGrid } from '../DataGrid';
import { DataList } from '../DataList';
import { EventBusProvider } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

const wrap = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider> });

const rows = [
  { id: '1', title: 'One' },
  { id: '2', title: 'Two' },
];
const fields = [{ name: 'title', variant: 'h4' as const }];

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
});

describe('Sidebar', () => {
  it('marks only the active item aria-current=page', async () => {
    const { container } = wrap(
      <Sidebar
        aria-label="Main"
        items={[
          { id: 'a', label: 'Home', active: true },
          { id: 'b', label: 'Settings' },
          { id: 'c', label: 'Legacy', isActive: true },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Settings' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Legacy' })).toHaveAttribute('aria-current', 'page');
    expect(container.querySelector('aside')).toHaveAttribute('aria-label', 'Main');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });
});

describe('Navigation', () => {
  it('marks the active item aria-current=page and forwards aria-label', async () => {
    const { container } = wrap(
      <Navigation
        aria-label="Primary"
        items={[
          { id: 'a', label: 'Home', isActive: true },
          { id: 'b', label: 'About' },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'About' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('navigation')).toHaveAttribute('aria-label', 'Primary');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });
});

describe('ProgressDots', () => {
  it('marks the current dot aria-current=step, clickable or not', async () => {
    const onDot = vi.fn();
    const { container } = wrap(<ProgressDots count={3} currentIndex={1} onDotClick={onDot} aria-label="Steps" />);
    const dots = screen.getAllByRole('button');
    expect(dots.map((d) => d.getAttribute('aria-current'))).toEqual([null, 'step', null]);
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('marks the active dot with no click handler and handles zero dots', () => {
    const { container } = wrap(<ProgressDots count={2} currentIndex={0} />);
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    const empty = wrap(<ProgressDots count={0} currentIndex={0} />);
    expect(empty.container.querySelectorAll('[aria-current]')).toHaveLength(0);
  });
});

describe('Carousel', () => {
  it('exposes dots as tabs with aria-selected and is keyboard operable', async () => {
    const { container } = wrap(
      <Carousel items={[{ id: 'a' }, { id: 'b' }, { id: 'c' }]} renderItem={(i) => <span>{i.id}</span>} aria-label="Gallery" />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    fireEvent.keyDown(tabs[2], { key: 'Enter' });
    expect(screen.getAllByRole('tab').map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
    expect(screen.getByRole('tablist')).toHaveAccessibleName();
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });
});

describe('FilterGroup pills', () => {
  it('toggles aria-pressed with the selection', async () => {
    const { container } = wrap(
      <FilterGroup
        entity="Task"
        variant="pills"
        aria-label="Task filters"
        filters={[{ field: 'status', label: 'Status', options: ['open', 'done'] }]}
      />,
    );
    const all = screen.getByRole('button', { name: 'All' });
    const open = screen.getByRole('button', { name: 'open' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(open).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(open);
    expect(screen.getByRole('button', { name: 'open' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });
});

describe('TableView', () => {
  it('sets aria-selected on rows only when selectable', async () => {
    const { container } = wrap(
      <TableView entity={rows} columns={[{ key: 'title', label: 'Title' }]} selectable selectedIds={['2']} aria-label="Items" />,
    );
    const bodyRows = container.querySelectorAll('[data-entity-row]');
    expect(Array.from(bodyRows).map((r) => r.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(screen.getByRole('table')).toHaveAttribute('aria-label', 'Items');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('omits aria-selected when not selectable', () => {
    const { container } = wrap(<TableView entity={rows} columns={[{ key: 'title', label: 'Title' }]} />);
    expect(container.querySelectorAll('[data-entity-row][aria-selected]')).toHaveLength(0);
  });
});

describe('DataGrid', () => {
  it('marks the selected card aria-current=true', () => {
    const { container } = wrap(<DataGrid entity={rows} fields={fields} selectable aria-label="Cards" />);
    const checks = screen.getAllByRole('checkbox');
    fireEvent.click(checks[0]);
    const cards = container.querySelectorAll('[data-entity-row]');
    expect(Array.from(cards).map((c) => c.getAttribute('aria-current'))).toEqual(['true', null]);
  });
});

describe('DataList', () => {
  it('forwards aria-label to its root', async () => {
    const { container } = wrap(<DataList entity={rows} fields={fields} aria-label="Todos" />);
    expect(container.querySelector('[aria-label="Todos"]')).not.toBeNull();
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });
});
