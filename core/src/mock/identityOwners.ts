/**
 * Owner columns derived from a program's `[identity]` entity.
 *
 * The JS mirror of `orbital-core/src/runtime/seed.rs`
 * (`identity_entity_name` / `owner_fields_from_schema`). Both paths must agree:
 * a column is an owner column because the source *declared* it as a relation to
 * the `[identity]` entity (`patientId : Person`), never because its name looks
 * like one — a name-matching guess would silently scope the wrong column.
 *
 * @packageDocumentation
 */

import type { OrbitalEntity } from '../types/entity.js';
import type { EntityField } from '../types/field.js';
import type { OrbitalDefinition } from '../types/orbital.js';
import type { OrbitalSchema } from '../types/schema.js';
import type { SExpr } from '../types/expression.js';
import {
  entityAccessPolicies,
  orbitalInlineEntities,
  type EntityAccessPolicies,
} from '../access/entityAccess.js';

/** Inline entity definitions of every orbital in a schema: each orbital's
 * primary entity plus any auxiliaries. */
function inlineEntities(schema: OrbitalSchema): OrbitalEntity[] {
  return (schema.orbitals ?? []).flatMap(orbitalInlineEntities);
}

/**
 * Every `[identity]`-tagged entity, primaries first, paired with whether it is
 * an orbital's PRIMARY entity or an auxiliary copy an import brought along.
 *
 * Compiled-path twin: `identity_entities_tagged` in
 * `orbital-compiler/src/phases/validation/user_identity.rs` (L57-76).
 */
function identityEntitiesTaggedOf(
  orbitals: readonly OrbitalDefinition[],
): Array<{ def: OrbitalEntity; primary: boolean }> {
  const out: Array<{ def: OrbitalEntity; primary: boolean }> = [];
  for (const orbital of orbitals) {
    const ref = orbital.entity;
    if (typeof ref === 'object' && ref !== null && 'fields' in ref && (ref as OrbitalEntity).identity === true) {
      out.push({ def: ref as OrbitalEntity, primary: true });
    }
  }
  for (const orbital of orbitals) {
    for (const ref of orbital.auxiliaryEntities ?? []) {
      if (typeof ref === 'object' && ref !== null && 'fields' in ref && (ref as OrbitalEntity).identity === true) {
        out.push({ def: ref as OrbitalEntity, primary: false });
      }
    }
  }
  return out;
}

/**
 * The `[identity]` entities that decide what `@user` resolves to, primaries
 * first then auxiliaries.
 *
 * A behavior declares its own roster so it runs standalone. Composing it never
 * imports that orbital, but a trait bound to one of its siblings drags the
 * roster in as an auxiliary copy, tag and all — so a PRIMARY roster shadows
 * every imported copy: the composing app decides who `@user` is. With no
 * primary roster the copies still count, which is what lets a thin app that
 * wraps one behavior inherit that behavior's roster.
 *
 * Compiled-path twin: `identity_entities` in
 * `orbital-compiler/src/phases/validation/user_identity.rs` (L94-102).
 */
export function identityEntitiesOf(orbitals: readonly OrbitalDefinition[]): OrbitalEntity[] {
  const tagged = identityEntitiesTaggedOf(orbitals);
  const hasPrimary = tagged.some((e) => e.primary);
  return tagged.filter((e) => e.primary || !hasPrimary).map((e) => e.def);
}

/**
 * The name of the schema's `[identity]` entity, if it declares one.
 *
 * Compiled-path twin: `identity_entities` in
 * `orbital-compiler/src/phases/validation/user_identity.rs`.
 */
export function identityEntityName(schema: OrbitalSchema): string | undefined {
  return identityEntitiesOf(schema.orbitals ?? [])[0]?.name;
}

/**
 * Every `[identity]`-tagged name, shadowed copies included.
 *
 * Owner-column derivation asks whether a relation targets *a* roster, not *the*
 * one: `Timesheet.employeeId : Employee` is an owner column whether or not
 * `Employee` won the `@user` binding. Dropping the shadowed names here would
 * leave an imported behavior's rows unscoped at runtime while the compiled path
 * treats the very same column as an owner column.
 *
 * Compiled-path twin: `identity_entity_names` in
 * `orbital-compiler/src/phases/validation/user_identity.rs`.
 */
