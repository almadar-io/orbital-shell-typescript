/**
 * A field's declared default is what the form shows, so it is what the form
 * submits: Project Friday's create form showed Status "To do" yet saved no
 * status, and the new task fitted no board column.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { Form, type SchemaField } from '../Form';
import { EventBusProvider, useEventBus } from '../../../../core';

const FIELDS: SchemaField[] = [
  { name: 'title', label: 'Title', type: 'string' },
  { name: 'status', label: 'Status', type: 'string', values: ['todo', 'done'], defaultValue: 'todo' },
  { name: 'note', label: 'Note', type: 'string' },
];

function submitWith(change?: (form: HTMLFormElement) => void): ReturnType<typeof vi.fn> {
  const spy = vi.fn();
  function Listen(): null {
    const bus = useEventBus();
    React.useEffect(() => bus.on('UI:SAVE', (e) => spy(e.payload)), [bus]);
    return null;
  }
  render(<EventBusProvider debug={false}><Listen /><Form fields={FIELDS} submitEvent="SAVE" /></EventBusProvider>);
  const form = document.querySelector('form') as HTMLFormElement;
  act(() => { fireEvent.change(form.querySelector('[name=title]') as Element, { target: { value: 'T' } }); });
  if (change) act(() => change(form));
  act(() => { fireEvent.submit(form); });
  return spy;
}

describe('Form defaults', () => {
  it('an untouched field with a declared default is submitted with that default', () => {
    const spy = submitWith();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'T', status: 'todo' }) }));
  });

  it('control: a value the user picked wins over the default', () => {
    const spy = submitWith((form) => { fireEvent.change(form.querySelector('[name=status]') as Element, { target: { value: 'done' } }); });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'done' }) }));
  });

  it('control: a field with no default is not invented', () => {
    const spy = submitWith();
    const data = (spy.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect('note' in data).toBe(false);
  });
});
