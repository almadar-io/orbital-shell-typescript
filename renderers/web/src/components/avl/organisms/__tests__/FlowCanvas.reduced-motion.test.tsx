import React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';

const fitView = vi.fn();
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    useReactFlow: () => ({ ...actual.useReactFlow(), fitView }),
  };
});

import { FlowCanvas } from '../FlowCanvas';

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  fitView.mockClear();
  vi.unstubAllGlobals();
});

const schema: OrbitalSchema = {
  name: 'FixtureApp',
  orbitals: [
    {
      name: 'TaskBoard',
      entity: { name: 'Task', fields: [{ name: 'title', type: 'string', required: true }] },
      pages: [{ name: 'TasksPage', path: '/tasks' }],
      traits: [
        {
          name: 'TaskList',
          scope: 'collection',
          linkedEntity: 'Task',
          stateMachine: {
            states: [{ name: 'idle', isInitial: true }, { name: 'loaded' }],
            events: [{ key: 'LOAD', name: 'Load' }],
            transitions: [{ from: 'idle', to: 'loaded', event: 'LOAD', effects: [['render-ui', 'main', { type: 'badge' }]] }],
          },
        },
      ],
    },
  ],
};

function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
}

async function pickSize() {
  render(<FlowCanvas schema={schema} initialOrbital="TaskBoard" />);
  const btn = screen.getAllByRole('button').find((b) => b.getAttribute('aria-pressed') === 'false' && /view/i.test(b.getAttribute('aria-label') ?? ''));
  expect(btn).toBeDefined();
  fireEvent.click(btn as HTMLElement);
  await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
}

describe('FlowCanvas camera motion', () => {
  it('control: eases the camera when motion is allowed', async () => {
    stubMatchMedia(false);
    await pickSize();
    expect(fitView).toHaveBeenCalledWith(expect.objectContaining({ duration: 300 }));
  });

  it('jumps the camera under prefers-reduced-motion', async () => {
    stubMatchMedia(true);
    await pickSize();
    expect(fitView).toHaveBeenCalledWith(expect.objectContaining({ duration: 0 }));
    expect(fitView).not.toHaveBeenCalledWith(expect.objectContaining({ duration: 300 }));
  });
});
