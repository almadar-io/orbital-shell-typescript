import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { Select } from '../../../../core';
import { EventBusProvider } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

const OPTIONS = [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana', disabled: true },
    { value: 'cherry', label: 'Cherry' },
    { value: 'date', label: 'Date' },
];

function renderSelect(props: Partial<React.ComponentProps<typeof Select>> = {}) {
    return render(
        <EventBusProvider debug={false}>
            <Select label="Fruit" options={OPTIONS} searchable={false} clearable {...props} />
        </EventBusProvider>,
    );
}

describe('Select native', () => {
    it('is named by its label and has no axe violations', async () => {
        const { container } = render(
            <EventBusProvider debug={false}>
                <Select label="Fruit" options={OPTIONS} />
            </EventBusProvider>,
        );
        expect(screen.getByLabelText('Fruit').tagName).toBe('SELECT');
        expect(describeViolations(await axeViolations(container))).toEqual([]);
    });

    it('error sets aria-invalid and describes the field with the error text', () => {
        render(
            <EventBusProvider debug={false}>
                <Select label="Fruit" options={OPTIONS} error="Pick one" required />
            </EventBusProvider>,
        );
        const select = screen.getByLabelText('Fruit');
        expect(select.getAttribute('aria-invalid')).toBe('true');
        expect(select.getAttribute('aria-required')).toBe('true');
        const id = select.getAttribute('aria-describedby') ?? '';
        expect(document.getElementById(id)?.textContent).toBe('Pick one');
    });

    it('control: no error and not required leaves invalid/required unset', () => {
        render(
            <EventBusProvider debug={false}>
                <Select label="Fruit" options={OPTIONS} />
            </EventBusProvider>,
        );
        const select = screen.getByLabelText('Fruit');
        expect(select.getAttribute('aria-invalid')).toBeNull();
        expect(select.getAttribute('aria-required')).toBeNull();
        expect(select.getAttribute('aria-describedby')).toBeNull();
    });

    it('aria-label from A11yProps names an unlabelled select', () => {
        render(
            <EventBusProvider debug={false}>
                <Select aria-label="Sort by" options={OPTIONS} />
            </EventBusProvider>,
        );
        expect(screen.getByRole('combobox', { name: 'Sort by' })).toBeTruthy();
    });
});

