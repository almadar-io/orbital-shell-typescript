'use client';
 
/**
 * UISlotRenderer Component
 *
 * Renders all UI slots. This is the central component that displays
 * content rendered by traits via render_ui effects.
 *
 * Slots are rendered as:
 * - Layout slots: Inline in the page flow (main, sidebar)
 * - Portal slots: Rendered via portals (modal, drawer, toast, etc.)
 * - HUD slots: Fixed position overlays (hud-top, hud-bottom)
 *
 * @packageDocumentation
 */

import React, { Suspense, createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useEntitySchemaOptional } from "../../../providers/EntitySchemaContext";
import { useEntityBindingSnapshot } from "../../../providers/EntityBindingContext";
import { resolveRenderBindingMarkers, isEvaluatorResolvedData } from "../../../lib/resolve-render-bindings";
import { useRowSetResolver } from "../../../providers/RowSetResolverContext";
import { TraitScopeProvider, useTraitScope } from '../../../core';
import { RenderSlotProvider } from "../../../providers/RenderSlotContext";
import type { EntityRow, EventPayload, EventPayloadValue, RenderItemLambda, ResolvedEntity } from "@almadar/core";
import { isBehaviorRefValue, isRenderBindingMarker, isTraitValue, PATTERN_PROP_TYPE_ERROR_TESTID, type BehaviorRef, type TraitValue } from "@almadar/core";
import type { AnyPatternConfig } from "@almadar/core/patterns";
import { SELF_OVERLAY_PATTERN_TYPES } from "@almadar/core/patterns";
import {
  useUISlots,
  type UISlot,
  type SlotContent,
  type SlotProps,
  type SlotPropValue,
} from "../../../providers/UISlotContext";
import { Modal } from "../molecules/Modal";
import { Drawer } from "../molecules/Drawer";
import { useCompactLayout } from "./layout/DockLayout";
import { PageTransition } from "../molecules/PageTransition";
import { Toast } from "../molecules/Toast";
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate, useRenderI18n } from '../../../core';
import { slotLog, refId } from "../../../types/slot-types";
import { cn } from '../../../core';
import type { EnterAnimation, SkeletonNode } from "@almadar/core";
import { PendingScopeContext, usePendingScopeValue, useScopeHasPending } from '../../../core';
import { asEnterAnimation, enterClassName, slotPlaysDefaultEnter, useSlotEnterRestart, ENTER_SLOT_CLASS } from "../../../lib/enter";
import { getOrCreatePortalRoot } from "../../../lib/portalRoot";
import { SlotContainedContext } from "../../../lib/slotContained";
import { ErrorBoundary } from "../molecules/ErrorBoundary";
import { createLogger } from '@almadar/logger';
import { propTypeMismatches } from '../../../lib/propTypeMismatch';

const scopeWrapLog = createLogger("almadar:ui:scope-wrap");
import { Skeleton, SkeletonTree, type SkeletonVariant } from "../molecules/Skeleton";
import { useAwaitingSkeleton } from "../../../providers/AwaitingSkeletonContext";

// Shared renderer imports (synced from @almadar/core/patterns renderer)
import { isPortalSlot, SLOT_DEFINITIONS } from "../../../renderer";
import { getPatternRuntimeDefinition, getPatternFieldsContract, isDrawHostPattern } from "@almadar/core/patterns";
import type { PatternPropDef } from "@almadar/core/patterns";
import { wrapCallbackForEvent } from "../../../lib/wrapCallbackForEvent";

// Pattern registry — single source of truth for pattern → component name resolution
import { getComponentForPattern as getComponentName } from "@almadar/core/patterns";

// Per-trait composition primitive — `@trait.X` bindings embedded in
// pattern children resolve to this component at render time. See
// `docs/Almadar_Std_Gaps.md` §3.8.
import { TraitFrame } from "../atoms/TraitFrame";

// A trait VALUE child mounts through the plugin host's runtime, which imports
// this renderer back — lazy, for the same module-cycle reason as TraitFrame's.
const LazyTraitValueFrame = React.lazy(() => import("../../../preview/TraitValueFrame"));
const LazyBehaviorValueFrame = React.lazy(() => import("../../../preview/BehaviorValueFrame"));

/**
 * `^@trait.<PascalName>$` — single-segment binding only. Multi-segment
 * forms (formerly `@trait.X.slot`) are rejected by the compiler at
 * validate time, so the runtime regex here matches the exact accepted
 * shape.
 */
const TRAIT_BINDING_RE = /^@trait\.([A-Z][A-Za-z0-9]*)$/;

/** Object view of slot content props — a bare-string payload (`@trait.X` embed) has no prop fields. */
function slotPropsOf(content: { props: SlotProps | string }): SlotProps {
  return typeof content.props === 'string' ? {} : content.props;
}

// ============================================================================
// Suspense Configuration Context
// ============================================================================

export interface SuspenseConfig {
  /** Enable Suspense boundaries around slot content */
  enabled: boolean;
  /** Custom fallback per slot, overrides default Skeleton variant */
  slotFallbacks?: Partial<Record<UISlot, React.ReactNode>>;
}

const SuspenseConfigContext = createContext<SuspenseConfig>({ enabled: false });

// ============================================================================
// Slot Containment Context
// ============================================================================

// Slot containment: SlotContainedContext lives in ../../../lib/slotContained
// (dependency-free owner so any component can consume it without an import
// cycle) and is re-exported at the bottom of this file. When true, portal
// slots render inline with absolute positioning, contained within the
// UISlotRenderer's bounds (used by playground/builder previews).

/**
 * Provider for Suspense configuration.
 * When enabled, each UI slot is wrapped in `<ErrorBoundary><Suspense>`.
 */
export function SuspenseConfigProvider({
  config,
  children,
}: {
  config: SuspenseConfig;
  children: React.ReactNode;
}) {
  return React.createElement(
    SuspenseConfigContext.Provider,
    { value: config },
    children,
  );
}
SuspenseConfigProvider.displayName = 'SuspenseConfigProvider';

/** Map slot names to the best Skeleton variant */
const SLOT_SKELETON_MAP: Partial<Record<UISlot, SkeletonVariant>> = {
  main: 'table',
  sidebar: 'card',
  modal: 'form',
  drawer: 'form',
};

function getSlotFallback(slot: UISlot, config: SuspenseConfig): React.ReactNode {
  if (config.slotFallbacks?.[slot]) return config.slotFallbacks[slot];
  const variant = SLOT_SKELETON_MAP[slot] ?? 'text';
  return <Skeleton variant={variant} />;
}

// Component registry — auto-generated from @almadar/core/patterns component-mapping.json
// Regenerate: npx tsx tools/almadar-pattern-sync/generate-component-registry.ts
import { COMPONENT_REGISTRY } from "./component-registry.generated";

// Legacy imports kept for direct use in slot wrappers below (used by non-registry code)
import type { UiError } from '../../../core';
import { ThemedPortal } from "../../../lib/ThemedPortal";
// ============================================================================
// Component Registry (auto-generated, imported from component-registry.generated.ts)
// ============================================================================

/**
 * Get the React component for a pattern type.
 * Uses @almadar/core/patterns component-mapping.json (auto-generated, single source of truth)
 * to resolve pattern type → component name, then looks up in COMPONENT_REGISTRY.
 *
 * NOTE: getComponentName() returns the full mapping entry object
 * { component, importPath, category } despite its `string | null` type signature.
 * We extract .component to get the actual component name string.
 */
function getComponentForPattern(
  patternType: string
): React.ComponentType<any> | null {
  const mapping = getComponentName(patternType);
  if (!mapping) {
    return null;
  }
  return COMPONENT_REGISTRY[mapping] ?? null;
}

// Which patterns get entity-schema field enrichment — and in which shape —
// is DECLARED per component via the `@fieldsContract` JSDoc tag ('form' =
// editable SchemaFields, 'display' = read-only {key, header} + typed meta)
// and read from the pattern registry. Never a hardcoded pattern-name list:
// a future pattern declaring a contract gets enrichment with zero edits here.

/**
 * Enrich form field definitions with entity schema type info.
 * Mirrors what the compiler does at build time (EntityFieldInfo injection).
 * At runtime, we read the entity schema from EntitySchemaContext.
 */
function enrichFormFields(
  fields: SlotPropValue[],
  entityDef: ResolvedEntity,
): SlotPropValue[] {
  const fieldMap = new Map(entityDef.fields.map((f) => [f.name, f]));

  return fields.map((field) => {
    if (typeof field === 'string') {
      // Simple string field name — look up entity field and build SchemaField
      const entityField = fieldMap.get(field);
      if (entityField) {
        const enriched: SlotProps = {
          name: field,
          label: field,
          type: entityField.type,
          required: entityField.required ?? false,
        };
        if (entityField.description) {
          // The entity field's @description becomes the input's help text.
          enriched.hint = entityField.description;
        }
        if (entityField.values && entityField.values.length > 0) {
          enriched.values = entityField.values as SlotPropValue[];
        } else if (entityField.enumValues && entityField.enumValues.length > 0) {
          enriched.values = entityField.enumValues as SlotPropValue[];
        }
        if (entityField.relation) {
          enriched.relation = {
            entity: entityField.relation.entity,
            cardinality: entityField.relation.cardinality,
          };
        }
        return enriched;
      }
      return { name: field, label: field };
    }

    if (field && typeof field === 'object' && !Array.isArray(field) && !React.isValidElement(field) && !(field instanceof Date)) {
      const obj = field as SlotProps;
      const fieldName = (typeof obj.name === 'string' ? obj.name : typeof obj.field === 'string' ? obj.field : undefined);
      if (!fieldName) return field;

      // Only enrich if type is not already specified
      if (obj.type || obj.inputType) return field;

      const entityField = fieldMap.get(fieldName);
      if (!entityField) return field;

      const enriched: SlotProps = { ...obj, type: entityField.type };
      if (entityField.required && !('required' in obj)) {
        enriched.required = true;
      }
      if (entityField.description && !obj.hint && !obj.help) {
        enriched.hint = entityField.description;
      }
      if (!obj.values && !obj.options) {
        if (entityField.values && entityField.values.length > 0) {
          enriched.values = entityField.values as SlotPropValue[];
        } else if (entityField.enumValues && entityField.enumValues.length > 0) {
          enriched.values = entityField.enumValues as SlotPropValue[];
        }
      }
      if (!obj.relation && entityField.relation) {
        enriched.relation = {
          entity: entityField.relation.entity,
          cardinality: entityField.relation.cardinality,
        };
      }
      return enriched;
    }

    return field;
  });
}

/**
 * Enrich detail-panel display fields with entity schema type info — the
 * display twin of enrichFormFields. Accepts the shapes call sites author
 * (bare string names and {key, header} pairs) and injects `type`, `values`
 * (a string union's closed vocabulary) and `relation` (target entity name)
 * from the resolved entity, activating DetailPanel's typed rendering path.
 * Entries that already carry a `type` are the author's override — untouched.
 */
function enrichDetailFields(
  fields: SlotPropValue[],
  entityDef: ResolvedEntity,
): SlotPropValue[] {
  const fieldMap = new Map(entityDef.fields.map((f) => [f.name, f]));

  const metaFor = (name: string): SlotProps | undefined => {
    const entityField = fieldMap.get(name);
    if (!entityField) return undefined;
    const meta: SlotProps = { type: entityField.type };
    const values = entityField.values ?? entityField.enumValues;
    if (values && values.length > 0) meta.values = values as SlotPropValue[];
    if (entityField.relation) {
      meta.relation = {
        entity: entityField.relation.entity,
        cardinality: entityField.relation.cardinality,
      };
    }
    return meta;
  };

  return fields.map((field) => {
    if (typeof field === 'string') {
      const meta = metaFor(field);
      return meta ? ({ key: field, ...meta } as SlotPropValue) : field;
    }

    if (field && typeof field === 'object' && !Array.isArray(field) && !React.isValidElement(field) && !(field instanceof Date)) {
      const obj = field as SlotProps;
      const fieldName = typeof obj.key === 'string' ? obj.key : typeof obj.name === 'string' ? obj.name : undefined;
      if (!fieldName || obj.type) return field;
      const meta = metaFor(fieldName);
      return meta ? ({ ...obj, ...meta } as SlotPropValue) : field;
    }

    return field;
  });
}

