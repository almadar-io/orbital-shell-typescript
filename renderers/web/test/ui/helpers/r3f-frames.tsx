import React from 'react';
import { vi } from 'vitest';
import { act } from '@testing-library/react';
import * as THREE from 'three';
import { createRoot, advance, extend, useThree, type RootState, type ReconcilerRoot } from '@react-three/fiber';

const noop = (): void => undefined;

// r3f's own `three` can be a different module instance under vitest, so its catalogue is filled from the one the components use.
extend(THREE as never);

function fakeRenderer(canvas: HTMLCanvasElement) {
  return {
    domElement: canvas,
    xr: { enabled: false, addEventListener: noop, removeEventListener: noop },
    shadowMap: { enabled: false, type: 0 },
    outputColorSpace: 'srgb',
    toneMapping: 0,
    setPixelRatio: noop,
    setSize: noop,
    setClearAlpha: noop,
    setClearColor: noop,
    setAnimationLoop: noop,
    render: noop,
    dispose: noop,
    getContext: () => ({}),
    capabilities: {},
    info: { autoReset: true, reset: noop },
    compile: noop,
  };
}

export interface R3fHarness {
  root: ReconcilerRoot<HTMLCanvasElement>;
  state: () => RootState;
  frame: (deltaSeconds: number) => void;
  rerender: (tree: React.ReactNode) => Promise<void>;
  unmount: () => void;
}

export async function mountR3f(tree: React.ReactNode): Promise<R3fHarness> {
  const canvas = document.createElement('canvas');
  const root = createRoot(canvas);
  let latest: RootState | null = null;
  const Probe = (): null => {
    latest = useThree();
    return null;
  };
  await act(async () => {
    await root.configure({
      frameloop: 'never',
      size: { width: 100, height: 100, top: 0, left: 0 },
      gl: fakeRenderer(canvas) as never,
      dpr: 1,
    });
    root.render(
      <>
        <Probe />
        {tree}
      </>,
    );
  });
  let clock = 0;
  return {
    root,
    state: () => {
      if (!latest) throw new Error('the r3f root has not rendered');
      return latest;
    },
    frame: (deltaSeconds: number) => {
      clock += deltaSeconds;
      act(() => {
        advance(clock, true);
      });
    },
    rerender: async (next: React.ReactNode) => {
      await act(async () => {
        root.render(
          <>
            <Probe />
            {next}
          </>,
        );
      });
    },
    unmount: () => {
      act(() => root.unmount());
    },
  };
}

export function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    onchange: null,
    dispatchEvent: () => false,
  }));
}