export function identityEntityNames(schema: OrbitalSchema): string[] {
  const out: string[] = [];
  for (const { def } of identityEntitiesTaggedOf(schema.orbitals ?? [])) {
    if (!out.includes(def.name)) out.push(def.name);
  }
  return out;
}

/**
 * The declared vocabulary for an identity field, following `items` for the
 * array/map form. `roles : ["a" | "b"]` keeps the union on the ELEMENT, so a
 * multi-valued role field is read through `items` — one level, not recursive.
 *
 * Compiled-path twin: `vocabulary` in
 * `orbital-compiler/src/phases/validation/user_identity.rs` (L125-134).
 */
export function roleVocabularyOf(
  entity: OrbitalEntity,
  field = 'role',
): readonly string[] | undefined {
  const def = entity.fields.find((f) => f.name === field);
  if (!def) return undefined;
  return fieldVocabulary(def);
}

function fieldVocabulary(field: EntityField): readonly string[] | undefined {
  if ('values' in field && field.values && field.values.length > 0) {
    return field.values;
  }
  if ('items' in field && field.items && 'values' in field.items && field.items.values && field.items.values.length > 0) {
    return field.items.values;
  }
  return undefined;
}

/**
 * The field name `x` reads off `binding` — either the dotted-path form
 * (`@entity.id`) or the lowered `.lolo` call form (`(object/get @entity id)`
 * → `["object/get", "@entity", "id"]`, the shape `std-time-tracking`'s
 * `Employee [identity]` actually compiles to; verified against
 * `packages/almadar-behaviors/behaviors/registry/app/organisms/
 * std-time-tracking.orb`). `undefined` when `x` reads a different binding, a
 * different shape entirely, or isn't a field read at all.
 */
function fieldRefName(x: SExpr, binding: string): string | undefined {
  if (typeof x === 'string' && x.startsWith(`${binding}.`)) return x.slice(binding.length + 1);
  if (Array.isArray(x) && x.length === 3 && x[0] === 'object/get' && x[1] === binding && typeof x[2] === 'string') {
    return x[2];
  }
  return undefined;
}

/** `true` when `x` reads field `field` off binding `binding` (either
 *  spelling — see {@link fieldRefName}). */
function isFieldRef(x: SExpr, binding: string, field: string): boolean {
  return fieldRefName(x, binding) === field;
}

/**
 * Equality operator spellings a direct-ownership comparison may use. `=` is
 * what `.lolo`-authored policies lower to; `==` stays shape-identical to the
 * Rust twin's generalized reader (`POLICY_EQ_OPS` in
 * `orbital-core/src/runtime/seed.rs`), which also accepts a codegen-derived
 * policy bridged through `OirBinaryOp::Eq`'s `==` spelling
 * (`access_policies.rs::owner_fields`).
 */
const OWNER_EQ_OPS: readonly string[] = ['=', '=='];

/**
 * Every column `expr` compares to `@user.id` via direct equality — the
 * general form of "self-identity": `@entity.<field> == @user.id` (either
 * operand order, either spelling — see `fieldRefName`) names `field` as an
 * owner column, whether `field` is the row's OWN `id` (distinct from a
 * relation column like `@entity.managerId == @user.id`) or any other
 * declared field (the shape `ORB_S_OWNER_FIELD_NOT_IDENTITY_TYPED` flags as
 * an authoring error when it is neither — codegen still needs to seed it).
 * Recurses through `and`/`or`/`not`/any other combinator —
 * `std-time-tracking`'s `Employee [identity]` declares
 * `@read (or (= @user.role "approver") (= (object/get @entity id) @user.id))`,
 * and the self-access arm counts even though it isn't the whole policy.
 * Rust twin: `owner_columns_from_policy` in `orbital-core/src/runtime/seed.rs`.
 */
export function ownerColumnsFromPolicy(expr: SExpr, out: string[] = []): string[] {
  if (Array.isArray(expr)) {
    if (expr.length === 3) {
      const [op, a, b] = expr;
      if (typeof op === 'string' && OWNER_EQ_OPS.includes(op)) {
        const field = isFieldRef(b, '@user', 'id')
          ? fieldRefName(a, '@entity')
          : isFieldRef(a, '@user', 'id')
            ? fieldRefName(b, '@entity')
            : undefined;
        if (field !== undefined && !out.includes(field)) out.push(field);
      }
    }
    for (const item of expr) ownerColumnsFromPolicy(item, out);
  }
  return out;
}