// Overlay patterns that render their own backdrop + dialog chrome (Modal /
// ConfirmDialog). When one of these is the modal-slot content, the portal
// wrappers below must NOT add their own Modal shell — otherwise two backdrops
// stack (the wrapper's + the component's). Render the self-overlaying content
// bare so exactly one backdrop paints. Single owner: @almadar/core/patterns.

// Named node-slot props that carry pattern-descriptor arrays (same set as
// lolo-ui.ts CONTENT_NODE_SLOTS). These must be converted to React elements
// via renderPatternChildren — the same path children uses — so they never
// reach the component as raw {type,content} objects regardless of whether
// isPatternConfig can resolve the type.
const CONTENT_NODE_SLOTS = new Set([
  'logo', 'master', 'detail', 'trigger', 'content', 'addons', 'hud', 'fallback',
  'controls', 'overlay',
]);

// Patterns that support nested children
const PATTERNS_WITH_CHILDREN = new Set([
  "stack",
  "vstack",
  "hstack",
  "box",
  "canvas",
  "canvas-2d",
  "grid",
  "center",
  "card",
  "tooltip",
  "popover",
  "container",
  "simple-grid",
  "custom",
  "dashboard-layout",
  "game-shell",
  "game-template",
  "scaled-diagram",
  "master-detail",
  "form-field",
  "form-section",
  "form",
  "accordion",
  "tabs",
  "tab-content",
  "collapsible",
  "alert",
  "dialog",
]);

// ============================================================================
// Slot Component
// ============================================================================

/** A modal/drawer slot's presence: false while a cleared slot plays its exit. */
export interface SlotPresence {
  open: boolean;
  onExited: () => void;
}

export interface UISlotComponentProps {
  slot: UISlot;
  portal?: boolean;
  position?:
    | "left"
    | "right"
    | "top-right"
    | "top-left"
    | "bottom-right"
    | "bottom-left";
  className?: string;
  draggable?: boolean;
  isLoading?: boolean;
  error?: UiError | null;
  entity?: string;
  /**
   * Compiled mode: render children directly instead of resolving from context.
   * A function receives the slot's presence — compiled self-overlaying content
   * (Modal / ConfirmDialog) takes it as `isOpen`/`onExited` to play its exit.
   */
  children?: React.ReactNode | ((presence: SlotPresence) => React.ReactNode);
  /** Pattern type for data-pattern attribute (compiled mode) */
  pattern?: string;
  /** Source trait name for data-source-trait attribute (compiled mode) */
  sourceTrait?: string;
  /**
   * Compiled mode: the root node's declared `enter`. When set, the slot plays
   * no theme-default entry (the root element animates itself, or opts out
   * with `none`). Runtime mode reads it off the slot content.
   */
  enter?: EnterAnimation;
  /**
   * Compiled mode: the predicted skeleton while this trait's server round
   * trip is in flight (the View selects it by the pending transition). Shown
   * only while the slot is empty. Runtime mode reads it from
   * `AwaitingSkeletonContext`.
   */
  awaitingSkeleton?: SkeletonNode;
  /**
   * Host-supplied stock content for a slot-host region (Studio V4 §14 Part
   * I2). Ignored whenever `children` is passed — `children` (compiled mode)
   * always wins, so a compiled organism's slot can never be silently
   * shadowed by a host `fallback`. In `portal` mode `fallback` never
   * portals: it paints inline at this component's own position in the
   * tree, while slot content (if present) still portals as usual — a
   * plugin filling `modal` doesn't relocate the host's inline empty-state.
   */
  fallback?: React.ReactNode;
  /**
   * `'replace'` (default): slot content when present, else `fallback`.
   * `'append'`: `fallback` first, then slot content when present — both
   * render together, so `fallback` is a fixture, not just a placeholder.
   */
  mode?: "replace" | "append";
}

/** Compiled children, resolved against the slot's presence when they are a render function. */
function resolveCompiledChildren(
  children: React.ReactNode | ((presence: SlotPresence) => React.ReactNode),
  presence: SlotPresence,
): React.ReactNode {
  return typeof children === "function" ? children(presence) : children;
}

/** Modal and drawer slots animate out: they stay mounted through the exit. */
function isAnimatedPortalSlot(slot: UISlot): boolean {
  return slot === "modal" || slot === "drawer";
}

/**
 * Keeps an animated portal slot's last value mounted after the slot clears, so
 * the Modal/Drawer can play its exit animation: `open` flips false while
 * `shown` still holds the last value, and `onExited` releases it.
 */
function useSlotPresence<T>(value: T | null, hold = false): { shown: T | null; open: boolean; onExited: () => void } {
  const last = useRef<T | null>(null);
  const current = useRef<T | null>(value);
  current.current = value;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  if (value !== null) last.current = value;
  const onExited = useCallback(() => {
    if (current.current !== null) return;
    last.current = null;
    rerender();
  }, []);
  // `hold`: an action started inside the slot is still in flight — a cleared
  // dialog stays open (its confirm busy) until that action settles.
  const open = value !== null || (hold && last.current !== null);
  return { shown: value ?? last.current, open, onExited };
}

/**
 * Render portal slot content inline with absolute positioning (contained mode).
 * Used by playground/builder previews to keep all content within the preview box.
 * Mirrors SlotPortal's wrapper logic but uses absolute instead of fixed positioning.
 */
function renderContainedPortal(
  slot: UISlot,
  content: SlotContent,
  onDismiss: () => void,
  open: boolean,
  onExited: () => void,
): React.ReactElement {
  // Wrap with MaybeTraitScope so bare `UI:X` emits inside the slot (e.g.
  // form submit dispatching `UI:SAVE`) get qualified to
  // `UI:Orbital.Trait.X` via TraitScopeProvider — same contract as
  // SlotPortal's wrapping for the non-contained path. Without this wrap,
  // every cross-trait listener (subscribed under the qualified key) misses
  // the form-submit event in playground/builder previews (contained mode).
  const slotContent = (
    <MaybeTraitScope sourceTrait={content.sourceTrait}>
      <SlotContentRenderer content={content} onDismiss={onDismiss} presence={{ open, onExited }} />
    </MaybeTraitScope>
  );
  // Every mounted portal slot advertises `id="slot-{name}"` so VG1's portal
  // probe + any external selector sees the same anchor whether the runtime
  // drew the content inline (contained mode) or via a React portal. Before
  // this was set, modal contents painted but the probe couldn't locate the
  // slot — VG15 / runtime-path "modal not mounted" reports.
  const slotId = `slot-${slot}`;

  switch (slot) {
    case "modal":
      // Self-overlaying content (Modal / ConfirmDialog patterns) brings its
      // own backdrop + chrome — render it bare under the slot anchor so the
      // wrapper's backdrop doesn't double up.
      if (SELF_OVERLAY_PATTERN_TYPES.has(content.pattern)) {
        return <Box id={slotId} className="contents">{slotContent}</Box>;
      }
      return (
        <Modal
          contained
          isOpen={open}
          onExited={onExited}
          onClose={onDismiss}
          title={slotPropsOf(content).title as string | undefined}
          size={slotPropsOf(content).size as "sm" | "md" | "lg" | "xl" | "full" | undefined}
        >
          <Box id={slotId}>{slotContent}</Box>
        </Modal>
      );

    case "dock":
      return (
        <DockSlotFrame open={open} onExited={onExited} onDismiss={onDismiss} contained>
          <Box id={slotId} className="flex min-h-0 flex-1 flex-col">{slotContent}</Box>
        </DockSlotFrame>
      );

    case "drawer":
      // A slide-over DetailPanel brings its own full-height chrome (header,
      // actions, X) — the w-80 shell would double the header and clamp its
      // width. Same self-overlay rationale as the modal case above.
      if (content.pattern === "detail-panel" && slotPropsOf(content).slideOver === true) {
        return (
          <Box
            id={slotId}
            className="absolute inset-0 z-50 overflow-hidden bg-scrim"
            onClick={onDismiss}
          >
            <Box
              className="absolute inset-y-0 right-0 pointer-events-auto"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              {slotContent}
            </Box>
          </Box>
        );
      }
      return (
        <Drawer
          contained
          isOpen={open}
          onExited={onExited}
          onClose={onDismiss}
          title={slotPropsOf(content).title as string | undefined}
          position={(slotPropsOf(content).position as "left" | "right") ?? "right"}
          width={slotPropsOf(content).width as string | undefined}
        >
          <Box id={slotId}>{slotContent}</Box>
        </Drawer>
      );

    case "toast":
      return (
        <Box id={slotId} className="absolute top-4 right-4 z-50">
          <SlotToasts content={content} onDismiss={onDismiss} />
        </Box>
      );

    case "overlay":
      return (
        <Box
          id={slotId}
          className="absolute inset-0 z-50 flex items-center justify-center overflow-auto bg-scrim"
          onClick={onDismiss}
        >
          <Box className="max-h-full overflow-auto" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            {slotContent}
          </Box>
        </Box>
      );

    case "center":
      return (
        <Box id={slotId} className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none overflow-auto">
          <Box className="pointer-events-auto max-h-full overflow-auto">
            {slotContent}
          </Box>
        </Box>
      );

    default:
      return <Box id={slotId}>{slotContent}</Box>;
  }
}

/**
 * Wrap a slot's rendered subtree in `TraitScopeProvider` when both the
 * source trait and its owning orbital can be resolved. The wrap is what
 * makes Button (and any pure component using `useEventBus`) emit the
 * qualified `UI:Orbital.Trait.EVENT` form that `useTraitStateMachine`
 * listens on. Without this wrap, runtime-path clicks dispatch bare
 * `UI:EVENT` keys and never reach the trait's state machine — which
 * was the runtime-side modal-not-mounting bug traced via
 * `[gap4-button-emit]` / `[gap4-bus-emit]`.
 *
 * Resolves orbital via `EntitySchemaContext.orbitalsByTrait`. When the
 * trait isn't in the map (e.g. compiled mode without the schema
 * context, or storybook), children render unwrapped — those callers
 * either don't need scope (storybook) or already get it from codegen.
 */
function MaybeTraitScope({
  sourceTrait,
  children,
}: { sourceTrait: string | undefined; children: React.ReactNode }): React.ReactElement {
  const schemaCtx = useEntitySchemaOptional();
  const orbital = sourceTrait !== undefined && schemaCtx !== null
    ? schemaCtx.orbitalsByTrait.get(sourceTrait)
    : undefined;
  const wrap = sourceTrait !== undefined && orbital !== undefined;
  scopeWrapLog.debug('decide', {
    sourceTrait,
    schemaCtxPresent: schemaCtx !== null,
    orbitalsByTraitSize: schemaCtx?.orbitalsByTrait.size ?? 0,
    orbital,
    wrap,
  });
  if (wrap) {
    return (
      <TraitScopeProvider orbital={orbital!} trait={sourceTrait!}>
        {children}
      </TraitScopeProvider>
    );
  }
  // Declining to wrap is not free: every bare `UI:X` emit inside these
  // children then qualifies against whatever scope surrounds them instead
  // of their owning trait, so cross-trait listeners miss it and the
  // affordance is silently dead. Storybook/compiled callers legitimately
  // land here (no schema context, or codegen already emitted the scope) —
  // hence a warning rather than a throw — but a named trait that failed
  // the `orbitalsByTrait` lookup is a real wiring hole worth surfacing.
  if (sourceTrait !== undefined && schemaCtx !== null) {
    scopeWrapLog.warn('decline', {
      sourceTrait,
      orbitalsByTraitSize: schemaCtx.orbitalsByTrait.size,
      reason: 'sourceTrait not in orbitalsByTrait — children render unscoped',
    });
  }
  return <>{children}</>;
}

/**
 * Individual slot renderer.
 *
 * Handles different slot types with appropriate wrappers.
 */
function UISlotComponent(props: UISlotComponentProps): React.ReactElement | null {
  // Actions started inside this slot (a dialog's confirm) register here, so a
  // cleared dialog holds open until they settle.
  const pendingScope = usePendingScopeValue();
  // Every subtree knows which slot hosts it (RenderSlotContext default is
  // 'main'; slot-sensitive components like DetailPanel gate on it).
  const inner = (
    <RenderSlotProvider slot={props.slot}>
      <PendingScopeContext.Provider value={pendingScope}>
        <UISlotComponentInner {...props} />
      </PendingScopeContext.Provider>
    </RenderSlotProvider>
  );
  // The system slot holds invisible components: mounted, never seen (as on the runtime path).
  return props.slot === "system" ? <Box className="sr-only">{inner}</Box> : inner;
}

