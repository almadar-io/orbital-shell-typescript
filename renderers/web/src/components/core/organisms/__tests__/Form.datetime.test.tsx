/**
 * A date-time field submits an instant the kernel accepts: the browser's
 * date-time box holds local wall-clock text with no zone, which the kernel's
 * datetime check refuses, so Project Friday's time-off form never saved.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { Form, type SchemaField } from '../Form';
import { EventBusProvider, useEventBus } from '../../../../core';

const FIELDS: SchemaField[] = [
  { name: 'startDate', label: 'Start', type: 'datetime' },
  { name: 'day', label: 'Day', type: 'date' },
];

function submit(initialData: Record<string, string> | undefined, change: (form: HTMLFormElement) => void): Record<string, unknown> {
  const spy = vi.fn();
  function Listen(): null {
    const bus = useEventBus();
    React.useEffect(() => bus.on('UI:SAVE', (e) => spy(e.payload)), [bus]);
    return null;
  }
  render(<EventBusProvider debug={false}><Listen /><Form fields={FIELDS} submitEvent="SAVE" initialData={initialData} /></EventBusProvider>);
  const form = document.querySelector('form') as HTMLFormElement;
  act(() => change(form));
  act(() => { fireEvent.submit(form); });
  return (spy.mock.calls[0][0] as { data: Record<string, unknown> }).data;
}

describe('Form date-time value', () => {
  it('a typed local date-time is submitted as a zoned ISO instant', () => {
    const data = submit(undefined, (form) => {
      fireEvent.change(form.querySelector('[name=startDate]') as Element, { target: { value: '2026-12-02T09:00' } });
    });
    expect(data.startDate).toBe(new Date(2026, 11, 2, 9, 0).toISOString());
    expect(String(data.startDate)).toMatch(/Z$/);
  });

  it('control: a stored instant left untouched is submitted unchanged', () => {
    const data = submit({ startDate: '2026-12-02T08:00:00.000Z' }, (form) => {
      fireEvent.change(form.querySelector('[name=day]') as Element, { target: { value: '2026-12-05' } });
    });
    expect(data.startDate).toBe('2026-12-02T08:00:00.000Z');
  });

  it('control: a date field keeps its calendar day with no zone', () => {
    const data = submit(undefined, (form) => {
      fireEvent.change(form.querySelector('[name=day]') as Element, { target: { value: '2026-12-05' } });
    });
    expect(data.day).toBe('2026-12-05');
  });
});
