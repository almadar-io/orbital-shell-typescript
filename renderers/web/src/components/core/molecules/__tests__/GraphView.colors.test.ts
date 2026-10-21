import { describe, it, expect } from 'vitest';
import { GROUP_COLORS, DEFAULT_NODE_COLOR, DEFAULT_EDGE_COLOR } from '../GraphView';

const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;

describe('GraphView color defaults hold no literal color', () => {
  it('GROUP_COLORS is theme tokens only', () => {
    expect(GROUP_COLORS.length).toBeGreaterThan(0);
    for (const c of GROUP_COLORS) expect(c, c).not.toMatch(LITERAL);
  });

  it('DEFAULT_NODE_COLOR and DEFAULT_EDGE_COLOR are theme tokens', () => {
    expect(DEFAULT_NODE_COLOR).not.toMatch(LITERAL);
    expect(DEFAULT_EDGE_COLOR).not.toMatch(LITERAL);
    expect(DEFAULT_NODE_COLOR).toMatch(/^var\(--color-[a-z-]+\)$/);
    expect(DEFAULT_EDGE_COLOR).toMatch(/^var\(--color-[a-z-]+\)$/);
  });
});
