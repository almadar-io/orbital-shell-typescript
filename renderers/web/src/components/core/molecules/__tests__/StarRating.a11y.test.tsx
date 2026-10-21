import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StarRating } from '../StarRating';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

describe('StarRating a11y', () => {
  it('interactive: one named slider, stars are hidden from the tree, axe clean', async () => {
    const { container } = render(<StarRating value={3} max={5} label="Quality" />);
    const slider = screen.getByRole('slider', { name: 'Quality' });
    expect(slider.getAttribute('aria-valuenow')).toBe('3');
    expect(slider.getAttribute('aria-valuetext')).toBe('Rating: 3 out of 5');
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(5);
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('arrow keys, Home and End change the value within bounds', () => {
    const onChange = vi.fn();
    const { rerender } = render(<StarRating value={3} max={5} onChange={onChange} />);
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'End' });
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([4, 2, 5, 0]);
    rerender(<StarRating value={5} max={5} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(5);
  });

  it('read-only is a labelled image with no slider attributes', async () => {
    const { container } = render(<StarRating value={2} readOnly aria-label="Rated 2 of 5" />);
    const img = screen.getByRole('img', { name: 'Rated 2 of 5' });
    expect(img.hasAttribute('aria-valuenow')).toBe(false);
    expect(img.hasAttribute('tabindex')).toBe(false);
    fireEvent.keyDown(img, { key: 'ArrowRight' });
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });
});
