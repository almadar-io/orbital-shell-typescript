import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Switch } from '../../index';

describe('Switch label', () => {
    it('toggles exactly once per label click when an id is set', () => {
        const onChange = vi.fn();
        const { getByText, getByRole } = render(<Switch id="notify" label="Notify" onChange={onChange} />);
        fireEvent.click(getByText('Notify'));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(getByRole('switch').getAttribute('aria-checked')).toBe('true');
    });

    it('toggles exactly once per label click without an id', () => {
        const onChange = vi.fn();
        const { getByText, getByRole } = render(<Switch label="Notify" onChange={onChange} />);
        fireEvent.click(getByText('Notify'));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(getByRole('switch').getAttribute('aria-checked')).toBe('true');
    });

    it('is named by its visible label', () => {
        const { getByLabelText } = render(<Switch label="Notify" />);
        expect(getByLabelText('Notify').getAttribute('role')).toBe('switch');
    });

    it('control: a disabled switch ignores label clicks', () => {
        const onChange = vi.fn();
        const { getByText } = render(<Switch id="n" label="Notify" disabled onChange={onChange} />);
        fireEvent.click(getByText('Notify'));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('control: a direct click on the switch toggles once', () => {
        const onChange = vi.fn();
        const { getByRole } = render(<Switch id="n" label="Notify" onChange={onChange} />);
        fireEvent.click(getByRole('switch'));
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});