function UISlotComponentInner({
  slot,
  portal = false,
  position,
  className,
  children,
  pattern,
  sourceTrait,
  enter,
  awaitingSkeleton,
  fallback,
  mode = "replace",
}: UISlotComponentProps): React.ReactElement | null {
  const { slots, clear } = useUISlots();
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const suspenseConfig = useContext(SuspenseConfigContext);
  const contained = useContext(SlotContainedContext);
  const schemaCtx = useEntitySchemaOptional();
  const rawContent = slots[slot];
  const runtimeAwaiting = useAwaitingSkeleton({ slot });
  const awaiting = isPortalSlot(slot) ? undefined : (awaitingSkeleton ?? runtimeAwaiting);
  // A region mount (one carrying `fallback`) is not a layout box: `display:
  // contents` lets the fill (stock or plugin) occupy exactly the box the
  // host's layout gives the region, as if mounted directly.
  const regionClassName = fallback !== undefined ? cn("contents", className) : className;
  // Render-time binding resolution for the slot wrappers below (Modal /
  // Drawer / Toast read `slotPropsOf(content).title` etc. directly). Nested
  // patterns re-resolve inside SlotContentRenderer with their own
  // sourceTrait — both passes are identity-preserving when no markers
  // are present.
  const binding = useEntityBindingSnapshot(rawContent?.sourceTrait);
  const i18n = useRenderI18n();
  const { resolver: rowSets, epoch: rowSetEpoch } = useRowSetResolver();
  const content = useMemo(() => {
    if (!rawContent) return rawContent;
    const resolvedProps = resolveRenderBindingMarkers(
      rawContent.props,
      rawContent.sourceTrait,
      binding.entity,
      binding.config,
      binding.state,
      i18n,
      rowSets,
    );
    return resolvedProps === rawContent.props ? rawContent : { ...rawContent, props: resolvedProps };
  }, [rawContent, binding.entity, binding.config, binding.state, i18n, rowSets, rowSetEpoch]);

  // Modal/drawer slots stay mounted through their exit animation (runtime
  // content and compiled children alike) — see useSlotPresence.
  const animatedPortal = isAnimatedPortalSlot(slot);
  const holdForPending = useScopeHasPending(useContext(PendingScopeContext));
  const runtimePresence = useSlotPresence(portal && animatedPortal ? (content ?? null) : null, holdForPending);
  const compiledPresence = useSlotPresence(
    children !== undefined && pattern !== "clear" && animatedPortal ? { children, pattern, sourceTrait } : null,
    holdForPending,
  );

  // Theme-default entry on inline slot content: replays when another trait or
  // root pattern takes the slot (a skeleton giving way to the record), not on
  // a data refresh. A region mount (`display: contents`) has no box to animate.
  const compiledMode = children !== undefined;
  const runtimeRootEnterValue = content ? slotPropsOf(content).enter : undefined;
  const runtimeRootEnter = asEnterAnimation(typeof runtimeRootEnterValue === "string" ? runtimeRootEnterValue : undefined);
  const slotEnterActive =
    fallback === undefined &&
    !isPortalSlot(slot) &&
    (compiledMode ? pattern !== "clear" : Boolean(content)) &&
    slotPlaysDefaultEnter(compiledMode ? enter : runtimeRootEnter);
  const slotContentKey = compiledMode ? `${sourceTrait ?? ""}:${pattern ?? ""}` : `${content?.sourceTrait ?? ""}:${content?.pattern ?? ""}`;
  const slotBoxRef = useRef<HTMLDivElement>(null);
  useSlotEnterRestart(slotBoxRef, slotContentKey, slotEnterActive);

  // Compiled mode: children provided directly, skip context resolution
  if (children !== undefined) {
    // "clear" pattern means dismiss/hide the slot — an animated portal slot
    // first plays its exit with the last children.
    if (pattern === "clear") {
      const last = compiledPresence.shown;
      if (last === null && awaiting !== undefined) {
        return (
          <Box id={`slot-${slot}`} className={cn("ui-slot", `ui-slot-${slot}`, className)} data-slot-mode="awaiting">
            <SkeletonTree node={awaiting} />
          </Box>
        );
      }
      // Self-overlaying content plays its own exit only when the codegen
      // handed it the presence (render-function children); finished JSX can't
      // take it, so it unmounts at once.
      const selfOverlay = last !== null && last.pattern !== undefined && SELF_OVERLAY_PATTERN_TYPES.has(last.pattern);
      const held = compiledPresence.open;
      if (last === null || (selfOverlay && typeof last.children !== "function" && !held)) {
        return null;
      }
      if (contained) {
        if (!held) return null;
        return (
          <Box
            id={`slot-${slot}`}
            className={cn("ui-slot", `ui-slot-${slot}`, className)}
            data-pattern={last.pattern}
            data-source-trait={last.sourceTrait}
          >
            <MaybeTraitScope sourceTrait={last.sourceTrait}>
              {resolveCompiledChildren(last.children, { open: true, onExited: compiledPresence.onExited })}
            </MaybeTraitScope>
          </Box>
        );
      }
      return (
        <CompiledPortal
          slot={slot}
          className={className}
          pattern={last.pattern}
          sourceTrait={last.sourceTrait}
          open={held}
          onExited={compiledPresence.onExited}
        >
          <MaybeTraitScope sourceTrait={last.sourceTrait}>
            {resolveCompiledChildren(last.children, { open: held, onExited: compiledPresence.onExited })}
          </MaybeTraitScope>
        </CompiledPortal>
      );
    }

    const openChildren = resolveCompiledChildren(children, { open: true, onExited: compiledPresence.onExited });

    // Portal slots (modal, drawer, toast): render through a portal with proper wrapper
    // In contained mode, use inline rendering with absolute positioning
    if (isPortalSlot(slot)) {
      if (contained && slot === "dock") {
        return (
          <DockSlotFrame
            open
            onExited={compiledPresence.onExited}
            onDismiss={() => {
              const orbital = sourceTrait !== undefined && schemaCtx !== null ? schemaCtx.orbitalsByTrait.get(sourceTrait) : undefined;
              const prefix = orbital !== undefined && sourceTrait !== undefined ? `UI:${orbital}.${sourceTrait}.` : "UI:";
              eventBus.emit(`${prefix}CLOSE`);
              eventBus.emit(`${prefix}CANCEL`);
              clear(slot);
            }}
            contained
          >
            <Box id={`slot-${slot}`} className={cn("ui-slot", `ui-slot-${slot}`, "flex min-h-0 flex-1 flex-col", className)} data-pattern={pattern} data-source-trait={sourceTrait}>
              <MaybeTraitScope sourceTrait={sourceTrait}>{openChildren}</MaybeTraitScope>
            </Box>
          </DockSlotFrame>
        );
      }
      if (contained) {
        return (
          <Box
            id={`slot-${slot}`}
            className={cn("ui-slot", `ui-slot-${slot}`, className)}
            data-pattern={pattern}
            data-source-trait={sourceTrait}
          >
            <MaybeTraitScope sourceTrait={sourceTrait}>{openChildren}</MaybeTraitScope>
          </Box>
        );
      }
      return (
        <CompiledPortal
          slot={slot}
          className={className}
          pattern={pattern}
          sourceTrait={sourceTrait}
          open={true}
          onExited={compiledPresence.onExited}
        >
          <MaybeTraitScope sourceTrait={sourceTrait}>{openChildren}</MaybeTraitScope>
        </CompiledPortal>
      );
    }

    return (
      <Box
        ref={slotBoxRef}
        id={`slot-${slot}`}
        className={cn("ui-slot", `ui-slot-${slot}`, slotEnterActive && ENTER_SLOT_CLASS, className)}
        data-pattern={pattern}
        data-source-trait={sourceTrait}
      >
        <MaybeTraitScope sourceTrait={sourceTrait}>{openChildren}</MaybeTraitScope>
      </Box>
    );
  }

  // A cleared modal/drawer slot keeps rendering its last content (closed)
  // until the exit animation ends.
  const shownContent = content ?? runtimePresence.shown;
  const slotOpen = (content !== null && content !== undefined) || runtimePresence.open;

  // Handle empty slot. When a `fallback` is supplied it renders INLINE at
  // this position regardless of `portal` — a portal slot's fallback is host
  // chrome, not something a plugin should ever be able to relocate, so it
  // never goes through SlotPortal/CompiledPortal.
  if (!shownContent) {
    if (fallback !== undefined) {
      return (
        <Box
          id={`slot-${slot}`}
          className={cn("ui-slot", `ui-slot-${slot}`, regionClassName)}
          data-testid={`ui-slot-${slot}`}
          data-slot-mode="fallback"
        >
          {fallback}
        </Box>
      );
    }
    // For non-portal slots, render an empty placeholder (the predicted
    // skeleton while a server round trip will fill it)
    if (!portal) {
      return (
        <Box
          id={`slot-${slot}`}
          className={cn("ui-slot", `ui-slot-${slot}`, className)}
          data-testid={`ui-slot-${slot}`}
          data-slot-mode={awaiting !== undefined ? "awaiting" : "empty"}
        >
          {awaiting !== undefined ? <SkeletonTree node={awaiting} /> : null}
        </Box>
      );
    }
    return null;
  }

  // Render content based on slot type. For interactive portal slots
  // (modal, drawer) the X / overlay click is a user dismiss, which the
  // owning trait usually models as a CLOSE/CANCEL transition. Emit both
  // standard close-style events on the eventBus so `useUIEvents` in the
  // trait hook dispatches them — without this, clicking X just clears
  // the slot DOM but the trait stays in `open` and any subsequent open
  // attempt no-ops because the state machine thinks it's already there.
  // Mirrors `ModalSlot.handleClose` (which has done it right all along).
  const handleDismiss = () => {
    if (slot === 'modal' || slot === 'drawer' || slot === 'dock') {
      const trait = shownContent.sourceTrait;
      const orbital = trait !== undefined && schemaCtx !== null
        ? schemaCtx.orbitalsByTrait.get(trait)
        : undefined;
      const prefix = orbital !== undefined && trait !== undefined
        ? `UI:${orbital}.${trait}.`
        : 'UI:';
      eventBus.emit(`${prefix}CLOSE`);
      eventBus.emit(`${prefix}CANCEL`);
    }
    clear(slot);
  };

  // Portal-based slots. Content always portals (SlotPortal/renderContainedPortal
  // own `id="slot-${slot}"` on the mount they create — see VG1/VG15). A
  // `fallback` in `append` mode paints as an INLINE sibling at this
  // position with its own id, so it never collides with the portaled
  // content's id and is never itself portaled.
  if (portal) {
    const inlineFallback =
      mode === "append" && fallback !== undefined ? (
        <Box
          id={`slot-${slot}-fallback`}
          className={cn("ui-slot", `ui-slot-${slot}-fallback`, regionClassName)}
          data-testid={`ui-slot-${slot}-fallback`}
          data-slot-mode="append"
        >
          {fallback}
        </Box>
      ) : null;
    // In contained mode, render inline with absolute positioning
    if (contained) {
      return (
        <>
          {inlineFallback}
          {renderContainedPortal(slot, shownContent, handleDismiss, slotOpen, runtimePresence.onExited)}
        </>
      );
    }
    return (
      <>
        {inlineFallback}
        <SlotPortal
          slot={slot}
          content={shownContent}
          position={position}
          onDismiss={handleDismiss}
          open={slotOpen}
          onExited={runtimePresence.onExited}
        />
      </>
    );
  }

  // Inline slots — always wrapped in an ErrorBoundary so a pattern
  // component crashing (e.g. a data pattern that dereferences an
  // unpopulated entity prop) contains the failure to that slot instead
  // of blanking the whole preview. Optional Suspense wraps when the
  // consumer opts in for async data.
  const slotContent = (
    <SlotContentRenderer content={shownContent} onDismiss={handleDismiss} />
  );

  const wrappedContent = suspenseConfig.enabled ? (
    <ErrorBoundary>
      <Suspense fallback={getSlotFallback(slot, suspenseConfig)}>
        {slotContent}
      </Suspense>
    </ErrorBoundary>
  ) : (
    <ErrorBoundary>{slotContent}</ErrorBoundary>
  );

  const showFallback = mode === "append" && fallback !== undefined;

  return (
    <Box
      ref={slotBoxRef}
      id={`slot-${slot}`}
      className={cn("ui-slot", `ui-slot-${slot}`, slotEnterActive && ENTER_SLOT_CLASS, regionClassName)}
      data-pattern={shownContent.pattern}
      data-source-trait={shownContent.sourceTrait}
      data-testid={`ui-slot-${slot}`}
      data-slot-mode={showFallback ? "append" : "content"}
    >
      {showFallback ? fallback : null}
      <MaybeTraitScope sourceTrait={shownContent.sourceTrait}>{wrappedContent}</MaybeTraitScope>
    </Box>
  );
}

