/**
 * The secondary button's label must stay legible in every theme: a theme's accent is often a
 * signature bright (Bauhaus/Memphis yellow) that fails as text on a light page, so the accent is
 * the button's border and hover fill, and the label paints in the foreground.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../../index';

describe('Button secondary variant', () => {
  it('paints its label in the foreground and keeps the accent as the border', () => {
    render(<Button variant="secondary">Step</Button>);
    const cls = screen.getByRole('button', { name: 'Step' }).className;
    expect(cls).toContain('text-foreground');
    expect(cls).toContain('border-accent');
    expect(cls).not.toMatch(/(^|\s)text-accent(\s|$)/);
  });

  it('control: hover still fills with the accent and switches to its foreground', () => {
    render(<Button variant="secondary">Run</Button>);
    const cls = screen.getByRole('button', { name: 'Run' }).className;
    expect(cls).toContain('hover:bg-accent');
    expect(cls).toContain('hover:text-accent-foreground');
  });
});
