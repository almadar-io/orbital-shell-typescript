/**
 * A button's content follows the button's own alignment: the content box
 * fills the button and inherits its `justify-content`, so a caller's
 * `justify-start` / `justify-between` or a growing child (`flex-1`) lays out
 * across the whole button instead of a centred, content-sized box.
 */
import React from 'react';
import { createRequire } from 'module';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../../../../core';

const { compileTailwindClasses } = createRequire(import.meta.url)('../../../../../tailwind-compile.cjs') as {
  compileTailwindClasses: (classes: string[]) => Promise<string>;
};

const contentBox = (): HTMLElement => {
  const label = screen.getByText('Projects');
  const box = label.parentElement;
  if (!box) throw new Error('label has no content box');
  return box;
};

describe('Button content alignment', () => {
  it('the content box fills the button and inherits its justification', () => {
    render(<Button className="w-full justify-start"><span>Projects</span></Button>);
    expect(contentBox().className).toContain('flex-1');
    expect(contentBox().className).toContain('[justify-content:inherit]');
    expect(contentBox().className).not.toContain('justify-center');
  });

  it('the content box classes compile: justify-content inherit is real CSS', async () => {
    render(<Button className="w-full justify-start"><span>Projects</span></Button>);
    const css = await compileTailwindClasses(contentBox().className.split(/\s+/));
    expect(css).toMatch(/justify-content:\s*inherit/);
  });

  it('edge: a full-width icon-only button centres its icon (the content inherits the button\'s centring)', () => {
    render(<Button className="w-full" icon="plus" aria-label="Add" />);
    const button = screen.getByRole('button');
    const box = button.lastElementChild;
    expect(button.className).toContain('justify-center');
    expect(box?.className).toContain('[justify-content:inherit]');
  });

  it('control: a default button keeps its centring on the button itself', () => {
    render(<Button><span>Projects</span></Button>);
    expect(screen.getByRole('button').className).toContain('justify-center');
  });

  it("edge: a caller's justify class reaches the button, which the content inherits", () => {
    render(<Button className="w-full justify-between"><span>Projects</span></Button>);
    const button = screen.getByRole('button');
    expect(button.className).toContain('justify-between');
    expect(button.className).not.toContain('justify-center');
    expect(contentBox().className).toContain('[justify-content:inherit]');
  });

  it('edge: a busy button keeps the content box (its space held for the spinner)', () => {
    render(<Button isLoading><span>Projects</span></Button>);
    expect(contentBox().className).toContain('almadar-busy-content');
    expect(contentBox().className).toContain('flex-1');
  });
});
