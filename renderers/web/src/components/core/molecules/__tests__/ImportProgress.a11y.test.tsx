// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImportProgress } from '../import/ImportProgress';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

describe('ImportProgress accessibility', () => {
  it('marks only the running step as the current step', async () => {
    const { container } = render(<ImportProgress step="mapping" counts={{ staged: 3 }} role="group" aria-label="Import" />);
    const current = container.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute('data-testid')).toBe('import-progress-step-mapping');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('control: a finished import has no current step', () => {
    const { container } = render(<ImportProgress step="done" />);
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(0);
  });

  it('a failed import keeps no running step and exposes the failure as text', () => {
    const { container } = render(<ImportProgress step="failed" />);
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(0);
    expect(screen.getByText('Failed')).toBeTruthy();
  });

  it('forwards the group name to the root', () => {
    render(<ImportProgress step="fetching" role="group" aria-label="Import progress" />);
    expect(screen.getByRole('group', { name: 'Import progress' })).toBeTruthy();
  });
});
