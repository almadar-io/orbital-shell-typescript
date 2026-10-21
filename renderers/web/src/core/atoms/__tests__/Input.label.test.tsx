import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Input } from '../../index';
import { EventBusProvider } from '../../index';

function renderInput(props: React.ComponentProps<typeof Input>) {
    return render(
        <EventBusProvider debug={false}>
            <Input {...props} />
        </EventBusProvider>,
    );
}

describe('Input label', () => {
    it('names its field, so a click or a screen reader reaches the input', () => {
        const { getByLabelText } = renderInput({ label: 'Email', name: 'email', type: 'email' });
        expect(getByLabelText('Email').getAttribute('name')).toBe('email');
    });

    it('keeps a caller id and points the label at it', () => {
        const { getByLabelText } = renderInput({ label: 'Password', id: 'pw', type: 'password' });
        expect(getByLabelText('Password').id).toBe('pw');
    });

    it('describes the field with its helper text and flags an error', () => {
        const { getByLabelText } = renderInput({ label: 'Name', helperText: 'Shown on your profile', error: 'Required' });
        const input = getByLabelText('Name');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        const describedBy = input.getAttribute('aria-describedby');
        expect(describedBy && document.getElementById(describedBy)?.textContent).toBe('Required');
    });

    it('control: no label renders no label element', () => {
        const { container } = renderInput({ name: 'q', placeholder: 'Search' });
        expect(container.querySelector('label')).toBeNull();
    });
});
