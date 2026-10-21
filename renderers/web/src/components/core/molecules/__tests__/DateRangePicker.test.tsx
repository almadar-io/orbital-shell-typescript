/**
 * DateRangePicker Component Tests
 *
 * Preset resolution contract: a preset's range may be a function (JS
 * callers), a literal { from, to }, or omitted with `value` naming a
 * built-in token — the declarative (.orb) surface. Unresolvable presets
 * must never render (a no-op preset button is a dead control).
 */
import React, { type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateRangePicker, type DateRangePickerPreset } from '../DateRangePicker';
import { EventBusProvider } from '../../../../core';

const TestWrapper = ({ children }: { children: ReactNode }) => (
    <EventBusProvider>{children}</EventBusProvider>
);

const renderWithProvider = (ui: React.ReactElement) => {
    return render(ui, { wrapper: TestWrapper });
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('DateRangePicker presets', () => {
    it('renders the built-in token presets by default', () => {
        renderWithProvider(<DateRangePicker />);
        for (const label of ['Last 7 days', 'Last 30 days', 'This Month', 'This Quarter', 'YTD']) {
            expect(screen.getByText(label)).toBeTruthy();
        }
    });

    it('resolves a token-only preset (declarative form) at click time', () => {
        const onChange = vi.fn();
        const presets: DateRangePickerPreset[] = [{ label: 'Last 7 days', value: '7d' }];
        renderWithProvider(<DateRangePicker presets={presets} onChange={onChange} />);

        fireEvent.click(screen.getByText('Last 7 days'));

        expect(onChange).toHaveBeenCalledTimes(1);
        const range = onChange.mock.calls[0][0];
        expect(range.from).toMatch(ISO_DATE);
        expect(range.to).toMatch(ISO_DATE);
        expect(range.from <= range.to).toBe(true);
    });

    it('uses a literal { from, to } range verbatim', () => {
        const onChange = vi.fn();
        const presets: DateRangePickerPreset[] = [
            { label: 'Q1 2026', value: 'q1-2026', range: { from: '2026-01-01', to: '2026-03-31' } },
        ];
        renderWithProvider(<DateRangePicker presets={presets} onChange={onChange} />);

        fireEvent.click(screen.getByText('Q1 2026'));

        expect(onChange).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-03-31' });
    });

    it('calls a function range (JS caller form)', () => {
        const onChange = vi.fn();
        const presets: DateRangePickerPreset[] = [
            { label: 'Fn range', value: 'fn', range: () => ({ from: '2026-02-01', to: '2026-02-28' }) },
        ];
        renderWithProvider(<DateRangePicker presets={presets} onChange={onChange} />);

        fireEvent.click(screen.getByText('Fn range'));

        expect(onChange).toHaveBeenCalledWith({ from: '2026-02-01', to: '2026-02-28' });
    });

    it('never renders a preset whose range cannot resolve', () => {
        const presets: DateRangePickerPreset[] = [
            { label: 'Dead preset', value: 'not-a-token' },
            { label: 'Last 30 days', value: '30d' },
        ];
        renderWithProvider(<DateRangePicker presets={presets} />);

        expect(screen.queryByText('Dead preset')).toBeNull();
        expect(screen.getByText('Last 30 days')).toBeTruthy();
    });

    it('hides the preset row entirely for an empty presets array', () => {
        const presets: DateRangePickerPreset[] = [];
        renderWithProvider(<DateRangePicker presets={presets} />);
        expect(screen.queryByText('Last 7 days')).toBeNull();
    });
});

describe('DateRangePicker local calendar days', () => {
    it('"This Month" starts on the 1st in a zone east of UTC', () => {
        const original = process.env.TZ;
        process.env.TZ = 'Asia/Riyadh';
        try {
            const onChange = vi.fn();
            renderWithProvider(<DateRangePicker presets={[{ label: 'This Month', value: 'month' }]} onChange={onChange} />);
            fireEvent.click(screen.getByText('This Month'));
            const now = new Date();
            const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
            expect(JSON.stringify(onChange.mock.calls[0])).toContain(expected);
        } finally {
            process.env.TZ = original;
        }
    });
});
