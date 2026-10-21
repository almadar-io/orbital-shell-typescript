import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Card as ActionCard } from '../Card';
import { EventBusProvider } from '../../../../core';

const wrap = (ui: React.ReactElement) => render(<EventBusProvider debug={false}>{ui}</EventBusProvider>);

describe('ActionCard composes the Card atom and Button', () => {
  it('renders title, subtitle and body on the themed card surface', () => {
    const { container } = wrap(<ActionCard title="Plan" subtitle="Pro">Body</ActionCard>);
    expect(screen.getByText('Plan')).toBeTruthy();
    expect(screen.getByText('Pro')).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).className).toContain('chrome-panel');
  });

  it('actions are Buttons that do not trigger the card click', () => {
    const onCard = vi.fn();
    const onAction = vi.fn();
    wrap(<ActionCard title="Plan" onClick={onCard} actions={[{ label: 'Upgrade', variant: 'primary', onClick: onAction }]} />);
    const btn = screen.getByRole('button', { name: 'Upgrade' });
    expect(btn.className).toContain('chrome-button');
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onCard).not.toHaveBeenCalled();
  });

  it('a clickable card is a keyboard-operable button', () => {
    const onCard = vi.fn();
    wrap(<ActionCard title="Plan" onClick={onCard} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /Plan/ }), { key: ' ' });
    expect(onCard).toHaveBeenCalledTimes(1);
  });

  it('control: a card with no click is not a button', () => {
    wrap(<ActionCard title="Plan" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
