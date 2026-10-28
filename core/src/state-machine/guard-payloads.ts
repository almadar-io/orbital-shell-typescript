/**
 * Guard Payload Builder
 *
 * Derive pass and fail payloads from guard s-expressions.
 * Extracted from orbital-verify-unified/src/analyze.ts.
 *
 * @packageDocumentation
 */

import type { GuardPayload } from './types.js';
import type { EventPayload, EventPayloadValue, SExpr, SExprObject } from '../types/expression.js';

/**
 * Extracts the first segment of a payload field reference.
 * 
 * Parses binding references in the format "@payload.field" and extracts
 * the first field name segment. Used for identifying payload fields in
 * guard conditions for test data generation.
 * 
 * @param {unknown} ref - Binding reference to extract from
 * @returns {string | null} First field segment or null for non-payload references
 * 
 * @example
 * extractPayloadFieldRef('@payload.item'); // returns 'item'
 * extractPayloadFieldRef('@payload.data.weight'); // returns 'data'
 * extractPayloadFieldRef('@entity.id'); // returns null
 * extractPayloadFieldRef('@user.name'); // returns null
 */
export function extractPayloadFieldRef(ref: unknown): string | null {
  if (typeof ref !== 'string') return null;
  const match = ref.match(/^@payload\.([A-Za-z0-9_]+)/);
  return match ? match[1] : null;
}

/**
 * Full dotted path of a payload reference — `'@payload.data.providerName'`
 * → `['data', 'providerName']`. `extractPayloadFieldRef` keeps only the
 * first segment, which made every guard on a NESTED payload field
 * unsatisfiable by synthesis: `when ?data.providerName` was seeded as
 * `{data: 'mock-test-value'}`, the runtime read `.providerName` off a
 * string, and the pass-case dispatch was correctly rejected (std-booking
 * BookingWizard NEXT — the whole step chain became unwalkable). Returns
 * `null` for non-payload references.
 */
export function extractPayloadFieldPath(ref: unknown): string[] | null {
  if (typeof ref !== 'string') return null;
  const match = ref.match(/^@payload\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)/);
  return match ? match[1].split('.') : null;
}

/** `(default @payload.x <string>)` → `['x']`: a payload field read with a fallback. */
function defaultPayloadPath(ref: unknown): string[] | null {
  if (!Array.isArray(ref) || ref[0] !== 'default' || typeof ref[2] !== 'string') return null;
  return extractPayloadFieldPath(ref[1]);
}

function isComparedLiteral(x: unknown): x is string | number | boolean | null {
  return x === null || typeof x === 'number' || typeof x === 'boolean' || (typeof x === 'string' && !x.startsWith('@'));
}

/**
 * The payload field a `=`/`!=` compares and the value it is compared with: `@payload.x` or
 * `(default @payload.x "…")` on either side, against a literal on the other (the plain field
 * on the left keeps accepting any value there, as before).
 */
function payloadComparison(a: EventPayloadValue, b: EventPayloadValue): { path: string[]; val: EventPayloadValue } | null {
  const plain = extractPayloadFieldPath(a);
  if (plain && b !== undefined) return { path: plain, val: b };
  for (const [side, other] of [[a, b], [b, a]] as const) {
    const path = extractPayloadFieldPath(side) ?? defaultPayloadPath(side);
    if (path && isComparedLiteral(other)) return { path, val: other };
  }
  return null;
}

/** `['data','providerName']` + leaf → `{data: {providerName: leaf}}`. */
function nestedPayload(path: string[], leaf: EventPayloadValue): EventPayload {
  let value: EventPayloadValue = leaf;
  for (let i = path.length - 1; i >= 1; i--) {
    value = { [path[i]]: value };
  }
  return { [path[0]]: value };
}

function isPayloadObject(v: EventPayloadValue): v is EventPayload {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/**
 * RV-53: a numeric comparison's LHS may be `["array/len", "@payload.x"]`
 * (`when (> (array/len ?data) 0)` — "does this list have rows") rather
 * than a bare `@payload.x` reference. `extractPayloadFieldPath` only
 * matches a string, so this shape fell through comparison handling
 * silently (`>` IS a recognized operator, so no gap warning fired) and
 * synthesized nothing — `?data` stayed unresolved even on the PASS
 * variant, making a list-non-empty guard false BY CONSTRUCTION regardless
 * of which branch verify was trying to walk.
 */
function extractArrayLenPath(ref: unknown): string[] | null {
  if (!Array.isArray(ref) || ref.length !== 2 || ref[0] !== 'array/len') return null;
  return extractPayloadFieldPath(ref[1]);
}

/** `n` synthesized rows — a real (non-empty, unless `n <= 0`) array whose
 *  length is exactly what the comparison branch needs, never a bare
 *  number written where the guard reads a list. Negative lengths (a
 *  `lt`/`lte` fail/pass computed as `n - 1` at `n = 0`) clamp to 0 — an
 *  empty list is the correct, real fact for "fewer than zero rows" can
 *  never mean, never a synthesis artifact. */
function arrayOfLength(n: number): EventPayloadValue[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => ({ id: `mock-test-id-${i}` }));
}

