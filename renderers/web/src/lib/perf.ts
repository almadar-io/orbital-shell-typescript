/**
 * @almadar/ui/runtime — perf instrumentation
 *
 * React-specific consumption layer on top of the renderer-agnostic perf ring
 * now living in `@almadar/runtime/ui/perf`. Re-exports the framework-free
 * timing primitives and adds `useSyncExternalStore` / `React.Profiler` hooks.
 */

import { useSyncExternalStore } from 'react';
import type { ProfilerOnRenderCallback } from 'react';
import {
  PERF_NAMESPACE,
  perfStart,
  perfEnd,
  perfTime,
  perfTimeAsync,
  perfGauge,
  clearPerf,
  pushPerfEntry,
  perfStore,
  type PerfEntry,
} from '../runtime';

export {
  PERF_NAMESPACE,
  perfStart,
  perfEnd,
  perfTime,
  perfTimeAsync,
  perfGauge,
  clearPerf,
  type PerfEntry,
};

/**
 * React hook: returns the current perf ring snapshot, re-renders on push.
 */
export function usePerfBuffer(): readonly PerfEntry[] {
  return useSyncExternalStore(perfStore.subscribe, perfStore.getSnapshot, perfStore.getSnapshot);
}

/**
 * React.Profiler `onRender` callback. Records `actualDuration` per commit.
 */
export const profilerOnRender: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
  _startTime,
  commitTime,
) => {
  pushPerfEntry({
    name: `profiler:${id}:${phase}`,
    durationMs: actualDuration,
    ts: commitTime,
    detail: { baseDuration },
  });
};
