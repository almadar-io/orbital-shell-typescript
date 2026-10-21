import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FormField } from '../FormField';
import { Input } from '../../../../core';
import { EventBusProvider } from '../../../../core';

const wrap = (node: React.ReactNode) => render(<EventBusProvider debug={false}>{node}</EventBusProvider>);

describe('FormField label', () => {
    it('names its field', () => {
        const { getByLabelText } = wrap(<FormField label="Company"><Input name="company" /></FormField>);
        expect(getByLabelText('Company').getAttribute('name')).toBe('company');
    });

    it('keeps the field id the caller gave', () => {
        const { getByLabelText } = wrap(<FormField label="Seats"><Input id="seats" name="seats" /></FormField>);
        expect(getByLabelText('Seats').id).toBe('seats');
    });

    it('control: several children are left as they are', () => {
        const { container } = wrap(
            <FormField label="Range"><Input name="from" /><Input name="to" /></FormField>,
        );
        expect(container.querySelector('label')?.getAttribute('for')).toBeNull();
    });
});

describe('FormField hint and error', () => {
    it('links the hint to the field', () => {
        const { getByLabelText, getByText } = wrap(<FormField label="Seats" hint="Whole numbers only"><Input name="seats" /></FormField>);
        const ids = (getByLabelText('Seats').getAttribute('aria-describedby') ?? '').split(' ');
        expect(ids).toContain(getByText('Whole numbers only').id);
    });

    it('an error flags the field and is linked to it', () => {
        const { getByLabelText, getByText } = wrap(<FormField label="Seats" error="Enter a number"><Input name="seats" /></FormField>);
        const input = getByLabelText('Seats');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect((input.getAttribute('aria-describedby') ?? '').split(' ')).toContain(getByText('Enter a number').id);
    });

    it('control: no hint and no error, no description and not invalid', () => {
        const { getByLabelText } = wrap(<FormField label="Seats"><Input name="seats" /></FormField>);
        expect(getByLabelText('Seats').getAttribute('aria-describedby')).toBeNull();
        expect(getByLabelText('Seats').getAttribute('aria-invalid')).toBeNull();
    });
});
