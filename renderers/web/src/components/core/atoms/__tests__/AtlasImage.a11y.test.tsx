import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AtlasImage } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

describe('AtlasImage a11y', () => {
  it('plain image takes its name from alt and forwards aria props', async () => {
    const { container } = render(<AtlasImage asset={{ url: '/a.png', name: 'Sword' }} alt="Iron sword" aria-describedby="d" />);
    const img = screen.getByRole('img', { name: 'Iron sword' });
    expect(img.getAttribute('aria-describedby')).toBe('d');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('control: aria-hidden removes it from the accessibility tree; no alt falls back to the asset name', () => {
    const { container, rerender } = render(<AtlasImage asset={{ url: '/a.png', name: 'Sword' }} />);
    expect(screen.getByRole('img', { name: 'Sword' })).toBeTruthy();
    rerender(<AtlasImage asset={{ url: '/a.png', name: 'Sword' }} aria-hidden />);
    expect(container.querySelector('img')?.getAttribute('aria-hidden')).toBe('true');
  });
});
