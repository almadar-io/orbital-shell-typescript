// @vitest-environment jsdom
/**
 * Which traits have rendered output on screen. A `[visible]` tick asks this
 * before firing; a trait nothing renders for is `absent` (its tick keeps running).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTraitPresence } from '../../core';

type Entry = { target: Element; isIntersecting: boolean };
let ioCallbacks: Array<(entries: Entry[]) => void> = [];
afterEach(() => { vi.unstubAllGlobals(); ioCallbacks = []; });

function stubIo(): Set<Element> {
  const observed = new Set<Element>();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: (entries: Entry[]) => void) { ioCallbacks.push(cb); }
    observe(el: Element) { observed.add(el); }
    unobserve(el: Element) { observed.delete(el); }
    disconnect() { observed.clear(); }
  });
  return observed;
}
const report = (el: Element, isIntersecting: boolean) => ioCallbacks.forEach((cb) => cb([{ target: el, isIntersecting }]));

function wrapper(...children: HTMLElement[]): HTMLElement {
  const w = document.createElement('div');
  w.style.display = 'contents';
  children.forEach((c) => w.appendChild(c));
  document.body.appendChild(w);
  return w;
}

describe('trait presence', () => {
  it('a trait with no rendered output is absent', () => {
    stubIo();
    expect(createTraitPresence().state(['Spin'])).toBe('absent');
  });

  it('rendered output in view is on screen; scrolled away it is off screen', () => {
    stubIo();
    const presence = createTraitPresence();
    const box = document.createElement('div');
    presence.attach('Spin', wrapper(box));
    report(box, true);
    expect(presence.state(['Spin'])).toBe('on-screen');
    report(box, false);
    expect(presence.state(['Spin'])).toBe('off-screen');
  });

  it('observes the boxes inside nested contents wrappers, not the wrappers', () => {
    const observed = stubIo();
    const presence = createTraitPresence();
    const inner = document.createElement('section');
    const nested = document.createElement('div');
    nested.style.display = 'contents';
    nested.appendChild(inner);
    const outer = wrapper(nested);
    presence.attach('Spin', outer);
    expect(observed.has(inner)).toBe(true);
    expect(observed.has(nested)).toBe(false);
  });

  it('a group is on screen when any member is', () => {
    stubIo();
    const presence = createTraitPresence();
    const a = document.createElement('div');
    const b = document.createElement('div');
    presence.attach('Canvas', wrapper(a));
    presence.attach('Hud', wrapper(b));
    report(a, false);
    report(b, true);
    expect(presence.state(['Art', 'Canvas', 'Hud'])).toBe('on-screen');
    report(b, false);
    expect(presence.state(['Art', 'Canvas', 'Hud'])).toBe('off-screen');
  });

  it('detaching the last output makes the trait absent again', () => {
    stubIo();
    const presence = createTraitPresence();
    const box = document.createElement('div');
    const detach = presence.attach('Spin', wrapper(box));
    report(box, false);
    detach();
    expect(presence.state(['Spin'])).toBe('absent');
  });

  it('a hidden tab is never on screen', () => {
    stubIo();
    const presence = createTraitPresence();
    const box = document.createElement('div');
    presence.attach('Spin', wrapper(box));
    report(box, true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    expect(presence.state(['Spin'])).toBe('off-screen');
  });

  it('watching is counted: a trait stays watched until every watcher lets go', () => {
    stubIo();
    const presence = createTraitPresence();
    const one = presence.watch(['Spin']);
    const two = presence.watch(['Spin']);
    one();
    expect(presence.isWatched('Spin')).toBe(true);
    two();
    expect(presence.isWatched('Spin')).toBe(false);
  });
});
