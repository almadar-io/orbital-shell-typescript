import { ComposeBehaviorsInput, ComposeBehaviorsResult, composeBehaviors } from './runtime/effects/composition/compose-behaviors.js';
import { EventWiringEntry, applyEventWiring } from './runtime/effects/composition/event-wiring.js';
import { LayoutStrategy, detectLayoutStrategy } from './runtime/effects/composition/layout-strategy.js';
import { PipeStep, pipeBehaviors } from './runtime/effects/composition/pipe.js';

/**
 * Composition Module
 *
 * Runtime-side TypeScript composition layer for behavior/* operators.
 *
 * Composition is normally a compile-time concept, evaluated by the Rust
 * compiler pass before code generation. The runtime ships an equivalent
 * TypeScript implementation so dev-mode hot reload, agent-driven dynamic
 * composition, and the legacy `composeBehaviors()` callers all have a
 * usable in-process implementation. The handlers are wired into
 * `EffectExecutor` as optional handlers (`composeBehaviors`,
 * `applyEventWiring`, `detectLayoutStrategy`, `pipeBehaviors`) so
 * consumers that do not need composition pay no cost.
 *
 * @packageDocumentation
 */

declare const index_ComposeBehaviorsInput: typeof ComposeBehaviorsInput;
declare const index_ComposeBehaviorsResult: typeof ComposeBehaviorsResult;
declare const index_EventWiringEntry: typeof EventWiringEntry;
declare const index_LayoutStrategy: typeof LayoutStrategy;
declare const index_PipeStep: typeof PipeStep;
declare const index_applyEventWiring: typeof applyEventWiring;
declare const index_composeBehaviors: typeof composeBehaviors;
declare const index_detectLayoutStrategy: typeof detectLayoutStrategy;
declare const index_pipeBehaviors: typeof pipeBehaviors;
declare namespace index {
  export { index_ComposeBehaviorsInput as ComposeBehaviorsInput, index_ComposeBehaviorsResult as ComposeBehaviorsResult, index_EventWiringEntry as EventWiringEntry, index_LayoutStrategy as LayoutStrategy, index_PipeStep as PipeStep, index_applyEventWiring as applyEventWiring, index_composeBehaviors as composeBehaviors, index_detectLayoutStrategy as detectLayoutStrategy, index_pipeBehaviors as pipeBehaviors };
}

export { index as i };
