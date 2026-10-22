/**
 * Baked S-expression field-comparison literal walk — one owner for the
 * consumers that must agree with the compiled path's
 * `ORB_S_ROLE_LITERAL_NOT_MEMBER` check (`user_identity.rs`) and
 * `ORB_S_OWNER_FIELD_NOT_IDENTITY_TYPED` check (`entity_access.rs`): rabit's
 * param-fill enum-delta guard (FIX-J) and the compose-time identity dedupe
 * passes (`compose-app.ts`, FIX-K/FIX-N).
 */

/** Equality ops whose operands the role-literal validator compares (mirrors `user_identity.rs`). */
const EQUALITY_OPS: ReadonlySet<string> = new Set(['=', '==', '!=', '!==', 'eq', 'neq']);

export interface FieldBindingContext {
  entityName: string;
  isIdentity: boolean;
  /** Primary entity of the orbital being walked (`@entity` resolves to it). */
  scopeEntityName: string | null;
  field: string;
}

/** True when `node` is a binding to `<entity>.<field>` in one of the baked S-expr forms. */
function isFieldBinding(node: unknown, ctx: FieldBindingContext): boolean {
  if (typeof node === 'string') {
    if (ctx.isIdentity && node === `@user.${ctx.field}`) return true;
    if (node === `@${ctx.entityName}.${ctx.field}`) return true;
    return ctx.scopeEntityName === ctx.entityName && node === `@entity.${ctx.field}`;
  }
  if (Array.isArray(node) && node[0] === 'object/get' && node.length === 3) {
    if (ctx.isIdentity && node[1] === '@user' && node[2] === ctx.field) return true;
    if (node[1] === `@${ctx.entityName}` && node[2] === ctx.field) return true;
    return ctx.scopeEntityName === ctx.entityName && node[1] === '@entity' && node[2] === ctx.field;
  }
  return false;
}

/**
 * Every string literal compared against `<entity>.<field>` inside `node` —
 * equality ops (`=` `==` `!=` `!==` `eq` `neq`) over either operand, plus
 * `array/includes` with the field binding as the haystack.
 */
export function collectFieldComparisonLiterals(node: unknown, ctx: FieldBindingContext, out: Set<string>): void {
  if (Array.isArray(node)) {
    const op = node[0];
    if (typeof op === 'string' && EQUALITY_OPS.has(op)) {
      const args = node.slice(1);
      if (args.some((arg) => isFieldBinding(arg, ctx))) {
        for (const arg of args) {
          if (typeof arg === 'string' && !arg.startsWith('@') && !isFieldBinding(arg, ctx)) out.add(arg);
        }
      }
    } else if (op === 'array/includes') {
      if (isFieldBinding(node[1], ctx)) {
        const needle = node[2];
        if (typeof needle === 'string' && !needle.startsWith('@')) out.add(needle);
      }
    }
    for (const item of node) collectFieldComparisonLiterals(item, ctx, out);
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node)) collectFieldComparisonLiterals(value, ctx, out);
  }
}

/** `@entity.<field>` in the bare dotted form (mirrors `entity_access.rs`'s `entity_field_of`). */
function entityFieldOf(s: string): string | null {
  if (!s.startsWith('@entity.')) return null;
  const rest = s.slice('@entity.'.length);
  return rest.length === 0 || rest.includes('.') || rest.includes('[') ? null : rest;
}

/** The viewer's identity key in either baked form: `@user.id` or `["object/get", "@user", "id"]`. */
function isUserIdToken(node: unknown): boolean {
  if (node === '@user.id') return true;
  return (
    Array.isArray(node) &&
    node[0] === 'object/get' &&
    node[1] === '@user' &&
    node[2] === 'id'
  );
}

/** A candidate-row field read in either baked form: `@entity.<F>` or `["object/get", "@entity", F]`. */
function entityFieldBinding(node: unknown): string | null {
  if (typeof node === 'string') return entityFieldOf(node);
  if (Array.isArray(node) && node[0] === 'object/get' && node[1] === '@entity' && typeof node[2] === 'string') {
    return node[2];
  }
  return null;
}

/**
 * Every field read off the candidate row in the owner-comparison form the
 * compiled path's `ORB_S_OWNER_FIELD_NOT_IDENTITY_TYPED` check enforces: a
 * `=`/`==` comparison with `@user.id` on one side and `@entity.<F>` on the
 * other, at any nesting depth (`or`/`and` clauses included). `id` itself is
 * excluded — an identity entity comparing its own key to the viewer is the
 * self-read shape, not an owner column.
 */
export function collectOwnerComparedFields(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    const op = node[0];
    if (op === '=' || op === '==') {
      const args = node.slice(1);
      if (args.some(isUserIdToken)) {
        for (const arg of args) {
          const field = entityFieldBinding(arg);
          if (field !== null && field !== 'id') out.add(field);
        }
      }
    }
    for (const item of node) collectOwnerComparedFields(item, out);
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node)) collectOwnerComparedFields(value, out);
  }
}

/**
 * The create/update-effect twin of the owner form: a `persist` payload entry
 * `"F": "@user.id"` stamping the viewer's identity key onto field `F` of the
 * named entity. Returns entity name → stamped field names. A trailing payload
 * object carrying `emit` is the resolver's options bag, not data (same
 * convention as `effect/persist.rs`).
 */
export function collectOwnerStampedFields(node: unknown, out: Map<string, Set<string>>): void {
  if (Array.isArray(node)) {
    if (
      node[0] === 'persist' &&
      (node[1] === 'create' || node[1] === 'upsert' || node[1] === 'update') &&
      typeof node[2] === 'string'
    ) {
      const payload = node[3];
      const isOptionsBag = node.length === 4 && payload !== null && typeof payload === 'object' && !Array.isArray(payload) && 'emit' in payload;
      if (payload !== null && typeof payload === 'object' && !Array.isArray(payload) && !isOptionsBag) {
        for (const [key, value] of Object.entries(payload)) {
          if (!isUserIdToken(value)) continue;
          const set = out.get(node[2]) ?? new Set<string>();
          set.add(key);
          out.set(node[2], set);
        }
      }
    }
    for (const item of node) collectOwnerStampedFields(item, out);
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node)) collectOwnerStampedFields(value, out);
  }
}
