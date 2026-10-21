import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Textarea } from '../../../../core';
import { Checkbox } from '../../../../core';
import { Radio } from '../../../../core';
import { Switch } from '../../../../core';
import { Label } from '../../../../core';
import { Input } from '../../../../core';
import { EventBusProvider } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

function wrap(node: React.ReactNode) {
    return render(<EventBusProvider debug={false}>{node}</EventBusProvider>);
}

function describedText(el: HTMLElement): string | undefined {
    const id = el.getAttribute('aria-describedby') ?? '';
    return document.getElementById(id)?.textContent ?? undefined;
}

describe('Textarea a11y', () => {
    it('is named by its label and has no axe violations', async () => {
        const { container } = wrap(<Textarea label="Notes" />);
        expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA');
        expect(describeViolations(await axeViolations(container))).toEqual([]);
    });

    it('error sets aria-invalid and describes the field; required sets aria-required', async () => {
        const { container } = wrap(<Textarea label="Notes" error="Too short" required />);
        const field = screen.getByLabelText('Notes');
        expect(field.getAttribute('aria-invalid')).toBe('true');
        expect(field.getAttribute('aria-required')).toBe('true');
        expect(describedText(field)).toBe('Too short');
        expect(describeViolations(await axeViolations(container))).toEqual([]);
    });

    it('helperText describes the field without marking it invalid', () => {
        wrap(<Textarea label="Notes" helperText="Plain text only" />);
        const field = screen.getByLabelText('Notes');
        expect(describedText(field)).toBe('Plain text only');
        expect(field.getAttribute('aria-invalid')).toBeNull();
    });

    it('keeps a caller id and merges a caller aria-describedby', () => {
        wrap(<><p id="ext">External</p><Textarea label="Notes" id="n1" aria-describedby="ext" helperText="Help" /></>);
        const field = screen.getByLabelText('Notes');
        expect(field.id).toBe('n1');
        expect((field.getAttribute('aria-describedby') ?? '').split(' ')).toContain('ext');
        expect((field.getAttribute('aria-describedby') ?? '').split(' ')).toHaveLength(2);
    });

    it('control: bare textarea renders no wrapper, label or aria state', () => {
        const { container } = wrap(<Textarea aria-label="Bio" />);
        expect(container.querySelector('label')).toBeNull();
        const field = screen.getByRole('textbox', { name: 'Bio' });
        expect(field.getAttribute('aria-required')).toBeNull();
        expect(field.getAttribute('aria-describedby')).toBeNull();
    });
});

describe('Checkbox a11y', () => {
    it('gives each checkbox a stable unique id instead of a random one', () => {
        wrap(<><Checkbox label="A" /><Checkbox label="B" /></>);
        const a = screen.getByLabelText('A');
        const b = screen.getByLabelText('B');
        expect(a.id).not.toBe(b.id);
        expect(a.id).not.toMatch(/^checkbox-[a-z0-9]{9}$/);
    });

    it('error sets aria-invalid and aria-describedby; required sets aria-required with a decorative marker', async () => {
        const { container } = wrap(<Checkbox label="Agree" error="Must accept" required />);
        const box = screen.getByRole('checkbox');
        expect(box.getAttribute('aria-invalid')).toBe('true');
        expect(box.getAttribute('aria-required')).toBe('true');
        expect(describedText(box)).toBe('Must accept');
        expect(container.querySelector('label span')?.getAttribute('aria-hidden')).toBe('true');
        expect(describeViolations(await axeViolations(container))).toEqual([]);
    });

    it('merges a caller aria-describedby with the error id', () => {
        wrap(<><p id="ext">Hint</p><Checkbox label="Agree" error="Bad" aria-describedby="ext" /></>);
        expect((screen.getByRole('checkbox').getAttribute('aria-describedby') ?? '').split(' ')).toHaveLength(2);
    });

    it('control: plain checkbox has no invalid/required/describedby', () => {
        wrap(<Checkbox label="Agree" />);
        const box = screen.getByRole('checkbox');
        expect(box.getAttribute('aria-invalid')).toBeNull();
        expect(box.getAttribute('aria-required')).toBeNull();
        expect(box.getAttribute('aria-describedby')).toBeNull();
    });
});

