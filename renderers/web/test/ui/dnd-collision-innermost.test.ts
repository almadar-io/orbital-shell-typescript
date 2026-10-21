/**
 * A drop goes to the innermost drop zone under the pointer. dnd-kit's
 * `pointerWithin` ranks overlapping zones by distance to their corners, which
 * favours the smaller rectangle — so once a canvas card is zoomed larger than
 * the canvas wrapper it sits in, the wrapper won and every drop into the card
 * fell through to the canvas-wide fallback.
 */
import { describe, it, expect } from 'vitest';
import type { Active, ClientRect, DroppableContainer } from '@dnd-kit/core';
import { almadarDndCollisionDetection } from '../../src/hooks/useAlmadarDndCollision';

const rect = (left: number, top: number, width: number, height: number): ClientRect => ({ left, top, width, height, right: left + width, bottom: top + height });

function zone(id: string, node: HTMLElement): DroppableContainer {
  return { id, key: id, data: { current: {} }, disabled: false, node: { current: node }, rect: { current: null } };
}

const active: Active = { id: 'tile', data: { current: {} }, rect: { current: { initial: null, translated: null } } };

function collide(zones: Array<[DroppableContainer, ClientRect]>, pointer: { x: number; y: number }) {
  return almadarDndCollisionDetection({
    active,
    collisionRect: rect(pointer.x, pointer.y, 1, 1),
    droppableRects: new Map(zones.map(([z, r]) => [z.id, r])),
    droppableContainers: zones.map(([z]) => z),
    pointerCoordinates: pointer,
  }).map((c) => c.id);
}

describe('almadarDndCollisionDetection', () => {
  const wrapperEl = document.createElement('div');
  const cardEl = document.createElement('div');
  wrapperEl.appendChild(cardEl);

  it('a zone nested inside another wins, even when zoomed larger than it', () => {
    const wrapper = zone('wrapper', wrapperEl);
    const card = zone('card', cardEl);
    // The zoomed card overflows the canvas region (the numbers from a real std-crm run).
    expect(collide([[wrapper, rect(336, 80, 624, 640)], [card, rect(-1015, -52, 2556, 1274)]], { x: 784, y: 400 })[0]).toBe('card');
  });

  it('side-by-side zones keep dnd-kit\'s own order (nearest corners first)', () => {
    const a = zone('a', document.createElement('div'));
    const b = zone('b', document.createElement('div'));
    // Overlapping, not nested: the smaller-cornered one stays first.
    expect(collide([[a, rect(0, 0, 400, 400)], [b, rect(90, 90, 20, 20)]], { x: 100, y: 100 })[0]).toBe('b');
  });

  it('a pointer in no zone falls through to the rest of the waterfall', () => {
    const a = zone('a', document.createElement('div'));
    expect(collide([[a, rect(0, 0, 10, 10)]], { x: 500, y: 500 })).toEqual(['a']);
  });
});
