/**
 * `animateChanges`: what appears or changes inside the box eases in instead of
 * switching in one frame. The almadar.io demos (a step card, a new post, a new
 * log line, a changed count) all switched instantly. Rows that glide or have
 * their own entrance are left to that mechanism.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { Box } from '../../index';
import { EventBusProvider } from '../../index';

const animated: string[] = [];
beforeEach(() => {
  animated.length = 0;
  document.documentElement.style.setProperty('--duration-normal', '250ms');
  document.documentElement.style.setProperty('--easing-emphasized', 'cubic-bezier(0.2, 0, 0, 1)');
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value(this: Element) {
      animated.push(this.hasAttribute('data-change-ghost') ? `ghost:${this.textContent ?? ''}` : this.getAttribute('data-name') ?? this.tagName);
    },
  });
});
afterEach(() => { document.documentElement.style.removeProperty('--duration-normal'); });

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

function View({ on, items, label }: { on: boolean; items: string[]; label: string }) {
  return (
    <EventBusProvider debug={false}>
      <Box animateChanges={on}>
        <span data-name="label">{label}</span>
        {items.map((i) => <div key={i} data-name={i}>{i}</div>)}
        {items.includes('glider') ? <div data-name="row" data-item-move="s" data-entity-id="r1">row</div> : null}
      </Box>
    </EventBusProvider>
  );
}

describe('Box animateChanges', () => {
  it('a newly added child eases in', async () => {
    const view = render(<View on items={['a']} label="x" />);
    await flush(); animated.length = 0;
    view.rerender(<View on items={['a', 'b']} label="x" />);
    await flush();
    expect(animated).toContain('b');
    expect(animated).not.toContain('a');
  });

  it('text that changes in place eases in on its element', async () => {
    const view = render(<View on items={[]} label="Submitted" />);
    await flush(); animated.length = 0;
    view.rerender(<View on items={[]} label="Approved" />);
    await flush();
    expect(animated).toContain('label');
  });

  it('changed text rolls: the old text leaves in a ghost while the new text arrives', async () => {
    const view = render(<View on items={[]} label="Submitted" />);
    await flush(); animated.length = 0;
    view.rerender(<View on items={[]} label="Approved" />);
    await flush();
    expect(animated).toContain('ghost:Submitted');
    expect(animated).toContain('label');
    // No animation runs in jsdom, so the ghost is removed at once.
    expect(document.querySelector('[data-change-ghost]')).toBeNull();
  });

  it('control: a change inside mixed content only fades the element', async () => {
    const Mixed = ({ n }: { n: string }) => (
      <EventBusProvider debug={false}>
        <Box animateChanges><span data-name="mixed"><b>Total</b> {n}</span></Box>
      </EventBusProvider>
    );
    const view = render(<Mixed n="1" />);
    await flush(); animated.length = 0;
    view.rerender(<Mixed n="2" />);
    await flush();
    expect(animated.some((a) => a.startsWith('ghost:'))).toBe(false);
    expect(animated).toContain('mixed');
  });

  it('control: a row that glides is left to its own motion', async () => {
    const view = render(<View on items={[]} label="x" />);
    await flush(); animated.length = 0;
    view.rerender(<View on items={['glider']} label="x" />);
    await flush();
    expect(animated).not.toContain('row');
  });

  it('an added display:contents wrapper eases in through the boxes it holds', async () => {
    const Wrapped = ({ show }: { show: boolean }) => (
      <EventBusProvider debug={false}>
        <Box animateChanges>
          {show ? <div data-name="wrapper" style={{ display: 'contents' }}><div data-name="inner">x</div></div> : null}
        </Box>
      </EventBusProvider>
    );
    const view = render(<Wrapped show={false} />);
    await flush(); animated.length = 0;
    view.rerender(<Wrapped show />);
    await flush();
    expect(animated).toEqual(['inner']);
  });

  it('a box that animates its changes plays them in presentation motion', () => {
    const view = render(<View on items={[]} label="x" />);
    expect(view.container.querySelector('[data-motion="presentation"]')).not.toBeNull();
  });

  it('control: off by default', async () => {
    const view = render(<View on={false} items={['a']} label="x" />);
    await flush(); animated.length = 0;
    view.rerender(<View on={false} items={['a', 'b']} label="y" />);
    await flush();
    expect(animated).toEqual([]);
  });
});
