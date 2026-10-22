/**
 * The one TypeScript sexpr -> `RowPredicate` compiler (docs/Almadar_Embedded_Kernel_Pushdown.md, "Compiling `filter` and
 * `read_policy`"), the twin of orbital-core `runtime/row_query.rs` `compile_predicate`; the shared fixture
 * `fixtures/pushdown/compile-cases.json` pins that the two make the same decision. `@user`/`@payload`/`@config`/`@now`
 * terms are folded to their values for this dispatch by the host's `resolve`, then the operators over `@entity` fields
 * are mapped to predicate leaves.
 *
 * A shape compiles only where the evaluator and `RowPredicate` provably agree (D-A21, D-A26):
 * - an ordering comparison (`<`, `<=`, `>`, `>=`) reads a missing or null field as below any number in the evaluator but
 *   fails in the two-valued `RowPredicate`. `orb validate` rejects one over a field that can be missing unless the program
 *   guards it (ORB_X_ORDERING_OPTIONAL_OPERAND), so it compiles on a field the entity declares required or defaulted, or when a direct conjunct
 *   of an enclosing `and` is a presence guard on that field (`(!= f null)`, `(not (= f null))`, or `(validate/required f)`
 *   next to an ordering of `f` against a number, where "required" and "not null" coincide) -- a null `f` then makes the
 *   whole conjunction false in both worlds;
 * - `array/includes` and `str/includes` ERROR on a missing or null operand in the evaluator, which drops the row; that
 *   equals a failing leaf only inside a top-level `and` chain, so elsewhere (`or`, `not`) they compile only on a required field.
 * Both are `null-semantics` otherwise. Anything else outside the table is `inexpressible`. A binding that resolves to
 * nothing is `unspecialised`: a policy then compiles to `const false` (a row whose predicate fails is hidden), a filter
 * is interpreted. The compiler never drops a conjunct.
 */
import type { FieldValue } from './types/entity.js';
import type { SExpr } from './types/expression.js';
import type { RowOrder, RowPredicate } from './service-types.js';

export type RowBindingScalar = string | number | boolean | null;

export type RowBindingResult =
  | { kind: 'value'; value: RowBindingScalar }
  | { kind: 'list'; values: RowBindingScalar[] }
  | { kind: 'unspecialised'; detail: string }
  | { kind: 'inexpressible'; detail: string };

export interface PredicateCompileContext {
  /** Folds a binding term (`@user.id`, `@payload.q`, `@config.k`, `@now`) to its value; absent = bindings are not expressible. */
  resolve?: (term: string) => RowBindingResult;
  /** Fields the entity declares required or with a default (never missing); `id` is always required. */
  requiredFields?: ReadonlySet<string>;
  /** `policy`: a predicate that cannot be specialised hides every row (`const false`). `filter` (default): it is interpreted. */
  role?: 'policy' | 'filter';
}

export type PredicateCompilation =
  | { kind: 'predicate'; predicate: RowPredicate }
  | { kind: 'inexpressible'; detail: string }
  | { kind: 'unspecialised'; detail: string }
  | { kind: 'null-semantics'; detail: string };

type Failure = Exclude<PredicateCompilation, { kind: 'predicate' }>;
type Term = { kind: 'field'; field: string } | { kind: 'value'; value: FieldValue };
/** What the enclosing `and` chains establish: fields shown present, and fields ordered against a number (where `validate/required` is a null check). */
interface Scope {
  guarded: ReadonlySet<string>;
  numeric: ReadonlySet<string>;
}
const NO_SCOPE: Scope = { guarded: new Set(), numeric: new Set() };
const ORDERING = new Set(['<', '<=', '>', '>=']);
type Outcome<T> = { ok: true; value: T } | { ok: false; failure: Failure };

const COMPARE_OPS = new Map<string, '==' | '!=' | '<' | '<=' | '>' | '>='>([
  ['=', '=='], ['==', '=='], ['eq', '=='], ['!=', '!='], ['!==', '!='], ['neq', '!='], ['<', '<'], ['<=', '<='], ['>', '>'], ['>=', '>='],
]);
const FLIPPED = { '==': '==', '!=': '!=', '<': '>', '<=': '>=', '>': '<', '>=': '<=' } as const;

const fail = (kind: Failure['kind'], detail: string): { ok: false; failure: Failure } => ({ ok: false, failure: { kind, detail } });
const shape = (detail: string): { ok: false; failure: Failure } => fail('inexpressible', detail);
const good = <T>(value: T): Outcome<T> => ({ ok: true, value });

