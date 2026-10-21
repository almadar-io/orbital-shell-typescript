/**
 * fn-form lambda → React render-prop conversion at the render-ui
 * dispatch site, before the pattern lands in `useUISlots`.
 *
 * `.lolo` authors per-row render functions for DataGrid/DataList/Carousel
 * as `["fn", argName, body]`. By converting them to functions here,
 * SlotContent's props match what consumer components expect (children =
 * real function) without depending on a render-time conversion pass.
 *
 * @packageDocumentation
 */

import React from "react";
import { isSExpr, isEventPayloadValue, quoteExpr, toWireValue, isRenderBindingMarker, containsEntityBinding, RENDER_BINDING_MARKER, type RenderBindingMarker, type SExpr, type EntityRow, type EventPayloadValue, type RenderItemLambda, type RuntimeValue } from "@almadar/core";
import { getPatternRuntimeDefinition, type AnyPatternConfig, type PatternPropDef, type PatternPropTypeSchema } from "@almadar/core/patterns";
import type { SlotProps, SlotPropValue } from "../hooks/useUISlots";
import { evaluateBindings } from '../core';
// Browser-safe subpath (pure operator metadata) — same import the runtime's
// BindingResolver uses; the `@almadar/std` index bundles a node-only loader.
import { isKnownStdOperator } from "@almadar/std/registry";
import { createLogger } from '@almadar/logger';

const lambdaLog = createLogger("almadar:ui:fn-form-lambda");

type PropSchemaNode = PatternPropDef | PatternPropTypeSchema;
type PropSchemaMap = Record<string, PropSchemaNode | undefined>;

// The lambda's evaluation context has no entity, locale or messages, so these expressions resolve at render time instead.
function readsI18n(value: SlotPropValue): boolean {
  if (typeof value === "string") return value === "@locale" || value.startsWith("@locale.");
  if (Array.isArray(value)) {
    const arr = value as ReadonlyArray<SlotPropValue>;
    return arr[0] === "i18n/t" || arr.some((v) => readsI18n(v));
  }
  if (value !== null && typeof value === "object" && !React.isValidElement(value) && !(value instanceof Date) && typeof value !== "function") {
    return Object.values(value as Record<string, SlotPropValue>).some((v) => readsI18n(v));
  }
  return false;
}

function needsRenderContext(value: SlotPropValue): boolean {
  return readsI18n(value) || ((typeof value === "string" || Array.isArray(value)) && containsEntityBinding(value as SExpr));
}

function patternPropsSchema(patternType: SlotPropValue): PropSchemaMap | undefined {
  return typeof patternType === "string" ? getPatternRuntimeDefinition(patternType)?.propsSchema : undefined;
}

// The registry types render props `function` and evaluable members (e.g. an
// action item's `when`) `sexpr`; only the former compile to render functions.
function isDeclaredSExpr(def: PropSchemaNode | undefined): boolean {
  return def?.types?.includes("sexpr") ?? false;
}

/**
 * Operator-call predicate for substituted arrays, mirroring
 * `BindingResolver.isSExpression` in @almadar/runtime: a string head that is
 * a known std operator, a namespaced `topic/op`, or `lambda`/`let`. Literal
 * data arrays (`["static", ...]`) fail this and pass through raw.
 */
function isOperatorCall(value: ReadonlyArray<SlotPropValue>): boolean {
  const first = value[0];
  if (typeof first !== "string") return false;
  return isKnownStdOperator(first) || first.includes("/") || first === "lambda" || first === "let";
}

export function isFnFormLambda(value: SlotPropValue): value is RenderItemLambda {
  if (!Array.isArray(value)) return false;
  // After the runtime array guard, view it as a homogeneous prop-value list so
  // `[1]` types as `SlotPropValue`. (Indexing the narrowed `RenderItemLambda`
  // tuple types `[1]` as `string`, collapsing the grouped-array branch to
  // `never`.)
  const arr = value as ReadonlyArray<SlotPropValue>;
  if (arr.length !== 3 || arr[0] !== "fn" || arr[2] === null || typeof arr[2] !== "object") {
    return false;
  }
  // Single-param shorthand (`["fn","item",body]`) OR the grouped multi-param
  // form (`["fn",["item","index"],body]`) the compiler now canonicalizes to.
  const params = arr[1];
  return (
    typeof params === "string" ||
    (Array.isArray(params) && params.length > 0 && params.every((p) => typeof p === "string"))
  );
}

