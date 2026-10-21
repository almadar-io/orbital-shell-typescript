// @vitest-environment jsdom
/**
 * `game-menu` is the corpus's game-over/victory overlay inside `GameShell`. As a start screen it
 * fills the viewport; inside the shell's overlay layer it must size to its card, or it paints a
 * viewport-tall column of page background over the arena.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { GameMenu } from '../GameMenu';
import { GameShell } from '../../templates/GameShell';

const OPTIONS = [{ id: 'again', label: 'Play Again', event: 'PLAY_AGAIN', variant: 'primary' }];

function menuRoot(): HTMLElement {
  const title = screen.getByText('GAME OVER');
  const root = title.closest('[data-game-menu]');
  if (!(root instanceof HTMLElement)) throw new Error('GameMenu root not found');
  return root;
}

describe('GameMenu sizing', () => {
  it('inside a GameShell overlay it sizes to its card, with no page background', () => {
    render(<GameShell appName="Snake" overlay={<GameMenu title="GAME OVER" options={OPTIONS} />}><span>arena</span></GameShell>);
    const root = menuRoot();
    expect(root.className).not.toContain('min-h-screen');
    expect(root.className).not.toContain('bg-background');
    expect(root.className).not.toContain('w-full');
  });

  it('control: standalone it is still a full-screen start menu', () => {
    render(<GameMenu title="GAME OVER" options={OPTIONS} />);
    const root = menuRoot();
    expect(root.className).toContain('min-h-screen');
    expect(root.className).toContain('bg-background');
  });

  it('edge: an explicit background still applies inside the overlay', () => {
    render(<GameShell overlay={<GameMenu title="GAME OVER" options={OPTIONS} background="rgb(1, 2, 3)" />}><span>arena</span></GameShell>);
    expect(menuRoot().style.background).toBe('rgb(1, 2, 3)');
  });
});
