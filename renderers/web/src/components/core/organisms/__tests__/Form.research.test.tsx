import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { Form, type SchemaField } from '../Form';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

const FIELDS: SchemaField[] = [
  { name: 'title', label: 'Title', type: 'string', required: true, hint: 'Shown on the card' },
  { name: 'email', label: 'Email', type: 'email', required: true },
  { name: 'notes', label: 'Notes', type: 'string' },
];

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('Form — labels and ids', () => {
  it('every label is programmatically tied to its field', () => {
    wrap(<Form fields={FIELDS} />);
    expect(screen.getByLabelText(/Title/).getAttribute('name')).toBe('title');
    expect(screen.getByLabelText(/Email/).getAttribute('name')).toBe('email');
  });

  it('two forms with the same fields never share element ids', () => {
    wrap(<><Form fields={FIELDS} /><Form fields={FIELDS} /></>);
    const ids = screen.getAllByRole('textbox').map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a hint is linked to its field', () => {
    wrap(<Form fields={FIELDS} />);
    const input = screen.getByLabelText(/Title/);
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ').map((id) => document.getElementById(id)?.textContent)).toContain('Shown on the card');
  });
});

describe('Form — inline validation', () => {
  it('leaving an invalid field shows its error inline, linked and flagged', () => {
    wrap(<Form fields={FIELDS} />);
    const input = screen.getByLabelText(/Title/);
    act(() => { fireEvent.blur(input); });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
    const error = ids.map((id) => document.getElementById(id)).find((el) => el?.hasAttribute('data-field-error'));
    expect(error?.textContent).toBeTruthy();
  });

  it('fixing the field clears its error', () => {
    wrap(<Form fields={FIELDS} />);
    const input = screen.getByLabelText(/Title/);
    act(() => { fireEvent.blur(input); });
    act(() => { fireEvent.change(input, { target: { value: 'Quarterly report' } }); });
    act(() => { fireEvent.blur(input); });
    expect(input.getAttribute('aria-invalid')).not.toBe('true');
    expect(document.querySelector('[data-field-error]')).toBeNull();
  });

  it('control: an optional empty field is never flagged', () => {
    wrap(<Form fields={FIELDS} />);
    const notes = screen.getByLabelText(/Notes/);
    act(() => { fireEvent.blur(notes); });
    expect(notes.getAttribute('aria-invalid')).not.toBe('true');
  });

  it('an invalid submit lists every offending field in a summary whose links focus the field', async () => {
    wrap(<Form fields={FIELDS} />);
    const form = document.querySelector('form') as HTMLFormElement;
    await act(async () => { form.checkValidity(); });
    const summary = screen.getByRole('alert');
    expect(summary.textContent).toContain('Please fix 2 fields');
    act(() => { fireEvent.click(within(summary).getByRole('button', { name: 'Email' })); });
    expect(document.activeElement).toBe(screen.getByLabelText(/Email/));
    expect(screen.getByLabelText(/Title/).getAttribute('aria-invalid')).toBe('true');
  });
});

describe('Form — structure and actions', () => {
  it('sections are fieldsets named by their legend, and a collapsible one is a real toggle', () => {
    wrap(
      <Form
        fields={[]}
        sections={[{ id: 's1', title: 'Contact', collapsible: true, fields: [{ name: 'phone', label: 'Phone', type: 'string' }] }]}
      />,
    );
    const group = screen.getByRole('group', { name: /Contact/ });
    expect(group.tagName).toBe('FIELDSET');
    const toggle = within(group).getByRole('button', { name: /Contact/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    act(() => { fireEvent.click(toggle); });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('the primary action comes last, at the end of a sticky action row', () => {
    wrap(<Form fields={FIELDS} showCancel />);
    const save = screen.getByRole('button', { name: 'Save' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const row = save.parentElement as HTMLElement;
    expect(row.className).toContain('justify-end');
    expect(row.className).toContain('sticky');
  });

  it('a vertical form is one readable column', () => {
    wrap(<Form fields={FIELDS} />);
    expect((document.querySelector('form') as HTMLFormElement).className).toMatch(/max-w-/);
  });

  it('control: a valid submit emits the submit event with the data', () => {
    const spy = vi.fn();
    function Listen() {
      const bus = useEventBus();
      React.useEffect(() => bus.on('UI:SAVE', (e) => spy(e.payload)), [bus]);
      return null;
    }
    wrap(<><Listen /><Form fields={[{ name: 'title', label: 'Title', type: 'string' }]} submitEvent="SAVE" /></>);
    act(() => { fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Q3' } }); });
    act(() => { fireEvent.submit(document.querySelector('form') as HTMLFormElement); });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'Q3' }) }));
  });
});