/** `true` when ANY of `policies`' four declared directives self-identifies
 *  the row — the `[identity]` entity's OWN `id` compared directly to
 *  `@user.id` (see {@link ownerColumnsFromPolicy}). */
function policiesSelfIdentify(policies: EntityAccessPolicies | undefined): boolean {
  if (policies === undefined) return false;
  return [policies.read, policies.create, policies.update, policies.delete].some(
    (expr) => expr !== undefined && ownerColumnsFromPolicy(expr).includes('id'),
  );
}

/**
 * Owner columns as `Entity.field` pairs — every NON-INTRINSIC relation field
 * pointing at an `[identity]`-tagged entity, shadowed imported rosters
 * included, PLUS `Entity.id` for an `[identity]` entity whose own declared
 * access policy compares its row directly to the viewer (self-identity), PLUS
 * any other column an entity's own declared `@read`/`@update`/`@delete`
 * compares to `@user.id` (see `ownerColumnsFromPolicy`). Empty when the
 * program declares no identity, which keeps every unmigrated app behaving
 * exactly as before.
 *
 * An `intrinsic: true` relation field is excluded even when it targets the
 * identity entity: intrinsic marks framework plumbing the owning trait
 * computes itself (`EntityField.intrinsic` doc, `types/field.ts`), never
 * domain ownership — a generic atom's self-relation (`ModalRecord.seedRow :
 * ModalRecord`, record-detail/modal edit-seed plumbing) gets its relation
 * target rewritten onto whatever entity the trait binds, so a self-identity
 * entity like `std-time-tracking`'s `Employee [identity]` ends up with an
 * `Employee.seedRow : Employee` self-relation that is structurally
 * indistinguishable from a real owner column by type/target alone. Stamping
 * it with the viewer id (as an owner column would be) creates a row that
 * references itself, which trips the entity's own `onDelete: restrict`.
 */
export function ownerFieldsFromSchema(schema: OrbitalSchema): string[] {
  const identities = identityEntityNames(schema);
  if (identities.length === 0) return [];

  const out: string[] = [];
  const defs = inlineEntities(schema);
  const declaredByCollection = new Map<string, string[]>();
  for (const def of defs) {
    for (const field of def.fields ?? []) {
      // Cardinality-one only: an owner column holds ONE viewer id. A
      // `[Person]` array is a participant list, not ownership. Intrinsic
      // fields are framework plumbing the owning trait computes itself
      // (e.g. a record-detail/modal's `seedRow` edit-seed relation) — never
      // domain ownership, even when the field happens to relate to the
      // identity entity because a generic atom's self-relation was rewritten
      // onto the concrete bound entity (`ModalRecord.seedRow : ModalRecord`
      // → `Employee.seedRow : Employee` once bound). Rust twin:
      // `owner_fields_from_schema` in `orbital-core/src/runtime/seed.rs`.
      if (
        field.name &&
        field.type === 'relation' &&
        !field.intrinsic &&
        identities.includes(field.relation.entity)
      ) {
        out.push(`${def.name}.${field.name}`);
        if (def.collection) {
          const cols = declaredByCollection.get(def.collection) ?? [];
          if (!cols.includes(field.name)) cols.push(field.name);
          declaredByCollection.set(def.collection, cols);
        }
      }
    }
  }

  // Self-identity: the `[identity]` entity's OWN `id` is the owner column
  // when its declared access policy compares it directly to `@user.id`.
  for (const name of identities) {
    if (policiesSelfIdentify(entityAccessPolicies(schema, name))) {
      const key = `${name}.id`;
      if (!out.includes(key)) out.push(key);
    }
  }

  // Policy-derived: a column an entity's OWN `@read`/`@update`/`@delete`
  // compares to `@user.id` is an owner column whether or not it is a
  // relation-to-identity FIELD — the codegen twin
  // (`access_policies.rs::owner_fields`, same reader) already finds this
  // shape (a policy naming a non-relation field), which the type-only scan
  // above cannot. `@create` is excluded — it compares the row being
  // written, which says nothing about what a fixture should already own.
  // Deduped against the type-derived set above (a relation field whose
  // policy also names it, e.g. `managerId`, is not double-counted). Rust
  // twin: `owner_fields_from_schema`'s policy-derived arm in
  // `orbital-core/src/runtime/seed.rs`.
  for (const def of defs) {
    const policies = entityAccessPolicies(schema, def.name);
    if (policies === undefined) continue;
    for (const policy of [policies.read, policies.update, policies.delete]) {
      if (policy === undefined) continue;
      for (const field of ownerColumnsFromPolicy(policy)) {
        const key = `${def.name}.${field}`;
        if (!out.includes(key)) out.push(key);
      }
    }
  }

  // Collection mirror of `entityAccessTable`'s policy inheritance: an entity
  // sharing a collection with a declaring sibling is scoped by that sibling's
  // @read policy, so its same-named column IS the owner column the policy
  // compares — an imported atom's entity structurally cannot declare the
  // relation itself (it does not know the app's identity entity). Still
  // declaration-grounded, never name-guessing across collections.
  for (const def of defs) {
    const cols = def.collection ? declaredByCollection.get(def.collection) : undefined;
    if (!cols) continue;
    for (const col of cols) {
      const key = `${def.name}.${col}`;
      if (out.includes(key)) continue;
      if ((def.fields ?? []).some((f) => f.name === col)) out.push(key);
    }
  }
  return out;
}

