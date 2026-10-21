/**
 * Workspaces, canvases and maps fill the content area edge to edge: `fullBleed` drops the
 * main area's padding and the page's max width, and bounds the shell to the viewport so a
 * full-height child (a canvas) gets a real height while a long page scrolls inside main.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardLayout } from '../DashboardLayout';

function mainOf(fullBleed: boolean | undefined): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <DashboardLayout appName="Studio" layoutMode="topnav" fullBleed={fullBleed}>
        <span data-testid="page">content</span>
      </DashboardLayout>
    </MemoryRouter>,
  );
  const main = container.querySelector('main');
  if (!main) throw new Error('no main');
  return main;
}

describe('DashboardLayout fullBleed', () => {
  it('drops the main padding and the max width', () => {
    const main = mainOf(true);
    expect(main.className).not.toMatch(/\bp-3\b/);
    expect(main.querySelector('.max-w-\\[1440px\\]')).toBeNull();
  });

  it('control: by default the content is padded and width-capped', () => {
    const main = mainOf(undefined);
    expect(main.className).toMatch(/\bp-3\b/);
    expect(main.querySelector('.max-w-\\[1440px\\]')).not.toBeNull();
  });

  it('bounds the shell to the viewport and scrolls inside main', () => {
    const main = mainOf(true);
    const root = main.closest('[class*="@container/dashboard"]');
    expect(root?.className).toMatch(/(^|\s)h-screen(\s|$)/);
    expect(root?.className).not.toMatch(/(^|\s)min-h-screen(\s|$)/);
    expect(main.className).toMatch(/\boverflow-y-auto\b/);
  });

  it('control: by default the page grows and the document scrolls', () => {
    const main = mainOf(undefined);
    const root = main.closest('[class*="@container/dashboard"]');
    expect(root?.className).toMatch(/(^|\s)min-h-screen(\s|$)/);
    expect(root?.className).not.toMatch(/(^|\s)h-screen(\s|$)/);
  });
});