/**
 * Guard operators this module synthesizes real pass/fail payloads for
 * (subject to the arg shape actually being payload-steerable — an
 * `@entity`/`@config`-only guard using one of these ops still falls
 * through to `{pass:{}, fail:{}}`, silently, same as always: that's an
 * unsteerable GUARD, not an unrecognized OPERATOR).
 */
const SYNTHESIZED_GUARD_OPERATORS = new Set([
  'not-nil', 'not_nil', 'nil',
  'eq', '==', '=', 'not-eq', '!=', 'neq',
  'gt', '>', 'gte', '>=', 'lt', '<', 'lte', '<=',
  'and', 'or', 'not',
  'object/has', 'object/get', 'array/includes', 'str/startsWith', 'validate/url', 'validate/required',
  'agent/is-pinned', 'agent/memory-strength',
  'if', 'let', 'array/some', 'array/every', 'grid/in-bounds',
]);

/**
 * Guard operators seen in the std/io behavior registries that this module
 * knowingly does NOT synthesize a payload for yet. Empty since G-CORE-022
 * landed. Add an operator here only
 * alongside a gap-ledger entry; never to quiet a genuinely new miss.
 */
const ACKNOWLEDGED_UNSYNTHESIZED_GUARD_OPERATORS = new Set<string>();

/** A `(quote …)` guard is constant data that is never evaluated, so it has no payload to synthesize. */
const CONSTANT_GUARD_FORMS = new Set(['quote']);

/**
 * True when `op` is a guard operator this module has consciously
 * accounted for — either with real synthesis or as a tracked gap.
 * Exported so the exhaustive corpus-coverage test
 * (`__tests__/guard-payloads-operator-coverage.test.ts`) can assert every
 * operator actually used in the std/io registries is on one list or the
 * other, and fail CI the moment a new one isn't.
 */
export function isRecognizedGuardOperator(op: string): boolean {
  return (
    SYNTHESIZED_GUARD_OPERATORS.has(op) ||
    ACKNOWLEDGED_UNSYNTHESIZED_GUARD_OPERATORS.has(op) ||
    CONSTANT_GUARD_FORMS.has(op) ||
    op.startsWith('agent/')
  );
}

/**
 * Operators `buildGuardPayloads` fell through on with NO case at all (not
 * even a tracked gap) — deduped, in first-seen order. `@almadar/core` has
 * no logger dependency (`@almadar/logger` depends on `@almadar/core`, so
 * the reverse would cycle), so a module-level array + `console.warn` is
 * the loud fallback: a silently-returned `{pass:{}, fail:{}}` here is
 * exactly how the `object/has` gap (vim-mode / std-modal-editor
 * OPERATOR_PENDING) went unnoticed for every guardParity + replay-
 * precondition check that depended on it.
 */
export const unhandledGuardOperators: string[] = [];

function recordUnhandledOperator(op: string): void {
  if (unhandledGuardOperators.includes(op)) return;
  unhandledGuardOperators.push(op);
  console.warn(
    `[@almadar/core buildGuardPayloads] unrecognized guard operator "${op}" — synthesizing {pass:{}, fail:{}}; this guard arm cannot be walked pass/fail by verify. Add synthesis (or a tracked-gap entry) in guard-payloads.ts.`,
  );
}

/**
 * `object/has` / `object/get` / `array/includes` guards carry a
 * (collection, `@payload.*` ref) pair. The evaluator's own arg order is
 * fixed — `evalObjectHas`/`evalObjectGet` always read args[0] as the
 * collection, args[1] as the key/path — but detect whichever guard arg IS
 * the payload binding rather than assuming a position, since callers of
 * this synthesizer should not have to track that per-operator.
 */
function splitPayloadArg(a: unknown, b: unknown): { path: string[]; collection: unknown } | null {
  const pathA = extractPayloadFieldPath(a);
  if (pathA) return { path: pathA, collection: b };
  const pathB = extractPayloadFieldPath(b);
  if (pathB) return { path: pathB, collection: a };
  return null;
}

function isPlainRecord(v: unknown): v is SExprObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/** A key guaranteed absent from `keys` — the longest key, `_`-suffixed
 * until it no longer collides (terminates: each suffix strictly grows). */
function absentKey(keys: string[]): string {
  let candidate = `${keys.reduce((longest, k) => (k.length > longest.length ? k : longest), '')}_`;
  while (keys.includes(candidate)) candidate += '_';
  return candidate;
}

/**
 * Deep-merge for synthesized payloads. A shallow spread clobbers sibling
 * NESTED fields — `(and ?data.customerName ?data.email)` built
 * `{data:{customerName}}` then `{data:{email}}` and the spread kept only
 * the last, so multi-field AND guards on one payload object could never
 * pass. Later keys win on genuine conflicts, mirroring spread order.
 */
function mergePayloads(a: EventPayload, b: EventPayload): EventPayload {
  const out: EventPayload = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    out[k] = prev !== undefined && isPayloadObject(prev) && v !== undefined && isPayloadObject(v)
      ? mergePayloads(prev, v)
      : v;
  }
  return out;
}

/**
 * `(object/get <mapLiteral> <payloadRef>)` used as one side of an `=` /
 * `==` / `!=` comparison — e.g. `["=", (object/get MAP ?key), "change"]`
 * (std-modal-editor's `vim-mode` motion-key guard). Detects the operand
 * regardless of which comparison side it's on, matching `splitPayloadArg`'s
 * either-order convention.
 */
