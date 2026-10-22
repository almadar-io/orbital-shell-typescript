/**
 * State Graph Construction
 *
 * Build an adjacency list from state machine transitions.
 * Extracted from orbital-verify-unified/src/analyze.ts.
 *
 * @packageDocumentation
 */

import type { GraphTransition, StateEdge } from './types.js';

/**
 * Builds an adjacency list from state machine transitions.
 * 
 * Constructs a state transition graph where each state maps to an array
 * of outgoing edges (events and target states). Wildcard transitions
 * (from === '*') are excluded since they don't represent fixed edges.
 * Used as the foundation for state machine analysis, traversal, and verification.
 * 
 * @param {GraphTransition[]} transitions - Array of state transitions
 * @returns {Map<string, StateEdge[]>} State transition graph
 * 
 * @example
 * const graph = buildStateGraph(transitions);
 * const edgesFromInitial = graph.get('initial'); // Array of outgoing edges
 * console.log(`Initial state has ${edgesFromInitial?.length} transitions`);
 */
export function buildStateGraph(
  transitions: GraphTransition[]
): Map<string, StateEdge[]> {
  const graph = new Map<string, StateEdge[]>();
  for (const t of transitions) {
    if (t.from === '*') continue;
    if (!graph.has(t.from)) graph.set(t.from, []);
    graph.get(t.from)!.push({ event: t.event, to: t.to });
  }
  return graph;
}
