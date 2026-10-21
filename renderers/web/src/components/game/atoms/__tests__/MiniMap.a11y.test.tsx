import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MiniMap } from '../MiniMap';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

afterEach(() => vi.restoreAllMocks());

describe('MiniMap a11y', () => {
  it('exposes the canvas as a named image', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { container } = render(<MiniMap />);
    expect(screen.getByRole('img', { name: 'Minimap' })).toBeTruthy();
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('control: a caller aria-label replaces the default name', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<MiniMap aria-label="Dungeon overview" tiles={[]} units={[]} />);
    expect(screen.getByRole('img', { name: 'Dungeon overview' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Minimap' })).toBeNull();
  });
});
