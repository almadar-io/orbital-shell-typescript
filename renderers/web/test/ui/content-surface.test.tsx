/**
 * Content surfaces: every content block paints the theme-owned
 * `surface-content` by default, `surface="none"` opts out, and a block that sits
 * inside something that already is a surface stays flat (no card-in-card).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { TableView } from '../../src/components/core/molecules/TableView';
import { CalendarGrid } from '../../src/components/core/molecules/CalendarGrid';
import { DataList } from '../../src/components/core/molecules/DataList';
import { DataGrid } from '../../src/components/core/molecules/DataGrid';
import { Card } from '../../src/core';
import { Modal } from '../../src/components/core/molecules/Modal';

const rows = [{ id: '1', name: 'Prairie Quartz', status: 'active' }];
const columns = [{ key: 'name', header: 'Name' }];
const fields = [{ name: 'name', variant: 'h4' as const }];

const renderIn = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);
const surfaces = (root: HTMLElement) => root.querySelectorAll('.surface-content').length;

describe('content surface', () => {
  it('a top-level table paints one surface', () => {
    const { container } = renderIn(<TableView entity={rows} columns={columns} />);
    expect(surfaces(container)).toBe(1);
  });

  it('control: surface="none" opts out', () => {
    const { container } = renderIn(<TableView entity={rows} columns={columns} surface="none" />);
    expect(surfaces(container)).toBe(0);
  });

  it('the week calendar paints a surface like every other block', () => {
    const { container } = renderIn(<CalendarGrid events={[]} />);
    expect(surfaces(container)).toBe(1);
  });

  it('a block inside a Card stays flat — the Card is the surface', () => {
    const { container } = renderIn(<Card><TableView entity={rows} columns={columns} /></Card>);
    expect(surfaces(container)).toBe(1);
    expect(container.querySelector('[role=table]')?.className).not.toMatch(/surface-content/);
  });

  it('a block nested in another block stays flat', () => {
    const { container } = renderIn(
      <DataList entity={rows} renderItem={() => <TableView entity={rows} columns={columns} />} />,
    );
    expect(container.querySelector('[role=table]')?.className).not.toMatch(/surface-content/);
  });

  it('edge: under a surface="none" parent, a nested block still paints (it sits on the page)', () => {
    const { container } = renderIn(
      <DataList entity={rows} surface="none" renderItem={() => <TableView entity={rows} columns={columns} />} />,
    );
    expect(container.querySelector('[role=table]')?.className).toMatch(/surface-content/);
  });

  it('a block inside a dialog stays flat — the dialog is the surface', () => {
    const { baseElement } = renderIn(
      <Modal isOpen onClose={() => undefined} title="Pick"><TableView entity={rows} columns={columns} /></Modal>,
    );
    expect(baseElement.querySelector('[role=table]')?.className).not.toMatch(/surface-content/);
  });

  it('card-per-item lists put the surface on the items, not the list', () => {
    const { container } = renderIn(<DataList entity={rows} fields={fields} look="card-rows" />);
    const list = container.querySelector('[data-entity-row]')?.parentElement;
    expect((list?.className ?? '').split(/\s+/)).not.toContain('surface-content');
  });

  it('grid cards each paint the shared surface (no hand-rolled card chrome)', () => {
    const { container } = renderIn(<DataGrid entity={rows} fields={fields} cols={3} />);
    const card = container.querySelector('[data-entity-row]') as HTMLElement;
    expect(card.className).toMatch(/surface-content/);
    expect(card.className).not.toMatch(/\bbg-card\b/);
  });
});
