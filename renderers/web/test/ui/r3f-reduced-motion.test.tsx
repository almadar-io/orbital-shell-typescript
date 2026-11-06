/**
 * G-ORBITAL-SHELL-TYPESCRIPT-051: every r3f `useFrame` loop that moves something on its own
 * must stand still (or snap) when the user asks for reduced motion. Each case runs the same scene
 * with motion allowed (the control proves the loop moves) and with reduced motion.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import * as THREE from 'three';
import { act } from '@testing-library/react';
import { FollowCamera3D } from '../../src/lib/drawable/three/GameCamera3D';
import { Drawable3D } from '../../src/lib/drawable/three/Drawable3D';
import { ModelLoader } from '../../src/lib/drawable/three/ModelLoader';
import { create3DProjector } from '../../src/lib/drawable/projector3d';
import { mountR3f, stubReducedMotion } from './helpers/r3f-frames';

vi.mock('@react-three/drei', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }): React.JSX.Element => <>{children}</>;
  const nothing = (): null => null;
  return { Html: nothing, Text: nothing, Billboard: passthrough, OrbitControls: nothing, RoundedBox: passthrough, Line: passthrough };
});

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', async () => {
  const three = await import('three');
  class GLTFLoader {
    setResourcePath(): this {
      return this;
    }
    load(_url: string, onLoad: (gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }) => void): void {
      const scene = new three.Group();
      scene.name = 'Walk';
      queueMicrotask(() => onLoad({ scene, animations: [new three.AnimationClip('Walk', 1, [new three.NumberKeyframeTrack('.position[x]', [0, 1], [0, 1])])] }));
    }
  }
  return { GLTFLoader };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FollowCamera3D', () => {
  async function cameraX(reduce: boolean): Promise<number> {
    stubReducedMotion(reduce);
    const h = await mountR3f(<FollowCamera3D target={[10, 0, 0]} offset={[0, 0, 0]} />);
    h.state().camera.position.set(0, 0, 0);
    h.frame(0.016);
    const x = h.state().camera.position.x;
    h.unmount();
    return x;
  }
  it('tweens toward the target when motion is allowed', async () => {
    const x = await cameraX(false);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(10);
  });
  it('lands on the target in one frame under reduced motion', async () => {
    expect(await cameraX(true)).toBeCloseTo(10, 5);
  });
});

describe('ModelLoader clip playback', () => {
  async function mixerDeltas(reduce: boolean): Promise<number[]> {
    stubReducedMotion(reduce);
    const update = vi.spyOn(THREE.AnimationMixer.prototype, 'update');
    const h = await mountR3f(<ModelLoader url="/walk.glb" animation="Walk" />);
    await act(async () => {
      await Promise.resolve();
    });
    h.frame(0.016);
    h.frame(0.016);
    h.unmount();
    return update.mock.calls.map((c) => c[0]);
  }
  it('advances the mixer when motion is allowed', async () => {
    expect((await mixerDeltas(false)).some((d) => d > 0)).toBe(true);
  });
  it('never advances the mixer under reduced motion', async () => {
    expect((await mixerDeltas(true)).every((d) => d === 0)).toBe(true);
  });
});

describe('animated drawables', () => {
  const projector = create3DProjector({ cellSize: 1 });
  const keyframes = [{ at: 0, offsetX: 0 }, { at: 1, offsetX: 4 }];
  const animation = { durationMs: 1000, keyframes };

  async function sceneX(node: React.ComponentProps<typeof Drawable3D>['node'], reduce: boolean): Promise<number> {
    stubReducedMotion(reduce);
    const h = await mountR3f(<Drawable3D node={node} projector={projector} />);
    h.frame(0.5);
    const group = h.state().scene.children[0];
    const x = group.position.x;
    h.unmount();
    return x;
  }

  const groupNode = { type: 'draw-group', position: { x: 0, y: 0 }, items: [], animation } as unknown as React.ComponentProps<typeof Drawable3D>['node'];
  const meshNode = { type: 'draw-mesh', shape: 'box', position: { x: 0, y: 0 }, animation } as unknown as React.ComponentProps<typeof Drawable3D>['node'];
  const shapeNode = { type: 'draw-shape', shape: 'cell', position: { x: 0, y: 0 }, fill: '#fff', animation } as unknown as React.ComponentProps<typeof Drawable3D>['node'];

  for (const [name, node] of [['draw-group', groupNode], ['draw-mesh', meshNode], ['draw-shape', shapeNode]] as const) {
    it(`${name} plays its track when motion is allowed`, async () => {
      expect(await sceneX(node, false)).toBeGreaterThan(0.5);
    });
    it(`${name} holds its rest pose under reduced motion`, async () => {
      expect(await sceneX(node, true)).toBeCloseTo(0, 5);
    });
  }
});
