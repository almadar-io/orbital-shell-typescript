/**
 * A new category joins the bar chart and the others slide aside with a glide,
 * instead of every bar jumping sideways in one frame (almadar.io team demo).
 * jsdom lays nothing out: each category column's box is its index among its siblings.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { Chart } from '../Chart';
import { EventBusProvider } from '../../../../core';

const COL = 100;
const glides: Array<{ id: string; from: string }> = [];

beforeEach(() => {
  glides.length = 0;
  document.documentElement.style.setProperty('--duration-slow', '400ms');
  document.documentElement.style.setProperty('--easing-emphasized', 'cubic-bezier(0.2, 0, 0, 1)');
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (!this.hasAttribute('data-item-key')) return new DOMRect(0, 0, 600, 300);
    const siblings = [...(this.parentElement?.children ?? [])].filter((c) => c.hasAttribute('data-item-key'));
    return new DOMRect(siblings.indexOf(this) * COL, 0, COL, 300);
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

const view = (labels: string[]) => (
  <EventBusProvider debug={false}>
    <Chart chartType="bar" data={labels.map((label, i) => ({ label, value: i + 1 }))} />
  </EventBusProvider>
);

describe('Chart bar columns move', () => {
  it('a category inserted before others slides them aside', () => {
    const r = render(view(['Sales', 'Ops']));
    glides.length = 0;
    r.rerender(view(['Sales', 'Design', 'Ops']));
    expect(glides).toContainEqual({ id: 'Ops', from: `translate(${-COL}px, 0px)` });
    expect(glides.map((g) => g.id)).not.toContain('Design');
  });

  it('control: unchanged categories glide nothing', () => {
    const r = render(view(['Sales', 'Ops']));
    glides.length = 0;
    r.rerender(view(['Sales', 'Ops']));
    expect(glides).toEqual([]);
  });
});
