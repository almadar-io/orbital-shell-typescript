/**
 * The written document is the page before it boots: the laid-out text, never the ready mark. It is taken from a
 * detached copy, so the live page (where the canvas keeps the mark) cannot put it back before it is serialized.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readySnapshot } from './prerender-lib.mjs';

class El {
  constructor(tag, attrs = {}, children = [], text = '') {
    Object.assign(this, { tag, attrs: { ...attrs }, children, text });
  }
  cloneNode() {
    return new El(this.tag, this.attrs, this.children.map((c) => c.cloneNode()), this.text);
  }
  querySelectorAll(selector) {
    const name = selector.slice(1, -1);
    const all = this.children.flatMap((c) => [c, ...c.querySelectorAll(selector)]);
    return all.filter((e) => name in e.attrs);
  }
  removeAttribute(name) {
    delete this.attrs[name];
  }
  setAttribute(name, value) {
    this.attrs[name] = value;
  }
  querySelector(selector) {
    const id = selector.slice(1);
    return this.children.flatMap((c) => [c, ...c.querySelectorAllNodes()]).find((e) => e.attrs.id === id) ?? null;
  }
  querySelectorAllNodes() {
    return this.children.flatMap((c) => [c, ...c.querySelectorAllNodes()]);
  }
  get outerHTML() {
    const attrs = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
    return `<${this.tag}${attrs}>${this.text}${this.children.map((c) => c.outerHTML).join('')}</${this.tag}>`;
  }
}

function page(portal = true) {
  const canvas = new El('div', { class: 'orbital-scene-canvas', 'data-orb-ready': 'true' }, [new El('h1', {}, [], 'Every program')]);
  const body = [new El('div', { 'data-orb-mounted': '/' }, [canvas]), ...(portal ? [new El('div', { id: 'ui-slot-portal-root' }, [new El('div', { id: 'slot-center' })])] : [])];
  globalThis.document = { documentElement: new El('html', {}, [new El('body', {}, body)]) };
  return canvas;
}

afterEach(() => {
  delete globalThis.document;
});

describe('readySnapshot', () => {
  it('serializes the page without any ready mark, its text kept', () => {
    page();
    const html = readySnapshot();
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<h1>Every program</h1>');
    expect(html).not.toContain('data-orb-ready');
    expect(html).not.toContain('data-orb-mounted');
  });

  it('control: the live page keeps its ready mark', () => {
    const canvas = page();
    readySnapshot();
    expect(canvas.attrs['data-orb-ready']).toBe('true');
  });

  it('marks the prerendered portal root, so the booting shell replaces its content instead of adding beside it', () => {
    page();
    expect(readySnapshot()).toContain('<div id="ui-slot-portal-root" data-orb-prerendered="">');
  });

  it('control: a page with no portal root is written without the mark', () => {
    page(false);
    expect(readySnapshot()).not.toContain('data-orb-prerendered');
  });
});
