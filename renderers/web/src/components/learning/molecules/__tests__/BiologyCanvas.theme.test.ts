import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HEX = /#[0-9a-fA-F]{3,8}\b/;

describe('BiologyCanvas holds no hardcoded color', () => {
  it('source has no hex literal', () => {
    const src = readFileSync(join(__dirname, '..', 'BiologyCanvas.tsx'), 'utf8');
    expect(src.match(HEX)).toBeNull();
  });

  it('control: the matcher catches a sample hex', () => {
    expect("color: '#16a34a'").toMatch(HEX);
    expect("tone: 'series-1'").not.toMatch(HEX);
  });
});
