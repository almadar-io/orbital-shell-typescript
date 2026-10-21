import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Pagination } from '../Pagination';
import { EventBusProvider } from '../../../../core';

function renderPager(props: Partial<React.ComponentProps<typeof Pagination>> = {}) {
  return render(
    <EventBusProvider debug={false}>
      <Pagination currentPage={3} totalPages={12} onPageChange={vi.fn()} {...props} />
    </EventBusProvider>,
  );
}

describe('Pagination', () => {
  it('is a labelled navigation landmark that sizes to its container', () => {
    renderPager();
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(nav.className).toContain('@container');
    expect((nav.firstElementChild as HTMLElement).className).toContain('flex-wrap');
  });

  it('marks the current page', () => {
    renderPager();
    expect(screen.getByRole('button', { name: '3' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: '4' }).getAttribute('aria-current')).toBeNull();
  });

  it('keeps Previous/Next named when their labels collapse to icons', () => {
    const onPageChange = vi.fn();
    renderPager({ onPageChange });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenCalledWith(4);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeTruthy();
  });

  it('offers a compact "page of pages" summary for narrow containers', () => {
    renderPager();
    expect(screen.getByText('3 / 12').className).toContain('@md:hidden');
  });

  it('control: the ellipsis is decorative', () => {
    renderPager();
    for (const el of screen.getAllByText('…')) expect(el.getAttribute('aria-hidden')).toBe('true');
  });
});