/**
 * Equality operators an access-policy comparison may use. Compiled-path twin:
 * `EQUALITY_OPS` in `orbital-compiler/src/phases/validation/user_identity.rs`
 * — shared there with the orbital-import role-literal rewrite
 * (`inline/rewrite.rs` `rewrite_role_literals`), so this JS list and
 * {@link collectUserFieldLiterals} must stay shape-identical to that Rust
 * pair too.
 */
const EQUALITY_OPS: readonly string[] = ['=', '==', '!=', '!==', 'eq', 'neq'];

/** `true` when `x` is a direct `@user.<field>` sigil read (either spelling —
 *  see {@link fieldRefName}), regardless of WHICH field. Used to locate the
 *  sigil operand of an `array/includes` node BY CONTENT rather than
 *  position — see {@link collectUserFieldLiterals}'s doc. */
function isUserFieldSigil(x: SExpr): boolean {
  return typeof x === 'string' && fieldRefName(x, '@user') !== undefined;
}

/**
 * Is an `array/includes` haystack array a LITERAL role list, and if so,
 * which elements are the members? Twin of Rust
 * `validation::user_identity::literal_haystack_members` (`user_identity.rs`)
 * — the two must stay shape-identical: either a `["list", …]`
 * array-construction call (Rust `mark_literal_list_in_place`'s wrap for a
 * config-array-override value that would otherwise collide with operator
 * dispatch; both `.lolo` spellings `(a b)`/`[a, b]` lower through it) whose
 * TAIL is all-string, or a bare array whose every element (including
 * position 0) is a string literal. Any other shape — a nested call like
 * `["object/get", ["array/nth", …], "allowedRoles"]`, std-step-flow's
 * per-step dynamic role guard — is not a literal haystack: `undefined`.
 */
function literalHaystackMembers(items: readonly SExpr[]): string[] | undefined {
  const isListCall = items[0] === 'list';
  const members = isListCall ? items.slice(1) : items;
  return members.every((v): v is string => typeof v === 'string') ? [...members] : undefined;
}