describe('Label required marker', () => {
    it('hides the asterisk from assistive tech', () => {
        const { container } = wrap(<Label required>Name</Label>);
        const marker = container.querySelector('span');
        expect(marker?.textContent).toBe('*');
        expect(marker?.getAttribute('aria-hidden')).toBe('true');
    });

    it('control: not required renders no marker', () => {
        const { container } = wrap(<Label>Name</Label>);
        expect(container.querySelector('span')).toBeNull();
    });

    it('forwards A11yProps to the label', () => {
        const { container } = wrap(<Label lang="ar" dir="rtl">Name</Label>);
        expect(container.querySelector('label')?.getAttribute('dir')).toBe('rtl');
    });
});

describe('Radio a11y', () => {
    it('group is a named radiogroup, required and error flow to the group, no axe violations', async () => {
        const { container } = wrap(<Radio label="Size" options={['S', 'M']} required error="Pick" />);
        const group = screen.getByRole('radiogroup', { name: 'Size' });
        expect(group.getAttribute('aria-required')).toBe('true');
        expect(group.getAttribute('aria-invalid')).toBe('true');
        expect(describedText(group)).toBe('Pick');
        expect(describeViolations(await axeViolations(container))).toEqual([]);
    });

    it('aria-label overrides label as the group name', () => {
        wrap(<Radio label="Size" aria-label="T-shirt size" options={['S', 'M']} />);
        expect(screen.getByRole('radiogroup', { name: 'T-shirt size' })).toBeTruthy();
    });

    it('single radio carries aria-required and keeps its error description', () => {
        wrap(<Radio label="Opt in" required error="Needed" />);
        const radio = screen.getByRole('radio');
        expect(radio.getAttribute('aria-required')).toBe('true');
        expect(describedText(radio)).toBe('Needed');
    });

    it('control: no required leaves aria-required unset', () => {
        wrap(<Radio label="Size" options={['S', 'M']} />);
        expect(screen.getByRole('radiogroup').getAttribute('aria-required')).toBeNull();
    });
});

describe('Switch a11y', () => {
    it('aria-label names a switch with no visible label', async () => {
        const { container } = wrap(<Switch aria-label="Dark mode" />);
        expect(screen.getByRole('switch', { name: 'Dark mode' })).toBeTruthy();
        expect(describeViolations(await axeViolations(container))).toEqual([]);
    });

    it('control: an unnamed switch is flagged by axe', async () => {
        const { container } = wrap(<Switch />);
        expect((await axeViolations(container)).map((v) => v.id)).toContain('button-name');
    });

    it('forwards aria-describedby and still toggles', () => {
        const onChange = vi.fn();
        wrap(<Switch label="Notify" aria-describedby="x" onChange={onChange} />);
        const sw = screen.getByRole('switch');
        expect(sw.getAttribute('aria-describedby')).toBe('x');
        fireEvent.click(sw);
        expect(onChange).toHaveBeenCalledWith(true);
    });
});

describe('Input a11y', () => {
    it('clear button is a named button and clears', () => {
        const onClear = vi.fn();
        wrap(<Input label="Q" value="abc" clearable onClear={onClear} onChange={() => undefined} />);
        fireEvent.click(screen.getByRole('button', { name: 'Clear input' }));
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('control: no value renders no clear button', () => {
        wrap(<Input label="Q" value="" clearable onChange={() => undefined} />);
        expect(screen.queryByRole('button', { name: 'Clear input' })).toBeNull();
    });

    it('required sets aria-required and a caller aria-describedby merges with the helper text', async () => {
        const { container } = wrap(<><p id="ext">Ext</p><Input label="Email" required helperText="We never share it" aria-describedby="ext" /></>);
        const input = screen.getByLabelText('Email');
        expect(input.getAttribute('aria-required')).toBe('true');
        expect((input.getAttribute('aria-describedby') ?? '').split(' ')).toHaveLength(2);
        expect(describeViolations(await axeViolations(container))).toEqual([]);
    });
});
