import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormSectionHeader } from '../FormSectionHeader';

describe('FormSectionHeader', () => {
  it('a collapsible header is a button announcing its expanded state', () => {
    const onToggle = vi.fn();
    render(<FormSectionHeader title="Billing" onToggle={onToggle} isCollapsed />);
    const btn = screen.getByRole('button', { name: /Billing/ });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('control: a static header is not a button', () => {
    render(<FormSectionHeader title="Billing" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
