import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Canvas2D } from '../Canvas2D';
import { EventBusProvider } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

afterEach(() => vi.restoreAllMocks());

function mount(props: React.ComponentProps<typeof Canvas2D>) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  return render(
    <EventBusProvider debug={false}>
      <Canvas2D projection="free" scale={1} tileWidth={0} showMinimap={false} {...props}>
        <span />
      </Canvas2D>
    </EventBusProvider>,
  );
}

describe('Canvas2D a11y', () => {
  it('is a named image whose description is linked and visually hidden', async () => {
    const { container } = mount({ 'aria-label': 'Battle board', description: 'A 6x6 board with two knights facing off.' });
    const img = screen.getByTestId('canvas-2d');
    expect(img.getAttribute('role')).toBe('img');
    expect(img.getAttribute('aria-label')).toBe('Battle board');
    const described = img.getAttribute('aria-describedby');
    const text = container.querySelector(`[id="${described}"]`);
    expect(text?.textContent).toBe('A 6x6 board with two knights facing off.');
    expect(text?.className).toContain('sr-only');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('control: without props it keeps the default name and no describedby', () => {
    mount({});
    const img = screen.getByTestId('canvas-2d');
    expect(img.getAttribute('aria-label')).toBe('Game scene');
    expect(img.hasAttribute('aria-describedby')).toBe(false);
  });
});
