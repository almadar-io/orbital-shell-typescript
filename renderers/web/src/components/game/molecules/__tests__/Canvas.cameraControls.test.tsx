/**
 * `camera.controls: false` holds the authored framing: a decorative 3D
 * backdrop (almadar.io's hero) must not zoom or orbit when the page scrolls
 * over it. The 3D host is lazy, so its module is replaced with a probe that
 * records the props Canvas hands it.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { Canvas3DHostProps } from '../../../../lib/drawable/three/Canvas3DHost';

const seen: Canvas3DHostProps[] = [];
vi.mock('../../../../lib/drawable/three', () => ({
  Canvas3DHost: (props: Canvas3DHostProps) => {
    seen.push(props);
    return null;
  },
}));

import { Canvas, to2DCamera } from '../Canvas';

describe('Canvas camera.controls', () => {
  it('false turns the 3D host\'s orbit controls off', async () => {
    seen.length = 0;
    render(<Canvas mode="3d" camera={{ mode: 'perspective', controls: false }} />);
    await waitFor(() => expect(seen.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(seen[seen.length - 1]?.controlsEnabled).toBe(false);
  });

  it('control: left out, the host keeps its default (controls on)', async () => {
    seen.length = 0;
    render(<Canvas mode="3d" camera={{ mode: 'perspective' }} />);
    await waitFor(() => expect(seen.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(seen[seen.length - 1]?.controlsEnabled).toBeUndefined();
  });

  it('false holds a 2D camera fixed; a follow camera still follows', () => {
    expect(to2DCamera('perspective', false)).toBe('fixed');
    expect(to2DCamera('perspective', undefined)).toBe('pan-zoom');
    expect(to2DCamera('follow', false)).toBe('follow');
  });
});
