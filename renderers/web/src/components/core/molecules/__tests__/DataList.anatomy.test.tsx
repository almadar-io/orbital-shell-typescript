/**
 * DataList row anatomy is driven by each field's declared role:
 * overline = eyebrow above the title, avatar = leading initials, caption =
 * prose under the title (DataGrid's meaning), body/small = the meta line.
 * A clickable row is ONE stretched control (the title), never a button that
 * contains the row-action buttons.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DataList, type DataListField } from '../DataList';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

function Spy({ event, onFire }: { event: string; onFire: (p: unknown) => void }) {
  const bus = useEventBus();
  React.useEffect(() => bus.on(`UI:${event}`, (e) => onFire(e.payload)), [bus, event, onFire]);
  return null;
}
const renderList = (ui: React.ReactElement, spies: { event: string; onFire: (p: unknown) => void }[] = []) =>
  render(
    <EventBusProvider debug={false}>
      {spies.map((s) => <Spy key={s.event} {...s} />)}
      {ui}
    </EventBusProvider>,
  );

const rows = [
  { id: 'a1', title: 'The waiting room', section: 'Cities', excerpt: 'Four months inside three transit agencies.', author: 'Ruth Adeyemi', status: 'published' },
  { id: 'a2', title: 'Unions at the office', section: 'Work', excerpt: '', author: 'Jonas Weber', status: 'draft' },
];
const fields: readonly DataListField[] = [
  { name: 'section', variant: 'overline' },
  { name: 'title', variant: 'h3' },
  { name: 'excerpt', variant: 'caption' },
  { name: 'author', label: 'By', variant: 'small' },
  { name: 'status', variant: 'badge' },
  { name: 'author', variant: 'avatar' },
];
const rowOf = (text: string) => screen.getByText(text).closest('[data-entity-row]') as HTMLElement;

describe('DataList field roles', () => {
  it('overline renders as an eyebrow ABOVE the title', () => {
    renderList(<DataList entity={rows} fields={fields} />);
    const eyebrow = screen.getByText('Cities');
    const title = screen.getByText('The waiting room');
    expect(eyebrow.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(eyebrow.className).toMatch(/uppercase/);
  });

  it('avatar renders leading initials from its value', () => {
    renderList(<DataList entity={rows} fields={fields} />);
    expect(within(rowOf('The waiting room')).getByText('RA')).toBeInTheDocument();
  });

  it('control: without an avatar field no initials are drawn', () => {
    renderList(<DataList entity={rows} fields={fields.filter((f) => f.variant !== 'avatar')} />);
    expect(within(rowOf('The waiting room')).queryByText('RA')).toBeNull();
  });

  it('caption is prose: shown as its own paragraph with no "label:" prefix', () => {
    renderList(<DataList entity={rows} fields={fields} />);
    const prose = screen.getByText('Four months inside three transit agencies.');
    expect(prose.parentElement?.textContent).toBe('Four months inside three transit agencies.');
  });

  it('control: small stays on the meta line with its screen-reader label', () => {
    renderList(<DataList entity={rows} fields={fields.filter((f) => f.variant !== 'avatar')} />);
    const row = rowOf('The waiting room');
    expect(within(row).getByText('By:')).toHaveClass('sr-only');
    expect(within(row).getByText('Ruth Adeyemi')).toBeInTheDocument();
  });

  it('edge: an empty caption renders nothing (no blank paragraph)', () => {
    renderList(<DataList entity={rows} fields={fields} />);
    const row = rowOf('Unions at the office');
    expect(within(row).queryAllByText('', { selector: 'p' })).toHaveLength(0);
  });

  it('compact rows do not borrow the display heading voice for their title', () => {
    renderList(<DataList entity={rows} fields={fields} variant="compact" />);
    expect(screen.getByText('The waiting room').className).not.toMatch(/heading-voice/);
    expect(screen.getByText('The waiting room').className).toMatch(/font-semibold/);
  });

  it('control: default rows keep the declared heading', () => {
    renderList(<DataList entity={rows} fields={fields} />);
    expect(screen.getByText('The waiting room').tagName).toBe('H3');
  });
});

describe('DataList clickable rows (stretched control)', () => {
  const actions = [{ label: 'Edit', event: 'EDIT' }, { label: 'Delete', event: 'DELETE', variant: 'danger' as const }];

  it('the row is not a button; the title is the one control and no button nests inside another', () => {
    renderList(<DataList entity={rows} fields={fields} itemClickEvent="VIEW" itemActions={actions} />);
    const row = rowOf('The waiting room');
    expect(row.getAttribute('role')).not.toBe('button');
    for (const btn of within(row).getAllByRole('button')) {
      expect(btn.parentElement?.closest('[role=button]')).toBeNull();
    }
    expect(within(row).getByRole('button', { name: /The waiting room/ })).toBeInTheDocument();
  });

  it('Enter on the title fires the row event with { id, row }', () => {
    const onView = vi.fn();
    renderList(<DataList entity={rows} fields={fields} itemClickEvent="VIEW" />, [{ event: 'VIEW', onFire: onView }]);
    fireEvent.keyDown(screen.getByRole('button', { name: /The waiting room/ }), { key: 'Enter' });
    expect(onView).toHaveBeenCalledTimes(1);
    expect(onView.mock.calls[0][0]).toMatchObject({ id: 'a1' });
  });

  it('an action click fires the action, never the row', () => {
    const onView = vi.fn();
    const onEdit = vi.fn();
    renderList(<DataList entity={rows} fields={fields} itemClickEvent="VIEW" itemActions={actions} />, [
      { event: 'VIEW', onFire: onView },
      { event: 'EDIT', onFire: onEdit },
    ]);
    fireEvent.click(within(rowOf('The waiting room')).getByTestId('action-EDIT'));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onView).not.toHaveBeenCalled();
  });

  it('control: without itemClickEvent the title is plain text, not a control', () => {
    renderList(<DataList entity={rows} fields={fields} />);
    expect(screen.queryByRole('button', { name: /The waiting room/ })).toBeNull();
  });

  it('edge: a custom renderItem row gets one named overlay control, with its actions outside it', () => {
    renderList(
      <DataList entity={rows} itemClickEvent="VIEW" itemActions={actions} renderItem={(item) => <span>{String(item.title)}</span>} />,
    );
    const row = rowOf('The waiting room');
    expect(row.getAttribute('role')).not.toBe('button');
    for (const btn of within(row).getAllByRole('button')) {
      expect(btn.parentElement?.closest('[role=button]')).toBeNull();
    }
  });
});

describe('DataList title length (Almadar_UX 2.7: long titles clamp to 2 lines)', () => {
  const long = [{ id: 'v1', title: 'You will not believe what happened when we tried every keyboard on the market', author: 'Clickbait Central' }];
  const titleOf = () => screen.getByText(long[0].title);

  it('a row title wraps up to two lines instead of cutting off on one', () => {
    renderList(<DataList entity={long} fields={[{ name: 'title', variant: 'h4' }, { name: 'author', variant: 'small' }]} />);
    expect(titleOf().className).toContain('line-clamp-2');
    expect(titleOf().className).not.toContain('truncate');
  });

  it('control: a compact row keeps its one-line scanning label', () => {
    renderList(<DataList entity={long} variant="compact" fields={[{ name: 'title', variant: 'h4' }, { name: 'author', variant: 'small' }]} />);
    expect(titleOf().className).toContain('truncate');
  });
});
