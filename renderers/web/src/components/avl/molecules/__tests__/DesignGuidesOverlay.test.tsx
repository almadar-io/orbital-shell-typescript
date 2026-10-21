// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DesignGuidesOverlay } from '../DesignGuidesOverlay';

describe('DesignGuidesOverlay', () => {
  it('draws each smart guide as a 1px line where it lines up', () => {
    render(<DesignGuidesOverlay guides={[
      { orientation: 'vertical', at: 100, from: 0, to: 120 },
      { orientation: 'horizontal', at: 40, from: 10, to: 60 },
    ]} measures={[]} zoom={1} />);
    const [v, h] = screen.getAllByTestId('design-guide');
    expect(v.style.left).toBe('100px');
    expect(v.style.top).toBe('0px');
    expect(v.style.height).toBe('120px');
    expect(h.style.top).toBe('40px');
    expect(h.style.left).toBe('10px');
    expect(h.style.width).toBe('50px');
  });

  it('draws each measurement with its length in pixels', () => {
    render(<DesignGuidesOverlay guides={[]} measures={[
      { x1: 60, y1: 55, x2: 90, y2: 55, length: 30 },
      { x1: 50, y1: 60, x2: 50, y2: 70, length: 10 },
    ]} zoom={1} />);
    const lines = screen.getAllByTestId('design-measure');
    expect(lines).toHaveLength(2);
    expect(lines[0].style.left).toBe('60px');
    expect(lines[0].style.width).toBe('30px');
    expect(lines[1].style.top).toBe('60px');
    expect(lines[1].style.height).toBe('10px');
    expect(screen.getAllByTestId('design-measure-label').map((l) => l.textContent)).toEqual(['30', '10']);
  });

  it('a line drawn right-to-left or bottom-to-top starts at its smaller end', () => {
    render(<DesignGuidesOverlay guides={[]} measures={[{ x1: 40, y1: 50, x2: 10, y2: 50, length: 30 }]} zoom={1} />);
    expect(screen.getByTestId('design-measure').style.left).toBe('10px');
  });

  it('labels keep their on-screen size when the canvas is zoomed', () => {
    render(<DesignGuidesOverlay guides={[]} measures={[{ x1: 0, y1: 0, x2: 30, y2: 0, length: 30 }]} zoom={2} />);
    expect(screen.getByTestId('design-measure-label').style.transform).toContain('scale(0.5)');
  });

  it('nothing to draw renders nothing', () => {
    const { container } = render(<DesignGuidesOverlay guides={[]} measures={[]} zoom={1} />);
    expect(container.firstChild).toBeNull();
  });
});
