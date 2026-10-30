/**
 * S-Expression Types
 *
 * Defines the S-Expression type system for guards, effects, and computed values.
 * S-expressions are JSON arrays where the first element is an operator string.
 *
 * @example
 * // Guard: health > 0
 * [">", "@entity.health", 0]
 *
 * // Effect: set x to x + vx
 * ["set", "@entity.x", ["+", "@entity.x", "@entity.vx"]]
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { setOwn } from './own-key.js';
import { JsonValueSchema, type JsonValue, type RuntimeValue } from './json.js';

// ============================================================================
// S-Expression Type
// ============================================================================

/**
 * S-Expression type - recursive structure representing expressions.
 *
 * An S-expression is either:
 * - A literal value (string, number, boolean, null)
 * - An object literal (for payload data, props, etc.)
 * - A binding reference (string starting with @)
 * - A call expression (array with operator as first element)
 */
/** Object literal branch of an S-expression atom (payload data, props, etc.). */
export interface SExprObject {
  [key: string]: SExpr;
}
export type SExprAtom = string | number | boolean | null | SExprObject;
export type SExpr = SExprAtom | SExpr[];

/**
 * Expression type - S-expressions only.
 * Used for guards, computed values, and effect expressions.
 *
 * NOTE: Legacy string format is no longer supported.
 * All expressions must be S-expression arrays.
 */
export type Expression = SExpr;

// ============================================================================
// S-Expression Schema (Zod)
// ============================================================================

/**
 * Recursive schema for s-expr-shaped DATA in literal positions (object
 * values, effect arguments). Unlike `SExprSchema`, arrays may be empty or
 * non-operator-headed — literal data lists (`children: []`, `tiles: [...]`)
 * are valid here; only call positions get the operator-head refine.
 */
export const SExprDataSchema: z.ZodType<SExpr> = z.lazy(() =>
  z.union([SExprAtomSchema, z.array(SExprDataSchema)]),
);

/**
 * Schema for atomic S-expression values (non-array)
 * Includes objects for payload data, props, etc.
 */
export const SExprAtomSchema: z.ZodType<SExprAtom> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.record(z.string(), SExprDataSchema), // Objects for payload data
]);

/**
 * Recursive schema for S-expressions: an atom, or a call — an array whose first element is its
 * string operator. A call's arguments are data (`SExprDataSchema`): an argument array without
 * an operator head is a literal list, as both evaluators read it (an inlined config list in
 * `["array/nth", [{…}, {…}], "@entity.i"]`).
 */
export const SExprSchema: z.ZodType<SExpr> = z.lazy(() =>
  z.union([
    SExprAtomSchema,
    z
      .array(SExprDataSchema)
      .min(1)
      .refine(
        (arr) => typeof arr[0] === 'string',
        { message: 'S-expression array must have a string operator as first element' }
      ),
  ])
);

/**
 * Schema for Expression type - S-expressions only.
 * S-expressions are arrays with operator as first element.
 *
 * NOTE: Legacy string format is no longer supported.
 */
export const ExpressionSchema: z.ZodType<Expression> = SExprSchema;

/** A list of propositions (`@invariant`, `@ensures`), named so declaration emit does not expand it at every use. */
export const SExprListSchema: z.ZodType<SExpr[]> = z.array(SExprSchema);

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for S-expression detection.
 * 100% reliable - structural check, no regex or keyword matching.
 *
 * @param value - Value to check
 * @returns true if value is an S-expression (array with string operator)
 */
export function isSExpr(value: RuntimeValue): value is SExpr[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === 'string'
  );
}

/**
 * Type guard for S-expression atoms (non-array values).
 * 
 * Validates that a value is an S-expression atom (literal value).
 * Includes null, strings, numbers, booleans, and objects. Used to
 * distinguish atomic values from S-expression calls (arrays).
 * 
 * @param {RuntimeValue} value - Value to check
 * @returns {boolean} True if value is an S-expression atom, false otherwise
 *
 * @example
 * isSExprAtom('hello'); // returns true
 * isSExprAtom(42); // returns true
 * isSExprAtom(null); // returns true
 * isSExprAtom({ key: 'value' }); // returns true
 * isSExprAtom(['+', 1, 2]); // returns false
 */
