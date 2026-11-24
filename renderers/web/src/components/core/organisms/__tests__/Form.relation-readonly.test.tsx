/**
 * A relation field picks from the rows its form is handed, and a field the
 * program marks read-only shows its value without letting it change: Project
 * Friday's time-off form picks the employee from the team, and only managers
 * of people may pick someone other than themselves.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act, screen } from '@testing-library/react';
import { Form, type SchemaField, type SchemaFieldOverride } from '../Form';
import { EventBusProvider, useEventBus } from '../../../../core';

const FIELDS: SchemaField[] = [
  { name: 'requester', label: 'Employee', type: 'relation', relation: { entity: 'Person' } },
];
const PEOPLE = { requester: [{ value: 'p1', label: 'Ana Novak' }, { value: 'p2', label: 'Luka Kovač' }] };

function mount(overrides: SchemaFieldOverride[]): { submit: () => Record<string, unknown> } {
  const spy = vi.fn();
  function Listen(): null {
    const bus = useEventBus();
    React.useEffect(() => bus.on('UI:SAVE', (e) => spy(e.payload)), [bus]);
    return null;
  }
  render(
    <EventBusProvider debug={false}>
      <Listen />
      <Form fields={FIELDS} submitEvent="SAVE" initialData={{ requester: 'p1' }} relationsData={PEOPLE} fieldOverrides={overrides} />
    </EventBusProvider>,
  );
  return {
    submit: () => {
      act(() => { fireEvent.submit(document.querySelector('form') as HTMLFormElement); });
      return (spy.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    },
  };
}

describe('Form relation field and read-only override', () => {
  it('shows the related row the value names, by its label', () => {
    mount([]);
    expect(screen.getByRole('button', { name: /Ana Novak/ })).toBeTruthy();
  });

  it('a read-only override disables the picker and keeps the value it was given', () => {
    const form = mount([{ name: 'requester', readonly: true }]);
    expect((screen.getByRole('button', { name: /Ana Novak/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(form.submit().requester).toBe('p1');
  });

  it('control: without the override another row can be picked and is submitted', () => {
    const form = mount([]);
    const trigger = screen.getByRole('button', { name: /Ana Novak/ }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    act(() => { fireEvent.click(trigger); });
    act(() => { fireEvent.click(screen.getByText('Luka Kovač')); });
    expect(form.submit().requester).toBe('p2');
  });

  it('control: a read-only override of false leaves the picker usable', () => {
    mount([{ name: 'requester', readonly: false }]);
    expect((screen.getByRole('button', { name: /Ana Novak/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
