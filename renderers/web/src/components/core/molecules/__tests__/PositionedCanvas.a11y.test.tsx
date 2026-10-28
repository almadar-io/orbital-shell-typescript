import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { EntityWith } from '@almadar/core';
import { PositionedCanvas, type CanvasItemRow } from '../PositionedCanvas';
import { EventBusProvider } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

const items: EntityWith<CanvasItemRow>[] = [
  { id: 't1', label: 'T1', x: 0, y: 0, capacity: 4, status: 'seated' as const, partySize: 2 },
  { id: 't2', label: 'T2', x: 150, y: 0, capacity: 2, status: 'empty' as const },
];

function mount(props: Partial<React.ComponentProps<typeof PositionedCanvas>>) {
  return render(<EventBusProvider debug={false}><PositionedCanvas items={items} {...props} /></EventBusProvider>);
}

describe('PositionedCanvas a11y', () => {
  it('selectable items are toggle buttons that report selection and toggle from the keyboard', async () => {
    const onSelect = vi.fn();
    const { container } = mount({ selectedId: 't1', onSelect, 'aria-label': 'Floor plan' });
    expect(screen.getByRole('group', { name: 'Floor plan' })).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
    fireEvent.keyDown(buttons[1], { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('t2');
    fireEvent.keyDown(buttons[0], { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('control: without a selection handler items are not controls; status is text, not only colour', () => {
    mount({});
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByTestId('item-node-t2').textContent).toContain('Empty');
  });
});