export function isSExprAtom(value: RuntimeValue): value is SExprAtom {
  if (value === null) return true;
  if (Array.isArray(value)) return false;
  const type = typeof value;
  return type === 'string' || type === 'number' || type === 'boolean' || type === 'object';
}

/**
 * Checks if a value is a binding reference.
 * 
 * Validates that a string is a binding reference (starts with @).
 * Bindings reference runtime values like @entity.health, @payload.amount, @now.
 * Used for identifying bindings in S-expressions and validation.
 * 
 * @param {RuntimeValue} value - Value to check
 * @returns {boolean} True if value is a binding reference, false otherwise
 *
 * @example
 * isBinding('@entity.health'); // returns true
 * isBinding('@payload.amount'); // returns true
 * isBinding('not-a-binding'); // returns false
 * isBinding(123); // returns false
 */
export function isBinding(value: RuntimeValue): value is string {
  return typeof value === 'string' && value.startsWith('@');
}

/**
 * Checks if a value is a valid S-expression call (array with operator).
 * 
 * Alias for isSExpr() - validates S-expression call structure.
 * Used to distinguish between S-expression calls and atom values.
 * 
 * @param {RuntimeValue} value - Value to check
 * @returns {boolean} True if value is a valid S-expression call, false otherwise
 *
 * @example
 * isSExprCall(['+', 1, 2]); // returns true
 * isSExprCall(['set', '@entity.health', 100]); // returns true
 * isSExprCall('not-a-call'); // returns false
 */
export function isSExprCall(value: RuntimeValue): value is SExpr[] {
  return isSExpr(value);
}

// ============================================================================
// Binding Parsing
// ============================================================================

/**
 * Parsed binding reference
 */
export interface ParsedBinding {
  /** Type of binding: core (@entity, @payload, @state, @now) or entity (@EntityName) */
  type: 'core' | 'entity';
  /** The root binding name (entity, payload, state, now, or EntityName) */
  root: string;
  /** Path segments after the root (e.g., ['health'] for @entity.health) */
  path: string[];
  /** Full original binding string */
  original: string;
}

/**
 * Core bindings that are always available.
 * Phase 4.5 adds: config, computed, trait (for behavior support).
 * `user` is the authenticated user / agent context (see binding.ts) and is
 * read-only in guards/effects/ticks — atoms reference `@user.id` and
 * `@user.role` for ownership / role-based gating.
 * `callsitePayload` is the call-site-captured event payload emitted by the
 * compiler's inline-trait hoisting; the runtime BindingResolver resolves it
 * at the composing effect.
 * `pages` / `currentTheme` are render-resolved schema sigils (effect-only,
 * see `orbital-rust/crates/orbital-compiler/src/phases/resolve.rs`):
 * substituted from the host orbital's schema (`@pages` → its `NavItem[]`
 * nav array, `@currentTheme` → its `data-theme` key) before codegen — they
 * never survive as live bindings past that substitution pass.
 */
export const CORE_BINDINGS = ['entity', 'payload', 'state', 'now', 'config', 'computed', 'trait', 'user', 'callsitePayload', 'pages', 'currentTheme'] as const;
export type CoreBinding = (typeof CORE_BINDINGS)[number];

/**
 * Parses a binding reference into its components.
 * 
 * Deconstructs a binding string (e.g., '@entity.health') into its constituent
 * parts: type, root, path, and original string. Does NOT use regex - uses
 * structured string operations for reliability and maintainability.
 * 
 * @param {string} binding - Binding string starting with @
 * @returns {ParsedBinding | null} Parsed binding object or null if invalid
 * 
 * @example
 * parseBinding('@entity.health'); // returns { type: 'core', root: 'entity', path: ['health'], original: '@entity.health' }
 * parseBinding('@User.name'); // returns { type: 'entity', root: 'User', path: ['name'], original: '@User.name' }
 * parseBinding('not-a-binding'); // returns null
 */
export function parseBinding(binding: string): ParsedBinding | null {
  if (!binding.startsWith('@')) {
    return null;
  }

  // Remove @ prefix
  const withoutPrefix = binding.slice(1);

  // Split by dots
  const parts = withoutPrefix.split('.');

  if (parts.length === 0 || parts[0] === '') {
    return null;
  }

  const root = parts[0];
  const path = parts.slice(1);

  // Determine if core binding or entity reference
  const isCore = (CORE_BINDINGS as readonly string[]).includes(root);

  return {
    type: isCore ? 'core' : 'entity',
    root,
    path,
    original: binding,
  };
}