// ============================================================================
// Dock frame — the `dock` slot's chrome on both paths
// ============================================================================

/** Width of the docked panel; the page gives up the same inset while it is open. */
const DOCK_INSET = "384px";

/**
 * Desktop: a full-height panel on the inline end that pushes the page (it sets
 * `--almadar-dock-inset`, which the base theme pads the body by). Compact
 * (<1024px): the existing right `Drawer`, full width on phones. The content
 * carries its own close control (an explicit `.lolo` affordance); Escape on
 * the drawer is the only chrome dismiss.
 */
function DockSlotFrame({ open, onExited, onDismiss, contained = false, children }: {
  open: boolean;
  onExited: () => void;
  onDismiss: () => void;
  /** Inside a preview box (`SlotContainedContext`): push the preview, not the page. */
  contained?: boolean;
  children: React.ReactNode;
}): React.ReactElement | null {
  const compact = useCompactLayout();
  const { t } = useTranslate();
  const panelRef = useRef<HTMLDivElement>(null);
  const pushes = open && !compact;

  useEffect(() => {
    if (!pushes) return;
    if (contained) {
      const host = panelRef.current?.closest<HTMLElement>(".ui-slot-renderer");
      if (!host) return;
      host.style.setProperty("--almadar-dock-contained-inset", DOCK_INSET);
      return () => { host.style.removeProperty("--almadar-dock-contained-inset"); };
    }
    const root = document.documentElement;
    root.style.setProperty("--almadar-dock-inset", DOCK_INSET);
    return () => { root.style.removeProperty("--almadar-dock-inset"); };
  }, [pushes, contained]);

  useEffect(() => {
    if (!open && !compact) onExited();
  }, [open, compact, onExited]);

  if (compact) {
    return (
      <Drawer isOpen={open} onExited={onExited} onClose={onDismiss} position="right" width="md" showCloseButton={false} contained={contained}>
        <Box data-testid="dock-sheet-fill" className="flex h-full min-h-0 flex-col">{children}</Box>
      </Drawer>
    );
  }
  if (!open) return null;
  return (
    <Box
      ref={panelRef}
      role="complementary"
      aria-label={t("aria.dockPanel")}
      className={cn(
        contained ? "absolute" : "fixed",
        "inset-y-0 end-0 z-[850] flex w-96 flex-col border-s border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-lg)]",
      )}
    >
      <Box className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</Box>
    </Box>
  );
}

// ============================================================================
// Compiled Portal — wraps compiled children in portal for modal/drawer/toast
// ============================================================================

interface CompiledPortalProps {
  slot: UISlot;
  className?: string;
  pattern?: string;
  sourceTrait?: string;
  children: React.ReactNode;
  /** False while a cleared modal/drawer plays its exit animation. */
  open: boolean;
  onExited: () => void;
}

function CompiledPortal({ slot, className, pattern, sourceTrait, children, open, onExited }: CompiledPortalProps): React.ReactElement | null {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const slotsBus = useUISlots();
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const compiledPortalSchemaCtx = useEntitySchemaOptional();

  useEffect(() => {
    setPortalRoot(getOrCreatePortalRoot());
  }, []);

  // X / overlay click on an interactive portal slot is a user dismiss.
  // Emit UI:CLOSE + UI:CANCEL so the owning trait's `useUIEvents` hook
  // dispatches them and the state machine actually advances, mirroring
  // what ModalSlot does. Without this the X clears the DOM but the
  // trait stays in `open` and the next OPEN no-ops on a same-state
  // transition. See std-modal G27 / VG3 click-path "no state advanced".
  const handleDismiss = () => {
    if (slot === 'modal' || slot === 'drawer' || slot === 'dock') {
      const orbital = sourceTrait !== undefined && compiledPortalSchemaCtx !== null
        ? compiledPortalSchemaCtx.orbitalsByTrait.get(sourceTrait)
        : undefined;
      const prefix = orbital !== undefined && sourceTrait !== undefined
        ? `UI:${orbital}.${sourceTrait}.`
        : 'UI:';
      eventBus.emit(`${prefix}CLOSE`);
      eventBus.emit(`${prefix}CANCEL`);
    }
    slotsBus.clear(slot);
  };

  if (!portalRoot) return null;

  // Every mounted portal slot advertises `id="slot-{name}"` on the inner
  // content wrapper so external selectors (VG1 portal probe + any DOM
  // lookup keyed off the slot name) resolve regardless of the portal's
  // outer shell (Modal / Drawer / raw fixed Box). See VG15.
  const slotId = `slot-${slot}`;
  let wrapper: React.ReactElement;

  switch (slot) {
    case "modal": {
      const innerContent = (
        <Box
          id={slotId}
          className={cn("ui-slot", `ui-slot-${slot}`, className)}
          data-pattern={pattern}
          data-source-trait={sourceTrait}
        >
          {children}
        </Box>
      );
      // Self-overlaying content (Modal / ConfirmDialog patterns) renders its
      // own backdrop + chrome — skip the Modal shell so only one backdrop
      // paints. Plain content keeps the shell.
      wrapper = pattern !== undefined && SELF_OVERLAY_PATTERN_TYPES.has(pattern) ? (
        innerContent
      ) : (
        <Modal isOpen={open} onExited={onExited} onClose={handleDismiss} showCloseButton={true} size="lg">
          {innerContent}
        </Modal>
      );
      break;
    }

    case "drawer":
      wrapper = (
        <Drawer isOpen={open} onExited={onExited} onClose={handleDismiss} position="right">
          <Box
            id={slotId}
            className={cn("ui-slot", `ui-slot-${slot}`, className)}
            data-pattern={pattern}
            data-source-trait={sourceTrait}
          >
            {children}
          </Box>
        </Drawer>
      );
      break;

    case "dock":
      wrapper = (
        <DockSlotFrame open={open} onExited={onExited} onDismiss={handleDismiss}>
          <Box
            id={slotId}
            className={cn("ui-slot", `ui-slot-${slot}`, "flex min-h-0 flex-1 flex-col", className)}
            data-pattern={pattern}
            data-source-trait={sourceTrait}
          >
            {children}
          </Box>
        </DockSlotFrame>
      );
      break;

    case "toast":
      wrapper = (
        <Box className="fixed top-4 right-4 z-50">
          <Box
            id={slotId}
            className={cn("ui-slot", `ui-slot-${slot}`, className)}
            data-pattern={pattern}
            data-source-trait={sourceTrait}
          >
            {children}
          </Box>
        </Box>
      );
      break;

    default:
      wrapper = (
        <Box
          id={slotId}
          className={cn("ui-slot", `ui-slot-${slot}`, className)}
          data-pattern={pattern}
          data-source-trait={sourceTrait}
        >
          {children}
        </Box>
      );
  }

  return (<ThemedPortal container={portalRoot}>{wrapper}</ThemedPortal>);
}

// ============================================================================
// Portal Renderer
// ============================================================================

interface SlotPortalProps {
  slot: UISlot;
  content: SlotContent;
  position?: string;
  onDismiss: () => void;
  /** False while a cleared modal/drawer plays its exit animation. */
  open: boolean;
  onExited: () => void;
  className?: string;
  isLoading?: boolean;
  error?: UiError | null;
  entity?: string;
}

function SlotPortal({
  slot,
  content,
  position,
  onDismiss,
  open,
  onExited,
}: SlotPortalProps): React.ReactElement | null {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalRoot(getOrCreatePortalRoot());
  }, []);

  if (!portalRoot) return null;

  // Every mounted portal slot advertises `id="slot-{name}"` on its wrapper
  // so the VG1 portal probe and any external selector resolve consistently
  // across contained mode, non-contained (this branch), and the compiled
  // path's CompiledPortal. See VG15.
  const slotId = `slot-${slot}`;
  const slotContent = (
    <MaybeTraitScope sourceTrait={content.sourceTrait}>
      <SlotContentRenderer content={content} onDismiss={onDismiss} presence={{ open, onExited }} />
    </MaybeTraitScope>
  );

  // Render slot-specific wrapper
  let wrapper: React.ReactElement;

  switch (slot) {
    case "modal":
      // Self-overlaying content (Modal / ConfirmDialog patterns) renders its
      // own backdrop + chrome — skip the Modal shell so only one backdrop
      // paints. Plain content keeps the shell.
      wrapper = SELF_OVERLAY_PATTERN_TYPES.has(content.pattern) ? (
        <Box id={slotId}>{slotContent}</Box>
      ) : (
        <Modal
          isOpen={open}
          onExited={onExited}
          onClose={onDismiss}
          title={slotPropsOf(content).title as string | undefined}
          size={
            slotPropsOf(content).size as "sm" | "md" | "lg" | "xl" | "full" | undefined
          }
        >
          <Box id={slotId}>{slotContent}</Box>
        </Modal>
      );
      break;

    case "drawer":
      wrapper = (
        <Drawer
          isOpen={open}
          onExited={onExited}
          onClose={onDismiss}
          title={slotPropsOf(content).title as string | undefined}
          position={(slotPropsOf(content).position as "left" | "right") ?? "right"}
          width={slotPropsOf(content).width as string | undefined}
        >
          <Box id={slotId}>{slotContent}</Box>
        </Drawer>
      );
      break;

    case "dock":
      wrapper = (
        <DockSlotFrame open={open} onExited={onExited} onDismiss={onDismiss}>
          <Box id={slotId} className="flex min-h-0 flex-1 flex-col">{slotContent}</Box>
        </DockSlotFrame>
      );
      break;

    case "toast":
      wrapper = (
        <Box id={slotId} className={cn("fixed z-50", getToastPosition(position))}>
          <SlotToasts content={content} onDismiss={onDismiss} />
        </Box>
      );
      break;

    case "overlay":
      wrapper = (
        <Box
          id={slotId}
          className="fixed inset-0 z-50 bg-scrim flex items-center justify-center"
          onClick={onDismiss}
        >
          <Box onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            {slotContent}
          </Box>
        </Box>
      );
      break;

    case "center":
      wrapper = (
        <Box id={slotId} className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <Box className="pointer-events-auto">
            {slotContent}
          </Box>
        </Box>
      );
      break;

    default:
      wrapper = <Box id={slotId}>{slotContent}</Box>;
  }

  return (<ThemedPortal container={portalRoot}>{wrapper}</ThemedPortal>);
}

type ToastVariantName = "success" | "error" | "warning" | "info";

interface SlotToastEntry {
  key: string;
  variant?: ToastVariantName;
  title?: string;
  message: string;
  sourceTrait?: string;
}

const TOAST_VARIANTS: readonly ToastVariantName[] = ["success", "error", "warning", "info"];

function stringField(value: object, key: string): string | undefined {
  const field: string | object | number | boolean | null | undefined = Reflect.get(value, key);
  return typeof field === "string" ? field : undefined;
}

function toastEntry(key: string, value: object, sourceTrait: string | undefined): SlotToastEntry {
  const variant = stringField(value, "variant");
  return {
    key,
    variant: TOAST_VARIANTS.find((v) => v === variant),
    title: stringField(value, "title"),
    message: stringField(value, "message") ?? "",
    sourceTrait,
  };
}