describe('Select rich combobox', () => {
    it('trigger is a collapsed combobox that controls a listbox', () => {
        renderSelect();
        const trigger = screen.getByRole('combobox', { name: 'Fruit' });
        expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        const list = screen.getByRole('listbox');
        expect(trigger.getAttribute('aria-controls')).toBe(list.id);
        expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Apple', 'Banana', 'Cherry', 'Date']);
    });

    it('marks the selected option with aria-selected and the disabled one aria-disabled', () => {
        renderSelect({ value: 'cherry' });
        fireEvent.click(screen.getByRole('combobox'));
        const options = screen.getAllByRole('option');
        expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true', 'false']);
        expect(options[1].getAttribute('aria-disabled')).toBe('true');
    });

    it('ArrowDown/ArrowUp/Home/End move the active option and skip disabled ones', () => {
        renderSelect();
        const trigger = screen.getByRole('combobox');
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        const active = () => document.getElementById(trigger.getAttribute('aria-activedescendant') ?? '')?.textContent;
        expect(active()).toBe('Apple');
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        expect(active()).toBe('Cherry');
        fireEvent.keyDown(trigger, { key: 'End' });
        expect(active()).toBe('Date');
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        expect(active()).toBe('Date');
        fireEvent.keyDown(trigger, { key: 'Home' });
        expect(active()).toBe('Apple');
        fireEvent.keyDown(trigger, { key: 'ArrowUp' });
        expect(active()).toBe('Apple');
    });

    it('Enter selects the active option and closes', () => {
        const onValueChange = vi.fn();
        renderSelect({ onValueChange });
        const trigger = screen.getByRole('combobox');
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        fireEvent.keyDown(trigger, { key: 'Enter' });
        expect(onValueChange).toHaveBeenCalledWith('cherry');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('Space selects the active option', () => {
        const onValueChange = vi.fn();
        renderSelect({ onValueChange });
        const trigger = screen.getByRole('combobox');
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        fireEvent.keyDown(trigger, { key: ' ' });
        expect(onValueChange).toHaveBeenCalledWith('apple');
    });

    it('Escape closes and returns focus to the trigger', () => {
        renderSelect({ searchable: true });
        const trigger = screen.getByRole('combobox', { name: 'Fruit' });
        trigger.focus();
        fireEvent.click(trigger);
        const search = screen.getByRole('searchbox');
        search.focus();
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('type-ahead jumps to the first option starting with the typed character', () => {
        renderSelect();
        const trigger = screen.getByRole('combobox');
        fireEvent.keyDown(trigger, { key: 'd' });
        expect(document.getElementById(trigger.getAttribute('aria-activedescendant') ?? '')?.textContent).toBe('Date');
        fireEvent.keyDown(trigger, { key: 'C' });
        expect(document.getElementById(trigger.getAttribute('aria-activedescendant') ?? '')?.textContent).toBe('Cherry');
    });

    it('type-ahead with no match leaves the active option unchanged', () => {
        renderSelect();
        const trigger = screen.getByRole('combobox');
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        fireEvent.keyDown(trigger, { key: 'z' });
        expect(document.getElementById(trigger.getAttribute('aria-activedescendant') ?? '')?.textContent).toBe('Apple');
    });

    it('error and required reach the trigger', () => {
        renderSelect({ error: 'Pick one', required: true });
        const trigger = screen.getByRole('combobox');
        expect(trigger.getAttribute('aria-invalid')).toBe('true');
        expect(trigger.getAttribute('aria-required')).toBe('true');
        const id = trigger.getAttribute('aria-describedby') ?? '';
        expect(document.getElementById(id)?.textContent).toBe('Pick one');
    });

    it('clear button has an accessible name and clears', () => {
        const onValueChange = vi.fn();
        renderSelect({ value: 'apple', onValueChange });
        fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
        expect(onValueChange).toHaveBeenCalledWith('');
    });

    it('control: no value renders no clear button', () => {
        renderSelect();
        expect(screen.queryByRole('button', { name: 'Clear selection' })).toBeNull();
    });

    it('search input is labelled and shows a visible focus ring', () => {
        renderSelect({ searchable: true });
        fireEvent.click(screen.getByRole('combobox'));
        const search = screen.getByRole('searchbox', { name: 'Search options' });
        expect(search.className).toContain('focus-visible:ring');
        expect(search.className).not.toContain('focus:outline-none');
    });

    it('search filters visible options and resets the active option', () => {
        renderSelect({ searchable: true });
        fireEvent.click(screen.getByRole('combobox'));
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ch' } });
        expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Cherry']);
    });

    it('multiple marks the listbox multiselectable and keeps it open on pick', () => {
        const onValueChange = vi.fn();
        renderSelect({ multiple: true, value: ['apple'], onValueChange });
        fireEvent.click(screen.getByRole('combobox'));
        expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true');
        fireEvent.click(screen.getByRole('option', { name: 'Cherry' }));
        expect(onValueChange).toHaveBeenCalledWith(['apple', 'cherry']);
        expect(screen.queryByRole('listbox')).not.toBeNull();
    });

    it('groups render as labelled groups', () => {
        renderSelect({ options: undefined, groups: [{ label: 'Stone', options: [OPTIONS[2]] }], value: undefined });
        fireEvent.click(screen.getByRole('combobox'));
        expect(screen.getByRole('group', { name: 'Stone' })).toBeTruthy();
    });

    it('has no axe violations closed or open', async () => {
        const { container } = renderSelect({ searchable: true, value: 'apple', error: 'Pick one', required: true });
        expect(describeViolations(await axeViolations(container))).toEqual([]);
        fireEvent.click(screen.getByRole('combobox'));
        expect(describeViolations(await axeViolations(container))).toEqual([]);
    });
});
