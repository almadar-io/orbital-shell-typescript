import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Form, type SchemaField } from '../Form';
import { EventBusProvider } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('Form required fields', () => {
  it('the checkbox label text carries no literal asterisk; the field itself is required', () => {
    wrap(<Form fields={[{ name: 'agree', label: 'Agree', type: 'boolean', required: true } as SchemaField]} />);
    const box = screen.getByRole('checkbox', { name: 'Agree' });
    expect(box.getAttribute('aria-required')).toBe('true');
    expect(box.closest('div')?.parentElement?.querySelector('label')?.textContent).toBe('Agree*');
  });

  it('the visual asterisk on a text field label is hidden from assistive tech and the field is aria-required', async () => {
    const { container } = wrap(<Form fields={[{ name: 'title', label: 'Title', type: 'string', required: true }]} />);
    const input = screen.getByRole('textbox', { name: 'Title' });
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(container.querySelector('label span')?.getAttribute('aria-hidden')).toBe('true');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('control: an optional field has no marker and no aria-required', () => {
    const { container } = wrap(<Form fields={[{ name: 'notes', label: 'Notes', type: 'string' }]} />);
    expect(screen.getByRole('textbox', { name: 'Notes' }).getAttribute('aria-required')).toBeNull();
    expect(container.querySelector('label span')).toBeNull();
  });

  it('a required select field is aria-required', () => {
    wrap(<Form fields={[{ name: 'kind', label: 'Kind', type: 'enum', enum: ['a', 'b'], required: true } as SchemaField]} />);
    expect(screen.getByRole('combobox', { name: 'Kind' }).getAttribute('aria-required')).toBe('true');
  });
});
