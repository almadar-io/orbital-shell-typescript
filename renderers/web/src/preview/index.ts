/**
 * @almadar/ui Runtime
 *
 * Client-side runtime components for rendering Orbital schemas.
 * Provides trait state machines, slot management, and pattern rendering.
 *
 * @packageDocumentation
 */

// Core runtime hooks
export { useTraitStateMachine, type UseTraitStateMachineOptions, type TraitStateMachineResult } from '../hooks/useTraitStateMachine';
export { useResolvedSchema, type ResolvedSchemaResult, clearSchemaCache } from '../hooks/useResolvedSchema';

// Context providers
export {
    EntitySchemaProvider,
    useEntitySchema,
    useEntitySchemaOptional,
    type EntitySchemaContextValue,
    type EntitySchemaProviderProps,
} from '../providers/EntitySchemaContext';

export {
    TraitProvider,
    TraitContext,
    useTraitContext,
    useTrait,
    type TraitContextValue,
    type TraitInstance,
    type TraitProviderProps,
} from '../providers/TraitProvider';

// Slot pattern types — the runtime now writes directly to `useUISlots`
// (re-exported from `../context/UISlotContext`); the previous
// SlotsContext / SlotsProvider / SlotBridge mirror layer was removed.
export type { SlotPatternEntry, SlotSource } from '../types/slot-types';

// C2 callback-prop wrap helper — single-source the named-arg → object-payload
// shape across the runtime path here and the codegen path in
// orbital-shell-typescript.
export { wrapCallbackForEvent } from '../lib/wrapCallbackForEvent';

// OrbPreview — live orbital schema renderer
export { OrbPreview, type OrbPreviewProps } from './OrbPreview';

// OrbitalPluginHost — headless plugin runtime(s) against the ambient bus + slots
export {
    OrbitalPluginHost,
    useOrbitalPluginHost,
    useDeclaredCaptureTable,
    type OrbitalPluginHostProps,
    type PluginHostPlugin,
    type PluginHostInbound,
    type PluginHostDenyVerb,
} from './OrbitalPluginHost';

// TraitValueFrame — a trait value (language trio) mounted and rendered inline;
// hosts supply the mount through TraitValueMountProvider
export {
    TraitValueFrame,
    TraitValueMountProvider,
    type TraitValueMountHost,
} from './TraitValueFrame';
// BehaviorValueFrame — a whole behavior value (`behavior/ref`) run in place, isolated.
export { BehaviorValueFrame } from './BehaviorValueFrame';

// Slot-host manifest — declarative region -> UISlot bindings a host (a
// plugin host's persona shell, or an embedding app) uses to describe its
// regions; mirrors UISlotComponent's fallback/mode contract as data.
export {
    assertUniqueSlotsPerHost,
    type SlotHostRegion,
    type SlotHostManifest,
} from '../types/slot-host';

// ServerBridge — client-server bridge for dual execution
export { ServerBridgeProvider, useServerBridge, type ServerBridgeContextValue, type ServerBridgeTransport, type AccessTokenProvider } from '../providers/ServerBridge';

// Types
export type {
    ResolvedTraitBinding,
    ResolvedTrait,
    ResolvedEntity,
    ResolvedPage,
    ResolvedIR,
} from '../types/runtime-types';

// Perf instrumentation (workstream 2 of Almadar_Studio_Performance.md).
// Gated behind createLogger('almadar:perf:canvas'); production strips the work.
export {
    PERF_NAMESPACE,
    perfStart,
    perfEnd,
    perfTime,
    profilerOnRender,
    usePerfBuffer,
    clearPerf,
    type PerfEntry,
} from '../lib/perf';
