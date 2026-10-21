/**
 * ImportProgress Component Tests
 *
 * Tests for lifecycle step rendering and count badges.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImportProgress } from '../import/ImportProgress';
import { EventBusProvider } from '../../../../core';
import { MemoryRouter } from 'react-router-dom';

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter>
    <EventBusProvider debug={false}>{children}</EventBusProvider>
  </MemoryRouter>
);

describe('ImportProgress', () => {
  it('renders the pipeline steps', () => {
    render(
      <TestWrapper>
        <ImportProgress step="mapping" />
      </TestWrapper>
    );

    expect(screen.getByText('Fetching')).toBeTruthy();
    expect(screen.getByText('Mapping')).toBeTruthy();
    expect(screen.getByText('Reviewing')).toBeTruthy();
    expect(screen.getByText('Committing')).toBeTruthy();
  });

  it('shows the done terminal step', () => {
    render(
      <TestWrapper>
        <ImportProgress step="done" />
      </TestWrapper>
    );

    expect(screen.getByTestId('import-progress-step-done')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('shows the failed terminal step', () => {
    render(
      <TestWrapper>
        <ImportProgress step="failed" />
      </TestWrapper>
    );

    expect(screen.getByTestId('import-progress-step-failed')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
  });

  it('renders staged/committed/failed counts', () => {
    render(
      <TestWrapper>
        <ImportProgress step="committing" counts={{ staged: 10, committed: 7, failed: 1 }} />
      </TestWrapper>
    );

    expect(screen.getByText('Staged 10')).toBeTruthy();
    expect(screen.getByText('Committed 7')).toBeTruthy();
    expect(screen.getByText('Failed 1')).toBeTruthy();
  });

  it('applies label overrides', () => {
    render(
      <TestWrapper>
        <ImportProgress step="fetching" labels={{ fetching: 'Loading' }} />
      </TestWrapper>
    );

    expect(screen.getByText('Loading')).toBeTruthy();
  });
});
