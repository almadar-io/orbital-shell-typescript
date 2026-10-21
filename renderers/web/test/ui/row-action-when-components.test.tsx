/**
 * Every list component draws an action item's button for a row only when the
 * item's `when` lambda returns true for that row and the ambient viewer.
 * Paired controls per component: the owner's row shows the action, another
 * viewer's row does not; an action without `when` is drawn on every row.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityRow, SExpr } from '@almadar/core';
import { EventBusProvider } from '../../src/core';
import { UserProvider } from '../../src/providers/UserContext';
import { DataList } from '../../src/components/core/molecules/DataList';
import { DataGrid } from '../../src/components/core/molecules/DataGrid';
import { TableView } from '../../src/components/core/molecules/TableView';
import { SwipeableRow } from '../../src/components/core/molecules/SwipeableRow';
import { DetailPanel } from '../../src/components/core/organisms/DetailPanel';

const ownerOnly: SExpr = ['fn', 'row', ['=', ['object/get', '@row', 'ownerId'], '@user.id']];

const alice = { id: 'u-alice', role: 'member', permissions: [] };
const bob = { id: 'u-bob', role: 'member', permissions: [] };

const rows = [
  { id: 'r1', title: 'Alice task', ownerId: 'u-alice' },
  { id: 'r2', title: 'Bob task', ownerId: 'u-bob' },
];

function as(user: typeof alice | null, ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <EventBusProvider>
          <UserProvider user={user}>{ui}</UserProvider>
        </EventBusProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const editIds = () => screen.queryAllByTestId('action-EDIT').map((el) => el.getAttribute('data-row-id'));

describe('DataList', () => {
  const actions = [
    { event: 'VIEW', label: 'Open' },
    { event: 'EDIT', label: 'Edit', when: ownerOnly },
  ];
  const fields = [{ name: 'title', variant: 'h4' as const }];

  it('draws Edit only on the viewer-owned row', () => {
    as(alice, <DataList entity={rows} fields={fields} itemActions={actions} />);
    expect(editIds()).toEqual(['r1']);
    expect(screen.getAllByTestId('action-VIEW')).toHaveLength(2);
  });

  it('control: the other viewer sees Edit on the other row', () => {
    as(bob, <DataList entity={rows} fields={fields} itemActions={actions} />);
    expect(editIds()).toEqual(['r2']);
  });

  it('control: a signed-out viewer sees no Edit, but the unconditional action stays', () => {
    as(null, <DataList entity={rows} fields={fields} itemActions={actions} />);
    expect(editIds()).toEqual([]);
    expect(screen.getAllByTestId('action-VIEW')).toHaveLength(2);
  });

  it('control: without any `when` every row shows every action', () => {
    as(alice, <DataList entity={rows} fields={fields} itemActions={[{ event: 'EDIT', label: 'Edit' }]} />);
    expect(editIds()).toEqual(['r1', 'r2']);
  });

  it('an action is never the row click: without itemClickEvent no row is clickable', () => {
    const only: readonly { event: string; label: string; when?: SExpr }[] = [{ event: 'EDIT', label: 'Edit', when: ownerOnly }];
    const { container } = as(alice, <DataList entity={rows} fields={fields} itemActions={only} />);
    const rowEls = container.querySelectorAll('[data-entity-row]');
    expect(rowEls[0].className).not.toContain('cursor-pointer');
    expect(rowEls[1].className).not.toContain('cursor-pointer');
  });

  it('control: a declared itemClickEvent makes every row clickable', () => {
    const { container } = as(alice, <DataList entity={rows} fields={fields} itemClickEvent="OPEN_ROW" />);
    const rowEls = container.querySelectorAll('[data-entity-row]');
    expect(rowEls[0].className).toContain('cursor-pointer');
    expect(rowEls[1].className).toContain('cursor-pointer');
  });
});

describe('DataList with a compiled closure `when`', () => {
  const closureActions = [
    { event: 'EDIT', label: 'Edit', when: (row: EntityRow): boolean => row.ownerId === 'u-alice' },
  ];
  const fields = [{ name: 'title', variant: 'h4' as const }];

  it('draws Edit only on the row the closure admits', () => {
    as(alice, <DataList entity={rows} fields={fields} itemActions={closureActions} />);
    expect(editIds()).toEqual(['r1']);
  });

  it('control: the closure is viewer-independent, the S-expression form is not', () => {
    as(bob, <DataList entity={rows} fields={fields} itemActions={closureActions} />);
    expect(editIds()).toEqual(['r1']);
  });
});

describe('DataGrid', () => {
  const actions = [{ event: 'EDIT', label: 'Edit', variant: 'primary' as const, when: ownerOnly }];
  const fields = [{ name: 'title', variant: 'h4' as const }];

  it('draws the primary Edit only on the viewer-owned card', () => {
    as(alice, <DataGrid entity={rows} fields={fields} itemActions={actions} />);
    expect(editIds()).toEqual(['r1']);
  });

  it('control: the other viewer gets the other card', () => {
    as(bob, <DataGrid entity={rows} fields={fields} itemActions={actions} />);
    expect(editIds()).toEqual(['r2']);
  });

  it('a card whose only action is hidden draws no action cluster', () => {
    const { container } = as(alice, <DataGrid entity={rows} fields={fields} itemActions={actions} />);
    const cards = container.querySelectorAll('[data-entity-row]');
    expect(within(cards[1] as HTMLElement).queryByTestId('action-overflow')).toBeNull();
    expect(within(cards[1] as HTMLElement).queryByTestId('action-EDIT')).toBeNull();
  });
});

describe('TableView', () => {
  const actions = [
    { event: 'VIEW', label: 'Open' },
    { event: 'EDIT', label: 'Edit', when: ownerOnly },
  ];
  const columns = [{ key: 'title', header: 'Title' }];

  const menuEvents = (rowIndex: number): string[] => {
    const triggers = screen.getAllByTestId('action-overflow');
    fireEvent.click(triggers[rowIndex]);
    return screen.queryAllByRole('menu').flatMap((menu) =>
      within(menu).queryAllByTestId(/^action-/).map((el) => el.getAttribute('data-testid') ?? ''),
    );
  };

  it('lists Edit in the viewer-owned row menu', () => {
    as(alice, <TableView entity={rows} columns={columns} itemActions={actions} />);
    expect(menuEvents(0)).toEqual(expect.arrayContaining(['action-VIEW', 'action-EDIT']));
  });

  it("control: the other viewer's row menu keeps Open but not Edit", () => {
    as(alice, <TableView entity={rows} columns={columns} itemActions={actions} />);
    const events = menuEvents(1);
    expect(events).toContain('action-VIEW');
    expect(events).not.toContain('action-EDIT');
  });
});

describe('SwipeableRow', () => {
  const left = [{ label: 'Edit', event: 'EDIT', when: ownerOnly }];

  it("reveals the action for the viewer's own row", () => {
    as(alice, <SwipeableRow leftActions={left} itemData={rows[0]}><span>row</span></SwipeableRow>);
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it("control: another viewer's row reveals nothing", () => {
    as(alice, <SwipeableRow leftActions={left} itemData={rows[1]}><span>row</span></SwipeableRow>);
    expect(screen.queryByText('Edit')).toBeNull();
  });
});

describe('DetailPanel', () => {
  const actions = [
    { label: 'Edit', event: 'EDIT', when: ownerOnly },
    { label: 'Archive', event: 'ARCHIVE' },
  ];

  it("draws Edit when the panel's record is the viewer's", () => {
    as(alice, <DetailPanel entity={rows[0]} fields={['title']} actions={actions} />);
    expect(screen.queryAllByTestId('action-EDIT')).toHaveLength(1);
  });

  it("control: another viewer's record hides Edit and keeps the unconditional action", () => {
    as(alice, <DetailPanel entity={rows[1]} fields={['title']} actions={actions} />);
    expect(screen.queryAllByTestId('action-EDIT')).toHaveLength(0);
    expect(screen.queryAllByTestId('action-ARCHIVE')).toHaveLength(1);
  });
});
