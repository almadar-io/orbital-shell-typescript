/**
 * Annotation labels never sit on their own marks and are always in the label voice: a range band's text
 * does not inherit the band tint, a pivot label clears its hatching, and a body-anchored vector's label
 * clears the body even when the arrow is shorter than the body radius.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import type { LearningShape } from '../../atoms/LearningCanvas';

const captured: { shapes: LearningShape[] } = { shapes: [] };

vi.mock('../../atoms/LearningCanvas', () => ({
  LearningCanvas: (props: { shapes?: LearningShape[] }) => {
    captured.shapes = props.shapes ?? [];
    return null;
  },
}));

const { AlgorithmCanvas } = await import('../AlgorithmCanvas');
const { PhysicsCanvas } = await import('../PhysicsCanvas');

type TextShape = LearningShape & { x: number; y: number };
const texts = (): TextShape[] =>
  captured.shapes.flatMap((s) => (s.type === 'text' && s.x !== undefined && s.y !== undefined ? [{ ...s, x: s.x, y: s.y }] : []));
const textOf = (label: string): TextShape => {
  const t = texts().find((s) => s.text === label);
  if (!t) throw new Error(`no text "${label}"`);
  return t;
};

beforeEach(() => {
  captured.shapes = [];
});

describe('AlgorithmCanvas range labels', () => {
  it('a fill band label is in the label voice, not the band tint', () => {
    render(<AlgorithmCanvas bars={[{ value: 3 }, { value: 1 }]} ranges={[{ from: 0, to: 0, kind: 'fill', label: 'sorted', color: 'highlight' }]} />);
    const t = textOf('sorted');
    expect(t.tone).toBe('label');
    expect(t.color).toBeUndefined();
  });

  it('a bracket label is in the label voice too', () => {
    render(<AlgorithmCanvas bars={[{ value: 3 }, { value: 1 }]} ranges={[{ from: 0, to: 1, kind: 'bracket', label: 'window', color: 'highlight' }]} />);
    expect(textOf('window').tone).toBe('label');
  });

  it('control: the band and bracket marks keep the declared tint', () => {
    render(
      <AlgorithmCanvas
        bars={[{ value: 3 }, { value: 1 }]}
        ranges={[
          { from: 0, to: 0, kind: 'fill', label: 'sorted', color: 'highlight' },
          { from: 0, to: 1, kind: 'bracket', label: 'window', color: 'series-2' },
        ]}
      />,
    );
    const band = captured.shapes.find((s) => s.type === 'rect' && s.fill === 'highlight');
    expect(band).toBeDefined();
    expect(captured.shapes.some((s) => s.type === 'line' && s.color === 'series-2')).toBe(true);
  });
});

describe('PhysicsCanvas pivot label', () => {
  it('clears the hatching above the pivot by at least a label half-height', () => {
    render(<PhysicsCanvas sceneObjects={[{ kind: 'pivot', x: 100, y: 100, label: 'pivot' }]} />);
    const hatchTop = Math.min(
      ...captured.shapes.filter((s) => s.type === 'line').flatMap((l) => [l.y1 ?? Infinity, l.y2 ?? Infinity]),
    );
    expect(hatchTop - textOf('pivot').y).toBeGreaterThanOrEqual(8);
  });
});

describe('PhysicsCanvas body-anchored vector labels', () => {
  const body = { id: 'bob', x: 200, y: 200, radius: 20 };
  const dist = (t: TextShape) => Math.hypot(t.x - body.x, t.y - body.y);

  it('a vector shorter than the body radius still puts its label outside the body', () => {
    render(<PhysicsCanvas bodies={[body]} showVelocity={false} vectors={[{ body: 'bob', dx: 0, dy: 4, label: 'mg' }]} />);
    expect(dist(textOf('mg'))).toBeGreaterThanOrEqual(body.radius + 8);
  });

  it('edge: a zero-length vector on a body still labels outside the body', () => {
    render(<PhysicsCanvas bodies={[body]} showVelocity={false} vectors={[{ body: 'bob', dx: 0, dy: 0, label: 'N' }]} />);
    expect(dist(textOf('N'))).toBeGreaterThanOrEqual(body.radius + 8);
  });

  it('control: a long vector labels just past its tip', () => {
    render(<PhysicsCanvas bodies={[body]} showVelocity={false} vectors={[{ body: 'bob', dx: 0, dy: 100, label: 'F' }]} />);
    const t = textOf('F');
    expect(t.x).toBeCloseTo(200);
    expect(t.y).toBeCloseTo(308);
  });

  it('control: a free vector (no body) labels just past its tip', () => {
    render(<PhysicsCanvas vectors={[{ x: 50, y: 50, dx: 4, dy: 0, label: 'v' }]} />);
    const t = textOf('v');
    expect(t.x).toBeCloseTo(62);
    expect(t.y).toBeCloseTo(50);
  });
});

describe('symbol slots keep their letters under an uppercase label theme', () => {
  it('force-vector and angle labels are declared verbatim', () => {
    render(
      <PhysicsCanvas
        bodies={[{ id: 'bob', x: 200, y: 200, radius: 20 }]}
        showVelocity={false}
        vectors={[{ body: 'bob', dx: 0, dy: 60, label: 'mg' }]}
        angles={[{ x: 100, y: 100, from: 0, to: 45, label: 'θ' }]}
      />,
    );
    expect(textOf('mg').textCase).toBe('verbatim');
    expect(textOf('θ').textCase).toBe('verbatim');
  });

  it('control: a fixture word label follows the theme case', () => {
    render(<PhysicsCanvas sceneObjects={[{ kind: 'pivot', x: 100, y: 100, label: 'pivot' }]} />);
    expect(textOf('pivot').textCase).toBeUndefined();
  });
});

describe('AlgorithmCanvas bar pointer label', () => {
  it('sits clear below the arrow tail and inside the pointer band', () => {
    render(<AlgorithmCanvas height={400} bars={[{ value: 3 }, { value: 1 }]} pointers={[{ index: 1, label: 'key' }]} />);
    const arrow = captured.shapes.find((s) => s.type === 'arrow');
    const tail = Math.max(arrow?.y1 ?? 0, arrow?.y2 ?? 0);
    const label = textOf('key');
    expect(label.y - tail).toBeGreaterThanOrEqual(14);
    expect(label.y).toBeLessThanOrEqual(400 - 6);
  });
});

describe('AlgorithmCanvas pointers sharing a bar', () => {
  it('draw one arrow with the labels joined, never stacked glyphs', () => {
    render(<AlgorithmCanvas bars={[{ value: 3 }, { value: 1 }]} pointers={[{ index: 1, label: 'key' }, { index: 1, label: 'j' }]} />);
    expect(captured.shapes.filter((s) => s.type === 'arrow')).toHaveLength(1);
    expect(texts().filter((t) => t.text === 'key' || t.text === 'j')).toEqual([]);
    expect(textOf('key · j').x).toBeCloseTo(450);
  });

  it('control: pointers on different bars keep their own arrows and labels', () => {
    render(<AlgorithmCanvas bars={[{ value: 3 }, { value: 1 }]} pointers={[{ index: 0, label: 'i' }, { index: 1, label: 'j' }]} />);
    expect(captured.shapes.filter((s) => s.type === 'arrow')).toHaveLength(2);
    expect(textOf('i').x).toBeLessThan(textOf('j').x);
  });

  it('edge: an unlabeled pointer sharing a bar adds no separator', () => {
    render(<AlgorithmCanvas bars={[{ value: 3 }, { value: 1 }]} pointers={[{ index: 1, label: 'key' }, { index: 1 }]} />);
    expect(textOf('key').text).toBe('key');
  });
});
