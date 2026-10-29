'use client';

/**
 * OrbPreview Component
 *
 * Renders a live preview of an Orbital schema (.orb program).
 * Uses static imports (no lazy loading) to ensure all providers,
 * hooks, and components share the same module instances.
 *
 * Usage:
 *   <OrbPreview schema={orbJsonStringOrObject} />
 *   <OrbPreview schema={schema} serverUrl="/api/orbitals" />
 *
 * @packageDocumentation
 */

import React, { createContext, useContext, useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { useHref, useInRouterContext } from 'react-router-dom';
import { useArbitraryClassStyles } from '../providers/ArbitraryClassCompiler';
import { Box } from '../core';
import { Typography } from '../core';
import { OrbitalProvider } from '../providers/OrbitalProvider';
import { useUser, type UserData } from '../providers/UserContext';
import { CurrentPagePathProvider } from '../providers/CurrentPagePathContext';
import { VerificationProvider } from '../providers/VerificationProvider';
import { UISlotProvider, useUISlots } from '../providers/UISlotContext';
import { UISlotRenderer } from '../components/core/organisms/UISlotRenderer';
import { useEventBus } from '../core';
import { useTranslate } from '../core';
import type { OrbitalSchema, EntityData, ResolvedTraitBinding, OrbitalDefinition, ThemeRef, LazyPage, ViewerAuthority, SchemaMetadata } from '@almadar/core';
import { getPage, orbitalInlineEntities, storesRowsInBrowser, collectCallsiteCaptureChildren, isHostSignInRoute, localeAlternates } from '@almadar/core';
import { useResolvedSchema } from '../hooks/useResolvedSchema';
import { matchPathAmong } from '../core';
import { collectEmbeddedTraits, collectTraitRefsFromResolvedTrait } from '../lib/embedded-traits';
import { useTraitStateMachine } from '../hooks/useTraitStateMachine';
import { buildOrbitalsByTrait } from '../lib/orbitalsByTrait';
import { buildTraitLinkedEntities } from '../runtime';
import { EntitySchemaProvider } from '../providers/EntitySchemaContext';
import { EntityBindingContext } from '../providers/EntityBindingContext';
import { AwaitingSkeletonContext } from '../providers/AwaitingSkeletonContext';
import { ServerBridgeProvider, useServerBridge, type ServerBridgeTransport, type AccessTokenProvider } from '../providers/ServerBridge';
import { OrbitalThemeProvider } from '../providers/OrbitalThemeProvider';
import { getAllPages } from '../core';
import { PageAccessHost } from '../providers/PageAccessHost';
import { usePageHead } from '../hooks/usePageHead';
import { NavStackProvider, useNavStack, type NavStackApi, type NavPageDecl } from '../core';
import { loadLazyPage, type SchemaLoader } from '@almadar/shell-runtime';
import type { PersistenceAdapter } from '@almadar/core';
import { LoadingState } from '../components/core/molecules/LoadingState';
import { ErrorState } from '../components/core/molecules/ErrorState';
import { useBrowserStore } from '../hooks/circuit/useBrowserStore';
import { KernelEngineProvider, useKernelEngine } from '../providers/KernelEngineContext';
import { ClientTicksPausedContext } from '../hooks/circuit/useClientTicks';
import type { KernelLoader, LanguageLoader } from '../lib/kernel-wire';
import { RowSetResolverProvider } from '../providers/RowSetResolverContext';
import { createCircuitRowSetResolver } from '../lib/store-row-set-resolver';
import { browserRowSets } from '../lib/browser-row-sets';
import { createLogger } from '@almadar/logger';
import { fitContentTransform, slotContentRect, type FitTransform } from './fitContent';

// Gap #11 (Almadar_Std_Verification.md): cross-orbital cascade tracing on
// the UI side. Pairs with the server-side `almadar:runtime:cross-orbital`
// channel; logs `SchemaRunner:mount` so the runtime-verify console capture
// can reconstruct which traits the runtime path believes belong on the
// active page. Slot-write attribution (which trait rendered what) is now
// `hooks/circuit/useSlotFlush.ts`'s job — the client role's own composition
// owns the dispatch that produces those writes.
const xOrbitalLog = createLogger('almadar:runtime:cross-orbital');
const navLog = createLogger('almadar:runtime:navigation');

/**
 * Exposes the mounted NavStackProvider's api to OrbPreview through a ref —
 * OrbPreview sits OUTSIDE the provider but its effect handlers
 * (crumb-carrying navigate, navigate-back) need the api.
 */
function NavStackRefBridge({ apiRef }: { apiRef: React.MutableRefObject<NavStackApi | null> }) {
  const api = useNavStack();
  useEffect(() => {
    apiRef.current = api;
    return () => {
      apiRef.current = null;
    };
  }, [api, apiRef]);
  return null;
}

/** Reports the host router's href for its root: `/`, `#/` (hash), `/base` (basename). */
function HostHrefBaseProbe({ onBase }: { onBase: (base: string) => void }): null {
  const base = useHref('/');
  useEffect(() => onBase(base), [base, onBase]);
  return null;
}

/**
 * The app path an in-app link points at, decoded with the host router's own
 * href encoding; null when the href is not one the host router produced.
 */
function appPathFromHref(href: string, hostHrefBase: string): string | null {
  const root = hostHrefBase.endsWith('/') ? hostHrefBase.slice(0, -1) : hostHrefBase;
  if (href === root) return '/';
  if (!href.startsWith(`${root}/`)) return null;
  return href.slice(root.length);
}

/**
 * Mounts the client-role trait state machine for the active page's trait
 * bindings and provides the render-time `EntityBindingContext`.
 *
 * The old dual round-trip (local dispatch here, THEN a separate
 * `bridge.sendEvent` + manual `applyServerEffects`/`commitServerEntity`/
 * `applyServerStates` continuation) is gone: `useTraitStateMachine`'s
 * kernel posts a dispatch's server leg and folds the response
 * (`postServerLeg`/`applyOrbitalEventResponse`, `@almadar/runtime`) BEFORE
 * its own `sendEvent`/mount-time dispatch resolves — this component only
 * decides WHICH transport (or none) the kernel dispatches through.
 */
function TraitInitializer({ traits, routeParams, mountKey, routePath, orbitals, metadata, typeContractVersion, onNavigate, onNavigateBack, onLocalFallback, localFallbackTimeoutMs, browserStore, embeddedTraits, callsiteCaptureChildrenByTrait, hasBridge, children }: {
  traits: ResolvedTraitBinding[];
  /** Route params from a parameterized page path — merged into every INIT payload. */
  routeParams?: Record<string, string>;
  /** The mounted page's identity — keys the once-per-mount INIT guard. */
  mountKey?: string;
  routePath?: string;
  /** The resolved schema's full orbital set — `useCircuitKernel`'s one input. */
  orbitals: readonly OrbitalDefinition[];
  /** The program's `_metadata`: a compiled client program's operator sites and dispatch facts ride it into the kernel. */
  metadata?: SchemaMetadata;
  /** The program's type-contract stamp: the kernel refuses to register a program without it. */
  typeContractVersion?: 1;
  onNavigate?: (path: string, params?: Record<string, string>, crumb?: string) => void;
  /** navigate-back effect handler: pop the orbital's navigation stack. */
  onNavigateBack?: () => void;
  /**
   * GAP-19: called when the server bridge hasn't connected within
   * `localFallbackTimeoutMs`. INIT itself no longer waits on this — the
   * kernel dispatches every trait's own lifecycle event immediately,
   * bridged or not — this is purely the "tell the caller we're running
   * without a live server" signal.
   */
  onLocalFallback?: () => void;
  localFallbackTimeoutMs?: number;
  /** The browser store for `[persistent: x, browser]` entities. */
  browserStore?: PersistenceAdapter;
  /**
   * Set of trait names referenced via `@trait.X` by some sibling layout
   * in the resolved schema. When an effect's `traitName` is in this set,
   * the flush updates only the per-trait sidecar and skips the slot write —
   * the layout owns the slot and embeds via TraitFrame.
   */
  embeddedTraits?: ReadonlySet<string>;
  /**
   * Referrer trait name → the DIRECT children (via `@trait.X`) that need
   * their lifecycle transition re-run under the referrer's payload whenever
   * the referrer's own transition fires — forwarded to
   * `useTraitStateMachine`'s `useCallsiteCapture`.
   */
  callsiteCaptureChildrenByTrait?: ReadonlyMap<string, ReadonlySet<string>>;
  /** True when OrbPreview was given a `serverUrl`/`transport` — gates
   *  whether this page dispatches through the bridge's transport. */
  hasBridge: boolean;
  /**
   * Slot subtree — wrapped in `EntityBindingContext.Provider` so the
   * renderer resolves `RenderBindingMarker` prop leaves against this
   * hook's live per-trait binding stores.
   */
  children?: React.ReactNode;
}) {
  const bridge = useServerBridge();
  const uiSlots = useUISlots();

  // GAP-19: lifecycle events are dispatched on mount; the kernel holds them
  // only until `register()` reports the topology (resolved or failed). This
  // timer only tells the caller the bridge never connected.
  useEffect(() => {
    if (!hasBridge) return;
    const timer = setTimeout(() => {
      if (!bridge.connected) onLocalFallback?.();
    }, localFallbackTimeoutMs ?? 5000);
    return () => clearTimeout(timer);
  }, [hasBridge, bridge.connected, onLocalFallback, localFallbackTimeoutMs]);

  const { entityBindingSource, awaitingSkeletonSource } = useTraitStateMachine(traits, uiSlots, {
    orbitals,
    ...(metadata !== undefined ? { metadata } : {}),
    ...(typeContractVersion !== undefined ? { typeContractVersion } : {}),
    ...(onNavigate !== undefined ? { navigate: onNavigate } : {}),
    ...(onNavigateBack !== undefined ? { navigateBack: onNavigateBack } : {}),
    ...(embeddedTraits !== undefined ? { embeddedTraits } : {}),
    ...(callsiteCaptureChildrenByTrait !== undefined ? { callsiteCaptureChildrenByTrait } : {}),
    initPayload: routeParams,
    ...(mountKey !== undefined ? { mountKey } : {}),
    ...(routePath !== undefined ? { routePath } : {}),
    ...(hasBridge ? { transport: bridge.transport, carriesCircuitState: bridge.carriesCircuitState, awaitTopology: !bridge.topologyKnown } : {}),
    ...(browserStore !== undefined ? { browserStore } : {}),
  });

  return (
    <EntityBindingContext.Provider value={entityBindingSource}>
      <AwaitingSkeletonContext.Provider value={awaitingSkeletonSource}>{children}</AwaitingSkeletonContext.Provider>
    </EntityBindingContext.Provider>
  );
}

/**
 * Scale-to-fit wrapper: measures the rendered content's natural size and
 * uniformly scales it down (never up) so it fits the container without
 * scrollbars. CSS transforms participate in hit-testing, so game canvas
 * pointer input keeps working at any scale. Used by `fit` previews (the
 * hero demo) whose content has a fixed intrinsic size (game canvases).
 * `content` mode fits the rendered component itself — the slot content, laid
 * out at `CONTENT_STAGE_WIDTH` — and centers it (a palette tile, a drag image).
 */
const CONTENT_STAGE_WIDTH = 480;
const NO_ORBITALS: readonly OrbitalDefinition[] = [];

/** True only around the lazy page a preview renders: that page is part of the program its parent already registered. */
const LazyPageOfRegisteredProgram = createContext(false);

function FitToBox({ children, mode = 'box' }: { children: React.ReactNode; mode?: 'box' | 'content' }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [fitted, setFitted] = useState<FitTransform>({ scale: 1, x: 0, y: 0 });
  const scaleRef = useRef(1);
  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const update = () => {
      const cw = outer.clientWidth;
      const ch = outer.clientHeight;
      if (mode === 'content') {
        const rect = slotContentRect(inner, scaleRef.current);
        if (!rect) return;
        const next = fitContentTransform({ width: cw, height: ch }, rect);
        scaleRef.current = next.scale;
        setFitted(next);
        return;
      }
      const sw = inner.scrollWidth;
      const sh = inner.scrollHeight;
      if (!sw || !sh || !cw || !ch) return;
      setFitted({ scale: Math.min(1, cw / sw, ch / sh), x: 0, y: 0 });
    };
    update();
    const cleanups: Array<() => void> = [];
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(outer);
      ro.observe(inner);
      cleanups.push(() => ro.disconnect());
    }
    // A component that lays out after mount (data arriving, a grid filling in)
    // changes what's rendered without resizing the fixed-width stage.
    if (mode === 'content' && typeof MutationObserver !== 'undefined') {
      let frame = 0;
      const schedule = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(update);
      };
      const mo = new MutationObserver(schedule);
      mo.observe(inner, { childList: true, subtree: true, attributes: true, characterData: true });
      schedule();
      cleanups.push(() => {
        mo.disconnect();
        cancelAnimationFrame(frame);
      });
    }
    return () => cleanups.forEach((c) => c());
  }, [mode]);
  return (
    <div ref={outerRef} className="relative h-full w-full overflow-hidden" data-fit-mode={mode}>
      <div
        ref={innerRef}
        style={{
          transform: `translate(${fitted.x}px, ${fitted.y}px) scale(${fitted.scale})`,
          transformOrigin: 'top left',
          width: mode === 'content' ? CONTENT_STAGE_WIDTH : 'fit-content',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Resolves schema, mounts trait state machines, and renders the UI.
 * When `serverUrl` is provided, wraps with ServerBridgeProvider and
 * forwards events to the server after local processing.
 */
function SchemaRunner({ schema, serverUrl, transport, getAccessToken, mockData, pageName, routeParams, onNavigate, onNavigateBack, onLocalFallback, localFallbackTimeoutMs, themeOverride }: {
  schema: OrbitalSchema;
  serverUrl?: string;
  transport?: ServerBridgeTransport;
  getAccessToken?: AccessTokenProvider;
  mockData?: EntityData;
  pageName?: string;
  /** Route params extracted from a parameterized page path (`/x/:id`) — merged into INIT payloads. */
  routeParams?: Record<string, string>;
  onNavigate?: (path: string, params?: Record<string, string>, crumb?: string) => void;
  /** navigate-back effect handler: pop the orbital's navigation stack. */
  onNavigateBack?: () => void;
  /** GAP-19: forwarded to TraitInitializer to surface server-bridge fallback. */
  onLocalFallback?: () => void;
  /** Forwarded to TraitInitializer — see OrbPreviewProps doc. */
  localFallbackTimeoutMs?: number;
  /** See OrbPreviewProps.themeOverride. */
  themeOverride?: string;
}) {
  const { traits, allEntities, allTraits, ir } = useResolvedSchema(schema, pageName);

  // Gap #13: orbitals are bound to pages, so trait subscriptions must be
  // route-scoped. Pre-fix, this branch collected traits from every page on
  // initial load — so on standalone preview (where no `navigate` effect
  // ever fires) ALL orbitals' traits mounted simultaneously. A bare CREATE
  // dispatched on the Deals page reached ContactCreate too, opening the
  // wrong modal (gap #13 evidence: runtime-verify and orbital-verify
  // frames showed Contact modals on Deal walks).
  //
  // Fix: when no page is explicitly active, mount only the FIRST page's
  // traits — a single orbital's worth, matching the compiled-shell
  // route-mounted layout. Cross-orbital channels still flow via the
  // qualified `UI:Orbital.Trait.EVENT` bus key (Phase 4 unification);
  // orbital isolation is now enforced at both subscription and dispatch
  // layers.
  const allPageTraits = useMemo<ResolvedTraitBinding[]>(() => {
    // Resolve the page's directly-composed trait bindings.
    let base: ResolvedTraitBinding[];
    if (pageName && traits.length > 0) {
      base = traits;
    } else if (!ir?.pages || ir.pages.size <= 1) {
      // Single-page schemas: the resolved traits are already the right set.
      base = traits;
    } else {
      // Initial load with multiple pages: pick the initial page's traits.
      const firstPage = getPage(ir);
      if (!firstPage) {
        base = traits;
      } else {
        const firstPageTraits: ResolvedTraitBinding[] = [];
        const seen = new Set<string>();
        for (const binding of firstPage.traits) {
          const name = binding.trait.name;
          if (name && !seen.has(name)) {
            seen.add(name);
            firstPageTraits.push(binding);
          }
        }
        base = firstPageTraits.length > 0 ? firstPageTraits : traits;
      }
    }
    // Append embed-routed `@trait.X` siblings (e.g. a calendar pulled into the
    // orbital by the compiler's sibling-pull and rendered via `@trait` inside a
    // page trait). They are NOT page bindings, so without this they'd never get
    // a state machine — their own fetch-success (e.g. CalendarEventLoaded) would
    // fire with no subscriber and the trait would stick in `loading`. Look each
    // referenced sibling up in the full resolved-trait map and bind it (rebound
    // to its resolved linkedEntity), recursively, deduped.
    const byName = new Set(base.map((b) => b.trait.name));
    const extra: ResolvedTraitBinding[] = [];
    const queue = [...base];
    while (queue.length > 0) {
      const binding = queue.shift();
      if (!binding) continue;
      for (const refName of collectTraitRefsFromResolvedTrait(binding.trait)) {
        if (byName.has(refName)) continue;
        const rt = allTraits.get(refName);
        if (!rt) continue;
        byName.add(refName);
        const sibling: ResolvedTraitBinding = { trait: rt, linkedEntity: rt.linkedEntity };
        extra.push(sibling);
        queue.push(sibling);
      }
    }
    return extra.length > 0 ? [...base, ...extra] : base;
  }, [ir, traits, pageName, allTraits]);

  // Gap #13: trait-name → owning-orbital-name map. Built from
  // `schema.orbitals[].traits[]` so `useTraitStateMachine` can construct
  // the qualified `UI:Orbital.Trait.EVENT` bus key at both subscribe and
  // emit sites — same scope shape the compiled codegen produces.
  const orbitalsByTrait = useMemo<Record<string, string>>(
    () =>
      buildOrbitalsByTrait(
        schema,
        ir
          ? Array.from(ir.pages.values()).map((p) => ({
              path: p.path,
              traitNames: p.traits.map((b) => b.trait.name),
            }))
          : [],
      ),
    [schema, ir],
  );

  const mountRoute = useMemo<string | undefined>(() => {
    return ir ? getPage(ir, pageName)?.path : undefined;
  }, [ir, pageName]);

  // Per-trait linkedEntity map for EntitySchemaProvider — page bindings plus embedded traits (G-UI-086).
  const traitLinkedEntitiesMap = useMemo<ReadonlyMap<string, string>>(
    () => (ir ? buildTraitLinkedEntities(ir) : new Map<string, string>()),
    [ir],
  );

  // `orbitalsByTrait` shaped as a `ReadonlyMap` for EntitySchemaProvider.
  // Same source of truth as the Record above (`orbitalsByTrait`), just
  // the Map shape the provider's context expects. Memoized against the
  // Record so it only rebuilds when the schema changes.
  const orbitalsByTraitMap = useMemo<ReadonlyMap<string, string>>(
    () => new Map(Object.entries(orbitalsByTrait)),
    [orbitalsByTrait],
  );

  // Stable array of resolved entities for EntitySchemaProvider. Without
  // memoization the inline `Array.from(...)` allocation produces a new
  // array reference per render, busting downstream `useMemo` deps.
  const entitiesArray = useMemo(() => Array.from(allEntities.values()), [allEntities]);

  // Gap #11: orbitals whose traits are mounted on the active page. The
  // server-bridge fan-out (both user-event and INIT) restricts to this
  // subset so off-page orbitals don't initialize server-side and leak
  // their `(render-ui main {...})` patterns into the active page's slot.
  // Cross-orbital `listens` still fire because the server has every
  // orbital registered; this only narrows the client's dispatch breadth.
  const pageOrbitalNames = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const binding of allPageTraits) {
      const orb = orbitalsByTrait[binding.trait.name];
      if (orb) set.add(orb);
    }
    return Array.from(set);
  }, [allPageTraits, orbitalsByTrait]);

  // Gap #11: emit allPageTraits at mount/page-change so runtime-verify's
  // console capture shows which traits the runtime path believes belong on
  // the active page. Compare against the .lolo `page "X" -> ...` declaration
  // and against compiled codegen to detect under-mount or over-mount.
  useEffect(() => {
    const traitNames = allPageTraits.map((b) => b.trait.name);
    const orbitalsByTraitForPage: Record<string, string> = {};
    for (const name of traitNames) {
      const orb = orbitalsByTrait[name];
      if (orb) orbitalsByTraitForPage[name] = orb;
    }
    xOrbitalLog.info('SchemaRunner:mount', {
      pageName,
      traitNames: traitNames.join(','),
      orbitalsByTraitForPage,
      pageOrbitalNames: pageOrbitalNames.join(','),
    });
  }, [pageName, allPageTraits, orbitalsByTrait, pageOrbitalNames]);

  // Referrer trait name → the DIRECT children (via `@trait.X`) that need
  // their lifecycle transition re-run under the referrer's payload whenever
  // the referrer's own transition fires (`@almadar/core`'s
  // `collectCallsiteCaptureChildren`, threaded to `useTraitStateMachine`'s
  // `reRenderCallsiteCaptureChildren`). Merged across every orbital in the
  // schema, same flattening `orbitalsByTrait` uses —
  // trait names are unique within one running schema.
  const callsiteCaptureChildrenByTrait = useMemo<ReadonlyMap<string, ReadonlySet<string>>>(() => {
    const merged = new Map<string, ReadonlySet<string>>();
    const orbitals: OrbitalDefinition[] | undefined = schema?.orbitals;
    if (orbitals) {
      for (const orbital of orbitals) {
        for (const [referrer, children] of collectCallsiteCaptureChildren(orbital)) {
          merged.set(referrer, children);
        }
      }
    }
    return merged;
  }, [schema]);

  // V2 Phase 6: EntityStore is gone. Standalone-preview (no serverUrl) with
  // `mockData` no longer hydrates a shared store; mock data now flows through
  // the event bus the same way a real server response does — i.e. traits
  // that `fetch` during INIT need a mock bridge to surface the data as
  // `@payload.data` on the success emit. See Almadar_Entity_V2_Plan.md §13
  // for the deferred standalone-preview mock-data wiring.
  void mockData;

  // Embed-aware slot routing: walk the resolved schema once, collect
  // every trait name referenced via `@trait.X` by some sibling layout's
  // render-ui. `applyServerEffects` uses this to route those traits'
  // render outputs to per-trait sidecars instead of the global slot.
  // Mirrors compiled-path codegen which inlines atom views as JSX
  // inside the layout's pattern rather than writing a shared slot.
  const embeddedTraits = useMemo(() => {
    const set = collectEmbeddedTraits(schema);
    xOrbitalLog.info('SchemaRunner:embeddedTraits', {
      pageName,
      embedded: Array.from(set),
      embeddedCount: set.size,
    });
    return set;
  }, [schema, pageName]);

  const activeOrbitalTheme = useMemo(() => resolvePreviewTheme(schema, pageName), [schema, pageName]);
  const { locale } = useTranslate();
  // A host that runs the whole program keeps its browser-stored entities; this view opens none.
  const browserStore = useBrowserStore(schema.name ?? 'app', transport?.hostsBrowserStore === true ? NO_ORBITALS : schema.orbitals, locale);

  const viewer = useUser();
  const bridge = useServerBridge();
  const kernelEngine = useKernelEngine();
  const browserRows = useMemo(
    () => (browserStore.status === 'ready' && kernelEngine !== null
      ? browserRowSets(kernelEngine, { name: schema.name ?? 'app', orbitals: schema.orbitals, ...(schema.typeContractVersion !== undefined ? { typeContractVersion: schema.typeContractVersion } : {}) }, browserStore.store, viewer.user ?? undefined)
      : undefined),
    [browserStore, kernelEngine, schema.name, schema.orbitals, viewer.user],
  );
  useEffect(() => () => browserRows?.dispose(), [browserRows]);
  const rowSets = useMemo(() => {
    const inlineEntities = schema.orbitals.flatMap(orbitalInlineEntities);
    const remote = bridge.transport.resolveRows?.bind(bridge.transport);
    return createCircuitRowSetResolver({
      ...(browserRows !== undefined
        ? { browser: { resolve: browserRows.resolve, entityTypes: new Set(inlineEntities.filter(storesRowsInBrowser).map((e) => e.name)) } }
        : {}),
      ...(remote !== undefined ? { remote } : {}),
    });
  }, [browserRows, schema.orbitals, bridge.transport]);

  const circuit = (
    <VerificationProvider enabled>
      <EntitySchemaProvider
        entities={entitiesArray}
        traitLinkedEntities={traitLinkedEntitiesMap}
        orbitalsByTrait={orbitalsByTraitMap}
      >
        <TraitInitializer
          traits={allPageTraits}
          routeParams={routeParams}
          mountKey={pageName}
          {...(mountRoute !== undefined ? { routePath: mountRoute } : {})}
          orbitals={schema.orbitals}
          {...(schema._metadata !== undefined ? { metadata: schema._metadata } : {})}
          {...(schema.typeContractVersion !== undefined ? { typeContractVersion: schema.typeContractVersion } : {})}
          hasBridge={Boolean(serverUrl || transport)}
          embeddedTraits={embeddedTraits}
          callsiteCaptureChildrenByTrait={callsiteCaptureChildrenByTrait}
          onNavigate={onNavigate}
          onNavigateBack={onNavigateBack}
          onLocalFallback={onLocalFallback}
          localFallbackTimeoutMs={localFallbackTimeoutMs}
          {...(browserStore.status === 'ready' ? { browserStore: browserStore.store } : {})}
        >
        {/* Sizing model:
            - `h-full` resolves to 100% of the parent's `style.height`. When
              consumers pass an explicit pixel height (e.g. canvas L2's
              transition card frame), this gives the chain a real number,
              which `UISlotRenderer`'s `min-h-full` then uses so the
              contained-portal modal/drawer (`absolute inset-0`) fills the
              card. With only `min-h-full` here, the percentage on the
              child resolved against an unspecified parent height per CSS
              spec — collapsing to 0 — and modals painted as tiny rects.
            - `min-h-full` keeps the "grow past frame" behavior when the
              parent's height is `auto` (consumers like docs MDX that pass
              `height="auto"`). With auto parent, `h-full` is also auto so
              both clauses fall through and content drives the height.
            - `overflow-auto` keeps tall layouts scrollable within the
              frame instead of overflowing past it when the parent has an
              explicit pixel height. The outer OrbPreview Box already has
              `overflow-auto`; this is defense-in-depth.
            The HUD docks via `absolute bottom-0` inside UISlotRenderer's
            own `relative min-h-full` container, so empty layouts still
            anchor the bar at the bottom of the viewport. */}
        <OrbitalThemeProvider theme={activeOrbitalTheme} override={themeOverride}>
          <Box className="h-full min-h-full overflow-auto p-4">
            <UISlotRenderer includeHud hudMode="inline" includeFloating pageKey={pageName} />
          </Box>
        </OrbitalThemeProvider>
        </TraitInitializer>
      </EntitySchemaProvider>
    </VerificationProvider>
  );

  const inner = rowSets === undefined ? circuit : <RowSetResolverProvider resolver={rowSets}>{circuit}</RowSetResolverProvider>;

  if (browserStore.status === 'opening') return <LoadingState />;
  if (browserStore.status === 'failed') {
    return <ErrorState data-testid="browser-store-error" message={browserStore.error.message} />;
  }

  return inner;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface OrbPreviewProps {
  /**
   * The orbital schema. Accepts a JSON string or an `OrbitalSchema` object
   * from `@almadar/core` (the validated `.orb` program type).
   */
  schema: string | OrbitalSchema;
  /**
   * Mock entity rows keyed by entity name. The `EntityData` type from
   * `@almadar/core` is `Record<string, EntityRow[]>` where each row is a
   * `{ id?: string } & Record<string, FieldValue>`.
   */
  mockData?: EntityData;
  /** Preview container height. Default: '400px'. */
  height?: string;
  /** CSS class for the outer container. */
  className?: string;
  /** Server URL for dual execution (e.g. "/api/orbitals"). When set, events are forwarded to the server. */
  serverUrl?: string;
  /**
   * Custom transport for in-process execution. Mutually exclusive with
   * `serverUrl`. Used by an in-process host to invoke
   * `OrbitalServerRuntime.processOrbitalEvent` directly without HTTP.
   */
  transport?: ServerBridgeTransport;
  /** Bearer token for `serverUrl` requests (see `ServerBridgeProviderProps.getAccessToken`). */
  getAccessToken?: AccessTokenProvider;
  /**
   * Loads the initialised `@almadar/kernel`. Given, the preview runs its circuits on the kernel engine and installs the
   * render evaluator from it (`KernelEngineProvider`); keep the function's identity stable across renders. Absent, the
   * preview runs under whatever engine the host's own `KernelEngineProvider` selects.
   */
  kernelLoader?: KernelLoader;
  /** Resolves the language bundle a kernel opened over browser-stored rows needs (forwarded to `KernelEngineProvider`); keep its identity stable. */
  languageLoader?: LanguageLoader;
  /**
   * How long (ms) to wait for the server bridge to connect before assuming
   * it's unreachable and falling back to local-only execution. Default
   * 5000 (unchanged unless you pass this). Widen it for a caller whose
   * schema is large enough that the server's first `register()` genuinely
   * takes longer than 5s (e.g. a 53-orbital organism measured ~14.5s in
   * production) — see `TraitInitializer`'s `localFallbackTimeoutMs` doc.
   */
  localFallbackTimeoutMs?: number;
  /**
   * Initial page path to render (e.g. `/deals`). Resolves against the
   * schema's `pages[]` to seed `currentPage` so the right orbital's traits
   * mount on first render. Without this the playground falls back to the
   * schema's first page binding (gap #13 Phase 5). runtime-verify uses this
   * to walk DealCreate, NoteCompose, etc. on their owning pages.
   */
  initialPagePath?: string;
  /**
   * The signed-in viewer — forwarded to `OrbitalProvider`'s `UserProvider` so
   * `@user.x` resolves in client-side guard and effect evaluation exactly as
   * it does on the server. Omitted → anonymous.
   */
  user?: UserData | null;
  /**
   * What the host's auth provider has resolved the viewer to be. An
   * `access: authenticated` page mounts only on `authenticated`; any other
   * resolved value sends the viewer to the app's `signIn` route. Omitted → the
   * host offers no sign-in (`unavailable`).
   */
  authority?: ViewerAuthority;
  /**
   * Sandbox mode, for previews embedded in a host app (e.g. the studio
   * canvas): the event bus stays context-local, navigation stays in memory
   * (the host URL/history are never touched), in-app links are always
   * intercepted, and external links open a new tab. Default false
   * (standalone previews own the global bridge and sync `?page=`).
   */
  isolated?: boolean;
  /**
   * Scale the rendered content down (never up) so it fits the container
   * without scrollbars. For fixed-intrinsic-size content (game canvases);
   * leave off for flow layouts, which should keep their internal scroll.
   * `'content'`: fit the rendered component itself (not the page around it)
   * and center it — a thumbnail of one behavior.
   */
  fit?: boolean | 'content';
  /**
   * Called with the page path on every in-preview page switch (link click,
   * navigate effect, `UI:NAVIGATE`), for a host that tracks the page in its
   * own router. When set, it replaces the built-in `?page=` URL sync.
   */
  onPageChange?: (path: string) => void;
  /**
   * A registry theme key (`"<base>-<light|dark>"`) that replaces every
   * orbital's declared theme — a host's explicit theme pick (the playground
   * picker). Omitted → each page renders in its own orbital's theme.
   */
  themeOverride?: string;
  /** Hold the preview's client ticks stopped (a canvas card the person has not played); clearing it resumes them. */
  paused?: boolean;
  /**
   * Loads the behavior behind a `lazyPages` entry (`uses lazy`) when its page
   * is opened. Without it, opening a lazy page shows a load error.
   */
  lazyLoader?: SchemaLoader;
  /** Where `schema` was loaded from — a lazy page's `orbRef` resolves against it. */
  schemaPath?: string;
  /**
   * Called with a path that matches none of this schema's pages — a lazily
   * loaded behavior hands links back to the schema that imported it.
   */
  onUnmatchedNavigate?: (path: string) => void;
  /**
   * The host's own sign-in (`HOST_SIGN_IN_ROUTE`, `/login`): navigating there —
   * including an `access: authenticated` page sending its viewer to
   * `signIn: "/login"` — calls this with the return path instead of routing to a
   * page. Omitted → the host offers no sign-in and nothing happens.
   */
  onSignIn?: (returnTo?: string) => void;
  /**
   * The host's session sign-out, called on the system event `UI:SIGN_OUT` (a
   * Sign out inside the circuit). Omitted → the host offers no sign-out.
   */
  onSignOut?: () => void;
}

type LazyLoad =
  | { status: 'loading' }
  | { status: 'ready'; schema: OrbitalSchema }
  | { status: 'error'; error: string };

type RouteHit<P> =
  | { kind: 'page'; entry: P; params: Record<string, string> }
  | { kind: 'lazy'; page: LazyPage; params: Record<string, string> };

/**
 * The theme a preview page's orbital declares: the orbital owning `pageName`
 * (falling back to the app theme), or the first orbital's before a page is
 * picked. Mirrors the compiled scoping where each orbital's pages resolve
 * against its own theme. A host's `themeOverride` is applied on top by
 * `OrbitalThemeProvider`.
 */
export function resolvePreviewTheme(
  schema: OrbitalSchema,
  pageName: string | undefined,
): ThemeRef | undefined {
  if (!schema.orbitals?.length) return schema.theme;
  if (pageName) {
    for (const orb of schema.orbitals) {
      for (const pageRef of orb.pages ?? []) {
        const name = typeof pageRef === 'object' && pageRef !== null && 'name' in pageRef ? pageRef.name : undefined;
        if (name === pageName) return orb.theme ?? schema.theme;
      }
    }
  }
  return schema.orbitals[0]?.theme ?? schema.theme;
}

/**
 * Renders a live preview of an Orbital schema.
 *
 * Uses static imports for all runtime components to ensure providers
 * and hooks share the same module instances (no context duplication).
 *
 * @example
 * ```tsx
 * <OrbPreview schema={orbJsonString} height="300px" />
 * <OrbPreview schema={schema} serverUrl="/api/orbitals" />
 * ```
 */

/**
 * `UI:NAVIGATE` consumer (`navigatesTo` on page-header, top-bar and item
 * actions). Mounted inside OrbitalProvider: that provider owns the bus the
 * rendered components emit on, so a listener on the preview's outer bus
 * never hears them.
 */
function NavigateListener({ onNavigate }: { onNavigate: (path: string) => void }): null {
  const bus = useEventBus();
  useEffect(
    () =>
      bus.on('UI:NAVIGATE', (event) => {
        const url = event.payload?.url;
        if (typeof url === 'string' && url.length > 0) onNavigate(url);
      }),
    [bus, onNavigate],
  );
  return null;
}

/** `UI:SIGN_OUT` consumer: the host ends the viewer's session. Mounted inside OrbitalProvider, as NavigateListener. */
function SignOutListener({ onSignOut }: { onSignOut: () => void }): null {
  const bus = useEventBus();
  useEffect(() => bus.on('UI:SIGN_OUT', () => onSignOut()), [bus, onSignOut]);
  return null;
}

export function OrbPreview({
  schema,
  mockData,
  height = '400px',
  className,
  serverUrl,
  transport,
  getAccessToken,
  kernelLoader,
  languageLoader,
  initialPagePath,
  isolated = false,
  fit = false,
  onPageChange,
  user = null,
  authority = 'unavailable',
  localFallbackTimeoutMs,
  themeOverride,
  paused = false,
  lazyLoader,
  schemaPath,
  onUnmatchedNavigate,
  onSignIn,
  onSignOut,
}: OrbPreviewProps): React.ReactElement {
  if (serverUrl && transport) {
    throw new Error('OrbPreview accepts serverUrl OR transport, not both');
  }
  const { t } = useTranslate();
  // GAP-19: track when the server bridge falls back to local execution.
  // The 5s timeout in TraitInitializer fires onLocalFallback if the bridge
  // never connected. We surface a persistent banner below — the retired
  // UI:NOTIFY bus emit was a duplicate of the same message (NotifyListener,
  // its only subscriber, is gone; the toast slot is the one feedback
  // surface now, and this state is durable, not a one-shot toast).
  const [localFallback, setLocalFallback] = useState(false);
  const inHostRouter = useInRouterContext();
  const [hostHrefBase, setHostHrefBase] = useState('/');
  const handleLocalFallback = useCallback(() => {
    if (localFallback) return;
    setLocalFallback(true);
  }, [localFallback]);
  // Parse the schema string or object: string | OrbitalSchema  →  { schema: OrbitalSchema, mockData: EntityData }
  type ParsedResult =
    | { ok: true; schema: OrbitalSchema; mockData: EntityData }
    | { ok: false; error: string };

  const isLazyPageOfRegisteredProgram = useContext(LazyPageOfRegisteredProgram);
  const parseResult = useMemo<ParsedResult>(() => {
    let parsed: OrbitalSchema;
    if (typeof schema === 'string') {
      try {
        parsed = JSON.parse(schema) as OrbitalSchema;
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    } else {
      parsed = schema;
    }

    return { ok: true, schema: parsed, mockData: mockData ?? {} };
  }, [schema, mockData]);

  const parsedSchema = parseResult.ok ? parseResult.schema : null;
  // Arbitrary-value classes exist only in the schema; the host compiles them.
  useArbitraryClassStyles(parsedSchema);
  const effectiveMockData: EntityData = parseResult.ok ? parseResult.mockData : {};

  // Discover pages from schema for effect-driven navigation
  const pages = useMemo(() => {
    if (!parsedSchema) return [];
    try {
      return getAllPages(parsedSchema);
    } catch {
      return [];
    }
  }, [parsedSchema]);

  const lazyPages = useMemo<LazyPage[]>(() => parsedSchema?.lazyPages ?? [], [parsedSchema]);

  // One ranking over the schema's own pages and its lazy pages: a static
  // route outranks a `:param` sibling whichever side declares it.
  const matchRoute = useCallback((path: string): RouteHit<(typeof pages)[number]> | null => {
    const candidates = [
      ...pages.map((entry) => ({ kind: 'page' as const, entry, path: entry.page.path })),
      ...lazyPages.map((page) => ({ kind: 'lazy' as const, page, path: page.path })),
    ];
    const hit = matchPathAmong(candidates, path, (c) => c.path);
    if (!hit) return null;
    return hit.candidate.kind === 'page'
      ? { kind: 'page', entry: hit.candidate.entry, params: hit.params }
      : { kind: 'lazy', page: hit.candidate.page, params: hit.params };
  }, [pages, lazyPages]);

  // Seed from `initialPagePath` (gap #13 / runtime-verify per-trait
  // navigation): resolve the path against the schema's pages to get the
  // page NAME (the keying useResolvedSchema expects). Falls back to
  // undefined → SchemaRunner picks the schema's first page.
  const initialRoute = useMemo(
    () => (initialPagePath ? matchRoute(initialPagePath) : null),
    [matchRoute, initialPagePath],
  );
  const initialPageMatch = useMemo(() => {
    // Pattern-aware: a concrete `/threads/abc` URL must land on the declared
    // `/threads/:id` page, with the route params extracted for INIT — and a
    // static sibling outranks the `:param` route whatever the declaration order.
    if (initialRoute?.kind !== 'page' || !initialRoute.entry.page.name) return undefined;
    return { name: initialRoute.entry.page.name, params: initialRoute.params };
  }, [initialRoute]);
  const [lazyRoute, setLazyRoute] = useState<{ page: LazyPage; path: string } | null>(
    initialRoute?.kind === 'lazy' && initialPagePath ? { page: initialRoute.page, path: initialPagePath } : null,
  );
  const [lazyLoad, setLazyLoad] = useState<LazyLoad>({ status: 'loading' });
  useEffect(() => {
    if (!lazyRoute) return;
    if (!lazyLoader) {
      setLazyLoad({ status: 'error', error: `No loader for lazy page ${lazyRoute.page.path} (${lazyRoute.page.orbRef})` });
      return;
    }
    let cancelled = false;
    setLazyLoad({ status: 'loading' });
    void loadLazyPage(lazyLoader, lazyRoute.page, schemaPath).then((result) => {
      if (cancelled) return;
      setLazyLoad(result.success ? { status: 'ready', schema: result.data } : { status: 'error', error: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [lazyRoute?.page, lazyLoader, schemaPath]);
  const initialPageName = initialPageMatch?.name;
  const [currentPage, setCurrentPage] = useState<string | undefined>(initialPageName);
  const [routeParams, setRouteParams] = useState<Record<string, string>>(initialPageMatch?.params ?? {});

  // When the parent passes a different initialPagePath later (e.g. the host
  // syncs `?page=` on browser back/forward / popstate), follow it — INCLUDING
  // when it clears to undefined (a back to a URL without `?page`), which must
  // reset to the schema's first page. Keying on `initialPagePath` (not
  // `currentPage`) means an in-preview nav click — which sets `currentPage`
  // before its synthetic popstate round-trips the prop — does NOT trigger this
  // effect, so there's no revert race. Previously the `initialPageName &&`
  // guard skipped the undefined case, leaving the prior page rendered stale
  // (or empty) after back/forward.
  const prevInitialPagePathRef = useRef(initialPagePath);
  useEffect(() => {
    if (prevInitialPagePathRef.current !== initialPagePath) {
      prevInitialPagePathRef.current = initialPagePath;
      setCurrentPage(initialPageName);
      setRouteParams(initialPageMatch?.params ?? {});
      setLazyRoute(initialRoute?.kind === 'lazy' && initialPagePath ? { page: initialRoute.page, path: initialPagePath } : null);
    }
  }, [initialPagePath, initialPageName, initialPageMatch, initialRoute]);

  // Resolved path of the page actually on screen (currentPage is a page
  // NAME, not a path — DashboardLayout's sidebar highlighting needs the
  // PATH). Falls back to the first declared page when currentPage hasn't
  // been set yet (initial mount, no initialPagePath), mirroring
  // SchemaRunner's own first-page default so the highlight matches what
  // actually renders instead of staying blank. Fed to
  // `CurrentPagePathProvider` below — `DashboardLayout` prefers this over
  // `useLocation().pathname`, which never changes here because in-preview
  // nav is intercepted client-side and never touches the MemoryRouter.
  const currentPagePath = useMemo(() => {
    const activePageName = currentPage ?? pages[0]?.page.name;
    const resolved = pages.find((p) => p.page.name === activePageName)?.page.path;
    return resolved ?? initialPagePath;
  }, [pages, currentPage, initialPagePath]);

  // Nav-stack host wiring (runtime-path mirror of the compiled App.tsx's
  // NavStackRouterBridge): page manifest + the CONCRETE current path
  // (route params substituted into the pattern) drive NavStackProvider.
  const navPages = useMemo<NavPageDecl[]>(
    () =>
      pages
        .filter((p) => typeof p.page.path === 'string' && p.page.path.length > 0)
        .map((p) => ({ path: p.page.path as string, name: p.page.name, orbital: p.orbitalName, label: p.page.label })),
    [pages],
  );
  const concreteCurrentPath = useMemo(() => {
    const pattern = currentPagePath ?? '/';
    return pattern.replace(/:([A-Za-z0-9_]+)/g, (whole, key: string) => routeParams[key] ?? whole);
  }, [currentPagePath, routeParams]);
  const navStackRef = useRef<NavStackApi | null>(null);

  // Navigate handler: when a ['navigate', '/path'] effect fires OR a
  // sidebar `<Link>` click is intercepted, find the matching page and
  // switch to it. Also pushes `?page=/path` into the host URL so a
  // page refresh lands on the same orbital page (the playground reads
  // `?page=...` on mount as `initialPagePath`). MemoryRouter doesn't
  // sync to the URL on its own — we drive that explicitly here.
  // A sandboxed preview navigates in memory only — the host page's URL and
  // history belong to the host.
  const announcePage = useCallback((path: string) => {
    if (onPageChange) {
      onPageChange(path);
    } else if (!isolated && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('page', path);
      window.history.pushState({}, '', url.toString());
      // Notify the host's popstate listener (main.tsx App) so its
      // `initialPagePath` state reflects the new URL. Without this,
      // OrbPreview's "sync from initialPageName" useEffect would see
      // a stale initialPageName and force currentPage back to the
      // mount-time page right after the user-driven swap.
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [isolated, onPageChange]);

  const handleNavigate = useCallback((path: string, navState?: Record<string, string>) => {
    // Pattern-aware page matching: `/threads/abc` matches the declared
    // `/threads/:id` (exact paths still match — matchPath handles both).
    // Route params merge into the target page's INIT payload downstream.
    // A static route outranks a `:param` sibling whatever the declaration order.
    //
    // `navState` is the navigate effect's second argument — `(navigate path
    // { k: v } { crumb })`. It used to be dropped at this signature, so the
    // runtime path delivered ONLY keys that happened to also be route params
    // while the compiled path merged the whole object (codegen emits
    // `initPayload: useLocation().state`, merged as
    // `{...routeParams, ...initPayload}` — orbital-shell-typescript
    // backend/pages.rs + codegen/effect/client.rs). Explicit state wins over
    // the pattern match, same precedence as the compiled merge.
    if (isHostSignInRoute(path)) {
      onSignIn?.(navState?.returnTo);
      return;
    }
    const route = matchRoute(path);
    if (!route) {
      onUnmatchedNavigate?.(path);
      return;
    }
    if (route.kind === 'lazy') {
      setLazyRoute({ page: route.page, path });
      announcePage(path);
      return;
    }
    setLazyRoute(null);
    const match: { page: { name?: string; path?: string } } = route.entry;
    const params: Record<string, string> = { ...route.params, ...(navState ?? {}) };
    navLog.debug('handleNavigate', () => ({
      path,
      matched: match?.page.name ?? null,
      params,
      navState: navState ? JSON.stringify(navState) : undefined,
      availablePaths: pages.map((p) => p.page.path),
    }));
    if (match.page.name) {
      setRouteParams(params);
      setCurrentPage(match.page.name);
      announcePage(path);
    }
  }, [pages, matchRoute, announcePage, onUnmatchedNavigate, onSignIn]);

  const activePage = useMemo(() => {
    const activePageName = currentPage ?? pages[0]?.page.name;
    return pages.find((p) => p.page.name === activePageName)?.page;
  }, [pages, currentPage]);
  const handleAccessDenied = useCallback(
    (signIn: string, returnTo: string) => handleNavigate(signIn, { returnTo }),
    [handleNavigate],
  );
  const site = parsedSchema?.site;
  const locales = parsedSchema?.locales;
  const alternates = useMemo(
    () => (activePage === undefined ? undefined : localeAlternates(pages.map((p) => p.page), activePage, locales ?? [])),
    [pages, activePage, locales],
  );
  const declaresHead =
    activePage !== undefined &&
    (activePage.title !== undefined ||
      activePage.description !== undefined ||
      activePage.access !== undefined ||
      activePage.indexing !== undefined);
  usePageHead(
    !isolated && !lazyRoute && declaresHead
      ? {
          title: activePage.title,
          description: activePage.description,
          access: activePage.access,
          indexing: activePage.indexing,
          origin: site?.origin,
          siteName: site?.name,
          path: concreteCurrentPath,
          ...(alternates !== undefined ? { alternates, defaultLocale: locales?.[0] } : {}),
        }
      : null,
  );

  // Effect-facing navigate: stages the nav-stack crumb (when the navigate
  // effect carried one) before the page switch; the provider's sync consumes
  // it on arrival. Anchor clicks / UI:NAVIGATE keep plain handleNavigate.
  const handleNavigateEffect = useCallback(
    (path: string, params?: Record<string, string>, crumb?: string) => {
      navStackRef.current?.beginNavigate(path, crumb);
      handleNavigate(path, params);
    },
    [handleNavigate],
  );

  // navigate-back effect: pop the current orbital's stack.
  const handleNavigateBack = useCallback(() => {
    navStackRef.current?.back();
  }, []);

  if (!parseResult.ok) {
    return (
      <Box className={className} style={{ height }}>
        <Typography as="pre" color="error" variant="small" className="font-mono whitespace-pre-wrap break-all m-0 p-4">
          Parse error: {parseResult.error}
        </Typography>
      </Box>
    );
  }

  // Intercept <a> clicks inside the preview to route through handleNavigate
  // instead of causing real browser navigation. Capture phase ensures we
  // run before any React handler or native navigation.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // A sandbox intercepts every in-app link, even with one page, so a raw
    // `<a href>` can never navigate the host.
    if (pages.length <= 1 && !isolated) {
      navLog.debug('interceptor:skipped', { reason: 'single-page schema', pageCount: pages.length });
      return;
    }
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? anchor.getAttribute('to') ?? '';
      navLog.debug('click:intercepted', {
        href,
        anchorText: anchor.textContent?.trim().slice(0, 40),
      });
      const external = href.startsWith('http') || href.startsWith('mailto:');
      const appPath = external ? null : appPathFromHref(href, hostHrefBase);
      if (isolated && appPath === null) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (external) window.open(href, '_blank', 'noopener,noreferrer');
        navLog.debug('click:sandboxed', { href, external });
        return;
      }
      if (appPath === null) {
        navLog.debug('click:skipped', { href, reason: 'not an in-app href', hostHrefBase });
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      handleNavigate(appPath);
    };
    el.addEventListener('click', handler, true);
    navLog.info('interceptor:installed', { pageCount: pages.length, paths: pages.map((p) => p.page.path) });
    return () => el.removeEventListener('click', handler, true);
  }, [pages, handleNavigate, isolated, hostHrefBase]);

  // One registration per program, above the lazy switch: the server runs the lazy behaviors as part of it.
  const withBridge = (node: React.ReactElement): React.ReactElement => {
    const bridged = (serverUrl || transport) && !isLazyPageOfRegisteredProgram ? (
      <ServerBridgeProvider schema={parseResult.schema} serverUrl={serverUrl} transport={transport} getAccessToken={getAccessToken}>
        {node}
      </ServerBridgeProvider>
    ) : node;
    const engined = kernelLoader !== undefined ? (
      <KernelEngineProvider loader={kernelLoader} {...(languageLoader !== undefined ? { languageLoader } : {})}>{bridged}</KernelEngineProvider>
    ) : bridged;
    return <ClientTicksPausedContext.Provider value={paused}>{engined}</ClientTicksPausedContext.Provider>;
  };

  if (lazyRoute) {
    return withBridge(
      <Box ref={containerRef} className={`overflow-auto ${className ?? ''}`} style={{ height }}>
        {lazyLoad.status === 'loading' && <LoadingState />}
        {lazyLoad.status === 'error' && <ErrorState data-testid="lazy-page-error" message={lazyLoad.error} />}
        {lazyLoad.status === 'ready' && (
          <LazyPageOfRegisteredProgram.Provider value={true}>
          <OrbPreview
            key={lazyRoute.page.orbRef}
            schema={lazyLoad.schema}
            height="100%"
            className="border-0"
            serverUrl={serverUrl}
            transport={transport}
            getAccessToken={getAccessToken}
            initialPagePath={lazyRoute.path}
            user={user}
            authority={authority}
            isolated={isolated}
            fit={fit}
            onPageChange={announcePage}
            themeOverride={themeOverride}
            lazyLoader={lazyLoader}
            onUnmatchedNavigate={handleNavigate}
          />
          </LazyPageOfRegisteredProgram.Provider>
        )}
      </Box>
    );
  }

  return withBridge(
    <Box
      ref={containerRef}
      className={`${fit ? 'overflow-hidden' : 'overflow-auto'} border border-[var(--color-border)] rounded-[var(--radius-md)] ${className ?? ''}`}
      style={{ height }}
    >
      {/* GAP-19: visible banner when the preview server bridge fell back to local execution.
          The 5s timeout in TraitInitializer fires this when serverUrl was set but the
          ServerBridge never connected. Without this, the user couldn't tell why state
          wasn't persisting to the server. */}
      {localFallback && (
        <Box className="px-3 py-2 bg-[var(--color-warning)] bg-opacity-10 border-b border-[var(--color-warning)] flex items-center gap-2">
          <Typography variant="caption" className="text-[var(--color-warning-foreground)] flex-1">
            {t('orbPreview.serverUnreachable')}
          </Typography>
        </Box>
      )}
      {inHostRouter ? <HostHrefBaseProbe onBase={setHostHrefBase} /> : null}
      <CurrentPagePathProvider value={currentPagePath}>
        <NavStackProvider
          pages={navPages}
          currentPath={concreteCurrentPath}
          navigate={handleNavigate}
          storageKey={`almadar:navstack:${parseResult.schema.name ?? 'preview'}`}
        >
        <NavStackRefBridge apiRef={navStackRef} />
        <OrbitalProvider initialData={effectiveMockData} skipTheme verification isolated={isolated} user={user}>
          <NavigateListener onNavigate={handleNavigate} />
          {onSignOut !== undefined && <SignOutListener onSignOut={onSignOut} />}
          <UISlotProvider>
            <PageAccessHost
              access={activePage?.access}
              authority={authority}
              viewerId={user?.id}
              signIn={parseResult.schema.site?.signIn}
              path={concreteCurrentPath}
              onDenied={handleAccessDenied}
            >
              {fit ? (
                <FitToBox mode={fit === 'content' ? 'content' : 'box'}>
                  <SchemaRunner
                    schema={parseResult.schema}
                    serverUrl={serverUrl}
                    transport={transport}
                    getAccessToken={getAccessToken}
                    mockData={effectiveMockData}
                    pageName={currentPage}
                    routeParams={routeParams}
                    onNavigate={handleNavigateEffect}
                    onNavigateBack={handleNavigateBack}
                    onLocalFallback={handleLocalFallback}
                    localFallbackTimeoutMs={localFallbackTimeoutMs}
                    themeOverride={themeOverride}
                  />
                </FitToBox>
              ) : (
                <SchemaRunner
                  schema={parseResult.schema}
                  serverUrl={serverUrl}
                  transport={transport}
                  getAccessToken={getAccessToken}
                  mockData={effectiveMockData}
                  pageName={currentPage}
                  routeParams={routeParams}
                  onNavigate={handleNavigateEffect}
                  onNavigateBack={handleNavigateBack}
                  onLocalFallback={handleLocalFallback}
                  localFallbackTimeoutMs={localFallbackTimeoutMs}
                  themeOverride={themeOverride}
                />
              )}
            </PageAccessHost>
          </UISlotProvider>
        </OrbitalProvider>
        </NavStackProvider>
      </CurrentPagePathProvider>
    </Box>
  );
}

OrbPreview.displayName = 'OrbPreview';
