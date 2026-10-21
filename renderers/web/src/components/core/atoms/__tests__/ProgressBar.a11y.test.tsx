import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

describe('ProgressBar exposes progressbar semantics in every variant', () => {
  for (const progressType of ['linear', 'circular', 'stepped'] as const) {
    it(`${progressType}: a named progressbar with its value range`, async () => {
      const { container } = render(<ProgressBar progressType={progressType} value={3} max={10} aria-label="Upload" />);
      const bar = screen.getByRole('progressbar', { name: 'Upload' });
      expect(bar.getAttribute('aria-valuenow')).toBe('3');
      expect(bar.getAttribute('aria-valuemax')).toBe('10');
      expect(describeViolations(await axeViolations(container))).toEqual([]);
    });
  }

  it('control: without a caller name it falls back to the visible label', () => {
    render(<ProgressBar value={1} max={4} label="Steps" />);
    expect(screen.getByRole('progressbar', { name: 'Steps' })).toBeTruthy();
  });

  it('edge: exactly one progressbar per instance', () => {
    render(<ProgressBar value={1} max={4} label="Steps" />);
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  });
});
