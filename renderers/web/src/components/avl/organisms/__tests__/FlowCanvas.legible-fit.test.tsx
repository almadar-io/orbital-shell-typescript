// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { FlowCanvas } from '../FlowCanvas';
import { EventBusProvider } from '../../../../core';
import { LEGIBLE_FIT_ZOOM } from '../../../../lib/avl-legible-fit';

const FRAME = { width: 800, height: 600 };

beforeAll(() => {
  // jsdom lays nothing out: give every node a chip's size and the canvas a frame, and report sizes as soon as they are observed.
  class ResizeObserverNow {
    private readonly notify: ResizeObserverCallback;
    constructor(notify: ResizeObserverCallback) { this.notify = notify; }
    observe(target: Element) { queueMicrotask(() => this.notify([{ target } as ResizeObserverEntry], this)); }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverNow);
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return (this as HTMLElement).classList.contains('react-flow__node') ? 280 : FRAME.width; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return (this as HTMLElement).classList.contains('react-flow__node') ? 100 : FRAME.height; } });
  Element.prototype.getBoundingClientRect = () => new DOMRect(0, 0, FRAME.width, FRAME.height);
  // React Flow reads the current zoom off the viewport's transform.
  class Matrix {
    readonly m22: number;
    constructor(transform?: string) { this.m22 = Number(/scale\(([\d.]+)\)/.exec(transform ?? '')?.[1] ?? 1); }
  }
  vi.stubGlobal('DOMMatrixReadOnly', Matrix);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
});

const orbital = (index: number): OrbitalSchema['orbitals'][number] => ({
  name: `Orbital${index}`,
  entity: { name: `Entity${index}`, fields: [{ name: 'title', type: 'string', default: '' }] },
  pages: [{ name: `Page${index}`, path: `/p${index}`, traits: [{ ref: `Trait${index}` }] }],
  traits: [
    {
      name: `Trait${index}`,
      linkedEntity: `Entity${index}`,
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [{ key: 'INIT', name: 'Init' }],
        transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content: `P${index}` }]] }],
      },
    },
  ],
});

const program = (count: number): OrbitalSchema => ({ name: 'Big', orbitals: Array.from({ length: count }, (_, index) => orbital(index)) });

const scaleOf = (container: HTMLElement): number => {
  const match = /scale\(([\d.]+)\)/.exec(container.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform ?? '');
  return match ? Number(match[1]) : NaN;
};

const renderProgram = (count: number) =>
  render(<EventBusProvider debug={false}><FlowCanvas schema={program(count)} initialLevel="system" width={FRAME.width} height={FRAME.height} /></EventBusProvider>);

describe('FlowCanvas opens a large program at a readable scale', () => {
  it('a 300-orbital system map settles at the readable floor, not at the zoom range minimum', async () => {
    const { container } = renderProgram(300);
    await waitFor(() => expect(container.querySelectorAll('.react-flow__node').length).toBeGreaterThan(300));
    await waitFor(() => expect(scaleOf(container)).toBe(LEGIBLE_FIT_ZOOM));
  });

  it('control: a small program is still fitted whole, above the floor', async () => {
    const { container } = renderProgram(4);
    await waitFor(() => expect(container.querySelectorAll('.react-flow__node').length).toBeGreaterThan(4));
    await waitFor(() => expect(scaleOf(container)).toBeGreaterThan(LEGIBLE_FIT_ZOOM));
  });
});
