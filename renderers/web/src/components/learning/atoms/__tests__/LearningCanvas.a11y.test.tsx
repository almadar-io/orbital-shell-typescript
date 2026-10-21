import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LearningCanvas } from '../LearningCanvas';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

afterEach(() => vi.restoreAllMocks());

describe('LearningCanvas a11y', () => {
  it('is a named image with a linked text alternative', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { container } = render(
      <LearningCanvas aria-label="Projectile arc" description="A ball launched at 45 degrees lands 20 m away." />,
    );
    const img = screen.getByRole('img', { name: 'Projectile arc' });
    const described = img.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(container.querySelector(`[id="${described}"]`)?.textContent).toBe('A ball launched at 45 degrees lands 20 m away.');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('control: no description renders no text alternative and no describedby', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { container } = render(<LearningCanvas />);
    const img = screen.getByRole('img', { name: 'Interactive diagram' });
    expect(img.hasAttribute('aria-describedby')).toBe(false);
    expect(container.querySelector('.sr-only')).toBeNull();
  });
});