// Several traits writing the toast slot at once aggregate into a `stack`; each child is its own toast.
function slotToastEntries(content: SlotContent): SlotToastEntry[] {
  const props = slotPropsOf(content);
  const children = props.children;
  if (content.pattern === "stack" && Array.isArray(children)) {
    const entries: SlotToastEntry[] = [];
    children.forEach((child, index) => {
      if (typeof child !== "object" || child === null) return;
      entries.push(toastEntry(`${content.id}-${index}`, child, stringField(child, "_sourceTrait")));
    });
    return entries;
  }
  return [toastEntry(content.id, props, content.sourceTrait)];
}

function SlotToasts({ content, onDismiss }: { content: SlotContent; onDismiss: () => void }): React.ReactElement {
  const { clearBySource } = useUISlots();
  const entries = slotToastEntries(content);
  return (
    <Box className="flex flex-col gap-2">
      {entries.map((entry) => {
        const trait = entry.sourceTrait;
        return (
          <Toast
            key={entry.key}
            variant={entry.variant ?? "info"}
            title={entry.title}
            message={entry.message}
            onDismiss={entries.length > 1 && trait !== undefined ? () => clearBySource("toast", trait) : onDismiss}
          />
        );
      })}
    </Box>
  );
}

function getToastPosition(position?: string): string {
  switch (position) {
    case "top-left":
      return "top-4 left-4";
    case "top-right":
      return "top-4 right-4";
    case "bottom-left":
      return "bottom-4 left-4";
    case "bottom-right":
      return "bottom-4 right-4";
    default:
      return "top-4 right-4";
  }
}

// ============================================================================
// Content Renderer
// ============================================================================

interface SlotContentRendererProps {
  content: SlotContent;
  onDismiss: () => void;
  /**
   * The owning modal slot's presence. A self-overlaying pattern (Modal /
   * ConfirmDialog) receives it as `isOpen`/`onExited` so it plays its own exit.
   */
  presence?: { open: boolean; onExited: () => void };
  className?: string;
  isLoading?: boolean;
  error?: UiError | null;
  entity?: string;
  /** Schema-compatible path for WYSIWYG drop targeting (e.g., "root.children.0"). */
  patternPath?: string;
}

/**
 * Recursively render nested pattern children.
 *
 * Takes an array of child pattern configurations and renders them recursively.
 * The `parentPath` parameter tracks the schema-compatible path for WYSIWYG drop targeting
 * (matches `navigatePatternPath()` format: "root.children.0.children.1").
 */
function renderPatternChildren(
  children:
    | Array<
        | { type: string; props?: SlotProps; _id?: string }
        | string
      >
    | { type: string; props?: SlotProps; _id?: string }
    | string
    | undefined,
  onDismiss: () => void,
  parentId = "root",
  parentPath = "root",
  sourceTrait?: string,
  orbCtx?: { slot?: string; transitionEvent?: string; fromState?: string; entity?: string },
): React.ReactNode {
  if (children === undefined || children === null) return null;

  // Pattern authors can write `children: { type: "button", ... }` for
  // single-child patterns (popover trigger, tooltip target, card content)
  // instead of `children: [{ type: "button", ... }]`. Codegen emits both
  // forms as identical JSX so the compiled path doesn't notice; the
  // runtime path historically required an array and silently rendered
  // nothing for popover/tooltip triggers, leaving filter rows in
  // std-embedded-dashboard with invisible Date Range / Export buttons.
  // Normalize to an array before walking — per
  // `[feedback_compiled_vs_runtime_paths]`, both paths must agree.
  const childrenArray: Array<{ type: string; props?: SlotProps; _id?: string } | string | TraitValue | BehaviorRef> = Array.isArray(children)
    ? children
    : typeof children === 'string' || (typeof children === 'object' && ('type' in children || isTraitValue(children) || isBehaviorRefValue(children)))
      ? [children]
      : [];

  if (childrenArray.length === 0) return null;

  return childrenArray.map((child, index) => {
    // String children are `@trait.X` bindings in the interpreted path.
    // Substitute a `<TraitFrame>` — passive read-only lens on the
    // referenced trait's current render output. Non-matching strings
    // (unlikely here since pattern children are typed as objects, but
    // defensive) render as text via the React text-child path.
    if (typeof child === "string") {
      const match = TRAIT_BINDING_RE.exec(child);
      if (match) {
        const traitName = match[1];
        const key = `${parentId}-${index}-trait:${traitName}`;
        return <TraitFrame key={key} traitName={traitName} />;
      }
      // Non-binding string — treat as plain text so authors who want
      // literal strings inside a pattern's children (rare) still work.
      return <React.Fragment key={`${parentId}-${index}`}>{child}</React.Fragment>;
    }

    if (!child || typeof child !== "object") return null;

    // A trait VALUE (language trio: a behavior's trait held as data) mounts
    // and renders here through its host.
    if (isTraitValue(child)) {
      return (
        <React.Suspense key={`${parentId}-${index}-value:${child.behavior}.${child.trait}`} fallback={null}>
          <LazyTraitValueFrame value={child} />
        </React.Suspense>
      );
    }
    // A whole behavior VALUE runs here as an isolated program.
    if (isBehaviorRefValue(child)) {
      return (
        <React.Suspense key={`${parentId}-${index}-behavior:${child.behavior}`} fallback={null}>
          <LazyBehaviorValueFrame value={child} />
        </React.Suspense>
      );
    }

    const childId = `${parentId}-${index}`;
    const childPath = parentPath === 'root'
      ? `root.children.${index}`
      : `${parentPath}.children.${index}`;
    // Pattern configs may arrive in two shapes:
    // 1) Flat: `{type: "button", label, action, actionPayload, ...}` — the
    //    authoring form the compiler and `.lolo` emit.
    // 2) Nested: `{type: "button", props: {label, action, ...}, _id}` —
    //    the form produced by some IR transformations that lift props
    //    into a sidecar for node-id tracking.
    // Reading `child.props` alone silently drops everything in the flat
    // case — actionPayload included — which was the runtime-only VG31
    // DELETE cascade failure: the Confirm button rendered without
    // actionPayload, emitted `{}` on click, and Persistor's DO_DELETE
    // ran with no id.
    const childAsRecord = child as { type: string; props?: SlotProps; _id?: string; _sourceTrait?: string; children?: SlotPropValue } & SlotProps;
    const { type: _childType, props: nestedProps, _id: _childNodeId, _sourceTrait: childSourceTrait, children: _childChildren, ...flatProps } = childAsRecord;
    const resolvedProps: SlotProps = nestedProps !== undefined
      ? nestedProps
      : (flatProps as SlotProps);
    // Preserve children — needed by pattern components that render
    // nested trees (stack, data-grid, form-section, etc). Nested-form
    // authors put `children` inside `props`; flat-form authors put it
    // at the top level. Either way it has to survive unwrapping.
    if (_childChildren !== undefined && nestedProps === undefined) {
      resolvedProps.children = _childChildren;
    }
    // A childless stack with no styling of its own is the pattern authors'
    // "render nothing" idiom (std-calendar's `(if @config.bodySearch {...}
    // { stack children: [] })` else-branch). Painted as an empty flex div it
    // still consumes the parent's `gap`, leaving dead vertical space that
    // pushes real content (the calendar grid) below the fold of bounded
    // previews. Skip it entirely. Stacks carrying className/style keep
    // rendering — those can be intentional spacers.
    const childKids = resolvedProps.children;
    const childlessStack =
      (_childType === 'stack' || _childType === 'vstack' || _childType === 'hstack') &&
      resolvedProps.className === undefined &&
      resolvedProps.style === undefined &&
      (childKids === undefined ||
        childKids === null ||
        (Array.isArray(childKids) && !(childKids as ReadonlyArray<SlotPropValue>).length));
    if (childlessStack) {
      return null;
    }
    const childContent: SlotContent = {
      id: childId,
      pattern: child.type,
      props: resolvedProps,
      priority: 0,
      nodeId: child._id,
      // Inherit sourceTrait from the parent slot so nested patterns
      // (e.g. form-section inside a stack) can resolve entityDef via
      // the trait's linkedEntity for form-field enrichment. The orbCtx
      // (slot/transition/state/entity) propagates the same way so every
      // nested node carries a complete contextual-edit address. A child
      // carrying its own `_sourceTrait` (multi-source slot stack) owns it
      // outright — inheriting the synthetic wrapper's sentinel instead
      // would erase the real owner.
      ...(childSourceTrait !== undefined
        ? { sourceTrait: childSourceTrait }
        : sourceTrait !== undefined && { sourceTrait }),
      ...(orbCtx ?? {}),
    };

    const renderedChild = (
      <SlotContentRenderer
        key={childId}
        content={childContent}
        onDismiss={onDismiss}
        patternPath={childPath}
      />
    );

    // A child that names its own source trait establishes that trait's
    // scope for its own subtree, mirroring the compiled path's per-trait
    // `<TraitScopeProvider>`. Without this, affordances inside a
    // multi-source slot stack emit under whatever scope surrounds the
    // stack (the sentinel resolves to none) and reach no listener.
    return childSourceTrait !== undefined ? (
      <MaybeTraitScope key={childId} sourceTrait={childSourceTrait}>
        {renderedChild}
      </MaybeTraitScope>
    ) : (
      renderedChild
    );
  });
}

/**
 * Normalize a draw-HOST's authored `children` into the flat `DrawableNode[]` its
 * `drawables` prop expects (painted via `paintDrawable` / `Drawable3D`). Each child
 * arrives as `{ type, ...fields }` (flat) or `{ type, props: { ...fields } }` (nested)
 * — the same two shapes `renderPatternChildren` unwraps — so a `draw-sprite` child
 * becomes `{ type: 'draw-sprite', position, asset, ... }`. Nested `items` (layer
 * batches) ride through inside `fields` untouched. String children (trait bindings)
 * are dropped: a draw-host paints descriptors, never DOM lenses.
 */
function toDrawableNodes(
  children:
    | Array<{ type: string; props?: SlotProps; _id?: string } | string>
    | { type: string; props?: SlotProps; _id?: string }
    | string
    | undefined,
): SlotPropValue[] {
  if (children === undefined || children === null) return [];
  const arr = Array.isArray(children) ? children : [children];
  const nodes: SlotPropValue[] = [];
  for (const child of arr) {
    if (!child || typeof child !== 'object') continue;
    const rec = child as { type: string; props?: SlotProps; _id?: string } & SlotProps;
    const { type, props: nested, _id: _drop, ...flat } = rec;
    const fields: SlotProps = nested !== undefined ? nested : flat;
    nodes.push({ ...fields, type });
  }
  return nodes;
}

/**
 * Check if a value looks like a pattern config object (has a `type` string
 * field). Predicate narrows to the `EventPayload`-shaped JSON object form
 * (subset of SlotPropValue) so callers can iterate its entries with the
 * recursive `EventPayloadValue` type from `@almadar/core`.
 */
function isPatternConfig(
  value: SlotPropValue,
): value is EventPayload & { type: string } {
  if (value === null || value === undefined) return false;
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  if (React.isValidElement(value)) return false;
  if (value instanceof Date) return false;
  if (typeof value === "function") return false;
  const record = value as Record<string, EventPayloadValue>;
  // `type` must name a REGISTERED pattern/component — otherwise this is plain
  // domain data that merely happens to have a `type` field (e.g. a platformer
  // tile `{ type: "ground", x, y, width, height }` or a game unit). Without the
  // registry check those data objects get mistaken for renderable patterns and
  // wrapped as <SlotContentRenderer> elements, destroying the data the consuming
  // component reads (the platforms-never-render bug).
  //
  // Use getComponentName (@almadar/core/patterns, static JSON-backed) instead of the
  // local isKnownPattern (pattern-resolver.ts, requires initializePatterns() to
  // have been called). The local resolver starts with componentMapping={} and
  // returns false for all types until the consumer calls initializePatterns(),
  // which meant hud/logo/detail descriptor arrays passed through unrendered as
  // raw objects → React error #31 on game-template and game-shell. Static
  // JSON-backed getComponentName is always pre-populated at module load time.
  return "type" in record && typeof record.type === "string" && getComponentName(record.type) !== null;
}

/** A Date rendered in the app's locale (a component, so it can read it). */
function PatternDate({ value }: { value: Date }): React.ReactElement {
  const { locale } = useTranslate();
  return <>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(value)}</>;
}

