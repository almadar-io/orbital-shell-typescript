import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Chart } from '../Chart';
import { EventBusProvider } from '../../../../core';

describe('Chart empty state', () => {
  it('says "No data available" once, not as both title and description', () => {
    render(
      <EventBusProvider debug={false}>
        <Chart data={[]} />
      </EventBusProvider>,
    );
    expect(screen.getAllByText('No data available').length).toBe(1);
  });
});
