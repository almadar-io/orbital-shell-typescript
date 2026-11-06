import { describe, expect, it } from 'vitest';
import { decodeParticles } from '../LearningCanvas';

const word = (x: number, y: number, index: number): number[] => {
  const w = (x | (y << 12) | (index << 24)) >>> 0;
  return [w & 255, (w >>> 8) & 255, (w >>> 16) & 255, w >>> 24];
};
const base64 = (bytes: number[]): string => btoa(String.fromCharCode(...bytes));

describe('decodeParticles', () => {
  it('reads one word per stride into the bucket of its palette index', () => {
    const data = base64([...word(10, 20, 0), 0, 0, 0, 0, ...word(4095, 4095, 1), 9, 9, 9, 9]);
    expect(decodeParticles({ data, stride: 8, radius: 1, palette: ['a', 'b'] })).toEqual([[10, 20], [4095, 4095]]);
  });

  it('edge: an index past the palette takes the last color', () => {
    const data = base64(word(1, 2, 7));
    expect(decodeParticles({ data, stride: 4, radius: 1, palette: ['a', 'b'] })).toEqual([[], [1, 2]]);
  });

  it('control: no palette or a stride under one word draws nothing', () => {
    const data = base64(word(1, 2, 0));
    expect(decodeParticles({ data, stride: 4, radius: 1, palette: [] })).toEqual([]);
    expect(decodeParticles({ data, stride: 2, radius: 1, palette: ['a'] })).toEqual([[]]);
  });
});