function extractObjectGetOperand(x: unknown): { path: string[]; map: SExprObject } | null {
  if (!Array.isArray(x) || x[0] !== 'object/get') return null;
  const split = splitPayloadArg(x[1], x[2]);
  if (split && isPlainRecord(split.collection)) {
    return { path: split.path, map: split.collection };
  }
  return null;
}

/** `["=", a, b]` / `["!=", a, b]` where exactly one side is `object/get(map, ?field)`
 * and the other is a literal — resolves to the field path, the map, and the literal
 * regardless of which side carries the `object/get`. */
function resolveObjectGetComparison(
  a: unknown,
  b: unknown,
): { path: string[]; map: SExprObject; literal: unknown } | null {
  const getA = extractObjectGetOperand(a);
  if (getA) return { path: getA.path, map: getA.map, literal: b };
  const getB = extractObjectGetOperand(b);
  if (getB) return { path: getB.path, map: getB.map, literal: a };
  return null;
}

/**
 * `["=" | "==", (object/get MAP ?field), literal]` (either operand order)
 * checks whether the map value the payload field NAMES equals `literal` —
 * `object/has` alone can't tell `?field` apart from any other key that
 * also happens to be present, so `(and (object/has MAP ?field) ["=",
 * (object/get MAP ?field), "change"])` needs this refinement or the `and`
 * merge falls back to `object/has`'s first-key guess (vim-mode / std-
 * modal-editor motion guard: `?key` synthesized as "d" instead of a key
 * whose command is actually "change"). `negate` swaps pass/fail for `!=`.
 * Pass binds the FIRST (map order) key whose value satisfies the
 * comparison; fail the first key whose value doesn't, else a synthesized
 * absent key. No satisfying key on the pass side is left unbound — do not
 * invent a value the real guard would reject.
 */
function buildObjectGetComparisonPayload(a: unknown, b: unknown, negate: boolean): GuardPayload | null {
  const resolved = resolveObjectGetComparison(a, b);
  if (!resolved) return null;
  const { path, map, literal } = resolved;
  const keys = Object.keys(map);
  const passKey = keys.find((k) => (negate ? map[k] !== literal : map[k] === literal));
  const failKey = keys.find((k) => (negate ? map[k] === literal : map[k] !== literal));
  return {
    pass: passKey !== undefined ? nestedPayload(path, passKey) : {},
    fail: failKey !== undefined ? nestedPayload(path, failKey) : nestedPayload(path, absentKey(keys)),
  };
}

/**
 * Finite set of `?field` values that satisfy `guard`'s PASS branch, for
 * conjuncts whose pass condition bounds one field to a known set of
 * candidates: `object/has MAP ?f` (the map's keys), an `object/get`
 * equality/inequality comparison against a map literal (the matching
 * keys), or a bare `["=", ?f, literal]` (the singleton `{literal}`).
 * Returns null for every other shape — most guards don't bound a field
 * this way, and this is used only to reconcile two conjuncts that name
 * the SAME field (see `applyFieldIntersections`), not as general synthesis.
 */
function guardPassCandidateSet(guard: unknown): { path: string[]; values: string[] } | null {
  if (!Array.isArray(guard) || guard.length === 0) return null;
  const op = String(guard[0]);

  if (op === 'object/has') {
    const split = splitPayloadArg(guard[1], guard[2]);
    if (split && isPlainRecord(split.collection)) {
      return { path: split.path, values: Object.keys(split.collection) };
    }
    return null;
  }

  if (op === 'eq' || op === '==' || op === '=' || op === 'not-eq' || op === '!=' || op === 'neq') {
    const negate = op === 'not-eq' || op === '!=' || op === 'neq';
    const resolved = resolveObjectGetComparison(guard[1], guard[2]);
    if (resolved) {
      const values = Object.keys(resolved.map).filter((k) =>
        negate ? resolved.map[k] !== resolved.literal : resolved.map[k] === resolved.literal,
      );
      return { path: resolved.path, values };
    }
    if (!negate) {
      const path = extractPayloadFieldPath(guard[1]);
      if (path && typeof guard[2] === 'string') return { path, values: [guard[2]] };
    }
    return null;
  }

  return null;
}

/** Removes one (possibly nested) field from a synthesized payload — used
 * when two `and` conjuncts constrain the same field to disjoint candidate
 * sets, so no single value satisfies both and inventing one would fail
 * whichever conjunct it doesn't come from. */
function withoutField(payload: EventPayload, path: string[]): EventPayload {
  const [head, ...tail] = path;
  if (tail.length === 0) {
    const rest: EventPayload = {};
    for (const k of Object.keys(payload)) {
      if (k !== head) rest[k] = payload[k];
    }
    return rest;
  }
  const nested = payload[head];
  if (!isPayloadObject(nested)) return payload;
  return { ...payload, [head]: withoutField(nested, tail) };
}

/**
 * `and` merges each conjunct's pass payload independently (last conjunct
 * wins on a shared field, via `mergePayloads`), so two conjuncts
 * constraining the SAME field raced on merge ORDER instead of agreeing on
 * a value that satisfies both: `(and (object/has MAP ?key) ["=",
 * (object/get MAP ?key), "change"])` picked `object/has`'s first key
 * whenever it merged last, ignoring the `=` conjunct's refinement.
 * Intersects every conjunct's candidate set for each field that has one,
 * in the first conjunct's own key order, and rebinds to the first
 * surviving value; a field left with no shared candidate is unsatisfiable
 * and is unbound rather than guessed.
 */
