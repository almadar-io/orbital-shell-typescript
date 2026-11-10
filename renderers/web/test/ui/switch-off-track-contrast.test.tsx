/**
 * G-CROSS-573: an unchecked switch's track is painted `--color-muted-foreground`, a token that clears 3:1
 * against the page and card ground (WCAG 1.4.11), never `--color-muted`, which is about 1.1:1 in light themes.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Switch } from '../../src/core/atoms/Switch';

function trackClasses(checked: boolean): string[] {
  render(<Switch checked={checked} label={checked ? 'on' : 'off'} />);
  return (screen.getByRole('switch', { name: checked ? 'on' : 'off' }).getAttribute('class') ?? '').split(/\s+/);
}

describe('switch track contrast', () => {
  it('an unchecked track reads muted-foreground, not muted', () => {
    const classes = trackClasses(false);
    expect(classes).toContain('bg-muted-foreground');
    expect(classes).not.toContain('bg-muted');
  });

  it('control: a checked track reads primary', () => {
    const classes = trackClasses(true);
    expect(classes).toContain('bg-primary');
    expect(classes).not.toContain('bg-muted-foreground');
  });
});
