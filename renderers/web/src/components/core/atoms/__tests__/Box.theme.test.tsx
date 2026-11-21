// @vitest-environment jsdom
/**
 * A registry key a component declares (`data-theme: @currentTheme`, a demo's
 * own theme) follows the same rule as an orbital's declared theme: the key
 * names a theme and its starting mode, and the viewer's mode wins when the
 * theme has it.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from '../../../../core';
import { OrbitalThemeProvider } from '../../../../providers/OrbitalThemeProvider';
import { Box } from '../../../../core';

function themeOf(declared: string, mode: 'light' | 'dark', override?: string) {
  const { getByTestId } = render(
    <ThemeProvider defaultTheme="minimalist" defaultMode={mode}>
      <OrbitalThemeProvider theme="gazette-light" override={override}>
        <Box data-theme={declared} data-testid="box">content</Box>
      </OrbitalThemeProvider>
    </ThemeProvider>,
  );
  return getByTestId('box').getAttribute('data-theme');
}

describe('Box declared data-theme', () => {
  it('takes the dark viewer mode, matching the orbital scope around it', () => {
    expect(themeOf('gazette-light', 'dark')).toBe('gazette-dark');
  });

  it('a different theme keeps its own name in the viewer mode', () => {
    expect(themeOf('minimalist-light', 'dark')).toBe('minimalist-dark');
  });

  it('control: a light viewer keeps the light key', () => {
    expect(themeOf('gazette-light', 'light')).toBe('gazette-light');
  });

  it('control: a dark key in a light viewer turns light', () => {
    expect(themeOf('gazette-dark', 'light')).toBe('gazette-light');
  });

  it('control: a key no declared theme builds passes through', () => {
    expect(themeOf('Ocean.theme', 'dark')).toBe('Ocean.theme');
  });

  // A host's own pick names an exact theme and mode (owner 2026-11-16).
  it('control: a host override still replaces it, in the mode it names', () => {
    expect(themeOf('gazette-light', 'dark', 'minimalist-light')).toBe('minimalist-light');
  });
});