function applyFieldIntersections(subs: unknown[], pass: EventPayload): EventPayload {
  const byField = new Map<string, { path: string[]; sets: string[][] }>();
  for (const sub of subs) {
    const candidate = guardPassCandidateSet(sub);
    if (!candidate) continue;
    const key = JSON.stringify(candidate.path);
    const entry = byField.get(key);
    if (entry) entry.sets.push(candidate.values);
    else byField.set(key, { path: candidate.path, sets: [candidate.values] });
  }
  let out = pass;
  for (const { path, sets } of byField.values()) {
    if (sets.length < 2) continue;
    const intersection = sets.reduce((acc, set) => acc.filter((v) => set.includes(v)));
    out = intersection.length > 0 ? mergePayloads(out, nestedPayload(path, intersection[0])) : withoutField(out, path);
  }
  return out;
}

/**
 * Builds test payloads that satisfy or violate guard conditions.
 *
 * Generates pass/fail test data for guard s-expressions used in state machine
 * transitions. Pass payloads satisfy the guard condition (allowing transition),
 * fail payloads violate it (blocking transition). Used for automated testing
 * and validation of state machine behavior.
 * 
 * Supports operators: not-nil, nil, eq, not-eq, gt, gte, lt, lte, and, or, not
 * 
 * @param {unknown} guard - Guard s-expression to analyze
 * @returns {GuardPayload} Object with pass and fail payloads
 * 
 * @example
 * // Guard: ['not-nil', '@payload.completed']
 * buildGuardPayloads(['not-nil', '@payload.completed']);
 * // Returns: { pass: { completed: 'mock-test-value' }, fail: { completed: null } }
 * 
 * @example
 * // Guard: ['eq', '@payload.status', 'active']
 * buildGuardPayloads(['eq', '@payload.status', 'active']);
 * // Returns: { pass: { status: 'active' }, fail: { status: 'not-active' } }
 * 
 * @example
 * // Guard: ['and', ['not-nil', '@payload.id'], ['eq', '@payload.status', 'ready']]
 * buildGuardPayloads(['and', ['not-nil', '@payload.id'], ['eq', '@payload.status', 'ready']]);
 * // Returns: { pass: { id: 'mock-test-value', status: 'ready' }, fail: { id: null } }
 */
/**
 * Evaluate a guard that is fully constant (no `@payload`/`@entity`/`@config`
 * bindings — e.g. after molecule/organism inlining folds `@config.mode` to a
 * literal). Returns the constant truth value, or `null` when the guard depends
 * on a binding (so a payload must be synthesized). This lets callers (a) emit
 * an empty payload for a constant guard (no field to satisfy) and (b) skip the
 * meaningless variant: an always-true guard has no fail case, an always-false
 * guard has no pass case. Without it, `(or (= "create" "create") @payload.row)`
 * (create-mode modal OPEN) was synthesized with a spurious `row`, which the
 * runtime read as edit-mode and rejected.
 */
export function constTruth(guard: unknown): boolean | null {
  if (typeof guard === 'boolean') return guard;
  if (typeof guard === 'string') {
    if (guard.startsWith('@')) return null; // a binding — not constant
    return guard.length > 0; // bare non-binding literal: truthy iff non-empty
  }
  if (!Array.isArray(guard) || guard.length === 0) return null;
  const op = String(guard[0]);
  const isLiteral = (x: unknown): boolean =>
    x === null ||
    typeof x === 'number' ||
    typeof x === 'boolean' ||
    (typeof x === 'string' && !x.startsWith('@'));
  if (op === '=' || op === '==' || op === 'eq') {
    return isLiteral(guard[1]) && isLiteral(guard[2]) ? guard[1] === guard[2] : null;
  }
  if (op === '!=' || op === 'ne' || op === 'not-eq' || op === 'neq') {
    return isLiteral(guard[1]) && isLiteral(guard[2]) ? guard[1] !== guard[2] : null;
  }
  if (op === 'not') {
    const inner = constTruth(guard[1]);
    return inner === null ? null : !inner;
  }
  if (op === 'or') {
    const subs = (guard.slice(1) as unknown[]).map(constTruth);
    if (subs.some((s) => s === true)) return true; // short-circuit
    if (subs.every((s) => s === false)) return false;
    return null;
  }
  if (op === 'and') {
    const subs = (guard.slice(1) as unknown[]).map(constTruth);
    if (subs.some((s) => s === false)) return false; // short-circuit
    if (subs.every((s) => s === true)) return true;
    return null;
  }
  return null;
}


type RefMapper = (path: string[]) => SExpr | undefined;

/**
 * Replaces every reference to the bound variable `name` in `node`: a bare
 * `"@name"` / dotted `"@name.a.b"` string, or `(object/get "@name" "a")`.
 * `mapRef` receives the field path (empty for the bare variable) and returns the
 * replacement, or `undefined` to leave the reference untouched. A nested `fn`
 * that re-binds `name` shadows it and is left alone.
 */
