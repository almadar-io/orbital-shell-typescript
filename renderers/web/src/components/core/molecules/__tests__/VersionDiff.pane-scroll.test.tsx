/**
 * Side-by-side panes each scroll their own long lines: in a narrow container
 * the before pane's text never runs into the after pane.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { VersionDiff } from '../VersionDiff';

const revisions = [
  { id: 'r1', label: 'v1', content: 'Trips over 500 need a manager\'s approval and a receipt for every night.' },
  { id: 'r2', label: 'v2', content: 'Trips over 800 need a manager\'s approval and a receipt for every night.' },
];

describe('VersionDiff side-by-side panes', () => {
  it('each pane clips and scrolls its own overflow', () => {
    render(<VersionDiff revisions={revisions} beforeId="r1" afterId="r2" view="side-by-side" />);
    for (const id of ['version-diff-before', 'version-diff-after']) {
      const pane = screen.getByTestId(id);
      expect(pane.className).toContain('min-w-0');
      expect(pane.className).toContain('overflow-x-auto');
    }
  });

  it('control: the inline view renders no side-by-side panes', () => {
    render(<VersionDiff revisions={revisions} beforeId="r1" afterId="r2" view="inline" />);
    expect(screen.queryByTestId('version-diff-before')).toBeNull();
  });
});
