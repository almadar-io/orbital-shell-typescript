// @vitest-environment jsdom
/**
 * A host's explicit theme pick (`override`) replaces the orbital's theme AND
 * every `data-theme` a behavior renders inside the preview (e.g. std-app-layout
 * binding its root to `@currentTheme`). No pick → nothing changes.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from '../../core';
import { OrbitalThemeProvider } from '../OrbitalThemeProvider';
import { Box } from '../../core';
import { GameShell } from '../../components/game/templates/GameShell';

function renderTree(override: string | undefined) {
  return render(
    <ThemeProvider defaultTheme="minimalist" defaultMode="dark">
      <OrbitalThemeProvider theme="art-deco-light" override={override}>
        <Box data-testid="layout" data-theme="art-deco-light">
          <Box data-testid="plain">x</Box>
          <OrbitalThemeProvider theme="gazette-light">
            <span data-testid="nested-leaf">y</span>
          </OrbitalThemeProvider>
        </Box>
      </OrbitalThemeProvider>
    </ThemeProvider>,
  );
}

describe('OrbitalThemeProvider override', () => {
  it('replaces the orbital theme on the wrapper', () => {
    const { getByTestId } = renderTree('win95-dark');
    const wrapper = getByTestId('layout').parentElement?.closest('[data-theme]');
    expect(wrapper?.getAttribute('data-theme')).toBe('win95-dark');
  });

  it('replaces a data-theme a Box declares inside the scope', () => {
    const { getByTestId } = renderTree('win95-dark');
    expect(getByTestId('layout').getAttribute('data-theme')).toBe('win95-dark');
  });

  it('does not add a data-theme to a Box that declares none', () => {
    const { getByTestId } = renderTree('win95-dark');
    expect(getByTestId('plain').hasAttribute('data-theme')).toBe(false);
  });

  it('wins over a nested orbital theme scope', () => {
    const { getByTestId } = renderTree('win95-dark');
    expect(getByTestId('nested-leaf').closest('[data-theme]')?.getAttribute('data-theme')).toBe('win95-dark');
  });

  it('control: no override keeps every declared theme, in the viewer mode like its scope', () => {
    const { getByTestId } = renderTree(undefined);
    expect(getByTestId('layout').getAttribute('data-theme')).toBe('art-deco-dark');
    expect(getByTestId('nested-leaf').closest('[data-theme]')?.getAttribute('data-theme')).toBe('gazette-dark');
  });

  it('an empty-string override is no override', () => {
    const { getByTestId } = renderTree('');
    expect(getByTestId('layout').getAttribute('data-theme')).toBe('art-deco-dark');
  });

  it('a GameShell data-theme yields to the override too', () => {
    const { container } = render(
      <ThemeProvider defaultTheme="minimalist" defaultMode="dark">
        <OrbitalThemeProvider theme="game-rpg-dark" override="pixel-dark">
          <GameShell data-theme="game-rpg-dark" appName="t" />
        </OrbitalThemeProvider>
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-theme="game-rpg-dark"]')).toBeNull();
  });
});