function substituteVar(node: SExpr, name: string, mapRef: RefMapper): SExpr {
  if (typeof node === 'string') {
    if (node === `@${name}`) return mapRef([]) ?? node;
    if (node.startsWith(`@${name}.`)) return mapRef(node.slice(name.length + 2).split('.')) ?? node;
    return node;
  }
  if (Array.isArray(node)) {
    if (node[0] === 'fn' && node[1] === name) return node;
    if (node[0] === 'object/get' && typeof node[2] === 'string' && node[1] === `@${name}`) {
      return mapRef([node[2]]) ?? node;
    }
    return node.map((child) => substituteVar(child, name, mapRef));
  }
  if (typeof node === 'object' && node !== null) {
    const out: SExprObject = {};
    for (const [k, v] of Object.entries(node)) out[k] = substituteVar(v, name, mapRef);
    return out;
  }
  return node;
}

function readLiteralPath(value: SExpr, path: string[]): SExpr {
  let cur: SExpr = value;
  for (const seg of path) {
    if (!isPlainRecord(cur)) return null;
    const next: SExpr | undefined = cur[seg];
    cur = next === undefined ? null : next;
  }
  return cur;
}

function hasKeys(p: EventPayload): boolean {
  return Object.keys(p).length > 0;
}

/**
 * `(let ((a <expr>) …) body)`: bind each name to its (already-substituted) value expression in
 * the rest of the bindings and the body, then synthesize for the body.
 */
function buildLetPayloads(guard: SExpr[]): GuardPayload | null {
  const bindings = guard[1];
  const bodyIdx = guard.length - 1;
  if (!Array.isArray(bindings) || bodyIdx < 2) return null;
  const pairs: [string, SExpr][] = [];
  for (const b of bindings) {
    if (!Array.isArray(b) || typeof b[0] !== 'string' || b.length < 2) return null;
    pairs.push([b[0], b[1]]);
  }
  const bindingRef = (value: SExpr): RefMapper => (path) => {
    if (path.length === 0) return value;
    if (typeof value === 'string' && value.startsWith('@')) return `${value}.${path.join('.')}`;
    if (isPlainRecord(value)) return readLiteralPath(value, path);
    return undefined;
  };
  let body: SExpr = guard[bodyIdx];
  const values = pairs.map(([, v]) => v);
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) values[j] = substituteVar(values[j], pairs[i][0], bindingRef(values[i]));
  }
  for (let i = pairs.length - 1; i >= 0; i--) body = substituteVar(body, pairs[i][0], bindingRef(values[i]));
  return buildGuardPayloads(body);
}

/**
 * `(if cond then else)` as a guard: it is true iff (cond ∧ then) ∨ (¬cond ∧ else). Each target
 * truth value takes the first arm that can reach it; an arm whose own value is a constant of the
 * wrong truth is skipped, as is the arm the condition's constant value rules out.
 */
function buildIfPayloads(guard: SExpr[]): GuardPayload | null {
  if (guard.length < 3) return null;
  const elseG: SExpr = guard.length > 3 ? guard[3] : false;
  const c = buildGuardPayloads(guard[1]);
  const t = buildGuardPayloads(guard[2]);
  const e = buildGuardPayloads(elseG);
  const cc = constTruth(guard[1]);
  const ct = constTruth(guard[2]);
  const ce = constTruth(elseG);
  const reach = (target: boolean): EventPayload => {
    const thenOk = cc !== false && ct !== !target;
    if (thenOk) return mergePayloads(c.pass, target ? t.pass : t.fail);
    const elseOk = cc !== true && ce !== !target;
    if (elseOk) return mergePayloads(c.fail, target ? e.pass : e.fail);
    return {};
  };
  return { pass: reach(true), fail: reach(false) };
}

/**
 * `(array/some coll (fn x pred))` / `(array/every coll (fn x pred))`. A payload collection gets a
 * synthesized list field whose element satisfies/violates the predicate (some-false is the empty
 * list); a literal collection (config folded in) is walked element by element with the element's
 * fields substituted into the predicate, so payload refs the predicate compares against are steered.
 */
