/**
 * An icon-only control names itself: its label is its accessible name and,
 * on hover or focus, its tooltip. The Tooltip it wraps keeps the button's own
 * ref and handlers.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { IconButton } from '../IconButton';
import { Tooltip } from '../Tooltip';

describe('IconButton', () => {
  it('is named by its label and shows it as a tooltip on hover', async () => {
    vi.useFakeTimers();
    render(<IconButton icon="plus" label="Add behaviors" data-testid="add" />);
    const button = screen.getByTestId('add');
    expect(button.getAttribute('aria-label')).toBe('Add behaviors');
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(button);
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('tooltip').textContent).toBe('Add behaviors');
    fireEvent.mouseLeave(button);
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(screen.queryByRole('tooltip')).toBeNull();
    vi.useRealTimers();
  });

  it('shows the tooltip on keyboard focus too', async () => {
    vi.useFakeTimers();
    render(<IconButton icon="plus" label="Add" data-testid="add" />);
    fireEvent.focus(screen.getByTestId('add'));
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('tooltip').textContent).toBe('Add');
    vi.useRealTimers();
  });

  it('forwards its ref to the button and still clicks', () => {
    const ref = React.createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    render(<IconButton ref={ref} icon="plus" label="Add" onClick={onClick} />);
    expect(ref.current?.tagName).toBe('BUTTON');
    fireEvent.click(ref.current as HTMLButtonElement);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Tooltip around an element', () => {
  it('keeps the element\'s own ref and hover/focus handlers', () => {
    const ref = React.createRef<HTMLButtonElement>();
    const onMouseEnter = vi.fn();
    const onFocus = vi.fn();
    render(<Tooltip content="tip"><button ref={ref} type="button" onMouseEnter={onMouseEnter} onFocus={onFocus}>x</button></Tooltip>);
    expect(ref.current?.tagName).toBe('BUTTON');
    fireEvent.mouseEnter(ref.current as HTMLButtonElement);
    fireEvent.focus(ref.current as HTMLButtonElement);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });
});

describe('IconButton on touch screens', () => {
  it('has no tooltip to leave behind: the tap is the action, the label still names it', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(hover: none)', media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    vi.useFakeTimers();
    render(<IconButton icon="plus" label="Menu" data-testid="menu" />);
    const button = screen.getByTestId('menu');
    expect(button.getAttribute('aria-label')).toBe('Menu');
    fireEvent.pointerDown(button);
    fireEvent.focus(button);
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.queryByRole('tooltip')).toBeNull();
    vi.useRealTimers();
    vi.stubGlobal('matchMedia', undefined);
  });
});
