import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GraphCanvas } from '../GraphCanvas';
import { EventBusProvider } from '../../../../core';
import { axeViolations, describeViolations } from '../../../../../test/ui/axe';

afterEach(() => vi.restoreAllMocks());

const nodes = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];

function mount(props: Partial<React.ComponentProps<typeof GraphCanvas>>) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  return render(
    <EventBusProvider debug={false}>
      <GraphCanvas nodes={nodes} edges={[{ source: 'a', target: 'b' }]} {...props} />
    </EventBusProvider>,
  );
}

describe('GraphCanvas a11y', () => {
  it('names the canvas and the three zoom/reset icon buttons', async () => {
    const { container } = mount({ title: 'Dependency graph', description: 'A depends on B.' });
    expect(screen.getByRole('img', { name: 'Dependency graph' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy();
    expect(container.textContent).toContain('A depends on B.');
    expect(describeViolations(await axeViolations(container))).toEqual([]);
  });

  it('control: explicit aria-label wins over the title; non-interactive has no icon buttons', () => {
    mount({ title: 'Graph', 'aria-label': 'Module imports', interactive: false });
    expect(screen.getByRole('img', { name: 'Module imports' })).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
