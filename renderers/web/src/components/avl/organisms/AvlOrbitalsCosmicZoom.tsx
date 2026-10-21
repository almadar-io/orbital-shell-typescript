'use client';

/**
 * AvlOrbitalsCosmicZoom — the whole app, drillable: L1 the system map
 * (`FlowCanvas` at `system`: one chip per orbital, the event wires the runtime
 * delivers between them), L3 an orbital's traits as state machines, L4 one
 * transition as circuits that a host can play (`scene`, `stepEvent`, …).
 * Every level is the same canvas, so pan, scroll-wheel zoom and fit behave
 * as on the design canvas.
 */

import React, { useMemo, useState, useCallback, useEffect, useReducer } from 'react';
import type { EventEmit, OrbitalSchema } from '@almadar/core';
import { parseTraitLevel } from '../../../lib/avl-schema-parser';
import { pressableProps } from '../../../core';
import { transitionPlayback, type AvlPlayStep, type AvlStepRequest } from '../../../lib/avl-play';
import { RangeSlider } from '../../../core';
import { zoomReducer, initialZoomState, getBreadcrumbs, type ZoomLevel } from '../../../lib/avl-zoom-state';
import { AvlTransitionDetail } from '../molecules/AvlTransitionDetail';
import { Box } from '../../../core';
import { HStack } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';
import { FlowCanvas, type TraitView } from './FlowCanvas';
import type { SystemMapContextValue } from '../molecules/SystemNode';
import type { SystemDependencies } from '../../../lib/avl-dependency-graph';
import { useTranslate } from '../../../core';
import { type ViewLevel } from '../../../lib/avl-preview-converter';

export interface AvlOrbitalsCosmicZoomProps {
  /** The orbital schema (parsed object or JSON string) */
  schema: OrbitalSchema | string;
  /** CSS class for the outer container */
  className?: string;
  /** Accent for the breadcrumb */
  color?: string;
  /** Container width */
  width?: number | string;
  /** Container height */
  height?: number | string;
  /** Orbital ringed on the system map (e.g. the one the user came from). */
  highlightedOrbital?: string;
  /** Fired when the user opens an orbital's traits. */
  onOrbitalSelect?: (orbital: string) => void;
  /** What hovering an orbital on the system map shows (e.g. its live screen). */
  renderOrbitalPreview?: (orbital: string) => React.ReactNode;
  /** Emits UI:{openCodeEvent} with { orbital } from an orbital's hover card. */
  openCodeEvent?: EventEmit<{ orbital: string }>;
  /** The app's imports (each orbital's, and each behavior's own), for the Dependencies lens on the system map. */
  dependencies?: SystemDependencies;
  /** Emits UI:{openBehaviorEvent} with { name } to open a behavior selected in the Dependencies lens. */
  openBehaviorEvent?: EventEmit<{ name: string }>;
  /** Emits UI:{previewEvent} with { orbital } from an orbital's hover card. */
  previewEvent?: EventEmit<{ orbital: string }>;
  /** Played steps, in order; they light the L3 state machines and the L4 circuits. A scrubber picks the step shown. */
  scene?: readonly AvlPlayStep[];
  /** Emits UI:{stepEvent} from L4's Step button — the host plays the transition and appends the result to `scene`. */
  stepEvent?: EventEmit<AvlStepRequest>;
  /** Emits UI:{playEvent} with the drilled trait; the host keeps stepping it until paused or stopped. */
  playEvent?: EventEmit<{ orbital: string; trait: string }>;
  /** Emits UI:{pauseEvent} while `playing`. */
  pauseEvent?: EventEmit<{ orbital: string; trait: string }>;
  /** Emits UI:{stopEvent}; the host ends the run and clears the scene. */
  stopEvent?: EventEmit<{ orbital: string; trait: string }>;
  /** Whether the host is continuously playing. */
  playing?: boolean;
}

const LEVEL_BOX = { inset: 0, paddingTop: 56, paddingBottom: 24, paddingLeft: 24, paddingRight: 24 };