/**
 * Validate a binding reference format.
 *
 * @param binding - Binding string to validate
 * @returns true if valid binding format
 */
export function isValidBinding(binding: string): boolean {
  const parsed = parseBinding(binding);
  if (!parsed) return false;

  // Core bindings: @entity, @payload, @state, @now (optionally with path)
  // @state and @now don't have paths
  if (parsed.type === 'core') {
    if (parsed.root === 'state' || parsed.root === 'now') {
      return parsed.path.length === 0;
    }
    // @entity and @payload can have paths
    return true;
  }

  // Entity bindings: @EntityName.field - must have at least one path segment
  return parsed.path.length > 0;
}

// ============================================================================
// S-Expression Utilities
// ============================================================================

/**
 * Get the operator from an S-expression call.
 *
 * @param expr - S-expression array
 * @returns The operator string or null if not a valid call
 */
export function getOperator(expr: SExpr): string | null {
  if (!isSExpr(expr)) return null;
  return expr[0] as string;
}

/** Where a node sits in its S-expression: argument indices of calls/arrays, keys of object literals. */
export type SExprPath = ReadonlyArray<number | string>;

/**
 * One step of a traced evaluation. `enter`/`exit` bracket a node's evaluation
 * (`exit` carries its value or error); `iter` marks a node re-entered (a lambda
 * body per item); `skip` marks an argument the operator never evaluated
 * (short-circuited `and`/`or`, the untaken `if` branch).
 */
export interface EvalStep {
  kind: 'enter' | 'exit' | 'iter' | 'skip';
  path: SExprPath;
  value?: RuntimeValue;
  error?: string;
}

export type EvalTrace = EvalStep[];

/**
 * Print an S-expression in `.lolo` surface form: calls as `(op args…)`,
 * bindings bare, strings quoted, objects `{ k: v }` (keys sorted), literal arrays `[a b]`.
 * Structural only — a string-headed array is a call, as in {@link isSExpr}.
 */
export function formatSExpr(expr: SExpr): string {
  if (expr === null) return 'null';
  if (typeof expr === 'string') return isBinding(expr) ? expr : JSON.stringify(expr);
  if (typeof expr === 'number' || typeof expr === 'boolean') return String(expr);
  if (Array.isArray(expr)) {
    const quoted = quoteBodyOf(expr);
    if (quoted !== undefined) return `(${QUOTE_HEAD} ${formatSExpr(decodeQuoteBody(quoted))})`;
    const qq = quasiquoteOf(expr);
    if (qq !== undefined) return `(${QUASIQUOTE_HEAD} ${formatTemplate(decodeQuoteBody(qq.body), qq.holes)})`;
    const op = getOperator(expr);
    if (op !== null) return `(${[op, ...expr.slice(1).map(formatSExpr)].join(' ')})`;
    return `[${expr.map(formatSExpr).join(' ')}]`;
  }
  const entries = Object.keys(expr).sort().map((k) => `${k}: ${formatSExpr(expr[k])}`);
  return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
}

/**
 * Get the arguments from an S-expression call.
 *
 * @param expr - S-expression array
 * @returns Array of arguments (empty if not a valid call)
 */
export function getArgs(expr: SExpr): SExpr[] {
  if (!isSExpr(expr)) return [];
  return expr.slice(1);
}

/**
 * Create an S-expression call.
 *
 * @param operator - The operator string
 * @param args - Arguments to the operator
 * @returns S-expression array
 */
export function sexpr(operator: string, ...args: SExpr[]): SExpr[] {
  return [operator, ...args];
}

/**
 * Walk an S-expression tree and apply a visitor function to each node.
 *
 * @param expr - S-expression to walk
 * @param visitor - Function to call on each node
 */
export function walkSExpr(
  expr: SExpr,
  visitor: (node: SExpr, parent: SExpr[] | null, index: number) => void,
  parent: SExpr[] | null = null,
  index: number = 0
): void {
  visitor(expr, parent, index);

  if (isSExpr(expr)) {
    for (let i = 0; i < expr.length; i++) {
      walkSExpr(expr[i], visitor, expr, i);
    }
  }
}

