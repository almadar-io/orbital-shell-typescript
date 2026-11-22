/**
 * A wide markdown table scrolls inside a named group a keyboard can reach (axe scrollable-region-focusable).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownContent } from '../MarkdownContent';

describe('MarkdownContent tables', () => {
  it('a table sits in a named, focusable group', () => {
    render(<MarkdownContent content={'| Tag | Meaning |\n|---|---|\n| runtime | in memory |'} />);
    const group = screen.getByRole('group', { name: 'Table' });
    expect(group.getAttribute('tabindex')).toBe('0');
    expect(group.querySelector('table')).not.toBeNull();
  });

  it('control: text without a table has no such group', () => {
    render(<MarkdownContent content={'Just a sentence.'} />);
    expect(screen.queryByRole('group', { name: 'Table' })).toBeNull();
  });
});