/**
 * Every literal an expression compares against `@user.<field>` (any field),
 * keyed by field name — the collecting counterpart of `orbital-compiler`'s
 * `validation::user_identity::check_comparison` (B4-R4; the two must stay
 * shape-identical, each cites the other): an equality node (`EQUALITY_OPS`)
 * or an `array/includes` node, walked transparently through `and`/`or`/`not`
 * and any other combinator (the Rust check runs on EVERY array node
 * regardless of what wraps it, so this does too).
 *
 * `array/includes` is directional, but the sigil can sit on EITHER side:
 * `(array/includes @user.roles "ghost")` checks a literal against a
 * multi-valued field's own vocabulary (field is the haystack, position 0);
 * the Stage-B orbital-import role rewrite (Rust `inline/rewrite.rs`
 * `rewrite_role_literals`, which `check_comparison` mirrors) instead
 * produces `(array/includes ["owner","project_manager"] @user.role)` — a
 * literal ARRAY haystack with the sigil as the needle, position 1 (found
 * live: Project Friday's imported `Timesheet.@delete` after `roles {
 * approver: [owner, project_manager] }`). So the sigil is located BY
 * CONTENT, never position: check position 0 first, fall back to position 1.
 * The OTHER side is then flattened to a literal list — a scalar (equality,
 * or an `array/includes` whose haystack is the sigil's own multi-valued
 * field) or, for the role-rewrite shape, every string element of a literal
 * array.
 *
 * A collected literal is a CANDIDATE a viewer might satisfy the expression
 * with, never a proof: a policy that ANDs the field check with an unrelated
 * condition can still reject a viewer carrying it. Callers that need
 * certainty re-check with the real evaluator (`checkMutationAccess` /
 * `evaluate`), the way any other synthesized dispatch is confirmed.
 */
export function collectUserFieldLiterals(
  expr: SExpr,
  out: Map<string, Set<string>> = new Map(),
): Map<string, Set<string>> {
  if (Array.isArray(expr)) {
    const [op, ...args] = expr;
    if (typeof op === 'string' && args.length >= 2 && (EQUALITY_OPS.includes(op) || op === 'array/includes')) {
      const isIncludes = op === 'array/includes';
      let sigilSide: SExpr[];
      let literalSide: SExpr[];
      if (isIncludes) {
        if (isUserFieldSigil(args[0])) {
          sigilSide = args.slice(0, 1);
          literalSide = args.slice(1, 2);
        } else {
          sigilSide = args.slice(1, 2);
          literalSide = args.slice(0, 1);
        }
      } else {
        sigilSide = args;
        literalSide = args;
      }
      const field = sigilSide.map((arg) => fieldRefName(arg, '@user')).find((f): f is string => f !== undefined);
      if (field !== undefined) {
        const literalArrayHaystack = literalSide[0];
        const literals: SExpr[] =
          isIncludes && Array.isArray(literalArrayHaystack)
            ? (literalHaystackMembers(literalArrayHaystack) ?? [])
            : literalSide;
        for (const literal of literals) {
          if (typeof literal === 'string' && !literal.startsWith('@')) {
            const set = out.get(field) ?? new Set<string>();
            set.add(literal);
            out.set(field, set);
          }
        }
      }
    }
    for (const item of expr) collectUserFieldLiterals(item, out);
    return out;
  }
  if (expr !== null && typeof expr === 'object') {
    for (const value of Object.values(expr)) collectUserFieldLiterals(value, out);
  }
  return out;
}

/**
 * A `@user.<field>` value that satisfies `policy`, chosen from the identity
 * entity's own declared vocabulary — never a guess: only a literal BOTH
 * (a) compared against `field` in an equality/`array/includes` node
 * somewhere in `policy` (see {@link collectUserFieldLiterals}) AND (b) a
 * declared member of `identity`'s `field` vocabulary (see
 * {@link roleVocabularyOf}) is a candidate. The pick is deterministic — the
 * first vocabulary value, in declaration order, that is also a candidate —
 * so two callers asking about the same policy always agree.
 *
 * `undefined` when `policy` is absent/`null` (no restriction — nothing to
 * satisfy), `field` carries no declared vocabulary on `identity`, or no
 * declared value appears anywhere in the policy. The last case is a genuine
 * finding for the CALLER to report, not a probe defect to paper over: the
 * policy structurally cannot be satisfied by any roster member, so forcing a
 * viewer past it would misreport an unreachable transition as reachable.
 */
export function roleSatisfyingPolicy(
  policy: SExpr | undefined,
  identity: OrbitalEntity,
  field = 'role',
): string | undefined {
  if (policy === undefined || policy === null) return undefined;
  const vocab = roleVocabularyOf(identity, field);
  if (vocab === undefined) return undefined;
  const accepted = collectUserFieldLiterals(policy).get(field);
  if (accepted === undefined) return undefined;
  return vocab.find((value) => accepted.has(value));
}
