import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GraphView } from '../GraphView';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

const nodes = [
  { id: 'a', label: 'Alpha', group: 'core' },
  { id: 'b' },
];
const edges = [{ source: 'a', target: 'b' }];

describe('GraphView a11y', () => {
  it('clickable nodes are named buttons from label/group and activate by keyboard', async () => {
    const onNodeClick = vi.fn();
    const { container } = render(<GraphView nodes={nodes} edges={edges} layout="flow" onNodeClick={onNodeClick} aria-label="Dependencies" />);
    const alpha = await screen.findByRole('button', { name: 'Alpha, core' });
    const bare = screen.getByRole('button', { name: 'b' });
    expect(alpha.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(alpha, { key: 'Enter' });
    fireEvent.keyDown(bare, { key: ' ' });
    expect(onNodeClick.mock.calls.map((c) => c[0].id)).toEqual(['a', 'b']);
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('control: without onNodeClick there are no buttons and a labelled graph is an image', async () => {
    const { container } = render(<GraphView nodes={nodes} edges={edges} layout="flow" aria-label="Dependencies" />);
    await waitFor(() => expect(container.querySelectorAll('circle').length).toBe(2));
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('img', { name: 'Dependencies' })).toBeTruthy();
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('empty graph renders the empty state without buttons', () => {
    render(<GraphView nodes={[]} edges={[]} onNodeClick={() => {}} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
