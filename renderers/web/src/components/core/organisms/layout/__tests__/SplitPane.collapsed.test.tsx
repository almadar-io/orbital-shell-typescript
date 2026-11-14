import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SplitPane } from '../SplitPane';

describe('SplitPane collapsed', () => {
  it('keeps the same pane elements whichever side is collapsed', () => {
    const view = (collapsed?: 'left' | 'right') => <SplitPane collapsed={collapsed} left={<div data-testid="l">l</div>} right={<div data-testid="r">r</div>} />;
    const { rerender } = render(view());
    const right = screen.getByTestId('r').parentElement;
    rerender(view('left'));
    expect(screen.getByTestId('r').parentElement).toBe(right);
    rerender(view('right'));
    expect(screen.getByTestId('r').parentElement).toBe(right);
    rerender(view());
    expect(screen.getByTestId('r').parentElement).toBe(right);
  });

  it('a collapsed left pane is hidden and gives the right pane the room', () => {
    render(<SplitPane collapsed="left" ratio={30} left={<div data-testid="l">l</div>} right={<div data-testid="r">r</div>} />);
    expect(screen.getByTestId('l').parentElement?.style.display).toBe('none');
  });

  it('a collapsed right pane takes its content width and the left pane the rest', () => {
    render(<SplitPane collapsed="right" ratio={30} left={<div data-testid="l">l</div>} right={<div data-testid="r">r</div>} />);
    expect(screen.getByTestId('l').parentElement?.style.width).toBe('');
    expect(screen.getByTestId('r').parentElement?.className).toContain('flex-none');
  });

  it('control: with nothing collapsed the left pane keeps its ratio', () => {
    render(<SplitPane ratio={30} left={<div data-testid="l">l</div>} right={<div data-testid="r">r</div>} />);
    expect(screen.getByTestId('l').parentElement?.style.width).toBe('30%');
  });
});
