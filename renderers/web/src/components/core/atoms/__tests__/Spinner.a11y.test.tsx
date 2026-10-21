import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Spinner } from '../../../../core';
import { I18nProvider, createTranslate } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

const t = createTranslate({ 'aria.loading': 'Loading' });
const wrap = (ui: React.ReactElement) =>
  render(<I18nProvider value={{ locale: 'en', direction: 'ltr', t }}>{ui}</I18nProvider>);

describe('Spinner', () => {
  it('is a status with the loading label', () => {
    wrap(<Spinner />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('the overlay variant is also a labelled status', () => {
    wrap(<Spinner overlay />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('a caller-supplied label wins', () => {
    wrap(<Spinner aria-label="Saving" />);
    expect(screen.getByRole('status', { name: 'Saving' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = wrap(<Spinner />);
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });
});
