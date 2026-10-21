/**
 * The deployment lens lays a published app's units out in its fixed column order, whatever order
 * they arrive in, and keeps each wire's label and health.
 */
import { describe, it, expect } from 'vitest';
import { deploymentGraph } from '../avl-deployment-graph';

describe('deploymentGraph', () => {
  const g = deploymentGraph({
    units: [
      { id: 'external:email', column: 'external', label: 'email', status: 'down' },
      { id: 'host', column: 'host', label: 'shop', status: 'ok', metric: 'p50 9 ms' },
      { id: 'visitors', column: 'client', label: 'Visitors', status: 'ok' },
      { id: 'store:memory', column: 'store', label: 'memory', status: 'ok' },
    ],
    edges: [
      { id: 'visitors->host', source: 'visitors', target: 'host', label: '3 calls', status: 'ok' },
      { id: 'host->external:email', source: 'host', target: 'external:email', label: '1 call · 1 error', status: 'down' },
    ],
  });

  it('orders the columns visitors, host, stores, external, left to right', () => {
    const x = (id: string) => g.nodes.find((n) => n.id === id)?.position.x ?? -1;
    expect(x('visitors')).toBeLessThan(x('host'));
    expect(x('host')).toBeLessThan(x('store:memory'));
    expect(x('store:memory')).toBeLessThan(x('external:email'));
  });

  it('keeps each wire\'s label and draws a failing one in the error colour', () => {
    expect(g.edges.find((e) => e.id === 'host->external:email')).toMatchObject({ label: '1 call · 1 error', style: { stroke: 'var(--color-error)' } });
  });

  it('control: an empty service column takes no space', () => {
    expect(g.nodes.some((n) => n.id === '__column_service')).toBe(false);
  });
});