function buildQuantifierPayloads(op: 'array/some' | 'array/every', guard: SExpr[]): GuardPayload | null {
  const fn = guard[2];
  if (!Array.isArray(fn) || fn[0] !== 'fn' || typeof fn[1] !== 'string' || fn.length < 3) return null;
  const name = fn[1];
  const body = fn[fn.length - 1];
  const some = op === 'array/some';

  const listPath = extractPayloadFieldPath(guard[1]);
  if (listPath) {
    const sub = substituteVar(body, name, (p) => (p.length > 0 ? `@payload.${p.join('.')}` : undefined));
    const truth = constTruth(sub);
    const built = buildGuardPayloads(sub);
    const witness = truth === true ? { id: 'mock-test-id' } : hasKeys(built.pass) && truth !== false ? built.pass : null;
    const violator = truth === false ? { id: 'mock-test-id' } : hasKeys(built.fail) && truth !== true ? built.fail : null;
    const list = (el: EventPayload | null): EventPayload => (el ? nestedPayload(listPath, [el]) : {});
    return some
      ? { pass: list(witness), fail: nestedPayload(listPath, []) }
      : { pass: list(witness), fail: list(violator) };
  }

  if (Array.isArray(guard[1])) {
    const items = guard[1];
    const per = items.map((item) => {
      const sub = substituteVar(body, name, (p) => readLiteralPath(item, p));
      return { truth: constTruth(sub), built: buildGuardPayloads(sub) };
    });
    const mergeAll = (pick: (b: GuardPayload) => EventPayload, skip: boolean): EventPayload =>
      per.reduce<EventPayload>((acc, x) => (x.truth === skip ? acc : mergePayloads(acc, pick(x.built))), {});
    const firstWhere = (ok: (t: boolean | null) => boolean, pick: (b: GuardPayload) => EventPayload): EventPayload => {
      const hit = per.find((x) => ok(x.truth));
      return hit ? pick(hit.built) : {};
    };
    return some
      ? {
          pass: per.some((x) => x.truth === true) ? {} : firstWhere((t) => t !== false, (b) => b.pass),
          fail: mergeAll((b) => b.fail, true),
        }
      : {
          pass: mergeAll((b) => b.pass, true),
          fail: per.some((x) => x.truth === false) ? {} : firstWhere((t) => t !== true, (b) => b.fail),
        };
  }
  return null;
}

/**
 * `(grid/in-bounds {x:…, y:…} w h)` (or a payload position object): the origin is inside any
 * positive grid and `-1` is outside any grid, so both hold whether the bounds are literals or
 * unresolved config. Only payload-derived coordinates are steered; with literal bounds that admit
 * no cell (`<= 0`) there is no in-bounds payload.
 */
function buildGridInBoundsPayloads(guard: SExpr[]): GuardPayload | null {
  const pos = guard[1];
  const w = guard[2];
  const h = guard[3];
  const emptyGrid = (typeof w === 'number' && w <= 0) || (typeof h === 'number' && h <= 0);
  const posPath = extractPayloadFieldPath(pos);
  if (posPath) {
    return {
      pass: emptyGrid ? {} : nestedPayload(posPath, { x: 0, y: 0 }),
      fail: nestedPayload(posPath, { x: -1, y: 0 }),
    };
  }
  if (!isPlainRecord(pos)) return null;
  const axes = (['x', 'y'] as const).map((k) => ({ k, path: extractPayloadFieldPath(pos[k]) }));
  const steered = axes.filter((a): a is { k: 'x' | 'y'; path: string[] } => a.path !== null);
  if (steered.length === 0) return null;
  const pass = emptyGrid ? {} : steered.reduce<EventPayload>((acc, a) => mergePayloads(acc, nestedPayload(a.path, 0)), {});
  return { pass, fail: nestedPayload(steered[0].path, -1) };
}

