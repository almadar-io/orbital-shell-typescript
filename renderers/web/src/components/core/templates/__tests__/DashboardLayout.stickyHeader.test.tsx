/**
 * The top bar stays put while the page scrolls unless the program says it scrolls away (`stickyHeader: false`).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardLayout } from '../DashboardLayout';

function headerOf(stickyHeader: boolean | undefined): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <DashboardLayout appName="KFlow" layoutMode="sidebar" stickyHeader={stickyHeader}>
        <span>content</span>
      </DashboardLayout>
    </MemoryRouter>,
  );
  const header = container.querySelector('header');
  if (!header) throw new Error('no header');
  return header;
}

describe('DashboardLayout stickyHeader', () => {
  it('scrolls the top bar away with the page when stickyHeader is false', () => {
    const header = headerOf(false);
    expect(header.className).not.toMatch(/(^|\s)sticky(\s|$)/);
    expect(header.className).not.toMatch(/(^|\s)top-0(\s|$)/);
  });

  it('control: by default the top bar sticks to the top', () => {
    const header = headerOf(undefined);
    expect(header.className).toMatch(/(^|\s)sticky(\s|$)/);
    expect(header.className).toMatch(/(^|\s)top-0(\s|$)/);
  });
});
