/**
 * The AVL graph canvas shell: the chrome every AVL graph shares (zoom range, fit padding,
 * dot background, zoom controls) around whatever nodes a lens draws.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider, type Node } from '@xyflow/react';
import { AvlGraphCanvas, AVL_GRAPH_NODE_TYPES } from '../AvlGraphCanvas';
import { Box } from '../../../../core';
import { layeredGraph } from '../../../../lib/avl-layered-graph';
import type { PreviewNodeData } from '../../../../lib/avl-preview-converter';

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

const graph = layeredGraph({
  columns: [{ id: 'host', width: 160 }, { id: 'store', width: 160 }],
  units: [{ id: 'h', column: 'host', label: 'shared host', status: 'ok', metric: '42 req' }, { id: 's', column: 'store', label: 'firestore', status: 'down' }],
  edges: [{ id: 'e', source: 'h', target: 's' }],
  row: { height: 28, gap: 12, columnGap: 96, headerHeight: 30 },
  handles: 'facing',
});

function renderCanvas(compact: boolean, nodes: Node<PreviewNodeData>[] = graph.nodes) {
  return render(
    <ReactFlowProvider>
      <Box style={{ width: 800, height: 600 }}>
        <AvlGraphCanvas nodes={nodes} edges={graph.edges} nodeTypes={AVL_GRAPH_NODE_TYPES} fitPadding={0.08} compact={compact} />
      </Box>
    </ReactFlowProvider>,
  );
}

describe('AvlGraphCanvas', () => {
  it('draws layered pills with their health and metric', () => {
    renderCanvas(false);
    expect(screen.getAllByTestId('avl-dependency-node')).toHaveLength(2);
    expect(screen.getAllByTestId('avl-unit-status').map((e) => e.getAttribute('data-status'))).toEqual(['ok', 'down']);
    expect(screen.getByText('42 req')).toBeTruthy();
  });

  it('shows zoom controls on a wide screen', () => {
    const { container } = renderCanvas(false);
    expect(container.querySelector('.react-flow__controls')).not.toBeNull();
  });

  it('control: compact screens pinch-zoom, so the controls are hidden', () => {
    const { container } = renderCanvas(true);
    expect(container.querySelector('.react-flow__controls')).toBeNull();
  });
});
