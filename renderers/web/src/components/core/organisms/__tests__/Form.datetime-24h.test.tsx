/**
 * A program that declares a 24-hour format locale (`formatLocale: "sl-SI"`) gets a date-time field with a
 * 24-hour time box: the browser's own date-time box follows the browser's language and showed AM/PM in
 * Project Friday's time-off form.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act, screen } from '@testing-library/react';
import { Form, type SchemaField } from '../Form';
import { EventBusProvider, useEventBus, FormatLocale } from '../../../../core';

const FIELDS: SchemaField[] = [{ name: 'startDate', label: 'Start', type: 'datetime' }];

function mount(formatLocale: string | undefined, initialData?: Record<string, string>): { submit: () => Record<string, unknown> } {
  const spy = vi.fn();
  function Listen(): null {
    const bus = useEventBus();
    React.useEffect(() => bus.on('UI:SAVE', (e) => spy(e.payload)), [bus]);
    return null;
  }
  render(
    <EventBusProvider debug={false}>
      <FormatLocale value={formatLocale}>
        <Listen />
        <Form fields={FIELDS} submitEvent="SAVE" initialData={initialData} />
      </FormatLocale>
    </EventBusProvider>,
  );
  return {
    submit: () => {
      act(() => { fireEvent.submit(document.querySelector('form') as HTMLFormElement); });
      const call = spy.mock.calls[0];
      return call === undefined ? {} : (call[0] as { data: Record<string, unknown> }).data;
    },
  };
}

describe('Form date-time field under a 24-hour format locale', () => {
  it('shows a date box and a 24-hour time box, and submits the zoned instant they name', () => {
    const form = mount('sl-SI');
    const day = screen.getByLabelText('Start date') as HTMLInputElement;
    const time = screen.getByLabelText('Start time') as HTMLInputElement;
    expect(day.type).toBe('date');
    expect(time.placeholder).toBe('HH:MM');
    act(() => { fireEvent.change(day, { target: { value: '2026-12-02' } }); });
    act(() => { fireEvent.change(time, { target: { value: '17:30' } }); });
    expect(form.submit().startDate).toBe(new Date(2026, 11, 2, 17, 30).toISOString());
  });

  it('shows a stored instant on the 24-hour clock', () => {
    mount('sl-SI', { startDate: new Date(2026, 11, 2, 17, 0).toISOString() });
    expect((screen.getByLabelText('Start time') as HTMLInputElement).value).toBe('17:00');
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe('2026-12-02');
  });

  it('edge: a time that is not on the 24-hour clock sets nothing', () => {
    const form = mount('sl-SI');
    act(() => { fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-12-02' } }); });
    act(() => { fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '24:10' } }); });
    expect(form.submit().startDate).toBeUndefined();
  });

  it('control: a 12-hour format locale keeps the browser date-time box', () => {
    mount('en-US');
    expect(document.querySelector('input[type="datetime-local"][name="startDate"]')).not.toBeNull();
    expect(screen.queryByLabelText('Start time')).toBeNull();
  });

  it('control: no format locale keeps the browser date-time box', () => {
    mount(undefined);
    expect(document.querySelector('input[type="datetime-local"][name="startDate"]')).not.toBeNull();
  });
});
