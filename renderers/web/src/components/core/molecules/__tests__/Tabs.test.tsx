/**
 * Tabs Component Tests
 *
 * Vertical-orientation keyboard navigation (ArrowUp/ArrowDown), and that
 * horizontal navigation (ArrowLeft/ArrowRight) is unaffected.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs, type TabItem } from '../Tabs';

const items: TabItem[] = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Bravo' },
  { id: 'c', label: 'Charlie' },
];

describe('Tabs orientation keyboard navigation', () => {
  it('vertical: ArrowDown moves focus + active tab to the next tab', () => {
    const onTabChange = vi.fn();
    render(<Tabs items={items} orientation="vertical" onTabChange={onTabChange} />);

    const first = screen.getByText('Alpha').closest('[role="tab"]') as HTMLElement;
    fireEvent.keyDown(first, { key: 'ArrowDown' });

    expect(onTabChange).toHaveBeenCalledWith('b');
    const second = screen.getByText('Bravo').closest('[role="tab"]') as HTMLElement;
    expect(second).toHaveFocus();
  });

  it('vertical: ArrowUp moves focus + active tab to the previous tab (wrapping)', () => {
    const onTabChange = vi.fn();
    render(<Tabs items={items} orientation="vertical" onTabChange={onTabChange} />);

    const first = screen.getByText('Alpha').closest('[role="tab"]') as HTMLElement;
    fireEvent.keyDown(first, { key: 'ArrowUp' });

    expect(onTabChange).toHaveBeenCalledWith('c');
    const last = screen.getByText('Charlie').closest('[role="tab"]') as HTMLElement;
    expect(last).toHaveFocus();
  });

  it('vertical: ArrowLeft/ArrowRight are ignored', () => {
    const onTabChange = vi.fn();
    render(<Tabs items={items} orientation="vertical" onTabChange={onTabChange} />);

    const first = screen.getByText('Alpha').closest('[role="tab"]') as HTMLElement;
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    fireEvent.keyDown(first, { key: 'ArrowRight' });

    expect(onTabChange).not.toHaveBeenCalled();
  });

  it('horizontal (default): ArrowRight still moves focus + active tab to the next tab', () => {
    const onTabChange = vi.fn();
    render(<Tabs items={items} onTabChange={onTabChange} />);

    const first = screen.getByText('Alpha').closest('[role="tab"]') as HTMLElement;
    fireEvent.keyDown(first, { key: 'ArrowRight' });

    expect(onTabChange).toHaveBeenCalledWith('b');
    const second = screen.getByText('Bravo').closest('[role="tab"]') as HTMLElement;
    expect(second).toHaveFocus();
  });

  it('horizontal (default): ArrowUp/ArrowDown are ignored', () => {
    const onTabChange = vi.fn();
    render(<Tabs items={items} onTabChange={onTabChange} />);

    const first = screen.getByText('Alpha').closest('[role="tab"]') as HTMLElement;
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    fireEvent.keyDown(first, { key: 'ArrowDown' });

    expect(onTabChange).not.toHaveBeenCalled();
  });
});
