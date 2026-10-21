import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WizardProgress } from '../WizardProgress';
import { WizardContainer } from '../WizardContainer';
import { EventBusProvider } from '../../../../core';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);
const STEPS = ['Account', 'Billing', 'Review'];

describe('WizardProgress', () => {
  it('the current step is announced and its title always visible', () => {
    wrap(<WizardProgress steps={STEPS} currentStep={1} />);
    const current = screen.getByRole('button', { name: 'Step 2 of 3: Billing' });
    expect(current.getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('Billing').closest('[data-step-title]')?.className).not.toContain('hidden');
  });

  it('other step titles fold away in narrow containers', () => {
    wrap(<WizardProgress steps={STEPS} currentStep={1} />);
    expect(screen.getByText('Account').closest('[data-step-title]')?.className).toContain('hidden @md:block');
  });

  it('a completed step navigates back', () => {
    const onStepClick = vi.fn();
    wrap(<WizardProgress steps={STEPS} currentStep={2} onStepClick={onStepClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Step 1 of 3: Account' }));
    expect(onStepClick).toHaveBeenCalledWith(0);
  });

  it('control: a future step is not navigable', () => {
    const onStepClick = vi.fn();
    wrap(<WizardProgress steps={STEPS} currentStep={0} onStepClick={onStepClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Step 3 of 3: Review' }));
    expect(onStepClick).not.toHaveBeenCalled();
  });
});

describe('WizardContainer', () => {
  it('renders its progress through WizardProgress', () => {
    wrap(<WizardContainer steps={[{ id: 'a', title: 'Account' }, { id: 'b', title: 'Billing' }]} />);
    expect(screen.getByRole('button', { name: 'Step 1 of 2: Account' }).getAttribute('aria-current')).toBe('step');
  });
});
