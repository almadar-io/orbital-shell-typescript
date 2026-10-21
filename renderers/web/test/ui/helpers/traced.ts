import { kernelEvaluator } from '@almadar/core';
import type { EvalTrace, JsonValue, SExpr } from '@almadar/core';
import type { EvalContextWire } from '@almadar/core/kernel-wire';

export interface TracedRun {
  value?: JsonValue;
  trace: EvalTrace;
  error?: string;
}

/** One expression evaluated by the kernel with every node's entry, value and exit, as the AVL views draw them. */
export function traced(expr: SExpr, context: EvalContextWire = {}): TracedRun {
  const run = kernelEvaluator().evaluateTraced(context, expr);
  return run.outcome.kind === 'value'
    ? { value: run.outcome.value, trace: run.trace }
    : { trace: run.trace, error: run.outcome.message };
}