/**
 * PatternValue → ReactNode boundary for the COMPILED path. Generated Views
 * forward node-typed config knobs straight into JSX slots
 * (`children: @config.children` → `{renderPatternValue(config?.children)}`);
 * the interpreted path resolves the same values through
 * `renderPatternChildren`/`SlotContentRenderer`, so this export routes the
 * compiled path through that exact machinery instead of handing React a raw
 * pattern object. Scalars render as text (booleans/functions render nothing,
 * matching React children semantics), Dates as their locale string, elements
 * pass through, strings resolve `@trait.X` bindings, and registered pattern
 * objects/arrays render through the component registry.
 */
export function renderPatternValue(value: SlotPropValue): React.ReactNode {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "function") return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") return renderPatternChildren(value, () => {});
  if (value instanceof Date) return <PatternDate value={value} />;
  if (React.isValidElement(value)) return value;
  if (Array.isArray(value)) {
    return (value as ReadonlyArray<SlotPropValue>).map((item, index) => (
      <React.Fragment key={index}>{renderPatternValue(item)}</React.Fragment>
    ));
  }
  if (isTraitValue(value)) {
    return (
      <React.Suspense fallback={null}>
        <LazyTraitValueFrame value={value} />
      </React.Suspense>
    );
  }
  if (isBehaviorRefValue(value)) {
    return (
      <React.Suspense fallback={null}>
        <LazyBehaviorValueFrame value={value} />
      </React.Suspense>
    );
  }
  if (isPatternConfig(value)) {
    const { type, ...props } = value;
    return renderPatternChildren({ type, props }, () => {});
  }
  return null;
}

/**
 * Plain-object guard — distinguishes a JSON-shape map from a React element,
 * Date, or class instance. Used to narrow the deep-scan walker so it only
 * recurses into config-data objects, never into renderable nodes or dates.
 */
function isPlainConfigObject(value: object): boolean {
  if (React.isValidElement(value)) return false;
  if (value instanceof Date) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Walk a render-ui prop value recursively, replacing every `@trait.X`
 * string match with a `<TraitFrame>` React element. Arrays and plain
 * config-data objects recurse; non-JSON values (functions, React elements,
 * Dates) pass through untouched. Mirrors the children-array scan in
 * `renderPatternChildren()` for the deep-prop case (e.g. tabs's
 * `items[].content` field where `@trait.X` lives inside an array of
 * objects).
 *
 * Input/output type is `SlotPropValue` — the union of every value shape
 * a render-ui prop can carry (JSON via `EventPayloadValue`, lambdas,
 * React nodes). The output stays in the same union; substituted strings
 * become `React.ReactNode` which is already a member.
 */

// Slot content is replaced only by a flush, so a container's identity is a
// valid cache key for "does this subtree hold any `@trait.X` string" — this
// keeps tick-rate re-renders from re-walking marker-free data bulk.
const traitRefPresenceCache = new WeakMap<object, boolean>();

function subtreeHasTraitRef(value: object): boolean {
  // Marker-evaluation output is runtime DATA — `@trait.X` composition refs
  // are authored literals in the raw descriptor and never appear in it.
  if (isEvaluatorResolvedData(value)) return false;
  const cached = traitRefPresenceCache.get(value);
  if (cached !== undefined) return cached;
  let found = false;
  const children: readonly SlotPropValue[] = Array.isArray(value)
    ? value
    : Object.values(value as Record<string, SlotPropValue>);
  for (const child of children) {
    if (typeof child === "string" && TRAIT_BINDING_RE.test(child)) { found = true; break; }
    if (isRenderBindingMarker(child)) continue;
    if (Array.isArray(child)) {
      if (subtreeHasTraitRef(child)) { found = true; break; }
    } else if (
      child !== null &&
      typeof child === "object" &&
      isPlainConfigObject(child)
    ) {
      if (subtreeHasTraitRef(child)) { found = true; break; }
    }
  }
  traitRefPresenceCache.set(value, found);
  return found;
}

function substituteTraitRefsDeep(
  value: SlotPropValue,
  pathKey: string,
): SlotPropValue {
  // `$renderBinding` markers (foreign `_sourceTrait` subtrees left raw for
  // their own renderer) carry an unevaluated S-expr — never rewrite inside it.
  if (isRenderBindingMarker(value)) return value;
  if (typeof value === "string") {
    const match = TRAIT_BINDING_RE.exec(value);
    if (match) {
      const traitName = match[1];
      return <TraitFrame key={`${pathKey}:${traitName}`} traitName={traitName} />;
    }
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined ||
    typeof value === "function"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    if (!subtreeHasTraitRef(value)) return value;
    return value.map((item, i) =>
      substituteTraitRefsDeep(item as SlotPropValue, `${pathKey}[${i}]`),
    ) as SlotPropValue;
  }
  if (typeof value === "object" && isPlainConfigObject(value)) {
    if (!subtreeHasTraitRef(value)) return value;
    const out: Record<string, SlotPropValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, SlotPropValue>)) {
      out[k] = substituteTraitRefsDeep(v, `${pathKey}.${k}`);
    }
    return out as SlotPropValue;
  }
  // React element, Date, class instance — pass through unchanged.
  return value;
}

/**
 * Recursively render any named props that contain pattern config objects.
 * E.g., flip-card's `front` and `back` props are pattern configs that need
 * to be converted to React elements before being passed to the component.
 *
 * Also deep-scans every non-`children` prop value for `@trait.X` strings
 * (substituted with `<TraitFrame>`). The children-array scan in
 * `renderPatternChildren()` covers literal `children` entries; this
 * deep-scan picks up references buried in config-shaped props like
 * `tabs[].content` whose schema marks the field as `trait`-typed.
 */
export function renderPatternProps(
  props: SlotProps,
  onDismiss: () => void,
  propsSchema?: Record<string, PatternPropDef>,
): SlotProps {
  const rendered: Record<string, SlotPropValue> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "children") {
      rendered[key] = value;
    } else if (propsSchema?.[key]?.types?.includes("sexpr") === true) {
      // A program held as data: a `@trait.X` inside it belongs to the program, never an embed.
      rendered[key] = value;
    } else if (isPatternConfig(value)) {
      const nestedProps: SlotProps = {};
      for (const [k, v] of Object.entries(value)) {
        if (k !== "type") nestedProps[k] = v;
      }
      const childContent: SlotContent = {
        id: `prop-${key}`,
        pattern: value.type,
        props: nestedProps,
        priority: 0,
      };
      rendered[key] = (
        <SlotContentRenderer content={childContent} onDismiss={onDismiss} />
      );
    } else if (Array.isArray(value)) {
      // Hoist the presence scan above the map: a clean array (the common
      // case — canvas drawables, marker-resolved data, static config lists)
      // passes through with its identity intact instead of paying a fresh
      // map + per-item scan every render. Marker-resolved arrays are
      // evaluator data: they skip the per-item pattern-config probe too
      // (pattern configs are authored in descriptors, not stored in entity
      // rows — same contract as the isDataArray schema guard below).
      // Item fields the schema types `node` (accordion/tabs `items[].content`)
      // hold patterns to render, inside otherwise-plain data items.
      const nodeFields = Object.entries(propsSchema?.[key]?.items?.properties ?? {})
        .filter(([, def]) => def?.types.includes("node") === true)
        .map(([name]) => name);
      const hasNodeField = (el: SlotPropValue): boolean =>
        typeof el === "object" && el !== null && !Array.isArray(el) && isPlainConfigObject(el)
        && nodeFields.some((f) => isPatternConfig((el as Record<string, SlotPropValue>)[f]));
      const holdsNodes = nodeFields.length > 0 && !isEvaluatorResolvedData(value) && value.some((el) => hasNodeField(el as SlotPropValue));
      if (holdsNodes || (!isEvaluatorResolvedData(value) && value.some((el) => isPatternConfig(el as SlotPropValue)))) {
        // falls through to the map below — pattern configs need conversion
      } else if (!subtreeHasTraitRef(value)) {
        rendered[key] = value;
        continue;
      }
      // Schema-declared data array (`items: object` — form `fields`, table
      // `columns`, tabs `items`): an item's `type` is domain data (e.g. a
      // field's input type), never a pattern name, even when it collides
      // with a registered pattern like "textarea".
      const isDataArray = propsSchema?.[key]?.items?.types?.includes("object") ?? false;
      rendered[key] = value.map((item, i) => {
        const el = item as SlotPropValue;
        if (!isDataArray && isPatternConfig(el)) {
          const nestedProps: SlotProps = {};
          for (const [k, v] of Object.entries(el)) {
            if (k !== "type") nestedProps[k] = v;
          }
          const childContent: SlotContent = {
            id: `prop-${key}-${i}`,
            pattern: el.type,
            props: nestedProps,
            priority: 0,
          };
          return <SlotContentRenderer key={i} content={childContent} onDismiss={onDismiss} />;
        }
        if (hasNodeField(el)) {
          const item: Record<string, SlotPropValue> = {};
          for (const [k, v] of Object.entries(el as Record<string, SlotPropValue>)) {
            if (nodeFields.includes(k) && isPatternConfig(v)) {
              const nestedProps: SlotProps = {};
              for (const [pk, pv] of Object.entries(v)) {
                if (pk !== "type") nestedProps[pk] = pv;
              }
              item[k] = (
                <SlotContentRenderer content={{ id: `prop-${key}-${i}-${k}`, pattern: v.type, props: nestedProps, priority: 0 }} onDismiss={onDismiss} />
              );
            } else {
              item[k] = substituteTraitRefsDeep(v, `prop:${key}[${i}].${k}`);
            }
          }
          return item as SlotPropValue;
        }
        return substituteTraitRefsDeep(el, `prop:${key}[${i}]`);
      }) as SlotPropValue;
    } else {
      // fn-form lambdas are converted UPSTREAM at the render-ui dispatch
      // site (see `convertFnFormLambdasInProps` in `runtime/fn-form-lambda.ts`).
      // By the time props reach this renderer, lambdas are already React
      // render functions routed under the consumer's expected key
      // (`children` for `renderItem`); they pass through unchanged.
      rendered[key] = substituteTraitRefsDeep(value, `prop:${key}`);
    }
  }
  return rendered;
}

/**
 * Renders the actual content of a slot.
 *
 * Dynamically renders pattern components from the registry.
 * For layout patterns with `hasChildren`, recursively renders nested patterns.
 * For all patterns, named props containing pattern configs are also rendered.
 */
