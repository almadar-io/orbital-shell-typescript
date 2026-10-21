// @vitest-environment jsdom
/**
 * A schema's declared theme reaches the rendered subtree even when the host
 * document runs a different theme (playground picker, runtime-verify catalog).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { ThemeDefinition } from '@almadar/core';
import { ThemeProvider } from '../../core';
import { OrbitalThemeProvider } from '../OrbitalThemeProvider';

function renderIn(theme: Parameters<typeof OrbitalThemeProvider>[0]['theme']) {
  return render(
    <ThemeProvider defaultTheme="minimalist" defaultMode="dark">
      <OrbitalThemeProvider theme={theme}>
        <span data-testid="leaf">content</span>
      </OrbitalThemeProvider>
    </ThemeProvider>,
  );
}

describe('OrbitalThemeProvider', () => {
  it('scopes the declared theme to the subtree, in the host document mode (the key is the starting mode)', () => {
    const { getByTestId } = renderIn('gazette-light');
    const scope = getByTestId('leaf').closest('[data-theme]');
    expect(scope?.getAttribute('data-theme')).toBe('gazette-dark');
  });

  it('paints the scoped theme background over the host theme', () => {
    const { getByTestId } = renderIn('gazette-light');
    const scope = getByTestId('leaf').closest('[data-theme="gazette-dark"]');
    expect(scope?.className).toContain('bg-background');
    expect(scope?.className).toContain('text-foreground');
  });

  it('leaves the legacy "Alias.theme" import form alone (unresolved upstream, matches no selector)', () => {
    const { getByTestId } = renderIn('Ocean.theme');
    expect(getByTestId('leaf').closest('[data-theme="Ocean.theme"]')).toBeNull();
  });

  it('is a pass-through when the orbital declares no theme', () => {
    const { getByTestId } = renderIn(undefined);
    expect(getByTestId('leaf').closest('[data-orbital-theme]')).toBeNull();
    expect(getByTestId('leaf').closest('[data-theme]')?.getAttribute('data-theme')).not.toBe('gazette-light');
  });

  it('keeps applying an inline definition as CSS variables', () => {
    const inline: ThemeDefinition = { name: 'harbor', tokens: { colors: { primary: '#123456' } } };
    const { getByTestId } = renderIn(inline);
    const wrapper = getByTestId('leaf').closest('[data-orbital-theme="harbor"]') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper?.style.getPropertyValue('--color-primary')).toBe('#123456');
  });

  it('paints an inline theme background so its own colors show inside a dark host (G-UI-022)', () => {
    const inline: ThemeDefinition = {
      name: 'harbor',
      tokens: { colors: { background: '#ffffff', foreground: '#111111' } },
    };
    const { getByTestId } = renderIn(inline);
    const wrapper = getByTestId('leaf').closest('[data-orbital-theme="harbor"]') as HTMLElement | null;
    expect(wrapper?.style.getPropertyValue('--color-background')).toBe('#ffffff');
    expect(wrapper?.className).toContain('bg-background');
    expect(wrapper?.className).toContain('text-foreground');
  });
});
