import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import type { PatternConfig } from '@almadar/core';

const seen: { config?: PatternConfig<'canvas'> } = {};

vi.mock('../../../../lib/drawable/orbital/OrbitalSceneCanvas', () => ({
  OrbitalSceneCanvas: (props: { config: PatternConfig<'canvas'> }) => {
    seen.config = props.config;
    return null;
  },
}));

vi.mock('../../../../lib/drawable/orbital/OrbitalCanvas3D', () => ({
  OrbitalCanvas3D: () => null,
}));

import { Canvas } from '../Canvas';

afterEach(() => {
  seen.config = undefined;
});

describe('G-ORBITAL-SHELL-TYPESCRIPT-205 frame origins reach the orbital painter', () => {
  it('the origins table and the origins event are handed to the scene as the program declared them', () => {
    const origins = { card: { x: 100, y: 50 }, row: { x: 4, y: 4, origin: 'card' } };
    render(<Canvas painter="orbital" origins={origins} originsEvent="SURFACE_ORIGINS" />);
    expect(seen.config?.origins).toEqual(origins);
    expect(seen.config?.originsEvent).toBe('SURFACE_ORIGINS');
  });

  it('control: a canvas that declares no origins hands none on', () => {
    render(<Canvas painter="orbital" />);
    expect(seen.config?.origins).toBeUndefined();
    expect(seen.config?.originsEvent).toBeUndefined();
  });
});
