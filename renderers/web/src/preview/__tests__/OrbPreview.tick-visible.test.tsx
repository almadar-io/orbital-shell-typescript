/**
 * The catalog path (OrbPreview): a `[visible]` tick pauses while its trait's output is off screen.
 * The second case is the game's shape: a writer trait that renders nothing ticks a `[shared]`
 * entity another trait renders, so it follows that trait's output.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import type { OrbitalSchema, TypedEffect } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';
import { TEST_TYPE_CONTRACT_VERSION } from '../../test-support/kernel-engine';

class ResizeObserverStub { observe(): void {} unobserve(): void {} disconnect(): void {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

type Entry = { target: Element; isIntersecting: boolean };
const observers: Array<{ cb: (e: Entry[]) => void; targets: Set<Element> }> = [];
let onScreen = true;
function stubIo(): void {
  vi.stubGlobal('IntersectionObserver', class {
    private readonly entry: { cb: (e: Entry[]) => void; targets: Set<Element> };
    constructor(cb: (e: Entry[]) => void) { this.entry = { cb, targets: new Set() }; observers.push(this.entry); }
    observe(el: Element) { this.entry.targets.add(el); this.entry.cb([{ target: el, isIntersecting: onScreen }]); }
    unobserve(el: Element) { this.entry.targets.delete(el); }
    disconnect() { this.entry.targets.clear(); }
  });
}
const setOnScreen = (v: boolean) => act(() => { onScreen = v; for (const o of observers) o.cb([...o.targets].map((target) => ({ target, isIntersecting: v }))); });
// The page keeps one presence observer across tests, so the stubs' observers outlive a test too.
afterEach(() => { vi.unstubAllGlobals(); onScreen = true; });

const show: TypedEffect = ['render-ui', 'main', { type: 'typography', content: ['str/concat', 'n=', '@entity.n'] }];

function ownTick(): OrbitalSchema {
  return {
    typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
    name: `own-${Math.random()}`, version: '1.0.0',
    orbitals: [{
      name: 'Lab',
      entity: { name: 'Counter', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }, { name: 'n', type: 'number', default: 0 }] },
      traits: [{
        name: 'Clock', linkedEntity: 'Counter',
        stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [{ key: 'INIT', name: 'INIT' }], transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [show] }] },
        ticks: [{ name: 'count', interval: 30, whileVisible: true, effects: [['set', '@entity.n', ['+', '@entity.n', 1]], show] }],
      }],
      pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Clock' }] }],
    }],
  };
}

function sharedWriter(): OrbitalSchema {
  return {
    typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
    name: `shared-${Math.random()}`, version: '1.0.0',
    orbitals: [{
      name: 'Lab',
      entity: { name: 'Board', persistence: 'runtime', shared: true, fields: [{ name: 'id', type: 'string' }, { name: 'n', type: 'number', default: 0 }] },
      traits: [
        {
          name: 'View', linkedEntity: 'Board',
          stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [{ key: 'INIT', name: 'INIT' }], transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [show] }] },
          ticks: [{ name: 'paint', interval: 'frame', effects: [show] }],
        },
        {
          name: 'Art', linkedEntity: 'Board',
          stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [{ key: 'INIT', name: 'INIT' }], transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [] }] },
          ticks: [{ name: 'animTick', interval: 30, whileVisible: true, effects: [['set', '@entity.n', ['+', '@entity.n', 1]]] }],
        },
      ],
      pages: [{ name: 'Home', path: '/', traits: [{ ref: 'View' }, { ref: 'Art' }] }],
    }],
  };
}

const count = (): number => Number((screen.getByText(/^n=/).textContent ?? 'n=0').slice(2));
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe('OrbPreview: [visible] ticks follow their output on screen', () => {
  for (const [label, schema] of [['its own output', ownTick], ['a shared writer follows the trait rendering its entity', sharedWriter]] as const) {
    it(label, async () => {
      stubIo();
      render(<OrbPreview schema={schema()} isolated />);
      await screen.findByText(/^n=[1-9]/, {}, { timeout: 5_000 });
      expect(document.querySelector('[data-trait-presence]')).not.toBeNull();
      setOnScreen(false);
      await wait(100);
      const paused = count();
      await wait(300);
      expect(count()).toBe(paused);
      setOnScreen(true);
      await wait(300);
      expect(count()).toBeGreaterThan(paused);
    }, 20_000);
  }
});
