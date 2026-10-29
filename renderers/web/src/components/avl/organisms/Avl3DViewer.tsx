'use client';

/**
 * Avl3DViewer - Interactive 3D Orbital Visualization
 *
 * The host organism that owns the R3F Canvas and delegates to 3D scene
 * renderers at each zoom level. The 3D equivalent of AvlCosmicZoom.
 *
 * Reuses avl-schema-parser.ts and avl-zoom-state.ts directly.
 *
 * @packageDocumentation
 */

import React, { useReducer, useCallback, useMemo, useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { HStack } from '../../../core';
import type { OrbitalSchema } from '@almadar/core';
import {
  parseApplicationLevel,
  parseOrbitalLevel,
  parseTraitLevel,
  parseTransitionLevel,
} from '../../../lib/avl-schema-parser';
import {
  zoomReducer,
  initialZoomState,
  getBreadcrumbs,
  type ZoomLevel,
} from '../../../lib/avl-zoom-state';
import { Scene3D } from '../../../lib/drawable/three/Scene3D';
import { Camera3D } from '../../../lib/drawable/three/Camera3D';
import { Lighting3D } from '../../../lib/drawable/three/Lighting3D';
import { AVL_3D_COLORS, CAMERA_POSITIONS } from '../../../lib/avl-3d-layout';
import { pressableProps } from '../../../core';
import { Avl3DApplicationScene } from './Avl3DApplicationScene';
import { Avl3DOrbitalScene } from './Avl3DOrbitalScene';
import { Avl3DTraitScene } from './Avl3DTraitScene';
import { Avl3DTransitionScene } from './Avl3DTransitionScene';
import { Avl3DEffects } from './Avl3DEffects';
import { Avl3DContext, type Avl3DModelOverrides } from '../../../providers/avl-3d-context';
import { useTranslate, usePrefersReducedMotion } from '../../../core';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { createLogger } from '@almadar/logger';

const log = createLogger('almadar:ui:avl-3d-viewer');

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface Avl3DViewerProps {
  /** The orbital schema (parsed object or JSON string) */
  schema: OrbitalSchema | string;
  /** CSS class for the outer container */
  className?: string;
  /** Enable animations (default: true) */
  animated?: boolean;
  /** Pre-select an orbital on mount */
  initialOrbital?: string;
  /** Pre-select a trait on mount */
  initialTrait?: string;
  /** Callback when zoom level changes */
  onZoomChange?: (level: ZoomLevel, context: { orbital?: string; trait?: string }) => void;
  /** Container width */
  width?: number | string;
  /** Container height */
  height?: number | string;
  /** Enable postprocessing effects (bloom, DOF, vignette). Default: true */
  effects?: boolean;
  /** Custom 3D model URLs to replace default primitive geometry */
  modelOverrides?: Avl3DModelOverrides;
}

// ---------------------------------------------------------------------------
// Camera Controller (inner component, used inside Canvas)
// ---------------------------------------------------------------------------

interface CameraControllerProps {
  targetPosition: [number, number, number];
  targetLookAt: [number, number, number];
  animated: boolean;
}

export function CameraController({ targetPosition, targetLookAt, animated }: CameraControllerProps): null {
  const { camera } = useThree();
  const targetPosVec = useRef(new THREE.Vector3(...targetPosition));
  const targetLookVec = useRef(new THREE.Vector3(...targetLookAt));
  // Only animate when target changes, then release control to OrbitControls
  const isAnimating = useRef(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const newTarget = new THREE.Vector3(...targetPosition);
    const newLookAt = new THREE.Vector3(...targetLookAt);

    // Only trigger animation if the target actually changed
    if (!newTarget.equals(targetPosVec.current) || !newLookAt.equals(targetLookVec.current)) {
      targetPosVec.current.copy(newTarget);
      targetLookVec.current.copy(newLookAt);

      if (animated && !reducedMotion) {
        isAnimating.current = true;
      } else {
        camera.position.copy(targetPosVec.current);
        camera.lookAt(targetLookVec.current.x, targetLookVec.current.y, targetLookVec.current.z);
      }
    }
  }, [targetPosition, targetLookAt, animated, reducedMotion, camera]);

  useFrame((_, delta) => {
    if (!isAnimating.current) return;

    const speed = 3;
    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetPosVec.current.x, speed, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, targetPosVec.current.y, speed, delta);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, targetPosVec.current.z, speed, delta);
    camera.lookAt(targetLookVec.current);

    // Stop animating once close enough (within 0.05 units)
    const dist = camera.position.distanceTo(targetPosVec.current);
    if (dist < 0.05) {
      isAnimating.current = false;
    }
  });

  return null;
}

// ---------------------------------------------------------------------------
// Scene Fade Wrapper (B5: crossfade between zoom levels)
// ---------------------------------------------------------------------------

interface SceneFadeProps {
  animating: boolean;
  children: React.ReactNode;
}

