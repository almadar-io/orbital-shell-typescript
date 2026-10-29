/**
 * `OrbPreview paused` stops the preview's client ticks and resumes them when cleared: the canvas card shows a
 * program paused until the person plays it (G-UI-108, the card's preview moved off the in-process server runtime).
 */
import { describe, expect, it } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';
import { TEST_TYPE_CONTRACT_VERSION } from '../../test-support/kernel-engine';

class ResizeObserverStub { observe(): void {} unobserve(): void {} disconnect(): void {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const show = ['render-ui', 'main', { type: 'typography', content: ['str/concat', 'n=', '@entity.n'] }];

function ticking(): OrbitalSchema {
  return JSON.parse(JSON.stringify({
    typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
    name: `paused-${Math.random()}`, version: '1.0.0',
    orbitals: [{
      name: 'Lab',
      entity: { name: 'Counter', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }, { name: 'n', type: 'number', default: 0 }] },
      traits: [{
        name: 'Clock', linkedEntity: 'Counter',
        stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [{ key: 'INIT', name: 'INIT' }], transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [show] }] },
        ticks: [{ name: 'count', interval: 30, effects: [['set', '@entity.n', ['+', '@entity.n', 1]], show] }],
      }],
      pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Clock' }] }],
    }],
  }));
}

const count = (): number => Number((screen.getByText(/^n=/).textContent ?? 'n=0').slice(2));
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe('OrbPreview paused', () => {
  it('runs no client tick while paused', async () => {
    render(<OrbPreview schema={ticking()} isolated paused />);
    await screen.findByText(/^n=/, {}, { timeout: 5_000 });
    await wait(300);
    expect(count()).toBe(0);
  });

  it('control: an unpaused preview ticks', async () => {
    render(<OrbPreview schema={ticking()} isolated />);
    await screen.findByText(/^n=[1-9]/, {}, { timeout: 5_000 });
  });

  it('edge: clearing paused resumes the ticks', async () => {
    const schema = ticking();
    const view = render(<OrbPreview schema={schema} isolated paused />);
    await screen.findByText(/^n=/, {}, { timeout: 5_000 });
    await wait(150);
    expect(count()).toBe(0);
    view.rerender(<OrbPreview schema={schema} isolated paused={false} />);
    await screen.findByText(/^n=[1-9]/, {}, { timeout: 5_000 });
  });
});
