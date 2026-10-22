/**
 * BFS Reachability Algorithms
 *
 * Breadth-first search over state machine graphs.
 * Extracted from orbital-verify-unified/src/analyze.ts and phase3-server.ts.
 *
 * @packageDocumentation
 */

import type { BFSNode, StateEdge } from './types.js';
import { buildStateGraph } from './graph.js';
import type { GraphTransition } from './types.js';

/**
 * Collects all reachable states from an initial state using breadth-first search.
 * 
 * Performs BFS traversal of the state machine to find all states reachable
 * from the initial state, up to the specified maximum depth. Used for
 * state machine analysis, verification, and test coverage assessment.
 * 
 * @param {GraphTransition[]} transitions - Array of state transitions
 * @param {string} initialState - Starting state name
 * @param {number} [maxDepth=5] - Maximum search depth
 * @returns {Set<string>} Set of reachable state names
 * 
 * @example
 * const reachable = collectReachableStates(transitions, 'initial', 10);
 * console.log('Reachable states:', Array.from(reachable));
 */
export function collectReachableStates(
  transitions: GraphTransition[],
  initialState: string,
  maxDepth = 5
): Set<string> {
  const graph = buildStateGraph(transitions);
  const visited = new Set<string>([initialState]);
  const queue: BFSNode[] = [{ state: initialState, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    const edges = graph.get(current.state) ?? [];
    for (const edge of edges) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push({ state: edge.to, depth: current.depth + 1 });
      }
    }
  }

  return visited;
}

/**
 * Walks all reachable (state, event) pairs using BFS and invokes callback for each.
 * 
 * Traverses the state machine using breadth-first search and calls the visitor
 * function for each (state, edge) pair encountered. Used by server verification
 * to test transitions by POSTing to endpoints and checking responses.
 * 
 * @param {GraphTransition[]} transitions - Array of state transitions
 * @param {string} initialState - Starting state name
 * @param {number} maxDepth - Maximum BFS depth
 * @param {(state: string, edge: StateEdge, depth: number) => Promise<boolean>} visitor - Callback for each pair
 * @returns {Promise<{ visitedPairs: Set<string>; walkedEdges: number }>} Traversal statistics
 * 
 * @example
 * const result = await walkStatePairs(transitions, 'initial', 5, async (state, edge) => {
 *   console.log(`Transition: ${state} --${edge.event}--> ${edge.to}`);
 *   return true; // Continue exploration
 * });
 * console.log(`Visited ${result.visitedPairs.size} state-event pairs`);
 */
export async function walkStatePairs(
  transitions: GraphTransition[],
  initialState: string,
  maxDepth: number,
  visitor: (state: string, edge: StateEdge, depth: number) => Promise<boolean>
): Promise<{ visitedPairs: Set<string>; walkedEdges: number }> {
  const graph = buildStateGraph(transitions);
  const visitedPairs = new Set<string>();
  const queue: BFSNode[] = [{ state: initialState, depth: 0 }];
  let walkedEdges = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    const edges = graph.get(current.state) ?? [];
    for (const edge of edges) {
      const pairKey = `${current.state}:${edge.event}`;
      if (visitedPairs.has(pairKey)) continue;
      visitedPairs.add(pairKey);

      const shouldEnqueue = await visitor(current.state, edge, current.depth);
      walkedEdges++;

      if (shouldEnqueue) {
        const stateVisited = [...visitedPairs].some((k) => k.startsWith(`${edge.to}:`));
        if (!stateVisited) {
          queue.push({ state: edge.to, depth: current.depth + 1 });
        }
      }
    }
  }

  return { visitedPairs, walkedEdges };
}
