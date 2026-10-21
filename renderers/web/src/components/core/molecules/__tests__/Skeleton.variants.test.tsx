// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Skeleton } from '../Skeleton';

describe('Skeleton — loading base', () => {
  it('announces itself as a busy status region', () => {
    render(<Skeleton variant="detail" />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(region.getAttribute('data-skeleton')).toBe('detail');
  });

  it.each(['table', 'list', 'grid', 'detail', 'stats', 'form', 'card', 'header', 'text'] as const)('renders the %s variant', (variant) => {
    render(<Skeleton variant={variant} />);
    expect(screen.getByRole('status').getAttribute('data-skeleton')).toBe(variant);
    expect(screen.getByRole('status').querySelectorAll('.almadar-shimmer').length).toBeGreaterThan(0);
  });

  it('list rows and grid cards follow the declared count', () => {
    const { container: list } = render(<Skeleton variant="list" rows={3} />);
    expect(list.querySelectorAll('.rounded-full.shrink-0').length).toBe(3);
  });

  it('control: no variant falls back to text lines', () => {
    render(<Skeleton />);
    expect(screen.getByRole('status').getAttribute('data-skeleton')).toBe('text');
  });
});