/**
 * Collect all bindings referenced in an S-expression.
 *
 * @param expr - S-expression to analyze
 * @returns Array of binding strings found
 */
export function collectBindings(expr: SExpr): string[] {
  const bindings: string[] = [];

  walkSExpr(expr, (node) => {
    if (isBinding(node)) {
      bindings.push(node);
    }
  });

  return bindings;
}

// ============================================================================
// Type Exports
// ============================================================================

export type SExprInput = z.input<typeof SExprSchema>;
export type ExpressionInput = z.input<typeof ExpressionSchema>;

// ============================================================================
// Runtime Evaluation Types
// ============================================================================

/** Evaluation context for guards and s-expressions. Recursive. */
export interface EvalContext {
  [key: string]: string | number | boolean | Date | null | string[] | EvalContext | undefined;
}

/**
 * A single value carried by an event payload field: a JSON value. A date is its ISO string, an absent
 * field is an absent key; `Date` and `undefined` never travel on the wire.
 */
export type EventPayloadValue = JsonValue;

/**
 * Typed event payload: a JSON object, assignable to the bus's `EventPayload` parameter without casts.
 */
export interface EventPayload {
  [key: string]: EventPayloadValue;
}

/**
 * Runtime guard for `EventPayloadValue` — narrows interpreter-produced
 * `unknown` values at typed substrate boundaries (e.g. `TraceContext.emit`).
 */
export function isEventPayloadValue(value: RuntimeValue): value is EventPayloadValue {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'boolean') return true;
  if (Array.isArray(value)) return value.every((item: RuntimeValue) => isEventPayloadValue(item));
  if (kind === 'object' && typeof value === 'object' && !(value instanceof Date)) {
    return Object.values(value).every((item: RuntimeValue) => isEventPayloadValue(item));
  }
  return false;
}

/** Zod twin of `EventPayloadValue` — the one runtime validator for a bus-emit payload slot. */
export const EventPayloadValueSchema: z.ZodType<EventPayloadValue> = JsonValueSchema;

/** Zod twin of `EventPayload` — the wire shape of a bus event's `payload`. */
export const EventPayloadSchema: z.ZodType<EventPayload> = z.record(z.string(), JsonValueSchema);

/**
 * Allowed leaf value for `LogMeta`. Mirrors `EventPayloadValue` shape so
 * the same row/list data flows through logs without manual flattening,
 * with `Error` added since structured logs carry exception detail.
 */
export type LogMetaValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | Error
  | LogMeta
  | readonly LogMetaValue[];

/** Structured log/event metadata. Recursive to support nested log data. */
export interface LogMeta {
  [key: string]: LogMetaValue;
}

/**
 * True when `expr` provably evaluates falsy — the twin of orbital-core's
 * `SExpression::is_statically_false`, one table on both paths. Conservative:
 * anything undecidable returns `false` ("not provably false"). `resolve`
 * turns a binding (`@config.selfFetch`) into its known literal value, or
 * `undefined` when unknown — the JS path keeps config bindings in guards
 * where Rust inlines them.
 */
export function isStaticallyFalse(expr: SExpr, resolve?: (binding: string) => SExprAtom | undefined): boolean {
  const known = (e: SExpr): SExpr => {
    if (typeof e === 'string' && e.startsWith('@') && resolve !== undefined) {
      const value = resolve(e);
      return value === undefined ? e : value;
    }
    return e;
  };
  const isLiteral = (e: SExpr): boolean =>
    e === null || typeof e === 'boolean' || typeof e === 'number' || (typeof e === 'string' && !e.startsWith('@'));
  const value = known(expr);
  if (value === false || value === null) return true;
  if (typeof value === 'number') return value === 0;
  if (typeof value === 'string') return value === '';
  if (Array.isArray(value)) {
    const op = value[0];
    if (typeof op !== 'string') return value.length === 0;
    const args = value.slice(1);
    switch (op) {
      case 'and': return args.some((a) => isStaticallyFalse(a, resolve));
      case 'or': return args.length > 0 && args.every((a) => isStaticallyFalse(a, resolve));
      case 'not': return args.length === 1 && known(args[0]) === true;
      case '==':
      case '!=': {
        if (args.length !== 2) return false;
        const [l, r] = [known(args[0]), known(args[1])];
        if (!isLiteral(l) || !isLiteral(r)) return false;
        return (l === r) === (op === '!=');
      }
      default: return false;
    }
  }
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}


