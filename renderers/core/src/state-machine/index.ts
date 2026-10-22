/**
 * State Machine Graph Algorithms
 *
 * Pure functions for state machine analysis: graph construction, BFS
 * reachability, guard payload derivation, and replay path building.
 *
 * These algorithms are shared by:
 * - orbital-verify-unified (compiled project verification)
 * - runtime-verify (interpreted runtime verification)
 * - Almadar Studio (visual state machine editor)
 * - AI agent (schema analysis and generation)
 *
 * @packageDocumentation
 */

// Types
export type {
  StateEdge,
  BFSNode,
  BFSPathNode,
  ReplayStep,
  PayloadFieldSchema,
  GuardPayload,
  GraphTransition,
  EdgeWalkTransition,
  WalkStep,
} from './types.js';

// Graph construction
export { buildStateGraph } from './graph.js';

// BFS algorithms
export { collectReachableStates, walkStatePairs } from './bfs.js';

// Guard payload derivation
export { buildGuardPayloads, extractPayloadFieldRef, extractPayloadFieldPath, constTruth } from './guard-payloads.js';

// Replay path building
export { buildReplayPaths, type ReplayTransition } from './replay-paths.js';

// Edge-covering walk
export { buildEdgeCoveringWalk } from './edge-walk.js';