function SlotContentRenderer({
  content,
  onDismiss,
  patternPath,
  presence,
}: SlotContentRendererProps): React.ReactElement {
  // Render-time binding resolution (compiled-shell parity): `@entity`-
  // dependent prop leaves arrive as `RenderBindingMarker`s and resolve
  // here against the source trait's live entity snapshot, so every
  // committed write re-renders with fresh values for EVERY pattern type.
  // Identity-stable when nothing relevant changed (Form's
  // normalizedInitialData contract is preserved).
  //
  // Lambda-row content (`makeLambdaFn`) mounts inside the owning trait's
  // subtree but carries no explicit sourceTrait — the ambient
  // TraitScopeProvider (already wrapping every slot subtree for emit
  // qualification) supplies the trait, so markers deferred out of
  // renderItem bodies resolve against the same live frame.
  const ambientScope = useTraitScope();
  const bindingTrait = content.sourceTrait ?? ambientScope?.trait;
  const binding = useEntityBindingSnapshot(bindingTrait);
  const i18n = useRenderI18n();
  const { resolver: rowSets, epoch: rowSetEpoch } = useRowSetResolver();
  const liveProps = useMemo(
    () => resolveRenderBindingMarkers(content.props, bindingTrait, binding.entity, binding.config, binding.state, i18n, rowSets),
    [content.props, bindingTrait, binding.entity, binding.config, binding.state, i18n, rowSets, rowSetEpoch],
  );
  // V2 (post-Phase-6): entity data arrives pre-resolved in `content.props.entity`
  // as a value (array or record). String-entity bindings — the EntityStore
  // fallback path — are gone; the compiler + runtime resolve bindings via
  // @payload.data / listener flows before handing props to this renderer.
  // If a stale `entity: "StringName"` literal is still present at render time
  // (e.g. non-migrated project content), dev-mode throws so the author fixes
  // the schema; prod silently renders nothing.
  // After the bare-trait-ref early return above, a string here is a
  // non-trait string payload — treat as empty props (no pattern component
  // consumes it; the fallback path below handles it).
  const propsObj: SlotProps = typeof liveProps === 'string' ? {} : liveProps;
  const entityProp = propsObj.entity;
  // Trace every render of every form-section so we can see whether
  // typing in the form causes the parent SlotContentRenderer to re-
  // render with a fresh entity reference (which would invalidate
  // Form's normalizedInitialData memo and reset typed values). Same
  // `almadar:ui:slot-render` namespace as the Slots/SlotBridge logs.
  if (content.pattern === 'form-section') {
    slotLog.debug('SlotContentRenderer:form-section-render', {
      contentId: content.id,
      sourceTrait: content.sourceTrait,
      entityRefId: refId(entityProp),
      entityIsObject: entityProp !== null && typeof entityProp === 'object' && !Array.isArray(entityProp),
    });
  }
  // Patterns whose `entity` prop is DECLARED a string (an entity name —
  // filter-group, search-input, the slot patterns) legitimately receive one;
  // the stale-binding guard applies only where the registry types it as data.
  const entityDeclaredString =
    getPatternRuntimeDefinition(content.pattern)?.propsSchema?.entity?.types?.includes('string') === true;
  if (typeof entityProp === 'string' && entityProp.length > 0 && !entityDeclaredString) {
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
      throw new Error(
        `[UISlotRenderer] Received string 'entity: "${entityProp}"' at render time. The V2 flow requires pre-resolved data; declare a fetch success listener and pass 'entity: @payload.data'. See docs/Almadar_Entity_V2_Plan.md §6.`,
      );
    }
  }

  // Event bus used for the C2 callback-prop wrap below; the surrounding
  // `MaybeTraitScope` qualifies bare `UI:X` keys to `UI:Orbital.Trait.X`
  // so the trait state machine receives the dispatch.
  const eventBus = useEventBus();
  const { t } = useTranslate();

  // Entity schema for form field type enrichment (optional — only available in runtime mode)
  const schemaCtx = useEntitySchemaOptional();
  // Two lookup paths:
  //   1. Legacy V1: entityProp is a string entity-name → look up directly.
  //   2. V2: entityProp is the resolved row/array (from @payload.row /
  //      @payload.data) → look up via the source trait's linkedEntity
  //      (projected from ResolvedTraitBinding by EntitySchemaProvider).
  // Without (2), form-section's `fields` enrichment never fires for
  // entity-bound forms in the V2 flow, and enum fields render as plain
  // text inputs instead of `<Select>`. Closes VR3.
  let entityDef: ResolvedEntity | undefined;
  if (typeof entityProp === 'string' && entityProp.length > 0 && schemaCtx) {
    entityDef = schemaCtx.entities.get(entityProp);
  } else if (schemaCtx && content.sourceTrait !== undefined) {
    const linkedEntity = schemaCtx.traitLinkedEntities.get(content.sourceTrait);
    if (linkedEntity !== undefined) {
      entityDef = schemaCtx.entities.get(linkedEntity);
    }
  }

  // Owning orbital, resolved deterministically from the source trait via the
  // schema context (same lookup as MaybeTraitScope). Omitted when unresolvable.
  const orbitalName = schemaCtx && content.sourceTrait !== undefined
    ? schemaCtx.orbitalsByTrait.get(content.sourceTrait)
    : undefined;

  const PatternComponent = getComponentForPattern(content.pattern);

  // Bare trait-embed payload: `(render-ui main "@trait.X")` reaches the
  // slot as an empty pattern whose PROPS are the `@trait.X` string itself
  // (preserved by the flush/server-effects producers). Lift it to a
  // TraitFrame — the same lens used for `@trait.X` string children —
  // instead of falling into the unknown-pattern placeholder.
  if (!PatternComponent && typeof liveProps === 'string') {
    const traitRefMatch = TRAIT_BINDING_RE.exec(liveProps);
    if (traitRefMatch) {
      return <TraitFrame key={`${content.id}:trait`} traitName={traitRefMatch[1]} />;
    }
  }

  // If we have a registered component, render it with props
  if (PatternComponent) {
    // Check if this pattern has children to render.
    // Any pattern with children array in props gets recursive rendering.
    // The PATTERNS_WITH_CHILDREN set is kept as a fast-path hint but
    // we also check for actual children presence to avoid missing any.
    // `children` can be an array (stack/grid/etc) or a single pattern
    // config (popover trigger, tooltip target). renderPatternChildren
    // accepts both shapes — see its normalization branch.
    const childrenConfig = propsObj.children as
      | Array<string | { type: string; props?: SlotProps; _id?: string }>
      | { type: string; props?: SlotProps; _id?: string }
      | string
      | undefined;
    const isSingleChild =
      typeof childrenConfig === 'string'
      || (typeof childrenConfig === 'object' && childrenConfig !== null && !Array.isArray(childrenConfig) && 'type' in childrenConfig);
    const hasChildren = PATTERNS_WITH_CHILDREN.has(content.pattern)
      || (Array.isArray(childrenConfig) && childrenConfig.length > 0)
      || isSingleChild;

    // A draw-HOST (canvas-2d / canvas-3d / the unified canvas) PAINTS its authored
    // `children` as neutral drawable descriptors instead of DOM-wrapping them.
    // Detected by the registry `drawHost` capability — pattern-sync derives it from
    // the `DrawableNode` type identity, not a name/signal. Skip `renderPatternChildren`
    // for it; the raw descriptors are routed into the host's `drawables` prop below.
    const isDrawHost = isDrawHostPattern(content.pattern);

    // Draw hosts paint their children as drawable descriptors, not DOM.
    // But when children are `@trait.X` JSX composition (organism-authored
    // `<Primitives.traits.SvgPrimitiveRender>` inside `<Canvas>`), each
    // child resolves to a TraitFrame → DrawShape that registers its
    // descriptor via DrawableRegistryContext. Detect this case: children
    // that are `@trait.` strings need the React-element path (not the
    // raw-data `toDrawableNodes` path below).
    const arr = Array.isArray(childrenConfig) ? childrenConfig : (childrenConfig ? [childrenConfig] : []);
    const hasTraitChildren = arr.some(
      (c) => typeof c === 'string' && TRAIT_BINDING_RE.test(c),
    );
    const drawHostUsesReactChildren = isDrawHost && hasTraitChildren;

    // Render children recursively (pass patternPath for WYSIWYG drop targeting).
    // Inherit sourceTrait from the parent so nested patterns (e.g. a
    // form-section inside a stack) can resolve entityDef via the trait's
    // linkedEntity. Without this, only the top-level slot pattern carries
    // sourceTrait and form enrichment skips for every nested form.
    const myPath = patternPath ?? 'root';
    const renderedChildren = (hasChildren && (!isDrawHost || drawHostUsesReactChildren))
      ? renderPatternChildren(childrenConfig, onDismiss, content.id, myPath, content.sourceTrait, {
          slot: content.slot,
          transitionEvent: content.transitionEvent,
          fromState: content.fromState,
          entity: content.entity,
        })
      : undefined;

    // Function-typed children come from the upstream fn-form lambda
    // conversion (`runtime/fn-form-lambda.ts`) and are render-prop
    // callbacks for DataGrid/DataList/Carousel — keep them in restProps
    // instead of treating them as a pattern array.
    const incomingChildren = propsObj.children;
    const childrenIsRenderFn = typeof incomingChildren === "function";
    const { children: _childrenConfig, ...restPropsNoChildren } = propsObj;
    const restProps: SlotProps = childrenIsRenderFn
      ? { ...restPropsNoChildren, children: incomingChildren }
      : restPropsNoChildren;

    // Node-slot props (hud, logo, master, detail, trigger, content, addons,
    // fallback) carry pattern-descriptor arrays authored by lolo-ui as
    // `[{ content: "X", type: typography }]`. Route them through
    // renderPatternChildren — the same path `children` uses — so they become
    // React elements before reaching the component. This path is unconditional
    // and does NOT depend on isPatternConfig resolving the type, closing the
    // crash where isKnownPattern returned false and the raw objects propagated
    // through substituteTraitRefsDeep unchanged into the component's JSX.
    const nodeSlotOverrides: SlotProps = {};
    for (const slotKey of CONTENT_NODE_SLOTS) {
      const slotVal = restProps[slotKey];
      if (slotVal === undefined || slotVal === null) continue;
      if (React.isValidElement(slotVal) || typeof slotVal === 'string' || typeof slotVal === 'number' || typeof slotVal === 'boolean') continue;
      // A typeless `{ children: [...] }` wrapper (authored slot bodies like
      // master-detail's `detail: { children: [...] }`) renders its children —
      // previously it failed this guard, fell through renderPatternProps'
      // type-requiring check too, and the slot silently showed nothing.
      const typelessChildren =
        !Array.isArray(slotVal) &&
        typeof slotVal === 'object' &&
        !('type' in (slotVal as object)) &&
        Array.isArray((slotVal as { children?: SlotPropValue }).children)
          ? (slotVal as { children: Parameters<typeof renderPatternChildren>[0] }).children
          : undefined;
      if (typelessChildren !== undefined || Array.isArray(slotVal) || (typeof slotVal === 'object' && 'type' in (slotVal as object))) {
        nodeSlotOverrides[slotKey] = renderPatternChildren(
          typelessChildren ?? (slotVal as Parameters<typeof renderPatternChildren>[0]),
          onDismiss,
          `${content.id}-${slotKey}`,
          `${myPath}.${slotKey}`,
          content.sourceTrait,
          { slot: content.slot, transitionEvent: content.transitionEvent, fromState: content.fromState, entity: content.entity },
        ) as SlotPropValue;
      }
    }

    // Recursively render any named props that are pattern configs
    const patternDef = getPatternRuntimeDefinition(content.pattern);
    const propsSchema = patternDef?.propsSchema;
    const renderedProps = renderPatternProps(restProps, onDismiss, propsSchema);

    // C2 runtime path: any callback-kind prop whose schema value is still a
    // string (e.g. `onTabChange: "TAB_CHANGED"`) is a declarative event
    // binding the schema author wired at the call site. Wrap it into a
    // function the component can invoke; the wrapper builds an OBJECT
    // payload `{ argName: value }` from the registry's `callbackArgs` so
    // the bus carries the trait's declared event payload, not a raw
    // positional spread. Mirrors the codegen wrapper at
    // `orbital-shell-typescript/src/codegen/pattern.rs` (compiled path).
    // Empty string counts as unset (same contract as Icon's `icon`), so a
    // `= ""` atom default does not become a truthy handler emitting `UI:`.
    if (propsSchema) {
      for (const [propKey, propValue] of Object.entries(renderedProps)) {
        if (typeof propValue !== 'string') continue;
        const propDef = propsSchema[propKey];
        if (!propDef || propDef.kind !== 'callback') continue;
        if (propValue === '') continue;
        renderedProps[propKey] = wrapCallbackForEvent(
          `UI:${propValue}`,
          propDef.callbackArgs,
          (eventKey, payload) => eventBus.emit(eventKey, payload),
        );
      }
    }

    // Date props: a bound value arrives as its serialized string/number form,
    // but the leaf component expects a real `Date`. Coerce at the renderer
    // boundary — symmetric with the compiled codegen's `new Date(...)`
    // (orbital-shell-typescript `pattern/registry.rs`) — so leaf components keep
    // pure `Date` props on both the compiled and runtime paths.
    if (propsSchema) {
      for (const [propKey, propDef] of Object.entries(propsSchema)) {
        const isDate = propDef.types?.some(
          (t) => t === 'date' || t === 'datetime' || t === 'timestamp',
        );
        if (!isDate) continue;
        const v = renderedProps[propKey];
        if (typeof v === 'string' || typeof v === 'number') {
          renderedProps[propKey] = new Date(v);
        } else if (v == null && propDef.required) {
          // Required `Date` with no bound value → default to today so the leaf
          // component's `date: Date` contract holds (symmetric with the compiled
          // edge's null→`new Date()` fallback in pattern/registry.rs).
          renderedProps[propKey] = new Date();
        }
      }
    }

    // Replace entity string with reactive store data. When the caller
    // already passed a pre-resolved array or single object via `entity`,
    // it flows through `renderedProps` untouched (no renderer action
    // needed). The string branch is the deprecated path.
    //
    // Auto-generate fields from entity records when not specified — this
    // is what the compiled app gets from the compiler, but the runtime
    // needs to derive at render time since the schema pattern may omit
    // field definitions.
    // V2: entity data flows through content.props.entity directly (pre-resolved
    // from @payload.data or value prop). No more store hydration.
    const finalProps: SlotProps = renderedProps;
    // Apply node-slot overrides (hud, logo, master, etc.) — rendered via
    // renderPatternChildren above, overwrite whatever renderPatternProps produced.
    for (const [k, v] of Object.entries(nodeSlotOverrides)) {
      finalProps[k] = v;
    }
    // Draw-host: feed the authored `children` descriptors to the host's `drawables`
    // prop (painted, not DOM-wrapped). `renderedChildren` was skipped above, so the
    // host renders as `<PatternComponent {...finalProps} />` with the flat drawable
    // array. Author-invisible: the `children` slot is unchanged, only its consumption.
    // When children are `@trait.X` JSX composition, skip this — renderedChildren
    // carries the React elements that register via DrawableRegistryContext.
    if (isDrawHost && !drawHostUsesReactChildren && Array.isArray(childrenConfig) && childrenConfig.length > 0) {
      finalProps.drawables = toDrawableNodes(childrenConfig);
    }
    const entityVal = finalProps.entity;
    const resolvedItems: ReadonlyArray<SlotPropValue> | null =
      Array.isArray(entityVal) && entityVal[0] !== 'fn'
        ? (entityVal as ReadonlyArray<SlotPropValue>)
        : null;
    if (
      resolvedItems &&
      resolvedItems.length > 0 &&
      !finalProps.fields &&
      !finalProps.columns
    ) {
      const sample = resolvedItems[0];
      if (sample && typeof sample === 'object' && !Array.isArray(sample) && !React.isValidElement(sample) && !(sample instanceof Date)) {
        const keys = Object.keys(sample).filter((k) => k !== 'id' && k !== '_id');
        finalProps.fields = keys.map((k, i) => ({ name: k, variant: i === 0 ? 'h4' : 'body' }));
      }
    }

    // Entity-schema field enrichment, keyed on the pattern's DECLARED
    // `@fieldsContract` (see the note at the top of this file):
    //   'form'    → editable SchemaFields (type/values/relation/hint).
    //   'display' → read-only display meta on {key, header} fields.
    // Legacy fallback: unregistered client/project patterns whose name
    // contains 'form' keep the form treatment they always had — registered
    // patterns are governed solely by their declared contract.
    const fieldsContract = getPatternFieldsContract(content.pattern)
      ?? (getPatternRuntimeDefinition(content.pattern) === null && content.pattern.includes('form') ? 'form' : undefined);
    if (fieldsContract && entityDef && Array.isArray(finalProps.fields) && finalProps.fields[0] !== 'fn') {
      finalProps.fields = fieldsContract === 'form'
        ? enrichFormFields([...finalProps.fields] as SlotPropValue[], entityDef)
        // V2: edit-form initialData comes pre-bound via `initialData: @payload.data`
        // instead of being hydrated from the entity store.
        : enrichDetailFields([...finalProps.fields] as SlotPropValue[], entityDef);
    }

    // A prop whose value shape no declared type accepts (an unresolved binding
    // string reaching an array prop) is reported on this element, not thrown.
    // Children rendered here arrive through the JSX channel, so they count as present.
    const typeMismatches = propTypeMismatches(propsSchema, finalProps, renderedChildren !== undefined ? ['children'] : []);
    if (typeMismatches.length > 0) {
      slotLog.error('SlotContentRenderer:prop-type-mismatch', {
        pattern: content.pattern,
        sourceTrait: content.sourceTrait,
        mismatches: typeMismatches.map((m) => `${m.prop}: expected ${m.expected.join(' | ')}, got ${m.got}`),
      });
      return (
        <Box
          className="p-4 text-sm border border-dashed border-error rounded-container"
          data-testid={PATTERN_PROP_TYPE_ERROR_TESTID}
          data-orb-pattern={content.pattern}
          data-orb-trait={content.sourceTrait}
          data-orb-slot={content.slot}
          data-orb-path={myPath}
        >
          {typeMismatches.map((m) => (
            <Typography key={m.prop} variant="small" color="error">
              {`${content.pattern}.${m.prop}: expected ${m.expected.join(' | ')}, got ${m.got}`}
            </Typography>
          ))}
        </Box>
      );
    }

    // A node's declared entry becomes a class on its own element (lib/enter);
    // the entry props never reach the component.
    const nodeEnterClass = enterClassName(
      asEnterAnimation(typeof finalProps.enter === 'string' ? finalProps.enter : undefined),
      typeof finalProps.enterDelay === 'number' ? finalProps.enterDelay : undefined,
    );
    delete finalProps.enter;
    delete finalProps.enterDelay;
    // An injected `skeleton` only feeds the awaiting-skeleton prediction; a
    // component that declares the prop draws it in its own loading state.
    if (propsSchema?.skeleton?.kind === 'skeleton') delete finalProps.skeleton;
    if (nodeEnterClass) {
      finalProps.className = cn(typeof finalProps.className === 'string' ? finalProps.className : undefined, nodeEnterClass);
    }

    const acceptsChildren = PATTERNS_WITH_CHILDREN.has(content.pattern);
    // JSX `<X {...props}>{c}</X>` desugars to `children={c}`, so passing
    // an explicit `undefined` overwrites a render-prop function flowing
    // in via the spread. Branch on `renderedChildren` so render-prop
    // callbacks survive when we have no recursive child JSX of our own.
    return (
      <Box
        className="slot-content contents"
        data-pattern={content.pattern}
        data-id={content.id}
        data-node-id={content.nodeId}
        data-source-trait={content.sourceTrait}
        data-pattern-path={myPath}
        data-pattern-type={content.pattern}
        data-accepts-children={acceptsChildren ? 'true' : undefined}
        data-orb-trait={content.sourceTrait}
        data-orb-slot={content.slot}
        data-orb-transition={content.transitionEvent}
        data-orb-state={content.fromState}
        data-orb-entity={content.entity}
        data-orb-path={myPath}
        data-orb-pattern={content.pattern}
        data-orb-orbital={orbitalName}
      >
        {presence !== undefined && SELF_OVERLAY_PATTERN_TYPES.has(content.pattern) ? (
          <PatternComponent {...finalProps} isOpen={presence.open} onExited={presence.onExited}>
            {renderedChildren}
          </PatternComponent>
        ) : renderedChildren !== undefined ? (
          <PatternComponent {...finalProps}>{renderedChildren}</PatternComponent>
        ) : (
          <PatternComponent {...finalProps} />
        )}
      </Box>
    );
  }

  // Fallback for unknown patterns - show placeholder
  return (
    <Box
      className="slot-content"
      data-pattern={content.pattern}
      data-id={content.id}
      data-node-id={content.nodeId}
      data-source-trait={content.sourceTrait}
      data-orb-trait={content.sourceTrait}
      data-orb-slot={content.slot}
      data-orb-transition={content.transitionEvent}
      data-orb-state={content.fromState}
      data-orb-entity={content.entity}
      data-orb-path={patternPath ?? 'root'}
      data-orb-pattern={content.pattern}
      data-orb-orbital={orbitalName}
    >
      {(propsObj.children as React.ReactNode) ?? (
        <Box className="p-4 text-sm text-muted-foreground border border-dashed border-border rounded-container">
          Unknown pattern: {content.pattern}
          {content.sourceTrait && (
            <Typography variant="small" className="ml-2">(from {content.sourceTrait})</Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export interface UISlotRendererProps {
  /** Include HUD slots */
  includeHud?: boolean;
  /** HUD positioning mode: 'fixed' (default, viewport-relative) or 'inline' (container-relative, uses sticky) */
  hudMode?: 'fixed' | 'inline';
  /** Include floating slot */
  includeFloating?: boolean;
  /** Additional class name for the container */
  className?: string;
  /** Loading state indicator */
  isLoading?: boolean;
  /** Error state */
  error?: UiError | null;
  /** Entity name for schema-driven auto-fetch */
  entity?: string;
  /**
   * Enable Suspense boundaries around each slot.
   * When true, each inline slot is wrapped in `<ErrorBoundary><Suspense>` with
   * Skeleton fallbacks. Opt-in — existing isLoading prop pattern still works.
   */
  suspense?: boolean | SuspenseConfig;
  /**
   * The current page (path or name). When set, the main slot's content animates
   * in on every page change (`PageTransition`); a layout's own content region
   * claims the transition so its chrome stays still.
   */
  pageKey?: string;
}

/**
 * Main UI Slot Renderer component.
 *
 * Renders all slot containers. Place this in your page/layout component.
 *
 * @example
 * ```tsx
 * function PageLayout() {
 *   return (
 *     <div className="page-layout">
 *       <UISlotRenderer />
 *     </div>
 *   );
 * }
 * ```
 */
export function UISlotRenderer({
  includeHud = false,
  hudMode = 'fixed',
  includeFloating = false,
  className,
  suspense,
  pageKey,
}: UISlotRendererProps): React.ReactElement {
  const isContained = hudMode === 'inline';
  const suspenseConfig: SuspenseConfig =
    suspense === true ? { enabled: true } :
    suspense && typeof suspense === 'object' ? suspense :
    { enabled: false };

  const content = (
    <Box className={cn(
      "ui-slot-renderer relative min-h-full",
      className,
    )}>
      {/* Layout slots: sidebar | main. A row only on large screens — on
          phones the columns stack. An empty sidebar renders nothing, so
          pages without one keep the plain full-width main. */}
      <Box className="flex min-h-full flex-col lg:flex-row">
        <UISlotComponent slot="sidebar" className="ui-slot-sidebar min-w-0 lg:shrink-0" />
        {pageKey !== undefined ? (
          <PageTransition locationKey={pageKey} className="flex flex-1 min-w-0 flex-col">
            <UISlotComponent slot="main" className="ui-slot-main flex-1 min-w-0 min-h-[200px]" />
          </PageTransition>
        ) : (
          <UISlotComponent slot="main" className="ui-slot-main flex-1 min-w-0 min-h-[200px]" />
        )}
      </Box>

      {/* Portal slots */}
      <UISlotComponent slot="dock" portal />
      <UISlotComponent slot="modal" portal />
      <UISlotComponent slot="drawer" portal />
      <UISlotComponent slot="overlay" portal />
      <UISlotComponent slot="center" portal />
      <UISlotComponent slot="toast" portal position="top-right" />

      {/* HUD slots (optional, for games) - absolutely positioned over content */}
      {includeHud && (
        <>
          <UISlotComponent
            slot="hud-top"
            className={isContained
              ? "absolute top-0 left-0 right-0 z-40"
              : "fixed top-0 inset-x-0 z-40"}
          />
          <UISlotComponent
            slot="hud-bottom"
            className={isContained
              ? "absolute bottom-0 left-0 right-0 z-40"
              : "fixed bottom-0 inset-x-0 z-40"}
          />
        </>
      )}

      {/* Floating slot: a draggable panel where includeFloating asks for one,
          otherwise a portal its content positions itself in (a FAB). */}
      {includeFloating ? (
        <UISlotComponent
          slot="floating"
          className={isContained ? "absolute top-2 left-2 z-50" : "fixed z-50"}
          draggable
        />
      ) : (
        <UISlotComponent slot="floating" portal />
      )}
    </Box>
  );

  // Wrap with SlotContainedContext + optional SuspenseConfigProvider
  let wrapped = content;

  if (suspenseConfig.enabled) {
    wrapped = (
      <SuspenseConfigProvider config={suspenseConfig}>
        {wrapped}
      </SuspenseConfigProvider>
    );
  }

  if (isContained) {
    wrapped = (
      <SlotContainedContext.Provider value={true}>
        {wrapped}
      </SlotContainedContext.Provider>
    );
  }

  return wrapped;
}

UISlotRenderer.displayName = "UISlotRenderer";

// ============================================================================
// Exports
// ============================================================================

export { UISlotComponent, SlotContentRenderer, SlotContainedContext };
