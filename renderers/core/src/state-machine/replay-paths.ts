/**
 * Replay Path Builder
 *
 * Compute the shortest path (replay steps) from an initial state
 * to every reachable state in a state machine. Used by browser
 * verification to navigate through states before running assertions.
 *
 * Extracted from orbital-verify-unified/src/analyze.ts (collectDataMutationTests).
 *
 * @packageDocumentation
 */

import type { GraphTransition, ReplayStep, PayloadFieldSchema } from './types.js';

/** Entity-data sentinel payload fields: presence means transition needs a selected row */
const ENTITY_PAYLOAD_FIELDS = new Set(['data', 'row', 'item', 'id']);

/**
 * Extended transition with render and payload info needed for replay path building.
 * Compatible with orbital-verify's UnifiedTransition.
 */
export interface ReplayTransition extends GraphTransition {
  hasGuard: boolean;
  guard?: unknown[];
  payloadFields: string[];
  payloadSchema: PayloadFieldSchema[];
  renderEffects: Array<{
    slot: string;
    patternType: string | null;
  }>;
}

/**
 * Builds the shortest replay paths from initial state to all reachable states.
 * 
 * Computes step-by-step navigation paths for state machine testing and verification.
 * Uses breadth-first search to find shortest paths up to specified depth limit.
 * Each path contains replay steps with event, state, and payload information
 * needed to reproduce state transitions in tests.
 * 
 * @param {ReplayTransition[]} transitions - Transitions with render/payload information
 * @param {string} initialState - Starting state name
 * @param {number} [maxDepth=3] - Maximum path length (default: 3)
 * @returns {Map<string, ReplayStep[]>} Map of state names to replay step arrays
 * 
 * @example
 * // Build paths from 'initial' state
 * const paths = buildReplayPaths(transitions, 'initial', 5);
 * 
 * // Get steps to reach 'completed' state
 * const stepsToComplete = paths.get('completed');
 * 
 * // Execute replay steps
 * for (const step of stepsToComplete) {
 *   await dispatchEvent(step.event, step.payload);
 * }
 */
export function buildReplayPaths(
  transitions: ReplayTransition[],
  initialState: string,
  maxDepth = 3
): Map<string, ReplayStep[]> {
  type QueueNode = { state: string; path: ReplayStep[] };

  const queue: QueueNode[] = [{ state: initialState, path: [] }];
  const replayPaths = new Map<string, ReplayStep[]>();
  replayPaths.set(initialState, []);

  while (queue.length > 0) {
    const { state, path } = queue.shift()!;
    if (path.length >= maxDepth) continue;

    const fromHere = transitions.filter(
      (t) => t.from === state && t.event !== 'INIT',
    );

    for (const transition of fromHere) {
      if (replayPaths.has(transition.to)) continue;

      const renderEffect = transition.renderEffects.find((re) => re.patternType !== null);
      const stepNeedsEntityData =
        transition.hasGuard ||
        transition.payloadFields.some((f) => ENTITY_PAYLOAD_FIELDS.has(f));

      const step: ReplayStep = {
        event: transition.event,
        fromState: state,
        toState: transition.to,
        slot: renderEffect?.slot ?? 'main',
        expectedPattern: renderEffect?.patternType ?? undefined,
        needsEntityData: stepNeedsEntityData,
        payloadSchema: transition.payloadSchema.length > 0 ? transition.payloadSchema : undefined,
      };

      const newPath = [...path, step];
      replayPaths.set(transition.to, newPath);
      queue.push({ state: transition.to, path: newPath });
    }
  }

  return replayPaths;
}
