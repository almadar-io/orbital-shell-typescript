import { describe, it, expect } from 'vitest';
import { TRACE_SERIES_COLORS } from '../LearningCanvas';

const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;

describe('LearningCanvas TRACE_SERIES_COLORS', () => {
  it('holds no literal color', () => {
    expect(TRACE_SERIES_COLORS.length).toBeGreaterThan(0);
    for (const c of TRACE_SERIES_COLORS) expect(c, c).not.toMatch(LITERAL);
  });
});
