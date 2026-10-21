/**
 * A row that moves glides from where it was to where it is now — within a
 * list, and between the lists one DataGrid renders (a board's columns). The
 * almadar.io board demo moved cards by unmounting them in one column and
 * mounting them in another, so a "move" read as a card vanishing and another
 * rising. jsdom lays nothing out, so each row's box is derived from its column
 * and its place in it, and `Element.animate` is recorded.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import type { EntityRow } from '@almadar/core';
import { DataGrid } from '../DataGrid';
import { DataList } from '../DataList';
import { EventBusProvider } from '../../../../core';

type Glide = { id: string; from: string };
const glides: Glide[] = [];
const cancels: string[] = [];
/** The eased progress every recorded glide reports, as a running animation would. */
let progress = 0;
const durations: number[] = [];
const COL_WIDTH = 300;
const ROW_HEIGHT = 100;
let pageShift = 0;
/** The on-screen scale of a frame the board sits in (a demo rendered at desktop size, scaled to fit). */
let frameScale = 1;
/** A row's laid-out height by id (default 80). */
const heights = new Map<string, number>();
const heightGlides: Array<{ id: string; from: string; to: string }> = [];

function boxOf(el: Element): DOMRect {
  const r = layoutBoxOf(el);
  return new DOMRect(r.x * frameScale, r.y * frameScale, r.width * frameScale, r.height * frameScale);
}

function layoutBoxOf(el: Element): DOMRect {
  if (el.hasAttribute('data-item-move-root')) return new DOMRect(0, pageShift, 1000, 1000);
  const row = el.closest('[data-item-key]');
  const col = el.closest('[data-col]');
  // A board column (the grid's own item) holds the [data-col] list inside it.
  if (row === el && col === null && el.querySelector('[data-col]') !== null) {
    const id = el.getAttribute('data-item-key') ?? '';
    return new DOMRect(Number(el.querySelector('[data-col]')?.getAttribute('data-col')) * COL_WIDTH, pageShift, 200, heights.get(id) ?? 400);
  }
  if (row === null || col === null || row !== el) return new DOMRect(0, 0, 0, 0);
  const siblings = [...(row.parentElement?.children ?? [])].filter((c) => c.hasAttribute('data-item-key'));
  const id = row.getAttribute('data-item-key') ?? '';
  return new DOMRect(Number(col.getAttribute('data-col')) * COL_WIDTH, pageShift + siblings.indexOf(row) * ROW_HEIGHT, 200, heights.get(id) ?? 80);
}

beforeEach(() => {
  glides.length = 0;
  cancels.length = 0;
  heights.clear();
  frameScale = 1;
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) { return this.hasAttribute('data-item-move-root') ? 1000 : 0; },
  });
  heightGlides.length = 0;
  progress = 0;
  pageShift = 0;
  document.documentElement.style.setProperty('--duration-slow', '400ms');
  document.documentElement.style.setProperty('--easing-emphasized', 'cubic-bezier(0.2, 0, 0, 1)');
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) { return boxOf(this); });
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value(this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
      const id = this.getAttribute('data-item-key') ?? '';
      if (frames[0]?.height !== undefined) {
        heightGlides.push({ id, from: String(frames[0].height), to: String(frames[1]?.height) });
        return { playState: 'running', currentTime: 0, effect: { getComputedTiming: () => ({ progress }) }, cancel: () => undefined };
      }
      durations.push(Number(options.duration));
      glides.push({ id, from: String(frames[0]?.transform ?? '') });
      const glide = {
        playState: 'running',
        effect: { getComputedTiming: () => ({ progress }) },
        cancel: () => { glide.playState = 'idle'; cancels.push(id); },
      };
      return glide;
    },
  });
});
afterEach(() => vi.restoreAllMocks());

const card = (id: string): EntityRow => ({ id, title: id });
const board = (todo: EntityRow[], done: EntityRow[]) => (
  <EventBusProvider debug={false}>
    <DataGrid
      entity={[{ id: 'todo', col: 0, items: todo }, { id: 'done', col: 1, items: done }]}
      renderItem={(col) => (
        <div data-col={String(col.col)}>
          <DataList entity={col.items as EntityRow[]} itemEnter="rise" renderItem={(item) => <span>{String(item.title)}</span>} />
        </div>
      )}
    />
  </EventBusProvider>
);

