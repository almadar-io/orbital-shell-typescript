/**
 * A new event lands on top of the timeline and the older ones glide down to make
 * room, instead of every entry jumping a slot in one frame (almadar.io launch demo).
 * jsdom lays nothing out: each row's box is its index among its siblings.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { Timeline, type TimelineItem } from '../Timeline';
import { EventBusProvider } from '../../../../core';

const ROW = 60;
const glides: Array<{ id: string; from: string }> = [];

beforeEach(() => {
  glides.length = 0;
  document.documentElement.style.setProperty('--duration-slow', '400ms');
  document.documentElement.style.setProperty('--easing-emphasized', 'cubic-bezier(0.2, 0, 0, 1)');
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (!this.hasAttribute('data-item-key')) return new DOMRect(0, 0, 400, 400);
    const siblings = [...(this.parentElement?.children ?? [])].filter((c) => c.hasAttribute('data-item-key'));
    return new DOMRect(0, siblings.indexOf(this) * ROW, 400, ROW);
  });
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value(this: Element, frames: Keyframe[]) {
      if (frames[0]?.transform !== undefined) glides.push({ id: this.getAttribute('data-item-key') ?? '', from: String(frames[0].transform) });
      return { playState: 'finished', currentTime: 0, effect: { getComputedTiming: () => ({ progress: 1 }) }, cancel: () => undefined };
    },
  });
});
afterEach(() => vi.restoreAllMocks());

const event = (id: string): TimelineItem => ({ id, title: id });
const view = (ids: string[]) => (
  <EventBusProvider debug={false}>
    <Timeline items={ids.map(event)} />
  </EventBusProvider>
);

describe('Timeline item moves', () => {
  it('an event added on top pushes the others down with a glide', () => {
    const r = render(view(['a', 'b']));
    glides.length = 0;
    r.rerender(view(['n', 'a', 'b']));
    expect(glides).toContainEqual({ id: 'a', from: `translate(0px, ${-ROW}px)` });
    expect(glides.map((g) => g.id)).not.toContain('n');
  });

  it('control: an unchanged timeline glides nothing', () => {
    const r = render(view(['a', 'b']));
    glides.length = 0;
    r.rerender(view(['a', 'b']));
    expect(glides).toEqual([]);
  });
});
