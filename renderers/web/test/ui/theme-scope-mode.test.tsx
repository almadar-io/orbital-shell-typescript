import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, registryKeyMode, useScopedMode, BUILT_IN_THEMES } from '../../src/core';
import { OrbitalThemeProvider } from '../../src/providers/OrbitalThemeProvider';
import { Box } from '../../src/core';

function ModeProbe(): React.ReactElement {
  return <span data-testid="mode">{useScopedMode()}</span>;
}

describe('registryKeyMode', () => {
  it('reads the mode a declared theme key was built with', () => {
    expect(registryKeyMode('orb-light', BUILT_IN_THEMES)).toBe('light');
    expect(registryKeyMode('orb-dark', BUILT_IN_THEMES)).toBe('dark');
  });

  it('edge: a theme whose name has hyphens resolves by its whole declared name', () => {
    expect(registryKeyMode('art-deco-dark', BUILT_IN_THEMES)).toBe('dark');
  });

  it('edge: a key no declared theme builds has no mode', () => {
    expect(registryKeyMode('not-a-theme-light', BUILT_IN_THEMES)).toBeUndefined();
    expect(registryKeyMode('orb', BUILT_IN_THEMES)).toBeUndefined();
  });

  it('edge: a mode the theme does not declare is not claimed', () => {
    expect(registryKeyMode('x-dark', [{ name: 'x', hasLightMode: true, hasDarkMode: false }])).toBeUndefined();
  });
});

describe('useScopedMode', () => {
  const tree = (docMode: 'light' | 'dark', key?: string) => (
    <ThemeProvider defaultTheme="orb" defaultMode={docMode}>
      {key ? <OrbitalThemeProvider theme={key}><ModeProbe /></OrbitalThemeProvider> : <ModeProbe />}
    </ThemeProvider>
  );

  it('a two-mode theme key is the starting mode: in a dark document orb-light follows to orb-dark', () => {
    const { container } = render(tree('dark', 'orb-light'));
    expect(screen.getByTestId('mode').textContent).toBe('dark');
    const wrapper = container.querySelector('[data-theme="orb-dark"]');
    expect(wrapper?.classList.contains('dark')).toBe(true);
    expect(container.querySelector('[data-theme="orb-light"]')).toBeNull();
  });

  it('control: in a light document the same key renders orb-light', () => {
    const { container } = render(tree('light', 'orb-light'));
    expect(screen.getByTestId('mode').textContent).toBe('light');
    expect(container.querySelector('[data-theme="orb-light"]')?.classList.contains('light')).toBe(true);
  });

  it('edge: a theme that declares one mode stays in it whatever the document mode', () => {
    const { container } = render(tree('light', 'game-adventure-dark'));
    expect(screen.getByTestId('mode').textContent).toBe('dark');
    expect(container.querySelector('[data-theme="game-adventure-dark"]')?.classList.contains('dark')).toBe(true);
  });

  it('edge: a host override key follows the document mode too, on the wrapper and on nested theme boxes', () => {
    const { container } = render(
      <ThemeProvider defaultTheme="orb" defaultMode="dark">
        <OrbitalThemeProvider theme="minimalist-light" override="orb-light">
          <ModeProbe />
          <Box data-theme="minimalist-light" data-testid="nested" />
        </OrbitalThemeProvider>
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode').textContent).toBe('dark');
    expect(container.querySelectorAll('[data-theme="orb-dark"]').length).toBe(2);
    expect(container.querySelector('[data-theme="orb-light"]')).toBeNull();
  });

  it('control: outside any orbital the document mode is read', () => {
    render(tree('dark'));
    expect(screen.getByTestId('mode').textContent).toBe('dark');
  });

  it('edge: an orbital key that no declared theme builds keeps the document mode', () => {
    render(tree('dark', 'not-a-theme-light'));
    expect(screen.getByTestId('mode').textContent).toBe('dark');
  });
});
