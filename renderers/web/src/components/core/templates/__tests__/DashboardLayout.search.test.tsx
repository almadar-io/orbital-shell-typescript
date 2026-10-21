/**
 * G-UI-034: the top-bar search drew its icon as an absolute sibling of the
 * Input, and the Input's own positioned wrapper (opaque bg-card) painted over
 * it — a blank indent where the icon belongs. The icon must be the Input's own
 * `icon`, rendered inside the Input's wrapper.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardLayout } from '../DashboardLayout';

function renderLayout(props: Partial<React.ComponentProps<typeof DashboardLayout>>) {
  return render(
    <MemoryRouter>
      <DashboardLayout appName="Notes" navItems={[{ label: 'Notes', href: '/', icon: 'file-text' }]} {...props}>
        <span>content</span>
      </DashboardLayout>
    </MemoryRouter>,
  );
}

describe('DashboardLayout top-bar search', () => {
  it('renders the search icon inside the Input wrapper, where the input cannot paint over it', async () => {
    renderLayout({ showSearch: true });
    const input = screen.getByRole('searchbox');
    const wrapper = input.parentElement;
    await waitFor(() => expect(wrapper?.querySelector('svg.lucide-search')).not.toBeNull());
  });

  it('draws no second search icon outside the Input', () => {
    renderLayout({ showSearch: true });
    const input = screen.getByRole('searchbox');
    const outer = input.parentElement?.parentElement?.parentElement;
    const icons = outer?.querySelectorAll('svg.lucide-search') ?? [];
    expect(icons).toHaveLength(1);
  });

  it('control: no search enabled renders no searchbox', () => {
    renderLayout({});
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('edge: Enter still submits the typed query', () => {
    const onSearchSubmit = vi.fn();
    renderLayout({ onSearchSubmit });
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'pasta' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSearchSubmit).toHaveBeenCalledWith('pasta');
  });
});