/** Lambda param names: `["fn","item",b]` → `["item"]`;
 *  `["fn",["item","index"],b]` → `["item","index"]`. */
function fnFormParams(value: ReadonlyArray<SlotPropValue>): string[] {
  const p = value[1];
  if (typeof p === "string") return [p];
  if (Array.isArray(p)) return p.filter((x): x is string => typeof x === "string");
  return [];
}

/**
 * Walk a pattern body replacing every `@<argName>.path` string with the
 * value at `path` of `arg`, then evaluating every operator call that needs no
 * render context. Mirrors the compiler's inline substitution for
 * `renderItem` lambda bodies; the calls of one body are evaluated in one
 * kernel crossing.
 */
export function resolveLambdaBindings(
  body: SlotPropValue,
  params: readonly string[],
  item: EntityRow,
  index: number,
): SlotPropValue {
  return evaluateStandaloneCalls(substituteLambdaBindings(body, params, item, index));
}

/** Row data is inserted quoted, so an array whose head names an operator is never evaluated as a call. */
function asData(value: EventPayloadValue): SlotPropValue {
  return value !== null && typeof value === "object" && !(value instanceof Date) ? quoteExpr(toWireValue(value)) : value;
}

function substituteLambdaBindings(
  body: SlotPropValue,
  params: readonly string[],
  item: EntityRow,
  index: number,
): SlotPropValue {
  // params[0] = the row (`item`); params[1] (optional) = the loop position
  // (`index`). `@<item>` / `@<item>.path` resolve against the row; a bare
  // `@<index>` resolves to the numeric loop position.
  const itemName = params[0];
  const indexName = params[1];
  const itemPrefix = itemName ? `@${itemName}.` : null;
  const lookup = (path: string): EventPayloadValue => {
    let cur: EventPayloadValue = item as EventPayloadValue;
    for (const seg of path.split(".")) {
      if (cur === null || cur === undefined) return undefined;
      if (typeof cur !== "object" || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, EventPayloadValue>)[seg];
    }
    return cur;
  };
  const recur = (b: SlotPropValue): SlotPropValue => substituteLambdaBindings(b, params, item, index);
  if (typeof body === "string") {
    if (indexName && body === `@${indexName}`) return index;
    if (itemName && body === `@${itemName}`) return asData(item as EventPayloadValue);
    if (itemPrefix && body.startsWith(itemPrefix)) {
      const v = lookup(body.slice(itemPrefix.length));
      return v === undefined || v === null ? "" : asData(v);
    }
    return body;
  }
  if (Array.isArray(body)) {
    // Fn-form lambdas stay raw: `convertObjectProps` compiles them into
    // render-prop functions after substitution (see makeLambdaFn).
    if (isFnFormLambda(body)) return body;
    // TS narrows the array union to `never` above (RenderItemLambda is a
    // subtype of the readonly-array member) — re-widen for the element map.
    const arr = body as ReadonlyArray<SlotPropValue>;
    return arr.map((b) => recur(b));
  }
  if (body !== null && typeof body === "object" && !React.isValidElement(body) && !(body instanceof Date) && typeof body !== "function") {
    const out: Record<string, SlotPropValue> = {};
    for (const [k, v] of Object.entries(body as Record<string, SlotPropValue>)) {
      out[k] = recur(v);
    }
    return out as SlotPropValue;
  }
  return body;
}

/**
 * Operator calls inside a lambda body (e.g. `(str/concat "⚔" @c.attack)` →
 * `["str/concat","⚔",5]`) must be EVALUATED, not joined as text — substitution
 * only replaces `@arg.path` leaves. Mirrors BindingResolver.isSExpression;
 * literal data arrays fail the predicate and pass through unchanged.
 *
 * An expression still referencing `@entity` after row substitution (e.g. the
 * selected-row highlight `(if (== @item.channel @entity.openChannel) …)`)
 * cannot be evaluated here — there is no entity, so the ref would compare as
 * a literal string and freeze the branch. It is left RAW for
 * `deferLambdaEntityExprs` (top-down, so the OUTERMOST such node becomes one
 * marker — a bottom-up marker here left marker objects inside parent `if`
 * conditions, always truthy, highlighting every row). Its independent
 * sub-calls are still evaluated.
 */
function evaluableCall(node: ReadonlyArray<SlotPropValue>): boolean {
  return isOperatorCall(node) && isSExpr(node) && !needsRenderContext(node);
}

