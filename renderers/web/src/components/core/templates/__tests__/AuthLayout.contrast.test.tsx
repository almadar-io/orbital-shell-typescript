import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthLayout } from '../AuthLayout';

function renderLayout(props: React.ComponentProps<typeof AuthLayout> = {}) {
  return render(
    <MemoryRouter>
      <AuthLayout appName="Ledger" {...props} />
    </MemoryRouter>,
  );
}

describe('AuthLayout brand panel', () => {
  it('paints text on the primary panel with primary-foreground, never the page foreground', () => {
    const { container } = renderLayout();
    const panel = container.querySelector('.bg-primary');
    expect(panel).not.toBeNull();
    const texty = [...(panel?.querySelectorAll('[class*="text-"]') ?? [])];
    expect(texty.length).toBeGreaterThan(0);
    for (const el of texty) {
      expect(el.className).not.toContain('--color-foreground');
    }
    expect(panel?.innerHTML).toContain('text-primary-foreground');
  });

  it('control: the mobile monogram on bg-primary also uses primary-foreground', () => {
    const { container } = renderLayout();
    const tiles = [...container.querySelectorAll('.lg\\:hidden .bg-primary')];
    expect(tiles.length).toBe(1);
    expect(tiles[0].innerHTML).toContain('text-primary-foreground');
  });

  it('control: the form panel keeps the page foreground', () => {
    const { container } = renderLayout({ showBranding: false });
    expect(container.querySelector('.bg-primary .text-foreground')).toBeNull();
    expect(container.innerHTML).toContain('text-foreground');
  });
});
