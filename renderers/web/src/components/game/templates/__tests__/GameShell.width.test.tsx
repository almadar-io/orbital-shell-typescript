// @vitest-environment jsdom
/**
 * GameShell fills its container's width instead of the viewport's, so a game
 * embedded in a padded page column never runs past the right edge; it still
 * never exceeds the viewport, and keeps its full-height surface.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { GameShell } from '../GameShell';

function root(): HTMLElement {
  const { container } = render(<GameShell appName="Snake" showTopBar={false} />);
  return container.querySelector('.game-shell') as HTMLElement;
}

describe('GameShell width', () => {
  it('fills its container, capped at the viewport', () => {
    const el = root();
    expect(el.style.width).toBe('100%');
    expect(el.style.maxWidth).toBe('100vw');
  });

  it('control: keeps its full-height surface', () => {
    expect(root().style.height).toBe('100vh');
  });

  it('renders an authored HUD panel asset behind the title', () => {
    const { container } = render(
      <GameShell
        appName="Snake"
        hudBackgroundAsset={{ url: 'https://example.invalid/hud.png', role: 'panel', category: 'ui' }}
      />,
    );
    const title = container.querySelector('.game-shell__title');
    expect(title?.textContent).toContain('Snake');
    expect(title?.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('keeps authored accessibility and locale on the surface', () => {
    const { container } = render(
      <GameShell appName="Snake" aria-label="Game surface" role="application" lang="ar" dir="rtl" tabIndex={0} />,
    );
    const surface = container.querySelector('.game-shell');
    expect(surface?.getAttribute('aria-label')).toBe('Game surface');
    expect(surface?.getAttribute('role')).toBe('application');
    expect(surface?.getAttribute('lang')).toBe('ar');
    expect(surface?.getAttribute('dir')).toBe('rtl');
    expect(surface?.getAttribute('tabindex')).toBe('0');
  });
});
