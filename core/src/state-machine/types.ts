/**
 * State Machine Graph Algorithm Types
 *
 * Pure types used by BFS, guard payload, and replay path algorithms.
 * These are decoupled from the verify-specific types (no Playwright, no HTTP).
 *
 * @packageDocumentation
 */

import type { SExpr, EventPayload } from '../types/expression.js';

/** An edge in the state graph adjacency list */
export interface StateEdge {
  event: string;
  to: string;
}

/** A node in the BFS queue */
export interface BFSNode {
  state: string;
  depth: number;
}

/** A node in the BFS queue with a replay path */
export interface BFSPathNode {
  fromState: string;
  replayPath: ReplayStep[];
}

/** A single step to replay to reach a given state */
export interface ReplayStep {
  /** Event to fire */
  event: string;
  /** State we're coming from */
  fromState: string;
  /** State we're transitioning to */
  toState: string;
  /** Slot the pattern renders in */
  slot: string;
  /** Pattern expected in the slot after this step */
  expectedPattern?: string;
  /** True if this step requires entity rows to be visible before clicking */
  needsEntityData: boolean;
  /** Payload to supply for this step (derived from guard pass case if guarded) */
  guardPayload?: EventPayload;
  /** Full payload schema for mock data generation */
  payloadSchema?: PayloadFieldSchema[];
}

/** Payload field definition (name + type) */
export interface PayloadFieldSchema {
  name: string;
  type: string;
  required?: boolean;
}

/** Pass and fail payloads derived from a guard s-expression */
export interface GuardPayload {
  pass: EventPayload;
  fail: EventPayload;
}

/**
 * Minimal transition interface for graph algorithms.
 * Compatible with both @almadar/core Transition and orbital-verify UnifiedTransition.
 */
export interface GraphTransition {
  from: string;
  event: string;
  to: string;
}

/**
 * Transition input for the edge-covering walk algorithm.
 * Extends GraphTransition with guard metadata for generating pass/fail walk steps.
 */
export interface EdgeWalkTransition extends GraphTransition {
  hasGuard: boolean;
  /**
   * Guard expression (when present). Mirrors `@almadar/core`'s `SExpr`
   * union — a string atom (e.g. `"@payload.row"` for bare-binding
   * existence guards declared by std-confirmation) OR an array
   * (`["or", ...]`, `["=", ...]`). Pre-fix, the type was `unknown[]`
   * which rejected the string form and `toEdgeWalkTransition`
   * silently dropped it; downstream `buildGuardPayloads` then saw no
   * guard and synthesized `{}` for the verifier's pass-case bus
   * replay, leaving the modal closed and the portal observer
   * reporting "slot not mounted" for every single-binding-guarded
   * event.
   */
  guard?: SExpr;
  /** Event payload field declarations (e.g., [{ name: "id", type: "string", mockValue: "mock-products-1" }]).
   *  Used to generate mock payloads for events that require data (VIEW, EDIT).
   *  Callers should set mockValue for id fields using their entity context. */
  payloadSchema?: Array<{ name: string; type: string; required?: boolean; mockValue?: unknown }>;
}

/**
 * A single step in an edge-covering walk.
 * The walk visits every transition (edge) in the state graph at least once.
 */
export interface WalkStep {
  /** Source state */
  from: string;
  /** Event to fire */
  event: string;
  /** Target state */
  to: string;
  /** Guard branch: null for unguarded, 'pass' or 'fail' for guarded */
  guardCase: 'pass' | 'fail' | null;
  /** Payload to send with the event */
  payload: EventPayload;
  /** True if this step is a repositioning step (navigating to reach a source state with uncovered edges) */
  isRepositioning: boolean;
}
