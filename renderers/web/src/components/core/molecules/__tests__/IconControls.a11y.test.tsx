import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NumberStepper } from '../NumberStepper';
import { Coachmark } from '../Coachmark';
import { DocumentViewer } from '../DocumentViewer';
import { CodeBlock } from '../markdown/CodeBlock';
import { EventBusProvider } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

function wrap(node: React.ReactNode) {
    return render(<EventBusProvider debug={false}>{node}</EventBusProvider>);
}

describe('NumberStepper a11y', () => {
    it('increase and decrease are named from aria.* keys and the group is named', async () => {
        const { container } = wrap(<NumberStepper value={2} label="Quantity" />);
        expect(screen.getByRole('group', { name: 'Quantity' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Decrease' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Increase' })).toBeTruthy();
        expect(describeViolations(await axeViolations(container))).toEqual([]);
    });

    it('aria-label from A11yProps wins over label; aria-describedby is forwarded', () => {
        wrap(<NumberStepper value={1} label="Qty" aria-label="Seats" aria-describedby="hint" />);
        const group = screen.getByRole('group', { name: 'Seats' });
        expect(group.getAttribute('aria-describedby')).toBe('hint');
    });

    it('control: bounds disable the matching button', () => {
        wrap(<NumberStepper value={0} min={0} max={5} />);
        expect((screen.getByRole('button', { name: 'Decrease' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Increase' }) as HTMLButtonElement).disabled).toBe(false);
    });
});

describe('Coachmark a11y', () => {
    it('dismiss is a named button, the dialog is named by its title, and it dismisses', async () => {
        const onDismiss = vi.fn();
        const anchor = new DOMRect(10, 10, 20, 20);
        wrap(<Coachmark open anchor={anchor} title="Welcome" onDismiss={onDismiss}>Hi</Coachmark>);
        expect(screen.getByRole('dialog', { name: 'Welcome' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(describeViolations(await axeViolations(document.body))).toEqual([]);
    });

    it('aria-label from A11yProps names an untitled coachmark', () => {
        wrap(<Coachmark open anchor={new DOMRect(0, 0, 5, 5)} aria-label="Tip" onDismiss={() => undefined}>Hi</Coachmark>);
        expect(screen.getByRole('dialog', { name: 'Tip' })).toBeTruthy();
    });

    it('control: closed renders nothing', () => {
        wrap(<Coachmark open={false} anchor={new DOMRect(0, 0, 5, 5)} title="Welcome" onDismiss={() => undefined}>Hi</Coachmark>);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('DocumentViewer a11y', () => {
    it('zoom, page, download and print buttons are named; no axe violations', async () => {
        const { container } = wrap(
            <DocumentViewer title="Report" content="hello" documentType="text" totalPages={3} currentPage={2} showDownload showPrint />,
        );
        for (const name of ['Zoom in', 'Zoom out', 'Previous page', 'Next page', 'Download document', 'Print document']) {
            expect(screen.getByRole('button', { name })).toBeTruthy();
        }
        expect(describeViolations(await axeViolations(container))).toEqual([]);
    });

    it('control: without showPrint/showDownload/pages those buttons are absent', () => {
        wrap(<DocumentViewer title="Report" content="hello" documentType="text" />);
        expect(screen.queryByRole('button', { name: 'Print document' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
    });

    it('forwards A11yProps to the root', () => {
        const { container } = wrap(<DocumentViewer title="Report" content="hello" documentType="text" lang="ar" aria-label="Doc" />);
        expect(container.querySelector('[aria-label="Doc"]')?.getAttribute('lang')).toBe('ar');
    });
});

describe('CodeBlock a11y', () => {
    it('standard mode: copy is named', async () => {
        const { container } = wrap(<CodeBlock code="const a = 1;" language="javascript" />);
        expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
        expect(describeViolations(await axeViolations(container))).toEqual([]);
    });

    it('viewer mode: wrap (toggle) and copy are named', async () => {
        const { container } = wrap(<CodeBlock code="const a = 1;" language="javascript" title="a.js" showCopy />);
        const wrapBtn = screen.getByRole('button', { name: 'Wrap lines' });
        expect(wrapBtn.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(wrapBtn);
        expect(wrapBtn.getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy();
        expect(describeViolations(await axeViolations(container))).toEqual([]);
    });

    it('control: showCopy false omits the copy control', () => {
        wrap(<CodeBlock code="x" language="javascript" title="a.js" showCopy={false} showCopyButton={false} />);
        expect(screen.queryByRole('button', { name: 'Copy code' })).toBeNull();
    });
});