function isScalar(value: SExpr): value is RowBindingScalar {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** Two constants of one non-null scalar kind: where the row-side equality is plain equality. */
function sameScalarKind(a: FieldValue, b: FieldValue): boolean {
  const scalar = (v: FieldValue): boolean => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
  return scalar(a) && typeof a === typeof b;
}

function flatField(name: string): Outcome<string> {
  return name.includes('.') || name.includes('[') ? shape('a row path is not a flat field') : good(name);
}

/** The row field an operand names, null when it names none. */
function fieldOf(expr: SExpr, ctx?: PredicateCompileContext): Outcome<string | null> {
  if (typeof expr === 'string') {
    if (expr === '@entity') return shape('the whole row is not a field');
    if (!expr.startsWith('@entity.')) return good(null);
    const flat = flatField(expr.slice('@entity.'.length));
    return flat.ok ? good(flat.value) : flat;
  }
  if (Array.isArray(expr) && expr[0] === 'object/get' && expr[1] === '@entity') {
    if (expr.length === 3 && typeof expr[2] === 'string') {
      if (expr[2].startsWith('@') && ctx !== undefined) {
        // The evaluator reads the one field the binding holds on every row: the same predicate as the literal field.
        const resolved = resolveBinding(expr[2], ctx);
        if (!resolved.ok) return resolved;
        if (resolved.value.kind !== 'value' || typeof resolved.value.value !== 'string') return shape('the row field name is not a string');
        const named = flatField(resolved.value.value);
        return named.ok ? good(named.value) : named;
      }
      const flat = flatField(expr[2]);
      return flat.ok ? good(flat.value) : flat;
    }
    return shape('object/get on the row is not a single flat field');
  }
  return good(null);
}

function resolveBinding(term: string, ctx: PredicateCompileContext): Outcome<RowBindingResult & { kind: 'value' | 'list' }> {
  if (!ctx.resolve) return shape(`binding ${term}`);
  const resolved = ctx.resolve(term);
  if (resolved.kind === 'value' || resolved.kind === 'list') return good(resolved);
  return fail(resolved.kind, resolved.detail);
}

function termOf(expr: SExpr, ctx: PredicateCompileContext): Outcome<Term> {
  const field = fieldOf(expr, ctx);
  if (!field.ok) return field;
  if (field.value !== null) return good({ kind: 'field', field: field.value });
  if (typeof expr === 'string' && expr.startsWith('@')) {
    const resolved = resolveBinding(expr, ctx);
    if (!resolved.ok) return resolved;
    return resolved.value.kind === 'value' ? good({ kind: 'value', value: resolved.value.value }) : shape('the value is not a scalar');
  }
  if (typeof expr === 'string' && expr.includes('@')) return shape('a string with an embedded binding');
  if (isScalar(expr)) return good({ kind: 'value', value: expr });
  if (Array.isArray(expr)) return shape(`operator ${typeof expr[0] === 'string' ? expr[0] : '[...]'} has no predicate form`);
  return shape('a value with no predicate form');
}

function listOf(expr: SExpr, ctx: PredicateCompileContext): Outcome<FieldValue[]> {
  let items: SExpr[];
  if (Array.isArray(expr)) items = expr;
  else if (typeof expr === 'string' && expr.startsWith('@')) {
    const resolved = resolveBinding(expr, ctx);
    if (!resolved.ok) return resolved;
    if (resolved.value.kind !== 'list') return shape('the list binding is not a list');
    return good(resolved.value.values);
  } else return shape('the list is not a list');
  const out: FieldValue[] = [];
  for (const item of items) {
    if (typeof item === 'string' && item.startsWith('@')) {
      const resolved = resolveBinding(item, ctx);
      if (!resolved.ok) return resolved;
      if (resolved.value.kind !== 'value') return shape('the value is not a scalar');
      out.push(resolved.value.value);
    } else if (typeof item === 'string' && item.includes('@')) return shape('a string with an embedded binding');
    else if (isScalar(item)) out.push(item);
    else return shape('the value is not a scalar');
  }
  return good(out);
}

const isRequired = (field: string, ctx: PredicateCompileContext): boolean => field === 'id' || ctx.requiredFields?.has(field) === true;

/** The fields among the direct conjuncts that an ordering compares with a number constant. */
function numericOrdered(args: SExpr[], ctx: PredicateCompileContext): Set<string> {
  const fields = new Set<string>();
  for (const arg of args) {
    if (!Array.isArray(arg) || arg.length !== 3 || typeof arg[0] !== 'string' || !ORDERING.has(arg[0])) continue;
    const left = termOf(arg[1], ctx);
    const right = termOf(arg[2], ctx);
    if (!left.ok || !right.ok) continue;
    if (left.value.kind === 'field' && right.value.kind === 'value' && typeof right.value.value === 'number') fields.add(left.value.field);
    if (right.value.kind === 'field' && left.value.kind === 'value' && typeof left.value.value === 'number') fields.add(right.value.field);
  }
  return fields;
}

/** The field a null comparison `(op f null)` names. */
function nullComparedField(expr: SExpr, op: string): string | null {
  if (!Array.isArray(expr) || expr.length !== 3 || expr[0] !== op) return null;
  const [left, right] = [expr[1], expr[2]];
  const other = right === null ? left : left === null ? right : undefined;
  if (other === undefined) return null;
  const field = fieldOf(other);
  return field.ok ? field.value : null;
}

/** The fields the direct conjuncts of one `and` show present. */
function presentFields(args: SExpr[], numeric: ReadonlySet<string>): Set<string> {
  const fields = new Set<string>();
  for (const arg of args) {
    const notNull = nullComparedField(arg, '!=') ?? (Array.isArray(arg) && arg[0] === 'not' && arg.length === 2 ? nullComparedField(arg[1], '=') : null);
    if (notNull !== null) fields.add(notNull);
    if (Array.isArray(arg) && arg[0] === 'validate/required' && arg.length === 2) {
      const field = fieldOf(arg[1]);
      if (field.ok && field.value !== null && numeric.has(field.value)) fields.add(field.value);
    }
  }
  return fields;
}

/** `array/includes` / `str/includes` fail on a missing operand in the evaluator: a failing leaf equals a false one only in a top-level `and` chain. */
function erroringLeaf(field: string, ctx: PredicateCompileContext, exact: boolean): Outcome<null> {
  return exact || isRequired(field, ctx) ? good(null) : fail('null-semantics', `${field} may be missing and the evaluator errors on a missing operand`);
}

function compareLeaf(field: string, op: '==' | '!=' | '<' | '<=' | '>' | '>=', value: FieldValue, ctx: PredicateCompileContext, scope: Scope): Outcome<RowPredicate> {
  if (op !== '==' && op !== '!=' && !isRequired(field, ctx) && !scope.guarded.has(field)) {
    return fail('null-semantics', `${op} on '${field}', which the entity does not declare required and no enclosing and guards`);
  }
  if (value === null && op === '==') return good({ kind: 'isNull', field, isNull: true });
  if (value === null && op === '!=') return good({ kind: 'isNull', field, isNull: false });
  return good({ kind: 'compare', field, op, value });
}

function compile(expr: SExpr, ctx: PredicateCompileContext, exact: boolean, scope: Scope): Outcome<RowPredicate> {
  if (typeof expr === 'boolean') return good({ kind: 'const', value: expr });
  if (!Array.isArray(expr)) return shape('not a predicate form');
  const head = typeof expr[0] === 'string' ? expr[0] : '';
  const args = expr.slice(1);
  switch (head) {
    case 'and':
    case 'or': {
      const of: RowPredicate[] = [];
      let inner = scope;
      if (head === 'and') {
        const numeric = new Set([...scope.numeric, ...numericOrdered(args, ctx)]);
        inner = { numeric, guarded: new Set([...scope.guarded, ...presentFields(args, numeric)]) };
      }
      // The evaluator stops at the first truthy operand of an or (falsy of an and), so an operand after a constant
      // that decides the chain is never evaluated and need not compile.
      const decides = head === 'or';
      for (const arg of args) {
        const child = compile(arg, ctx, exact && head === 'and', inner);
        if (!child.ok) return child;
        of.push(child.value);
        if (child.value.kind === 'const' && child.value.value === decides) return good({ kind: 'const', value: decides });
      }
      return good({ kind: head === 'and' ? 'all' : 'any', of });
    }
    case 'not': {
      if (args.length !== 1) return fail('inexpressible', 'operator not has no predicate form');
      const child = compile(args[0], ctx, false, scope);
      return child.ok ? good({ kind: 'not', of: child.value }) : child;
    }
    case 'validate/required': {
      // Equal to "not null" only where the field is ordered against a number in the same chain: a string or a list
      // is also "required" only when non-empty.
      if (args.length !== 1) return fail('inexpressible', 'operator validate/required has no predicate form');
      const field = fieldOf(args[0], ctx);
      if (!field.ok) return field;
      if (field.value === null || !scope.numeric.has(field.value)) return shape('validate/required is a null check only on a field ordered against a number');
      return good({ kind: 'isNull', field: field.value, isNull: false });
    }
    case 'array/includes': {
      if (args.length !== 2) return fail('inexpressible', 'operator array/includes has no predicate form');
      const needleField = fieldOf(args[1], ctx);
      if (!needleField.ok) return needleField;
      if (needleField.value !== null) {
        const guard = erroringLeaf(needleField.value, ctx, exact);
        if (!guard.ok) return guard;
        const values = listOf(args[0], ctx);
        return values.ok ? good({ kind: 'member', field: needleField.value, values: values.value }) : values;
      }
      const haystackField = fieldOf(args[0], ctx);
      if (!haystackField.ok) return haystackField;
      if (haystackField.value === null) return shape('array/includes names no row field');
      const guard = erroringLeaf(haystackField.value, ctx, exact);
      if (!guard.ok) return guard;
      const needle = termOf(args[1], ctx);
      if (!needle.ok) return needle;
      return needle.value.kind === 'value' ? good({ kind: 'hasElement', field: haystackField.value, value: needle.value.value }) : shape('two row fields');
    }
    case 'str/includes': {
      if (args.length !== 2) return fail('inexpressible', 'operator str/includes has no predicate form');
      const needle = termOf(args[1], ctx);
      if (!needle.ok) return needle;
      if (needle.value.kind !== 'value' || typeof needle.value.value !== 'string') return shape('str/includes needle is not a constant string');
      const text = needle.value.value;
      const haystack = fieldOf(args[0], ctx);
      if (!haystack.ok) return haystack;
      if (haystack.value !== null) {
        const guard = erroringLeaf(haystack.value, ctx, exact);
        if (!guard.ok) return guard;
        return good({ kind: 'contains', field: haystack.value, text, caseSensitive: true });
      }
      const lowered = args[0];
      if (Array.isArray(lowered) && lowered.length === 2 && lowered[0] === 'str/lower') {
        const loweredField = fieldOf(lowered[1], ctx);
        if (!loweredField.ok) return loweredField;
        if (loweredField.value !== null) {
          const guard = erroringLeaf(loweredField.value, ctx, exact);
          if (!guard.ok) return guard;
          if (text.toLowerCase() !== text) return shape('case-insensitive needle is not already lower case');
          return good({ kind: 'contains', field: loweredField.value, text, caseSensitive: false });
        }
      }
      return shape('str/includes haystack is not a row field');
    }
    default: {
      const op = COMPARE_OPS.get(head);
      if (op === undefined || args.length !== 2) return fail('inexpressible', `operator ${head} has no predicate form`);
      const left = termOf(args[0], ctx);
      if (!left.ok) return left;
      const right = termOf(args[1], ctx);
      if (!right.ok) return right;
      if (left.value.kind === 'field' && right.value.kind === 'value') return compareLeaf(left.value.field, op, right.value.value, ctx, scope);
      if (left.value.kind === 'value' && right.value.kind === 'field') return compareLeaf(right.value.field, FLIPPED[op], left.value.value, ctx, scope);
      if (left.value.kind === 'value' && right.value.kind === 'value' && (op === '==' || op === '!=') && sameScalarKind(left.value.value, right.value.value)) {
        return good({ kind: 'const', value: (left.value.value === right.value.value) === (op === '==') });
      }
      return shape('a comparison needs one row field and one constant');
    }
  }
}

export function compileRowPredicate(expr: SExpr, ctx: PredicateCompileContext): PredicateCompilation {
  const result = compile(expr, ctx, true, NO_SCOPE);
  if (result.ok) return { kind: 'predicate', predicate: result.value };
  if (result.failure.kind === 'unspecialised' && ctx.role === 'policy') return { kind: 'predicate', predicate: { kind: 'const', value: false } };
  return result.failure;
}

/** A fetch's `orderBy` (`"field"` or `"field:asc|desc"`): ascending unless `desc`. */
export function parseFetchOrder(orderBy: string | undefined): RowOrder | undefined {
  if (typeof orderBy !== 'string' || orderBy === '') return undefined;
  const [field, direction] = orderBy.split(':');
  const dir: RowOrder['direction'] = direction === 'desc' ? 'desc' : 'asc';
  return { field, direction: dir };
}