// ============================================================================
// quote — an S-expression held as data (G-CROSS-041)
// ============================================================================

/** The special form that holds an S-expression as data: `(quote x)`. */
export const QUOTE_HEAD = 'quote';

function canonicalQuoteValue(expr: SExpr): SExpr {
  if (Array.isArray(expr)) return expr.map(canonicalQuoteValue);
  if (expr !== null && typeof expr === 'object') {
    const out: SExprObject = {};
    for (const key of Object.keys(expr).sort()) setOwn(out, key, canonicalQuoteValue(expr[key]));
    return out;
  }
  return expr;
}

/**
 * The IR body of `(quote x)`: canonical JSON of `x` (object keys sorted) with
 * every `@` written as the JSON escape `@`. The body therefore carries no
 * raw `@`, so no binding interpolation, scan or rewrite can reach inside it;
 * any JSON parser restores the original. orbital-core's
 * `schema::quote::encode_quote_body` produces the same bytes.
 */
export function encodeQuoteBody(expr: SExpr): string {
  return JSON.stringify(canonicalQuoteValue(expr)).replace(/@/g, '\\u0040');
}

/** Decode a `(quote x)` body back to `x`. */
export function decodeQuoteBody(body: string): SExpr {
  const value: SExpr = JSON.parse(body);
  return value;
}

/** The IR call `["quote", <body>]` for `expr`. */
export function quoteExpr(expr: SExpr): [typeof QUOTE_HEAD, string] {
  return [QUOTE_HEAD, encodeQuoteBody(expr)];
}

/**
 * The data a quoted value stands for: `decodeQuoteBody` of the body when
 * `expr` is a `(quote x)` call, else `expr` unchanged. One level per call —
 * binding path resolution applies it per step, so `(quote …)` nested inside
 * the decoded data decodes there when the path reaches it.
 */
export function decodeQuotedValue(expr: SExpr): SExpr;
export function decodeQuotedValue(expr: RuntimeValue): RuntimeValue;
export function decodeQuotedValue(expr: RuntimeValue): RuntimeValue {
  const body = quoteBodyOf(expr);
  return body === undefined ? expr : decodeQuoteBody(body);
}

/** The encoded body when `expr` is a `(quote x)` call, else undefined. */
export function quoteBodyOf(expr: RuntimeValue): string | undefined {
  return Array.isArray(expr) && expr.length === 2 && expr[0] === QUOTE_HEAD && typeof expr[1] === 'string'
    ? expr[1]
    : undefined;
}

// ============================================================================
// quasiquote — a quoted template with live `(unquote e)` holes
// ============================================================================

/** A quoted template: `(quasiquote x)`. */
export const QUASIQUOTE_HEAD = 'quasiquote';
/** A live hole inside a quasiquote template: `(unquote e)`. */
export const UNQUOTE_HEAD = 'unquote';

function isHeadedCall(expr: SExpr, head: string): expr is SExpr[] {
  return Array.isArray(expr) && expr.length > 0 && expr[0] === head;
}

function containsHead(expr: SExpr, head: string): boolean {
  if (isHeadedCall(expr, head)) return true;
  if (Array.isArray(expr)) return expr.some((e) => containsHead(e, head));
  if (expr !== null && typeof expr === 'object') return Object.values(expr).some((e) => containsHead(e, head));
  return false;
}

function extractHoles(expr: SExpr, holes: SExpr[]): SExpr {
  if (isHeadedCall(expr, QUASIQUOTE_HEAD)) throw new Error('quasiquote: nested quasiquote is not supported');
  if (isHeadedCall(expr, UNQUOTE_HEAD)) {
    if (expr.length !== 2) throw new Error('quasiquote: (unquote e) takes exactly one expression');
    if (containsHead(expr[1], UNQUOTE_HEAD)) throw new Error('quasiquote: unquote inside an unquote');
    holes.push(expr[1]);
    return [UNQUOTE_HEAD, holes.length - 1];
  }
  if (Array.isArray(expr)) return expr.map((e) => extractHoles(e, holes));
  if (expr !== null && typeof expr === 'object') {
    // Canonical key order, so hole numbering matches the body bytes on every path.
    const out: SExprObject = {};
    for (const k of Object.keys(expr).sort()) setOwn(out, k, extractHoles(expr[k], holes));
    return out;
  }
  return expr;
}

