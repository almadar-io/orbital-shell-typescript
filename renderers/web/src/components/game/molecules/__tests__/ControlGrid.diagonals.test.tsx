// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ControlGrid } from '../ControlGrid';

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe('ControlGrid diagonal cells', () => {
  it('renders four additional directions only when requested', () => {
    const cardinal = render(<ControlGrid kind="dpad" visibility="always" />);
    expect(cardinal.container.querySelectorAll('button')).toHaveLength(4);
    cardinal.unmount();

    const diagonal = render(<ControlGrid kind="dpad" includeDiagonals visibility="always" />);
    expect(diagonal.container.querySelectorAll('button')).toHaveLength(8);
  });

  it('keeps a semantic map limited to its declared directions', () => {
    const { container } = render(
      <ControlGrid kind="dpad" includeDiagonals visibility="always" directionEvents={{ up: 'UP', 'up-left': 'UP_LEFT' }} />,
    );
    expect(container.querySelectorAll('button')).toHaveLength(2);
  });
});