export const AvlOrbitalsCosmicZoom: React.FC<AvlOrbitalsCosmicZoomProps> = ({
  schema: schemaProp,
  className,
  color = 'var(--color-primary)',
  width = '100%',
  height = 450,
  highlightedOrbital,
  onOrbitalSelect,
  renderOrbitalPreview,
  openCodeEvent,
  previewEvent,
  dependencies,
  openBehaviorEvent,
  scene,
  stepEvent,
  playEvent,
  pauseEvent,
  stopEvent,
  playing = false,
}) => {
  const { t } = useTranslate();
  const parsedSchema = useMemo<OrbitalSchema>(() => {
    if (typeof schemaProp === 'string') return JSON.parse(schemaProp) as OrbitalSchema;
    return schemaProp;
  }, [schemaProp]);

  const [state, dispatch] = useReducer(zoomReducer, initialZoomState);
  // The orbital level's lens outlives a visit to a transition (Esc lands back where the user was).
  const [traitView, setTraitView] = useState<TraitView>({ lens: 'flow', filter: null });
  useEffect(() => setTraitView({ lens: 'flow', filter: null }), [state.selectedOrbital]);
  const breadcrumbs = useMemo(() => getBreadcrumbs(state), [state]);

  const handleSelect = useCallback(
    (name: string) => {
      dispatch({ type: 'JUMP_TO_TRAIT_CIRCUIT', orbital: name });
      onOrbitalSelect?.(name);
    },
    [onOrbitalSelect],
  );

  const systemMap = useMemo<SystemMapContextValue>(() => ({
    openTraits: handleSelect,
    ...(renderOrbitalPreview ? { renderPreview: renderOrbitalPreview } : {}),
    ...(openCodeEvent ? { openCodeEvent } : {}),
    ...(previewEvent ? { previewEvent } : {}),
    ...(highlightedOrbital ? { highlighted: highlightedOrbital } : {}),
  }), [handleSelect, renderOrbitalPreview, openCodeEvent, previewEvent, highlightedOrbital]);

  // COSMIC-1: FlowCanvas's `onNodeClick` fires with `level: 'transition'`
  // when the user clicks a transition row inside a trait card. Translate
  // that into the cosmic dispatch sequence: record the trait name so the
  // breadcrumb has a label at L4, then drill to the transition scene.
  const handleCanvasNodeClick = useCallback(
    (ctx: { level: ViewLevel | 'code' | 'transition'; orbital: string; trait?: string; transition?: string; transitionIndex?: number }) => {
      if (ctx.level !== 'transition' || !ctx.trait || ctx.transitionIndex === undefined) return;
      dispatch({ type: 'SELECT_TRAIT', trait: ctx.trait });
      dispatch({ type: 'ZOOM_INTO_TRANSITION', transitionIndex: ctx.transitionIndex, targetPosition: { x: 0, y: 0 } });
      Promise.resolve().then(() => dispatch({ type: 'ANIMATION_COMPLETE' }));
    },
    [],
  );

  const handleZoomOut = useCallback(() => {
    dispatch({ type: 'ZOOM_OUT' });
    Promise.resolve().then(() => dispatch({ type: 'ANIMATION_COMPLETE' }));
  }, []);

  const handleBreadcrumbClick = useCallback((targetLevel: ZoomLevel) => {
    const order: ZoomLevel[] = ['application', 'orbital', 'trait', 'transition'];
    const currentIdx = order.indexOf(state.level);
    const targetIdx = order.indexOf(targetLevel);
    const steps = currentIdx - targetIdx;
    for (let i = 0; i < steps; i++) {
      dispatch({ type: 'ZOOM_OUT' });
    }
    Promise.resolve().then(() => dispatch({ type: 'ANIMATION_COMPLETE' }));
  }, [state.level]);

  // Esc to zoom out (only when drilled in past application level)
  useEffect(() => {
    if (state.level === 'application') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleZoomOut();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleZoomOut, state.level]);


  // COSMIC-1: only L4 (transition) is rendered from parsed cosmic data
  // now — L3 (trait) renders an embedded FlowCanvas instead, which
  // builds its own graph internally. Drops the orbitalLevelData /
  // traitLevelData memos that drove the retired L2 + AvlTraitScene.
  const selectedTrait = useMemo(() => {
    if (!state.selectedOrbital || !state.selectedTrait) return null;
    return parseTraitLevel(parsedSchema, state.selectedOrbital, state.selectedTrait);
  }, [parsedSchema, state.selectedOrbital, state.selectedTrait]);
  const selectedTransition = state.selectedTransition === null ? undefined : selectedTrait?.transitions[state.selectedTransition];

  const steps = useMemo(() => scene ?? [], [scene]);
  const [cursor, setCursor] = useState(steps.length - 1);
  useEffect(() => setCursor(steps.length - 1), [steps.length]);
  const sceneView = useMemo(() => ({ steps, cursor }), [steps, cursor]);
  const selectedPlayback = useMemo(
    () => (selectedTrait && selectedTransition && state.selectedOrbital
      ? transitionPlayback(selectedTrait, state.selectedOrbital, selectedTransition, steps, cursor)
      : undefined),
    [selectedTrait, selectedTransition, state.selectedOrbital, steps, cursor],
  );
  const playTarget = state.selectedOrbital && state.selectedTrait ? { orbital: state.selectedOrbital, trait: state.selectedTrait } : null;
  const showSceneBar = (state.level === 'trait' || state.level === 'transition') && (steps.length > 0 || (playTarget !== null && playEvent !== undefined && state.level === 'transition'));

  // Schema scoped to the selected orbital, fed to the embedded FlowCanvas
  // at the trait-expanded level. Stripping siblings keeps xyflow's node
  // count minimal and prevents cross-orbital edges from leaking in.
  const scopedSchema = useMemo<OrbitalSchema | null>(() => {
    if (!state.selectedOrbital) return null;
    const orbital = parsedSchema.orbitals?.find(o => o.name === state.selectedOrbital);
    if (!orbital) return null;
    return { ...parsedSchema, orbitals: [orbital] };
  }, [parsedSchema, state.selectedOrbital]);

  return (
    <Box className={className} position="relative" overflow="visible" style={{ width, height }}>
      {/* GAP-75: Breadcrumb header — always visible. Lets the user navigate
          back up the drill chain. */}
      <Box
        position="absolute"
        style={{
          top: 12,
          left: 12,
          zIndex: 30,
          background: 'var(--color-card)',
          padding: '4px 12px',
          borderRadius: 6,
          border: `1px solid ${color}`,
        }}
      >
        <HStack gap="xs" align="center">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={crumb.level}>
              {i > 0 && (
                <Typography variant="small" style={{ opacity: 0.5, color }}>
                  /
                </Typography>
              )}
              {i < breadcrumbs.length - 1 ? (
                <Box
                  as="span"
                  {...pressableProps(() => handleBreadcrumbClick(crumb.level))}
                  style={{ cursor: 'pointer' }}
                >
                  <Typography
                    variant="small"
                    style={{ color, textDecoration: 'underline' }}
                  >
                    {crumb.labelKey ? t(crumb.labelKey, crumb.labelParams) : crumb.label}
                  </Typography>
                </Box>
              ) : (
                <Typography variant="small" weight="bold" style={{ color }}>
                  {crumb.labelKey ? t(crumb.labelKey, crumb.labelParams) : crumb.label}
                </Typography>
              )}
            </React.Fragment>
          ))}
        </HStack>
      </Box>

      {/* Esc hint — only when drilled past L3 */}
      {state.level !== 'application' && (
        <Box
          position="absolute"
          style={{
            bottom: 12,
            right: 12,
            zIndex: 30,
            background: 'var(--color-card)',
            padding: '2px 8px',
            borderRadius: 4,
            opacity: 0.8,
          }}
        >
          <Typography variant="small" style={{ color }}>
            {t('avl.pressEscToZoomOut')}
          </Typography>
        </Box>
      )}

      {/* ── L1: the system map ── */}
      {state.level === 'application' && (
        <Box position="absolute" style={LEVEL_BOX}>
          <FlowCanvas
            schema={parsedSchema}
            initialLevel="system"
            systemMap={systemMap}
            {...(dependencies ? { systemDependencies: dependencies } : {})}
            {...(openBehaviorEvent ? { openBehaviorEvent } : {})}
            width="100%"
            height="100%"
          />
        </Box>
      )}

      {/* ── L3 (trait circuit): embedded FlowCanvas at `trait-expanded`.
            One card per trait of the selected orbital, connected by
            intra-orbital emit→listen edges. Click a transition row
            inside a card to drill into L4 transition detail. */}
      {state.level === 'trait' && scopedSchema && state.selectedOrbital && (
        <Box
          position="absolute"
          style={{
            inset: 0,
            paddingTop: 56,
            paddingBottom: 24,
            paddingLeft: 24,
            paddingRight: 24,
          }}
        >
          <FlowCanvas
            schema={scopedSchema}
            initialLevel="trait-expanded"
            initialOrbital={state.selectedOrbital}
            onNodeClick={handleCanvasNodeClick}
            scene={sceneView}
            {...(dependencies ? { systemDependencies: dependencies } : {})}
            traitView={traitView}
            onTraitViewChange={setTraitView}
            width="100%"
            height="100%"
          />
        </Box>
      )}

      {/* ── L4 (transition): HTML detail card with accordion-collapsed
            effects. Long render-ui args wrap inside each accordion's
            CodeBlock instead of being truncated. SVG variant
            (`AvlTransitionScene`) is preserved for `Avl3DTransitionScene`
            but no longer used by 2D cosmic. */}
      {state.level === 'transition' && selectedTransition && state.selectedOrbital && state.selectedTrait && (
        <Box
          position="absolute"
          style={{
            inset: 0,
            paddingTop: 56,
            paddingBottom: showSceneBar ? 72 : 24,
            paddingLeft: 24,
            paddingRight: 24,
            overflowY: 'auto',
          }}
        >
          <AvlTransitionDetail
            orbital={state.selectedOrbital}
            trait={state.selectedTrait}
            transition={selectedTransition}
            playback={selectedPlayback}
            stepEvent={stepEvent}
          />
        </Box>
      )}

      {showSceneBar && (
        <Box
          position="absolute"
          data-testid="avl-scene-bar"
          className="bg-card border border-border rounded-md shadow-sm"
          style={{ left: '50%', transform: 'translateX(-50%)', bottom: 12, zIndex: 30, padding: '6px 12px', width: 'min(560px, calc(100% - 320px))' }}
        >
          <HStack gap="sm" align="center">
            {playTarget && playEvent && state.level === 'transition' ? (
              playing && pauseEvent ? (
                <Button variant="secondary" size="sm" action={pauseEvent} actionPayload={playTarget} leftIcon="pause" title={t('avl.play.pause')} data-testid="avl-scene-pause" />
              ) : (
                <Button variant="primary" size="sm" action={playEvent} actionPayload={playTarget} leftIcon="play" title={t('avl.play.play')} data-testid="avl-scene-play" />
              )
            ) : null}
            {playTarget && stopEvent && steps.length > 0 ? (
              <Button variant="ghost" size="sm" action={stopEvent} actionPayload={playTarget} leftIcon="stop" title={t('avl.play.stop')} data-testid="avl-scene-stop" />
            ) : null}
            {steps.length > 0 ? (
              <>
                <Box className="flex-1 min-w-0">
                  <RangeSlider min={0} max={Math.max(0, steps.length - 1)} step={1} value={Math.max(0, cursor)} onChange={setCursor} size="sm" aria-label={t('avl.play.scene')} />
                </Box>
                <Box data-testid="avl-scene-position">
                  <Typography variant="small" color="muted">
                    {t('avl.play.sceneStep', { n: cursor + 1, total: steps.length })}
                  </Typography>
                </Box>
              </>
            ) : null}
          </HStack>
        </Box>
      )}

    </Box>
  );
};

AvlOrbitalsCosmicZoom.displayName = 'AvlOrbitalsCosmicZoom';
