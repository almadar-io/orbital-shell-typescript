/**
 * Render-time expression evaluation on the kernel's one evaluator.
 *
 * A render binds many expressions against one context (a form's conditional fields and sections, a list's
 * row actions). Each helper here takes the whole batch and crosses into the kernel once; a caller with no
 * expression never touches the kernel. The module that loads the kernel installs the evaluator
 * (`KernelEngineProvider`), and there is no other evaluator to fall back on.
 *
 * @packageDocumentation
 */

import { KernelEvalError, kernelEvaluator } from '@almadar/core';
import type { JsonValue, SExpr } from '@almadar/core';
import type { EvalContextWire } from '@almadar/core/kernel-wire';

/** The value of each expression against `context`, in one crossing; throws `KernelEvalError` on the first that fails. */
export function evaluateBindings(context: EvalContextWire, expressions: readonly SExpr[]): JsonValue[] {
  if (expressions.length === 0) return [];
  return kernelEvaluator()
    .evaluateMany(context, expressions)
    .map((outcome) => {
      if (outcome.kind === 'error') throw new KernelEvalError(outcome.message);
      return outcome.value;
    });
}

/** The value of one expression against `context`; throws `KernelEvalError` when it fails. */
export function evaluateBinding(context: EvalContextWire, expression: SExpr): JsonValue {
  return evaluateBindings(context, [expression])[0];
}

/** Whether each guard holds against `context` (the kernel's truthiness), in one crossing; throws on the first that fails. */
export function guardsHold(context: EvalContextWire, guards: readonly SExpr[]): boolean[] {
  if (guards.length === 0) return [];
  return kernelEvaluator()
    .evaluateGuards(context, guards)
    .map((verdict) => {
      if (verdict.kind === 'error') throw new KernelEvalError(verdict.message);
      return verdict.value;
    });
}