export function SceneFade({ animating, children }: SceneFadeProps): React.JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const opacityRef = useRef(1);
  const reducedMotion = usePrefersReducedMotion();

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const target = animating ? 0 : 1;
    opacityRef.current = reducedMotion ? target : THREE.MathUtils.damp(opacityRef.current, target, 5, delta);
    // Apply opacity via scale trick (R3F doesn't support group opacity directly)
    // Instead use visibility toggle at threshold
    groupRef.current.visible = opacityRef.current > 0.05;
    // Subtle scale-down during fade for a zoom feel
    const s = 0.9 + opacityRef.current * 0.1;
    groupRef.current.scale.setScalar(s);
  });

  return <group ref={groupRef}>{children}</group>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Avl3DViewer: React.FC<Avl3DViewerProps> = ({
  schema: schemaProp,
  className,
  animated = true,
  initialOrbital,
  initialTrait,
  onZoomChange,
  width = '100%',
  height = 500,
  effects = true,
  modelOverrides = {},
}) => {
  const { t } = useTranslate();
  const containerRef = useRef<HTMLDivElement>(null);

  // Resolve every AVL_3D_COLORS token against the active theme — three.js
  // materials and lights cannot evaluate `var()`/`color-mix()` themselves.
  const resolvedColors = useThemeColors(AVL_3D_COLORS, containerRef);
  const palette = useMemo(() => {
    if (!resolvedColors) return null;
    const out = {} as Record<keyof typeof AVL_3D_COLORS, string>;
    for (const key of Object.keys(AVL_3D_COLORS) as Array<keyof typeof AVL_3D_COLORS>) {
      const resolved = resolvedColors[key];
      if (!resolved) {
        log.error('avl-3d-palette-key-unresolved', { key, value: AVL_3D_COLORS[key] });
        return null;
      }
      out[key] = resolved.css;
    }
    return out;
  }, [resolvedColors]);

  // Parse schema
  const schema: OrbitalSchema = useMemo(() => {
    if (typeof schemaProp === 'string') {
      try { return JSON.parse(schemaProp); }
      catch { return { name: t('common.error'), orbitals: [] } as OrbitalSchema; }
    }
    return schemaProp;
  }, [schemaProp, t]);

  // 3D config context value
  const configValue = useMemo(() => ({
    modelOverrides,
    effectsEnabled: effects,
    palette,
  }), [modelOverrides, effects, palette]);

  // Zoom state machine (reused from 2D viewer)
  const [state, dispatch] = useReducer(zoomReducer, initialZoomState);

  // Handle initial selections
  useEffect(() => {
    if (initialOrbital) {
      dispatch({ type: 'ZOOM_INTO_ORBITAL', orbital: initialOrbital, targetPosition: { x: 0, y: 0 } });
      setTimeout(() => dispatch({ type: 'ANIMATION_COMPLETE' }), 0);

      if (initialTrait) {
        setTimeout(() => {
          dispatch({ type: 'ZOOM_INTO_TRAIT', trait: initialTrait, targetPosition: { x: 0, y: 0 } });
          setTimeout(() => dispatch({ type: 'ANIMATION_COMPLETE' }), 0);
        }, 10);
      }
    }
  }, [initialOrbital, initialTrait]);

  // Notify zoom changes
  useEffect(() => {
    onZoomChange?.(state.level, {
      orbital: state.selectedOrbital ?? undefined,
      trait: state.selectedTrait ?? undefined,
    });
  }, [state.level, state.selectedOrbital, state.selectedTrait, onZoomChange]);

  // Auto-complete animation after a delay (3D uses camera lerp instead of CSS)
  useEffect(() => {
    if (!state.animating) return;
    const timer = setTimeout(() => {
      dispatch({ type: 'ANIMATION_COMPLETE' });
    }, 800);
    return () => clearTimeout(timer);
  }, [state.animating]);

  // Keyboard handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      dispatch({ type: 'ZOOM_OUT' });
    }
  }, []);

  // Dispatch helpers
  const handleOrbitalClick = useCallback((name: string) => {
    dispatch({ type: 'ZOOM_INTO_ORBITAL', orbital: name, targetPosition: { x: 0, y: 0 } });
  }, []);

  const handleTraitClick = useCallback((name: string) => {
    dispatch({ type: 'ZOOM_INTO_TRAIT', trait: name, targetPosition: { x: 0, y: 0 } });
  }, []);

  // Highlighted trait at orbital level (hover)
  const [highlightedTrait, setHighlightedTrait] = React.useState<string | null>(null);

  const handleTransitionClick = useCallback((index: number) => {
    dispatch({ type: 'ZOOM_INTO_TRANSITION', transitionIndex: index, targetPosition: { x: 0, y: 0 } });
  }, []);

  const handleBreadcrumbClick = useCallback((targetLevel: ZoomLevel) => {
    const levelOrder: ZoomLevel[] = ['application', 'orbital', 'trait', 'transition'];
    const currentIdx = levelOrder.indexOf(state.level);
    const targetIdx = levelOrder.indexOf(targetLevel);
    if (targetIdx < currentIdx) {
      dispatch({ type: 'ZOOM_OUT' });
    }
  }, [state.level]);

  // Camera target for current level
  const cameraConfig = CAMERA_POSITIONS[state.level];

  // Parse data for current level
  const sceneContent = useMemo(() => {
    switch (state.level) {
      case 'application': {
        const data = parseApplicationLevel(schema);
        return (
          <Avl3DApplicationScene
            data={data}
            onOrbitalClick={handleOrbitalClick}
          />
        );
      }

      case 'orbital': {
        if (!state.selectedOrbital) return null;
        const orbData = parseOrbitalLevel(schema, state.selectedOrbital);
        if (!orbData) return null;
        return (
          <Avl3DOrbitalScene
            data={orbData}
            onTraitClick={handleTraitClick}
            highlightedTrait={highlightedTrait}
            onTraitHighlight={setHighlightedTrait}
          />
        );
      }

      case 'trait': {
        if (!state.selectedOrbital || !state.selectedTrait) return null;
        const traitData = parseTraitLevel(schema, state.selectedOrbital, state.selectedTrait);
        if (!traitData) return null;
        return (
          <Avl3DTraitScene
            data={traitData}
            onTransitionClick={handleTransitionClick}
          />
        );
      }

      case 'transition': {
        if (!state.selectedOrbital || !state.selectedTrait || state.selectedTransition === null) return null;
        const transData = parseTransitionLevel(schema, state.selectedOrbital, state.selectedTrait, state.selectedTransition);
        if (!transData) return null;
        return (
          <Avl3DTransitionScene
            data={transData}
          />
        );
      }

      default:
        return null;
    }
  }, [state.level, state.selectedOrbital, state.selectedTrait, state.selectedTransition, schema, handleOrbitalClick, handleTraitClick, handleTransitionClick, highlightedTrait, setHighlightedTrait]);

  const breadcrumbs = getBreadcrumbs(state);

  return (
    <Box
      ref={containerRef}
      className={`relative ${className ?? ''}`}
      style={{
        width,
        height: typeof height === 'number' ? `${height}px` : height,
        backgroundColor: AVL_3D_COLORS.background,
        borderRadius: '8px',
        overflow: 'hidden',
      }}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Breadcrumb navigation */}
      <HStack
        gap="xs"
        align="center"
        className="absolute top-2 left-2 z-10 bg-surface/80 backdrop-blur rounded-md px-3 py-1.5"
      >
        {breadcrumbs.map((crumb, i) => (
          <React.Fragment key={crumb.level}>
            {i > 0 && (
              <Typography variant="small" color="muted" className="mx-1">/</Typography>
            )}
            {i < breadcrumbs.length - 1 ? (
              <Box
                as="span"
                className="cursor-pointer hover:underline"
                {...pressableProps(() => handleBreadcrumbClick(crumb.level))}
              >
                <Typography variant="small" color="muted">
                  {crumb.labelKey ? t(crumb.labelKey, crumb.labelParams) : crumb.label}
                </Typography>
              </Box>
            ) : (
              <Typography variant="small" color="primary" className="font-bold">
                {crumb.labelKey ? t(crumb.labelKey, crumb.labelParams) : crumb.label}
              </Typography>
            )}
          </React.Fragment>
        ))}
      </HStack>

      {/* Zoom out hint */}
      {state.level !== 'application' && (
        <Typography
          variant="small"
          color="muted"
          className="absolute bottom-2 right-2 z-10 bg-surface/60 backdrop-blur rounded px-2 py-1"
        >
          {t('avl.pressEscToZoomOut')}
        </Typography>
      )}

      {/* R3F Canvas — held back until every AVL_3D_COLORS token has resolved,
          so no material/light ever receives an unparsed `var()` string. */}
      {palette && (
        <Canvas
          style={{ width: '100%', height: '100%' }}
          camera={{
            position: cameraConfig.position,
            fov: 60,
            near: 0.1,
            far: 200,
          }}
          onCreated={({ gl }) => {
            gl.setClearColor(palette.background);
          }}
        >
          <Avl3DContext.Provider value={configValue}>
            <Scene3D
              background={palette.background}
              fog={{ color: palette.fog, near: 30, far: 80 }}
            >
              <Camera3D
                mode="perspective"
                position={cameraConfig.position}
                target={cameraConfig.target}
                enableOrbit
                minDistance={3}
                maxDistance={80}
              />
              <Lighting3D
                ambientIntensity={0.35}
                ambientColor={palette.lightAmbient}
                directionalIntensity={0.5}
                directionalColor={palette.lightDirectional}
                directionalPosition={[8, 15, 12]}
                shadows={false}
              />

              {/* Fill light from below for depth (subtle uplighting) */}
              <pointLight
                position={[0, -10, 0]}
                color={palette.lightFill}
                intensity={0.15}
                distance={50}
                decay={2}
              />

              <CameraController
                targetPosition={cameraConfig.position}
                targetLookAt={cameraConfig.target}
                animated={animated}
              />

              {/* B5: Fade wrapper for smooth zoom transitions */}
              <SceneFade animating={state.animating}>
                {sceneContent}
              </SceneFade>

              {/* Postprocessing effects + ambient particles */}
              <Avl3DEffects level={state.level} enabled={effects} />
            </Scene3D>
          </Avl3DContext.Provider>
        </Canvas>
      )}
    </Box>
  );
};

Avl3DViewer.displayName = 'Avl3DViewer';
