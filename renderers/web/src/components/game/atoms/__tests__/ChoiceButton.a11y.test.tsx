import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChoiceButton } from '../ChoiceButton';
import { EventBusProvider } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

const wrap = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider> });

describe('ChoiceButton', () => {
  it('reflects selected as aria-pressed', async () => {
    const { container } = wrap(
      <>
        <ChoiceButton text="Yes" selected />
        <ChoiceButton text="No" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'No' })).toHaveAttribute('aria-pressed', 'false');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('lets an explicit aria-label override', () => {
    wrap(<ChoiceButton text="Go" aria-label="Proceed" />);
    expect(screen.getByRole('button', { name: 'Proceed' })).toBeInTheDocument();
  });
});
