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

  it('announces the selected node as text, not only as a larger dot (G-ORBITAL-SHELL-TYPESCRIPT-062)', () => {
    mount({ selectedNodeId: 'b' });
    expect(screen.getByRole('status').textContent).toBe('Selected: B');
  });

  it('control: no selection announces nothing; an id that is not a node announces nothing', () => {
    const { unmount } = mount({});
    expect(screen.queryByRole('status')).toBeNull();
    unmount();
    mount({ selectedNodeId: 'zzz' });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('GraphCanvas layout when the canvas mounts later (G-ORBITAL-SHELL-TYPESCRIPT-047)', () => {
  function recordingContext(arcs: number[]): CanvasRenderingContext2D {
    return new Proxy({} as CanvasRenderingContext2D, {
      get(_t, prop) {
        if (prop === 'arc') return () => { arcs.push(1); };
        if (prop === 'measureText') return () => ({ width: 0 });
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop: () => undefined });
        return () => undefined;
      },
      set() {
        return true;
      },
    });
  }

  function tree(isLoading: boolean) {
    return (
      <EventBusProvider debug={false}>
        <GraphCanvas nodes={nodes} edges={[{ source: 'a', target: 'b' }]} isLoading={isLoading} />
      </EventBusProvider>
    );
  }

  it('draws the nodes after isLoading flips to false with the same nodes', () => {
    const arcs: number[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingContext(arcs));
    const { rerender } = render(tree(true));
    expect(arcs).toHaveLength(0);
    rerender(tree(false));
    expect(arcs.length).toBeGreaterThan(0);
  });

  it('control: a graph that is never loading draws its nodes', () => {
    const arcs: number[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingContext(arcs));
    render(tree(false));
    expect(arcs.length).toBeGreaterThan(0);
  });
});

