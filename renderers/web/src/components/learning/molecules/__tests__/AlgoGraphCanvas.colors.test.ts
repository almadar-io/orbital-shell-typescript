import { describe, it, expect } from 'vitest';
import { DIAGRAM_TONES } from '@almadar/core';
import { NODE_STATE_COLOR, EDGE_STATE_COLOR } from '../AlgoGraphCanvas';

const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\bvar\(/i;

describe('AlgoGraphCanvas state maps hold tone names, never a literal color', () => {
  it('NODE_STATE_COLOR maps every AlgoGraphNodeState to a role tone', () => {
    expect(NODE_STATE_COLOR).toEqual({
      unvisited: 'ink',
      frontier: 'highlight',
      current: 'primary',
      visited: 'muted',
      goal: 'success',
      path: 'accent',
    });
    for (const c of Object.values(NODE_STATE_COLOR)) {
      expect(DIAGRAM_TONES).toContain(c);
      expect(c).not.toMatch(LITERAL);
    }
  });

  it('EDGE_STATE_COLOR maps every AlgoGraphEdgeState to a role tone', () => {
    expect(EDGE_STATE_COLOR).toEqual({
      default: 'ink',
      tree: 'muted',
      relaxed: 'primary',
      candidate: 'highlight',
      path: 'accent',
    });
    for (const c of Object.values(EDGE_STATE_COLOR)) {
      expect(DIAGRAM_TONES).toContain(c);
      expect(c).not.toMatch(LITERAL);
    }
  });

  it('control: the literal matcher catches a hex, rgb and var() token', () => {
    for (const bad of ['#16a34a', 'rgb(1,2,3)', 'var(--color-primary)']) expect(bad).toMatch(LITERAL);
  });
});