export function buildGuardPayloads(guard: unknown): GuardPayload {
  // A fully-constant guard (post-inline literal fold) is decided by its
  // literals, not by the payload — synthesize nothing for either case.
  if (constTruth(guard) !== null) {
    return { pass: {}, fail: {} };
  }
  if (Array.isArray(guard) && typeof guard[0] === 'string' && CONSTANT_GUARD_FORMS.has(guard[0])) {
    return { pass: {}, fail: {} };
  }
  // Bare-binding existence guard: e.g. `when @payload.row` lowers to
  // the string `"@payload.row"`. The transition fires iff that field is
  // truthy. Synthesize pass with a truthy mock and fail with null so
  // the verifier can drive both branches. Without this, std-confirmation
  // and std-modal's existence guards (REQUEST/EDIT requiring @payload.row)
  // get empty payloads in both cases — the pass case then fails the
  // server-side guard and the portal observer flags "slot not mounted".
  if (typeof guard === 'string') {
    const path = extractPayloadFieldPath(guard);
    // Single-segment existence guards keep the row-shaped mock (`?row` —
    // std-confirmation/std-modal open a record view off it); a NESTED leaf
    // (`?data.providerName`) is a scalar field, so a string mock is the
    // truthy value its consumers (str/…, renders) can actually use.
    if (path) {
      return path.length === 1
        ? { pass: { [path[0]]: { id: 'mock-test-id', name: 'mock-test-name' } }, fail: { [path[0]]: null } }
        : { pass: nestedPayload(path, 'mock-test-value'), fail: nestedPayload(path, null) };
    }
  }

  if (!Array.isArray(guard) || guard.length === 0) {
    return { pass: {}, fail: {} };
  }

  const op = String(guard[0]);

  if (op === 'not-nil' || op === 'not_nil') {
    const path = extractPayloadFieldPath(guard[1]);
    if (path) return { pass: nestedPayload(path, 'mock-test-value'), fail: nestedPayload(path, null) };
  }

  if (op === 'nil') {
    const path = extractPayloadFieldPath(guard[1]);
    if (path) return { pass: {}, fail: nestedPayload(path, 'mock-test-value') };
  }

  if (op === 'eq' || op === '==' || op === '=' || op === 'not-eq' || op === '!=' || op === 'neq') {
    const arrayPath = extractArrayLenPath(guard[1]);
    if (arrayPath && typeof guard[2] === 'number') {
      const n = guard[2];
      const equal = { hit: nestedPayload(arrayPath, arrayOfLength(n)), miss: nestedPayload(arrayPath, arrayOfLength(n + 1)) };
      return op === 'eq' || op === '==' || op === '='
        ? { pass: equal.hit, fail: equal.miss }
        : { pass: equal.miss, fail: equal.hit };
    }
  }

  if (op === 'eq' || op === '==' || op === '=') {
    const compared = payloadComparison(guard[1], guard[2]);
    if (compared) {
      const { path, val } = compared;
      const failVal =
        typeof val === 'number' ? val + 1
        : typeof val === 'string' ? `not-${val}`
        : null;
      return { pass: nestedPayload(path, val), fail: nestedPayload(path, failVal) };
    }
    const objectGetPayload = buildObjectGetComparisonPayload(guard[1], guard[2], false);
    if (objectGetPayload) return objectGetPayload;
  }

  if (op === 'not-eq' || op === '!=' || op === 'neq') {
    const compared = payloadComparison(guard[1], guard[2]);
    if (compared) {
      const { path, val } = compared;
      const passVal =
        typeof val === 'number' ? val + 1
        : typeof val === 'string' ? `not-${val}`
        : 'other';
      return { pass: nestedPayload(path, passVal), fail: nestedPayload(path, val) };
    }
    const objectGetPayload = buildObjectGetComparisonPayload(guard[1], guard[2], true);
    if (objectGetPayload) return objectGetPayload;
  }

  if (op === 'gt' || op === '>') {
    const arrayPath = extractArrayLenPath(guard[1]);
    const n = typeof guard[2] === 'number' ? guard[2] : 0;
    if (arrayPath) return { pass: nestedPayload(arrayPath, arrayOfLength(n + 1)), fail: nestedPayload(arrayPath, arrayOfLength(n)) };
    const path = extractPayloadFieldPath(guard[1]);
    if (path) return { pass: nestedPayload(path, n + 1), fail: nestedPayload(path, n - 1) };
  }

  if (op === 'gte' || op === '>=') {
    const arrayPath = extractArrayLenPath(guard[1]);
    const n = typeof guard[2] === 'number' ? guard[2] : 0;
    if (arrayPath) return { pass: nestedPayload(arrayPath, arrayOfLength(n)), fail: nestedPayload(arrayPath, arrayOfLength(n - 1)) };
    const path = extractPayloadFieldPath(guard[1]);
    if (path) return { pass: nestedPayload(path, n), fail: nestedPayload(path, n - 1) };
  }

  if (op === 'lt' || op === '<') {
    const arrayPath = extractArrayLenPath(guard[1]);
    const n = typeof guard[2] === 'number' ? guard[2] : 0;
    if (arrayPath) return { pass: nestedPayload(arrayPath, arrayOfLength(n - 1)), fail: nestedPayload(arrayPath, arrayOfLength(n + 1)) };
    const path = extractPayloadFieldPath(guard[1]);
    if (path) return { pass: nestedPayload(path, n - 1), fail: nestedPayload(path, n + 1) };
  }

  if (op === 'lte' || op === '<=') {
    const arrayPath = extractArrayLenPath(guard[1]);
    const n = typeof guard[2] === 'number' ? guard[2] : 0;
    if (arrayPath) return { pass: nestedPayload(arrayPath, arrayOfLength(n)), fail: nestedPayload(arrayPath, arrayOfLength(n + 1)) };
    const path = extractPayloadFieldPath(guard[1]);
    if (path) return { pass: nestedPayload(path, n), fail: nestedPayload(path, n + 1) };
  }

  if (op === 'and') {
    // Accept BOTH array sub-guards and bare-binding string sub-guards
    // (e.g. `(and "@payload.row" (not-nil "@payload.id"))`). Dropping the
    // bare strings with filter(Array.isArray) lost their fields from the
    // pass payload. AND passes iff every sub-guard passes, so merge all
    // sub-guards' pass payloads; AND fails iff any sub-guard fails, so the
    // first sub-guard's fail payload is a sufficient violation.
    const subs = guard.slice(1) as unknown[];
    if (subs.length >= 2) {
      const built = subs.map(buildGuardPayloads);
      const merged = built.reduce<GuardPayload['pass']>((acc, b) => mergePayloads(acc, b.pass), {});
      const pass = applyFieldIntersections(subs, merged);
      // A constant-true sub-guard (a config knob folded in) can never be the one that fails.
      const canFail = subs.findIndex((g) => constTruth(g) !== true);
      return { pass, fail: built[canFail >= 0 ? canFail : 0].fail };
    }
    if (subs.length === 1) return buildGuardPayloads(subs[0]);
  }

  if (op === 'or') {
    // Accept BOTH array sub-guards and bare-binding string sub-guards
    // (post-substitution mode-aware guards like
    // `(or (= "edit" "create") "@payload.row")` mix array + string children).
    const subs = guard.slice(1) as unknown[];
    if (subs.length >= 2) {
      const s1 = buildGuardPayloads(subs[0]);
      const s2 = buildGuardPayloads(subs[1]);
      // For OR: pass if EITHER branch passes. Prefer the second branch's
      // pass payload if the first yields nothing useful — the literal-fold
      // case `(= "edit" "create") || @payload.row` has the first branch
      // return `{}` and the row-payload comes from the second.
      const combinedPass = Object.keys(s1.pass).length > 0 ? s1.pass : s2.pass;
      return { pass: combinedPass, fail: mergePayloads(s1.fail, s2.fail) };
    }
    if (subs.length === 1) return buildGuardPayloads(subs[0]);
  }

  if (op === 'let') {
    const r = buildLetPayloads(guard);
    if (r) return r;
  }

  if (op === 'if') {
    const r = buildIfPayloads(guard);
    if (r) return r;
  }

  if (op === 'array/some' || op === 'array/every') {
    const r = buildQuantifierPayloads(op, guard);
    if (r) return r;
  }

  if (op === 'grid/in-bounds') {
    const r = buildGridInBoundsPayloads(guard);
    if (r) return r;
  }

  if (op === 'not') {
    const inner = buildGuardPayloads(guard[1]);
    return { pass: inner.fail, fail: inner.pass };
  }

  // `object/has(collection, "@payload.field")` (arg order per
  // `evalObjectHas` — see `splitPayloadArg` doc) — the vim-mode /
  // std-modal-editor OPERATOR_PENDING gap: `["object/has",
  // "@config.operators", "@payload.key"]` (post config-inline, args[0] is a
  // literal map) checks whether `payload.key` names one of the map's own
  // keys. Pass with the map's first declared key (deterministic); fail
  // with a key guaranteed absent from it.
  if (op === 'object/has') {
    const split = splitPayloadArg(guard[1], guard[2]);
    if (split && isPlainRecord(split.collection)) {
      const keys = Object.keys(split.collection);
      if (keys.length > 0) {
        return { pass: nestedPayload(split.path, keys[0]), fail: nestedPayload(split.path, absentKey(keys)) };
      }
    }
  }

  // `object/get(collection, "@payload.field")` used BARE as a guard (no
  // wrapping `not-nil`/`eq`) — std-modal-editor's `motions` arms — is a
  // truthy check on the looked-up value: pass iff `collection[payload.field]`
  // is truthy. Fail with an absent key (`object/get` returns `undefined`,
  // falsy); pass with a key whose declared value is itself truthy — a key
  // present but mapped to a falsy literal would still fail the real guard.
  if (op === 'object/get') {
    const split = splitPayloadArg(guard[1], guard[2]);
    if (split && isPlainRecord(split.collection)) {
      const map = split.collection;
      const keys = Object.keys(map);
      const passKey = keys.find((k) => Boolean(map[k]));
      if (passKey !== undefined) {
        return { pass: nestedPayload(split.path, passKey), fail: nestedPayload(split.path, absentKey(keys)) };
      }
    }
  }

  // `array/includes(list, "@payload.field")` — pass with the list's first
  // element, fail with a value provably not in the list.
  if (op === 'array/includes') {
    const split = splitPayloadArg(guard[1], guard[2]);
    if (split && Array.isArray(split.collection) && split.collection.length > 0) {
      const passVal = split.collection[0];
      const failVal = typeof passVal === 'string' ? `${passVal}-not-in-list` : 'not-in-list';
      return { pass: nestedPayload(split.path, passVal), fail: nestedPayload(split.path, failVal) };
    }
  }

  if (op === 'str/startsWith') {
    const path = extractPayloadFieldPath(guard[1]);
    const prefix = typeof guard[2] === 'string' ? guard[2] : '';
    if (path) {
      return {
        pass: nestedPayload(path, `${prefix}mock-suffix`),
        fail: nestedPayload(path, prefix.length > 0 ? `not-${prefix}` : 'mock-test-value'),
      };
    }
  }

  // `(validate/url @payload.x)`: pass with a parseable URL, fail with a non-URL string.
  if (op === 'validate/url') {
    const path = extractPayloadFieldPath(guard[1]);
    if (path) {
      return { pass: nestedPayload(path, 'https://example.test/mock'), fail: nestedPayload(path, 'not-a-url') };
    }
  }

  // `(validate/required @payload.x)`: pass with a non-empty value, fail with an empty string.
  if (op === 'validate/required') {
    const path = extractPayloadFieldPath(guard[1]);
    if (path) {
      return { pass: nestedPayload(path, 'mock-required-value'), fail: nestedPayload(path, '') };
    }
  }

  // Agent pure operators used in guards
  if (op === 'agent/is-pinned') {
    const field = extractPayloadFieldRef(guard[1]);
    if (field) return { pass: { [field]: 'mem_test_unpinned' }, fail: { [field]: 'mem_test_pinned' } };
  }

  if (op === 'agent/memory-strength') {
    const field = extractPayloadFieldRef(guard[1]);
    if (field) return { pass: { [field]: 'mem_test_id' }, fail: { [field]: 'mem_nonexistent' } };
  }

  // Agent operators in comparison contexts (e.g., [">=", ["agent/context-usage"], 0.85])
  // These don't use @payload, they query agent state directly. Return empty payloads
  // since the guard result depends on agent context, not event payload.
  if (op.startsWith('agent/')) {
    return { pass: {}, fail: {} };
  }

  // Every branch above either returned or fell through because the guard's
  // ARGS weren't payload-steerable (a recognized op, deliberately empty —
  // not a gap). An op that isn't even on the recognized list is the real
  // fallthrough this function must never let happen silently.
  if (!isRecognizedGuardOperator(op)) {
    recordUnhandledOperator(op);
  }

  return { pass: {}, fail: {} };
}