/**
 * The IR call `["quasiquote", <body>, hole0, hole1, …]` for `template`. The
 * body is a quote body in which each `(unquote e)` became the marker
 * `["unquote", i]`; hole `i` is `e`, left live so bindings resolve in it.
 * orbital-core's `schema::quote::quasiquote_expr` produces the same IR.
 */
export function quasiquoteExpr(template: SExpr): [typeof QUASIQUOTE_HEAD, string, ...SExpr[]] {
  const holes: SExpr[] = [];
  const body = encodeQuoteBody(extractHoles(template, holes));
  return [QUASIQUOTE_HEAD, body, ...holes];
}

/** The body and holes when `expr` is a `(quasiquote x)` call, else undefined. */
export function quasiquoteOf(expr: SExpr): { body: string; holes: SExpr[] } | undefined {
  if (!Array.isArray(expr) || expr.length < 2 || expr[0] !== QUASIQUOTE_HEAD || typeof expr[1] !== 'string') {
    return undefined;
  }
  return { body: expr[1], holes: expr.slice(2) };
}

function countMarkers(expr: SExpr): number {
  if (isHeadedCall(expr, UNQUOTE_HEAD) && expr.length === 2 && typeof expr[1] === 'number') return 1;
  if (Array.isArray(expr)) return expr.reduce<number>((n, e) => n + countMarkers(e), 0);
  if (expr !== null && typeof expr === 'object') return Object.values(expr).reduce<number>((n, e) => n + countMarkers(e), 0);
  return 0;
}

function fillMarkers(expr: SExpr, values: readonly SExpr[]): SExpr {
  if (isHeadedCall(expr, UNQUOTE_HEAD) && expr.length === 2 && typeof expr[1] === 'number') return values[expr[1]];
  if (Array.isArray(expr)) return expr.map((e) => fillMarkers(e, values));
  if (expr !== null && typeof expr === 'object') {
    const out: SExprObject = {};
    for (const [k, v] of Object.entries(expr)) setOwn(out, k, fillMarkers(v, values));
    return out;
  }
  return expr;
}

/**
 * A hole's evaluated value as program data: JSON scalars, arrays and plain
 * objects pass; anything a program cannot hold (a function, a Date, …) throws.
 * Both paths guard `(quasiquote …)` holes with this — orbital-core's
 * `QuasiquoteOp` refuses a lambda the same way.
 */
export function toProgramData(value: RuntimeValue): SExpr {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) return value.map((v: RuntimeValue) => toProgramData(v));
  if (typeof value === 'object' && !(value instanceof Date) && Object.getPrototypeOf(value) === Object.prototype) {
    const out: SExprObject = {};
    for (const [k, v] of Object.entries(value)) setOwn(out, k, toProgramData(v));
    return out;
  }
  throw new Error(`quasiquote: a hole evaluated to a ${typeof value} value, which cannot be held as program data`);
}

/** Decode a quasiquote body and splice `values` (the evaluated holes, in order) into it. */
export function instantiateQuasiquote(body: string, values: readonly SExpr[]): SExpr {
  const template = decodeQuoteBody(body);
  const holes = countMarkers(template);
  if (holes !== values.length) {
    throw new Error(`quasiquote: template has ${holes} hole(s), got ${values.length} value(s)`);
  }
  return fillMarkers(template, values);
}

function formatTemplate(expr: SExpr, holes: readonly SExpr[]): string {
  if (isHeadedCall(expr, UNQUOTE_HEAD) && expr.length === 2 && typeof expr[1] === 'number') {
    return `(${UNQUOTE_HEAD} ${formatSExpr(holes[expr[1]])})`;
  }
  if (Array.isArray(expr)) {
    const op = getOperator(expr);
    if (op !== null) return `(${[op, ...expr.slice(1).map((e) => formatTemplate(e, holes))].join(' ')})`;
    return `[${expr.map((e) => formatTemplate(e, holes)).join(' ')}]`;
  }
  if (expr !== null && typeof expr === 'object') {
    const entries = Object.keys(expr).sort().map((k) => `${k}: ${formatTemplate(expr[k], holes)}`);
    return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
  }
  return formatSExpr(expr);
}