function isPlainContainer(body: SlotPropValue): body is Record<string, SlotPropValue> {
  return body !== null && typeof body === "object" && !Array.isArray(body) && !React.isValidElement(body) && !(body instanceof Date) && typeof body !== "function";
}

function gatherCalls(body: SlotPropValue, sink: SExpr[]): void {
  if (Array.isArray(body)) {
    if (isFnFormLambda(body)) return;
    const arr = body as ReadonlyArray<SlotPropValue>;
    if (evaluableCall(arr)) {
      if (isSExpr(arr)) sink.push(arr);
      return;
    }
    arr.forEach((b) => gatherCalls(b, sink));
    return;
  }
  if (isPlainContainer(body)) Object.values(body).forEach((v) => gatherCalls(v, sink));
}

function replaceCalls(body: SlotPropValue, results: Iterator<SlotPropValue>): SlotPropValue {
  if (Array.isArray(body)) {
    if (isFnFormLambda(body)) return body;
    const arr = body as ReadonlyArray<SlotPropValue>;
    if (evaluableCall(arr)) return results.next().value;
    return arr.map((b) => replaceCalls(b, results));
  }
  if (isPlainContainer(body)) {
    const out: Record<string, SlotPropValue> = {};
    for (const [k, v] of Object.entries(body)) out[k] = replaceCalls(v, results);
    return out as SlotPropValue;
  }
  return body;
}

function evaluateStandaloneCalls(body: SlotPropValue): SlotPropValue {
  const calls: SExpr[] = [];
  gatherCalls(body, calls);
  if (calls.length === 0) return body;
  const values = evaluateBindings({}, calls).map((evaluated) => (isEventPayloadValue(evaluated) ? evaluated : String(evaluated)));
  return replaceCalls(body, values[Symbol.iterator]());
}

// `fn-form-lambda → UISlotRenderer → fn-form-lambda` is a module cycle; a
// module-level `React.lazy` defers the import to first render (loader-portable,
// unlike a CJS `require`, which only resolves inside the compiled bundle).
const LazySlotContentRenderer = React.lazy(() =>
  import("../components/core/organisms/UISlotRenderer").then((m) => ({ default: m.SlotContentRenderer })),
);

/**
 * Top-down twin of the flush-side `deferEntityBindings` for lambda bodies:
 * after `@item` substitution, the OUTERMOST node still referencing
 * `@entity` (string leaf or operator-call expression) becomes ONE
 * `RenderBindingMarker` for SlotContentRenderer to resolve against the
 * ambient trait's live snapshot. Top-down is load-bearing — a bottom-up
 * pass wraps inner sub-expressions first, and a marker object inside a
 * parent `if` condition is always truthy.
 */
function deferLambdaEntityExprs(value: SlotPropValue): SlotPropValue {
  if (typeof value === "string") {
    if (needsRenderContext(value)) {
      const marker: RenderBindingMarker = { [RENDER_BINDING_MARKER]: true, expression: value };
      return marker as SlotPropValue;
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (isFnFormLambda(value)) return value;
    const arr = value as ReadonlyArray<SlotPropValue>;
    if (isOperatorCall(arr) && isSExpr(arr) && needsRenderContext(arr)) {
      const marker: RenderBindingMarker = { [RENDER_BINDING_MARKER]: true, expression: arr as SExpr };
      return marker as SlotPropValue;
    }
    return arr.map((v) => deferLambdaEntityExprs(v));
  }
  if (value !== null && typeof value === "object" && !React.isValidElement(value) && !(value instanceof Date) && typeof value !== "function" && !isRenderBindingMarker(value as RuntimeValue)) {
    const out: Record<string, SlotPropValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, SlotPropValue>)) {
      out[k] = deferLambdaEntityExprs(v);
    }
    return out as SlotPropValue;
  }
  return value;
}

