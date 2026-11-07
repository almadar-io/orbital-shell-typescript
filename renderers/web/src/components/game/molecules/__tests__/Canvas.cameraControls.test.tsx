/**
 * `camera.controls: false` holds the authored framing: a decorative 3D
 * backdrop (almadar.io's hero) must not zoom or orbit when the page scrolls
 * over it. The 3D canvas is replaced with a probe that records the props
 * Canvas hands it.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { OrbitalCanvas3DProps } from '../../../../lib/drawable/orbital/OrbitalCanvas3D';

const seen: OrbitalCanvas3DProps<'canvas'>[] = [];
vi.mock('../../../../lib/drawable/orbital/OrbitalCanvas3D', () => ({
  OrbitalCanvas3D: (props: OrbitalCanvas3DProps<'canvas'>) => {
    seen.push(props);
    return null;
  },
}));

import { Canvas, to2DCamera } from '../Canvas';

function lastCamera(): string {
  return JSON.stringify(seen[seen.length - 1]?.config.camera);
}

describe('Canvas camera.controls', () => {
  it('false reaches the 3D canvas config, which holds the framing', () => {
    seen.length = 0;
    render(<Canvas mode="3d" camera={{ mode: 'perspective', controls: false }} />);
    expect(seen.length).toBeGreaterThan(0);
    expect(lastCamera()).toBe(JSON.stringify({ mode: 'perspective', controls: false }));
  });

  it('control: left out, the config carries no controls (the canvas default, controls on)', () => {
    seen.length = 0;
    render(<Canvas mode="3d" camera={{ mode: 'perspective' }} />);
    expect(seen.length).toBeGreaterThan(0);
    expect(lastCamera()).toBe(JSON.stringify({ mode: 'perspective' }));
  });

  it('false holds a 2D camera fixed; a follow camera still follows', () => {
    expect(to2DCamera('perspective', false)).toBe('fixed');
    expect(to2DCamera('perspective', undefined)).toBe('pan-zoom');
    expect(to2DCamera('follow', false)).toBe('follow');
  });

  it('G-ORBITAL-SHELL-TYPESCRIPT-060: a 3D canvas is a named image carrying the authored aria-label, layout-neutral', () => {
    seen.length = 0;
    const { container } = render(<Canvas mode="3d" aria-label="Battle board" />);
    const img = container.querySelector('[role="img"]');
    expect(img?.getAttribute('aria-label')).toBe('Battle board');
    expect(img?.className).toBe('contents');
  });

  it('G-ORBITAL-SHELL-TYPESCRIPT-060 control: without an authored label it keeps the 2D default name', () => {
    seen.length = 0;
    const { container } = render(<Canvas mode="3d" />);
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Game scene');
  });
});
