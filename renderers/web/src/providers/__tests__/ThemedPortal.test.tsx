// @vitest-environment jsdom
/**
 * Portaled UI (modals, menus, tooltips) renders in the theme of the place it
 * was opened from, never in whichever themed element happens to be last in the
 * document (a studio modal must not take a canvas preview's app theme).
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ThemeDefinition } from '@almadar/core';
import { ThemeProvider } from '../../core';
import { OrbitalThemeProvider } from '../OrbitalThemeProvider';
import { Modal } from '../../components/core/molecules/Modal';
import { ThemedPortal } from '../../lib/ThemedPortal';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});

/** The themed element the portaled leaf resolves under, inside the portal root (never the document's own). */
function scopeOf(testId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#ui-slot-portal-root [data-testid="${testId}"]`)?.closest<HTMLElement>('#ui-slot-portal-root [data-theme]') ?? null;
}

describe('ThemedPortal', () => {
  it('a studio modal keeps the studio theme when an app preview with another theme comes later in the page', () => {
    render(
      <ThemeProvider defaultTheme="minimalist" defaultMode="dark">
        <Modal isOpen onClose={() => {}} title="Studio">
          <span data-testid="studio-modal">x</span>
        </Modal>
        <OrbitalThemeProvider theme="gazette-light">
          <span>preview</span>
        </OrbitalThemeProvider>
      </ThemeProvider>,
    );
    const scope = scopeOf('studio-modal');
    expect(scope?.getAttribute('data-theme')).toBe('minimalist-dark');
    expect(scope?.classList.contains('dark')).toBe(true);
  });

  it('control: a modal opened inside an app preview takes that app theme', () => {
    render(
      <ThemeProvider defaultTheme="minimalist" defaultMode="dark">
        <OrbitalThemeProvider theme="gazette-light">
          <Modal isOpen onClose={() => {}} title="App">
            <span data-testid="app-modal">x</span>
          </Modal>
        </OrbitalThemeProvider>
      </ThemeProvider>,
    );
    expect(scopeOf('app-modal')?.getAttribute('data-theme')).toBe('gazette-dark');
  });

  it('two portals open at once each keep their own theme', () => {
    render(
      <ThemeProvider defaultTheme="minimalist" defaultMode="dark">
        <ThemedPortal><span data-testid="outer">o</span></ThemedPortal>
        <OrbitalThemeProvider theme="gazette-light">
          <ThemedPortal><span data-testid="inner">i</span></ThemedPortal>
        </OrbitalThemeProvider>
      </ThemeProvider>,
    );
    expect(scopeOf('outer')?.getAttribute('data-theme')).toBe('minimalist-dark');
    expect(scopeOf('inner')?.getAttribute('data-theme')).toBe('gazette-dark');
  });

  it('carries an inline theme definition’s CSS variables into the portal', () => {
    const inline: ThemeDefinition = { name: 'harbor', tokens: { colors: { primary: '#123456' } } };
    render(
      <ThemeProvider defaultTheme="minimalist" defaultMode="dark">
        <OrbitalThemeProvider theme={inline}>
          <ThemedPortal><span data-testid="inline">i</span></ThemedPortal>
        </OrbitalThemeProvider>
      </ThemeProvider>,
    );
    const scope = scopeOf('inline');
    expect(scope?.getAttribute('data-theme')).toBe('minimalist-dark');
    expect(scope?.style.getPropertyValue('--color-primary')).toBe('#123456');
  });

  it('with no theme provider the portal stamps nothing and inherits the document', () => {
    render(<ThemedPortal><span data-testid="bare">b</span></ThemedPortal>);
    expect(scopeOf('bare')).toBeNull();
  });
});