describe('itemEnter: a moved row glides from its old place', () => {
  it('a card moved to another column of the same grid glides across', () => {
    const view = render(board([card('a'), card('b')], []));
    glides.length = 0;
    view.rerender(board([card('b')], [card('a')]));
    expect(glides).toContainEqual({ id: 'a', from: `translate(${-COL_WIDTH}px, 0px)` });
  });

  it('the card that slides up into the freed place glides too', () => {
    const view = render(board([card('a'), card('b')], []));
    glides.length = 0;
    view.rerender(board([card('b')], [card('a')]));
    expect(glides).toContainEqual({ id: 'b', from: `translate(0px, ${ROW_HEIGHT}px)` });
  });

  it('control: a re-render that moves nothing animates nothing', () => {
    const view = render(board([card('a'), card('b')], []));
    glides.length = 0;
    view.rerender(board([card('a'), card('b')], []));
    expect(glides).toEqual([]);
  });

  it('control: with the theme\'s motion off, nothing glides', () => {
    document.documentElement.style.setProperty('--duration-slow', '');
    const view = render(board([card('a'), card('b')], []));
    glides.length = 0;
    view.rerender(board([card('b')], [card('a')]));
    expect(glides).toEqual([]);
  });

  it('a grid\'s own cards glide when they reorder', () => {
    const grid = (ids: string[]) => (
      <EventBusProvider debug={false}>
        <div data-col="0"><DataGrid entity={ids.map(card)} itemEnter="fade" renderItem={(item) => <span>{String(item.title)}</span>} /></div>
      </EventBusProvider>
    );
    const view = render(grid(['a', 'b']));
    glides.length = 0;
    view.rerender(grid(['b', 'a']));
    expect(glides.map((g) => g.id).sort()).toEqual(['a', 'b']);
  });

  it('a duration token in seconds is read as seconds', () => {
    document.documentElement.style.setProperty('--duration-slow', '.4s');
    const view = render(board([card('a'), card('b')], []));
    glides.length = 0;
    view.rerender(board([card('b')], [card('a')]));
    expect(durations).toContain(400);
  });

  it('control: the whole board shifting on the page (a caption above it grew) moves nothing', () => {
    const view = render(board([card('a'), card('b')], []));
    glides.length = 0;
    pageShift = 12;
    view.rerender(board([card('a'), card('b')], []));
    expect(glides).toEqual([]);
  });

  it('a re-render while a glide plays, with nothing moved, lets the glide finish', () => {
    const view = render(board([card('a'), card('b')], []));
    view.rerender(board([card('b')], [card('a')]));
    progress = 0.3;
    glides.length = 0;
    view.rerender(board([card('b')], [card('a')]));
    expect(cancels).toEqual([]);
    expect(glides).toEqual([]);
  });

  it('a card sent elsewhere mid-glide glides on from where it is on screen', () => {
    const view = render(board([card('a'), card('b')], []));
    view.rerender(board([card('b')], [card('a')]));
    progress = 0.5;
    glides.length = 0;
    view.rerender(board([card('a'), card('b')], []));
    expect(glides).toContainEqual({ id: 'a', from: `translate(${COL_WIDTH / 2}px, 0px)` });
  });

  it('control: a finished glide leaves the next move to start from the resting place', () => {
    const view = render(board([card('a'), card('b')], []));
    view.rerender(board([card('b')], [card('a')]));
    progress = 1;
    glides.length = 0;
    view.rerender(board([card('a'), card('b')], []));
    expect(glides).toContainEqual({ id: 'a', from: `translate(${COL_WIDTH}px, 0px)` });
  });

  it('a row whose own height changes eases to its new height', () => {
    const view = render(board([card('a'), card('b')], []));
    heights.set('b', 140);
    view.rerender(board([card('a'), card('b')], []));
    // Every list under one scope runs the pass; a second pass resumes the same ease.
    expect(new Set(heightGlides.map((g) => `${g.id}:${g.from}->${g.to}`))).toEqual(new Set(['b:80px->140px']));
  });

  it('a board column whose cards change eases its own height', () => {
    const view = render(board([card('a'), card('b')], []));
    heights.set('todo', 250);
    view.rerender(board([card('b')], [card('a')]));
    expect(new Set(heightGlides.map((g) => `${g.id}:${g.from}->${g.to}`))).toContain('todo:400px->250px');
  });

  it('inside a frame scaled to half size a card still glides the full distance in its own pixels', () => {
    frameScale = 0.5;
    const view = render(board([card('a'), card('b')], []));
    glides.length = 0;
    view.rerender(board([card('b')], [card('a')]));
    expect(glides).toContainEqual({ id: 'a', from: `translate(${-COL_WIDTH}px, 0px)` });
  });

  it('control: a row that keeps its height eases nothing', () => {
    const view = render(board([card('a'), card('b')], []));
    view.rerender(board([card('a'), card('b')], []));
    expect(heightGlides).toEqual([]);
  });

  it('control: a brand-new row plays its entrance, not a glide', () => {
    const view = render(board([card('a')], []));
    glides.length = 0;
    view.rerender(board([card('a'), card('n')], []));
    expect(glides.map((g) => g.id)).not.toContain('n');
  });
});
