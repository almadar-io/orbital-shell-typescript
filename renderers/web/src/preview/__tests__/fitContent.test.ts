/**
 * `fit="content"`: the rendered component (the slot content), not the padded
 * page around it, is fit into the box and centered — a palette tile shows a
 * Button at a readable size in its middle, and a wide grid scaled to the tile.
 */
import { describe, it, expect } from 'vitest';
import { fitContentTransform, slotContentRect } from '../fitContent';

const box = { width: 200, height: 80 };

describe('fitContentTransform', () => {
  it('centers content smaller than the box at its natural size', () => {
    expect(fitContentTransform(box, { x: 16, y: 16, width: 80, height: 32 })).toEqual({ scale: 1, x: 44, y: 8 });
  });

  it('scales content larger than the box down to fit, keeping proportions, and centers it', () => {
    expect(fitContentTransform(box, { x: 0, y: 0, width: 400, height: 80 })).toEqual({ scale: 0.5, x: 0, y: 20 });
  });

  it('edge: nothing rendered yet (empty rect) leaves the content untransformed', () => {
    expect(fitContentTransform(box, { x: 0, y: 0, width: 0, height: 0 })).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('edge: an unmeasured box leaves the content untransformed', () => {
    expect(fitContentTransform({ width: 0, height: 0 }, { x: 5, y: 5, width: 50, height: 20 })).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

function rectOf(el: HTMLElement, r: { left: number; top: number; width: number; height: number }): void {
  el.getBoundingClientRect = () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => r }) as DOMRect;
}

describe('slotContentRect', () => {
  it('includes descendants that overflow their slot child (a calendar wider than its wrapper)', () => {
    const inner = document.createElement('div');
    const slot = document.createElement('div');
    slot.setAttribute('data-orb-slot', 'main');
    const child = document.createElement('div');
    const wide = document.createElement('div');
    child.appendChild(wide);
    slot.appendChild(child);
    inner.appendChild(slot);
    rectOf(inner, { left: 0, top: 0, width: 480, height: 400 });
    rectOf(slot, { left: 0, top: 0, width: 480, height: 400 });
    rectOf(child, { left: 16, top: 16, width: 100, height: 40 });
    rectOf(wide, { left: 16, top: 16, width: 420, height: 90 });
    expect(slotContentRect(inner, 1)).toEqual({ x: 16, y: 16, width: 420, height: 90 });
  });

  it('control: nothing rendered in any slot is null', () => {
    const inner = document.createElement('div');
    const slot = document.createElement('div');
    slot.setAttribute('data-orb-slot', 'main');
    inner.appendChild(slot);
    rectOf(inner, { left: 0, top: 0, width: 480, height: 400 });
    expect(slotContentRect(inner, 1)).toBeNull();
  });
});
