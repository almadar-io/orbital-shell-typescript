/**
 * PhysicsCanvas paints by theme role: no hex color literal may live in its source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const source = readFileSync(join(__dirname, '..', 'PhysicsCanvas.tsx'), 'utf8');

describe('PhysicsCanvas theme roles', () => {
  it('contains no hex color literal', () => {
    expect(source.match(HEX)).toBeNull();
  });

  it('uses no literal fontSize default', () => {
    expect(source).not.toMatch(/fontSize:\s*\d/);
  });

  it('control: the hex pattern catches a hex literal', () => {
    expect(HEX.test("color: '#2563eb'")).toBe(true);
    expect(HEX.test("color: '#fff'")).toBe(true);
    expect(HEX.test("color: 'series-1'")).toBe(false);
  });
});
