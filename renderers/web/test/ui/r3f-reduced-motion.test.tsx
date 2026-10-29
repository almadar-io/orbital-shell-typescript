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
import { Camera3D } from '../../src/lib/drawable/three/Camera3D';
import { Drawable3D } from '../../src/lib/drawable/three/Drawable3D';
import { ModelLoader } from '../../src/lib/drawable/three/ModelLoader';
import { create3DProjector } from '../../src/lib/drawable/projector3d';
import { Avl3DContext } from '../../src/providers/avl-3d-context';
import { AVL_3D_COLORS } from '../../src/lib/avl-3d-layout';
import { Avl3DOrbitalNode } from '../../src/components/avl/molecules/Avl3DOrbitalNode';
import { Avl3DEntityCore } from '../../src/components/avl/molecules/Avl3DEntityCore';
import { Avl3DStateNode } from '../../src/components/avl/molecules/Avl3DStateNode';
import { Avl3DApplicationScene } from '../../src/components/avl/organisms/Avl3DApplicationScene';
import { TraitOrbit } from '../../src/components/avl/organisms/Avl3DOrbitalScene';
import { CameraController, SceneFade } from '../../src/components/avl/organisms/Avl3DViewer';
import { mountR3f, stubReducedMotion } from './helpers/r3f-frames';

const orbitControls = vi.hoisted(() => ({ props: [] as Array<{ enableDamping?: boolean }> }));

vi.mock('@react-three/drei', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }): React.JSX.Element => <>{children}</>;
  const nothing = (): null => null;
  return { Html: nothing, Text: nothing, Billboard: passthrough, OrbitControls: (props: { enableDamping?: boolean }): null => {
      orbitControls.props.push(props);
      return null;
    }, RoundedBox: passthrough, Line: passthrough };
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

const palette = { ...AVL_3D_COLORS };
const withPalette = (child: React.ReactNode): React.JSX.Element => (
  <Avl3DContext.Provider value={{ modelOverrides: {}, effectsEnabled: false, palette }}>{child}</Avl3DContext.Provider>
);

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

describe('Avl3D scene loops', () => {
  async function rotationOf(tree: React.ReactNode, reduce: boolean): Promise<number> {
    stubReducedMotion(reduce);
    const h = await mountR3f(withPalette(tree));
    const total = (): number => {
      let v = 0;
      h.state().scene.traverse((o) => {
        v += Math.abs(o.rotation.y);
      });
      return v;
    };
    const before = total();
    h.frame(1);
    const moved = total() - before;
    h.unmount();
    return moved;
  }
  it('the entity core spins when motion is allowed and holds still otherwise', async () => {
    const tree = <Avl3DEntityCore name="E" fieldCount={2} persistence="persistent" position={[0, 0, 0]} />;
    expect(await rotationOf(tree, false)).toBeGreaterThan(0);
    expect(await rotationOf(tree, true)).toBe(0);
  });
  it('the orbital node rotates when motion is allowed and holds still otherwise', async () => {
    const tree = <Avl3DOrbitalNode name="O" entityName="E" traitCount={1} position={[0, 0, 0]} />;
    expect(await rotationOf(tree, false)).toBeGreaterThan(0);
    expect(await rotationOf(tree, true)).toBe(0);
  });
  it('the application scene drifts when motion is allowed and holds still otherwise', async () => {
    const tree = <Avl3DApplicationScene data={{ orbitals: [], crossLinks: [] } as never} />;
    expect(await rotationOf(tree, false)).toBeGreaterThan(0);
    expect(await rotationOf(tree, true)).toBe(0);
  });
  it('a trait marker orbits when motion is allowed and holds its place otherwise', async () => {
    async function markerPosition(reduce: boolean): Promise<THREE.Vector3> {
      stubReducedMotion(reduce);
      const random = vi.spyOn(Math, 'random').mockReturnValue(0);
      const h = await mountR3f(withPalette(<TraitOrbit name="T" radius={3} tilt={0} speed={1} highlighted={false} dimmed={false} />));
      random.mockRestore();
      h.frame(1);
      const marker = h.state().scene.children.find((c) => c instanceof THREE.Group)?.children.find((c) => c instanceof THREE.Group);
      if (!marker) throw new Error('no marker');
      const p = marker.position.clone();
      h.unmount();
      return p;
    }
    expect((await markerPosition(false)).x).toBeLessThan(2.9);
    expect((await markerPosition(true)).x).toBeCloseTo(3, 5);
  });
  it('a state node reaches its hover scale only by tween unless motion is reduced', async () => {
    const calls: number[] = [];
    const spy = vi.spyOn(THREE.MathUtils, 'damp').mockImplementation((x, y, _l, dt) => {
      calls.push(dt);
      return x + (y - x) * 0.1;
    });
    stubReducedMotion(false);
    const h = await mountR3f(withPalette(<Avl3DStateNode name="S" position={[0, 0, 0]} />));
    h.frame(0.016);
    h.unmount();
    const allowed = calls.length;
    spy.mockClear();
    calls.length = 0;
    stubReducedMotion(true);
    const r = await mountR3f(withPalette(<Avl3DStateNode name="S" position={[0, 0, 0]} />));
    r.frame(0.016);
    r.unmount();
    expect(allowed).toBeGreaterThan(0);
    expect(calls.length).toBe(0);
  });
  it('the zoom camera glides when motion is allowed and cuts to the target otherwise', async () => {
    async function cameraZ(reduce: boolean): Promise<number> {
      stubReducedMotion(reduce);
      const h = await mountR3f(<CameraController targetPosition={[0, 0, 0]} targetLookAt={[0, 0, 0]} animated />);
      h.state().camera.position.set(0, 0, 20);
      await h.rerender(<CameraController targetPosition={[0, 0, 5]} targetLookAt={[0, 0, 0]} animated />);
      h.frame(0.016);
      const z = h.state().camera.position.z;
      h.unmount();
      return z;
    }
    const glide = await cameraZ(false);
    expect(glide).toBeGreaterThan(5.5);
    expect(await cameraZ(true)).toBeCloseTo(5, 5);
  });
  it('the scene fade damps when motion is allowed and cuts otherwise', async () => {
    async function visibleAfterOneFrame(reduce: boolean): Promise<boolean> {
      stubReducedMotion(reduce);
      const h = await mountR3f(<SceneFade animating>{null}</SceneFade>);
      h.frame(0.016);
      const group = h.state().scene.children.find((c) => c instanceof THREE.Group);
      if (!group) throw new Error('no fade group');
      const v = group.visible;
      h.unmount();
      return v;
    }
    expect(await visibleAfterOneFrame(false)).toBe(true);
    expect(await visibleAfterOneFrame(true)).toBe(false);
  });
});

describe('Camera3D orbit controls', () => {
  async function damping(reduce: boolean): Promise<boolean | undefined> {
    stubReducedMotion(reduce);
    orbitControls.props.length = 0;
    const h = await mountR3f(<Camera3D />);
    const last = orbitControls.props[orbitControls.props.length - 1];
    h.unmount();
    return last?.enableDamping;
  }
  it('damps the orbit when motion is allowed', async () => {
    expect(await damping(false)).toBe(true);
  });
  it('stops the orbit the moment the pointer stops under reduced motion', async () => {
    expect(await damping(true)).toBe(false);
  });
});
