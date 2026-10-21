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
});
