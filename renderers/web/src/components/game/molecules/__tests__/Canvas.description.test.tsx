import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OrbitalCanvas3DProps } from '../../../../lib/drawable/orbital/OrbitalCanvas3D';

vi.mock('../../../../lib/drawable/orbital/OrbitalCanvas3D', () => ({
  OrbitalCanvas3D: (_props: OrbitalCanvas3DProps<'canvas'>) => null,
}));

import { Canvas } from '../Canvas';
import { EventBusProvider } from '../../../../core';

afterEach(() => vi.restoreAllMocks());

function describedText(container: HTMLElement, el: Element): string | undefined {
  const id = el.getAttribute('aria-describedby');
  return id === null ? undefined : container.querySelector(`[id="${id}"]`)?.textContent ?? undefined;
}

describe('G-ORBITAL-SHELL-TYPESCRIPT-060 Canvas description', () => {
  it('2D: the description reaches Canvas2D as linked, visually hidden text', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { container } = render(
      <EventBusProvider debug={false}>
        <Canvas description="A 6x6 board with two knights." projection="free" showMinimap={false}><span /></Canvas>
      </EventBusProvider>,
    );
    expect(describedText(container, screen.getByTestId('canvas-2d'))).toBe('A 6x6 board with two knights.');
  });

  it('3D: the named image wrapper links the description', () => {
    const { container } = render(<Canvas mode="3d" description="A lit cube." />);
    const img = container.querySelector('[role="img"]');
    expect(img && describedText(container, img)).toBe('A lit cube.');
  });

  it('control: without a description there is no describedby', () => {
    const { container } = render(<Canvas mode="3d" />);
    expect(container.querySelector('[role="img"]')?.hasAttribute('aria-describedby')).toBe(false);
  });
});