function makeLambdaFn(
  params: readonly string[],
  lambdaBody: AnyPatternConfig,
  callerKey: string,
): (item: EntityRow, index: number) => React.ReactNode {
  return (item, index) => {
    const resolvedBody = deferLambdaEntityExprs(
      resolveLambdaBindings(lambdaBody as SlotPropValue, params, item, index),
    );
    if (
      resolvedBody === null ||
      typeof resolvedBody !== "object" ||
      Array.isArray(resolvedBody) ||
      typeof resolvedBody === "function" ||
      React.isValidElement(resolvedBody) ||
      resolvedBody instanceof Date
    ) {
      return null;
    }
    const record = resolvedBody as Record<string, SlotPropValue>;
    if (typeof record.type !== "string") {
      return null;
    }
    const rawChildProps: SlotProps = {};
    for (const [k, v] of Object.entries(record)) {
      if (k !== "type") rawChildProps[k] = v;
    }
    // Nested fn-form lambdas (e.g. a `data-list` inside this lambda's body
    // with its OWN `renderItem`) must be compiled here, not deferred — the
    // top-level `convertFnFormLambdasInProps` call only runs once at the
    // render-ui dispatch site and cannot see inside per-row lambda bodies.
    // Without this, the inner data-list receives a raw `["fn", ...]` array
    // and falls back to fields-based rendering with no fields, silently
    // dropping the children.
    const childProps = convertObjectProps(rawChildProps, patternPropsSchema(record.type));
    const childContent = {
      id: `lambda-${callerKey}-${index}`,
      pattern: record.type,
      props: childProps,
      priority: 0,
    };
    return React.createElement(
      React.Suspense,
      { fallback: null },
      React.createElement(LazySlotContentRenderer, { content: childContent, onDismiss: () => undefined }),
    );
  };
}

// Recursively walks pattern trees so nested `renderItem` lambdas (e.g.
// `stack > data-grid > renderItem`) get converted, not just top-level
// props. Identity-preserving when nothing converts so memoised consumers
// downstream don't re-render needlessly.
function convertNode(node: SlotPropValue, callerKey: string, def?: PropSchemaNode): SlotPropValue {
  if (node === null || node === undefined) return node;
  // A `$renderBinding` marker's `expression` is one S-expr evaluated whole at
  // render time — descending into it would compile its `fn` nodes into
  // render-props and corrupt the expression the evaluator later runs.
  if (isRenderBindingMarker(node)) return node;
  if (Array.isArray(node)) {
    if (isFnFormLambda(node)) {
      const arr = node as ReadonlyArray<SlotPropValue>;
      return makeLambdaFn(fnFormParams(arr), arr[2] as AnyPatternConfig, callerKey);
    }
    const arr = node as ReadonlyArray<SlotPropValue>;
    let anyChanged = false;
    const mapped: SlotPropValue[] = arr.map((item, i) => {
      const next = convertNode(item, `${callerKey}[${i}]`, def?.items);
      if (next !== item) anyChanged = true;
      return next;
    });
    return anyChanged ? mapped : node;
  }
  if (typeof node === "object" && !React.isValidElement(node) && !(node instanceof Date)) {
    return convertObjectProps(node as SlotProps, def?.properties);
  }
  return node;
}

function convertObjectProps(props: SlotProps, inherited?: PropSchemaMap): SlotProps {
  let convertedAny = false;
  const out: Record<string, SlotPropValue> = {};
  const schema = patternPropsSchema(props.type) ?? inherited;
  for (const [key, value] of Object.entries(props)) {
    const def = schema?.[key];
    if (isDeclaredSExpr(def)) {
      out[key] = value;
      continue;
    }
    if (isFnFormLambda(value)) {
      convertedAny = true;
      const arr = value as ReadonlyArray<SlotPropValue>;
      const compiled = makeLambdaFn(fnFormParams(arr), arr[2] as AnyPatternConfig, key);
      // `renderItem` is the schema-level alias: most consumers (DataGrid/DataList/
      // Carousel) read the per-row render via React `children`, but some
      // (RepeatableFormSection) read `renderItem` directly — set BOTH so either
      // reader gets the callable (else the latter throws "renderItem is not a function").
      out[key] = compiled;
      if (key === "renderItem") out.children = compiled;
      lambdaLog.debug(`convert key=${key}${key === "renderItem" ? " (+children)" : ""}`);
      continue;
    }
    const next = convertNode(value, key, def);
    if (next !== value) convertedAny = true;
    out[key] = next;
  }
  return convertedAny ? out : props;
}

/**
 * Walk a pattern's props (and recursively their nested children),
 * converting every fn-form lambda value into a React render-prop
 * function. Pure on inputs without lambdas: returns the props object
 * unchanged by reference.
 */
export function convertFnFormLambdasInProps(props: SlotProps | string, patternType?: string): SlotProps | string {
  // Route through the node-level converter: a bare-string slot payload
  // (`(render-ui main "@trait.X")`) is not a props object and must pass
  // through untouched — convertObjectProps would explode it into chars.
  if (props === null || typeof props !== 'object') return props;
  return convertObjectProps(props, patternType !== undefined ? patternPropsSchema(patternType) : undefined);
}
