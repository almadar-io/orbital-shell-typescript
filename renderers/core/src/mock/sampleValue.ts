/**
 * The one owner of mock-seed value synthesis.
 *
 * Five synthesizers used to hold four different policies on a field's declared
 * `default`, so the same entity seeded differently depending on which path
 * rendered it. This module is the single policy; callers supply only entropy.
 *
 * @packageDocumentation
 */

import type {
  ArrayEntityField,
  EntityField,
  ObjectEntityField,
  RelationEntityField,
  UnionEntityField,
} from '../types/field.js';
import type { EntityPersistence, EntityRow, FieldValue } from '../types/entity.js';
import type { FieldProjection } from '../types/projection.js';
import { isFieldValue } from '../types/entity.js';
import { isTypeVariableField } from '../types/field.js';
import {
  randomBoolean,
  randomEmail,
  randomInt,
  randomPhone,
  randomStraddlingDate,
  randomUrl,
  randomUuid,
  randomWords,
} from './random.js';

/**
 * Entropy source. `'seeded'` draws from the shared LCG — stateful and
 * order-dependent, so a value depends on how many draws earlier rows consumed.
 * `'index'` is a pure function of `(field, index)`, which is the only strategy
 * Rust can reproduce and therefore the one parity is asserted on.
 */
export type SampleStrategy = 'seeded' | 'index';

/** Recursion cap for self-referential `items` / `properties` walks. */
const MAX_NESTED_DEPTH = 3;

/** Framework-stamped columns — the row's id and audit timestamps, minted by
 *  the store itself, never synthesized here and never a REQUIRED column a
 *  caller must supply (`EffectExecutor`'s persist-create check, `@almadar/
 *  runtime`'s mock store stamping). The one owner; every caller imports this
 *  instead of repeating the name list. */
export const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set(['id', 'createdAt', 'updatedAt']);

export interface SampleEntity {
  readonly name: string;
  readonly persistence?: EntityPersistence;
  /** `[identity]`: the rows are the persona roster, so every field is filled. */
  readonly identity?: boolean;
  readonly fields: readonly EntityField[];
}

export interface SampleContext {
  readonly entityName: string;
  /** 1-based row ordinal. Row 1 always yields `values[0]`. */
  readonly index: number;
  readonly strategy: SampleStrategy;
  /** Declared persistence of the OWNING entity; undefined means persistent. */
  readonly persistence?: EntityPersistence;
  /** The owning entity is `[identity]`: its rows are personas, never left partly unset. */
  readonly identity?: boolean;
  readonly depth?: number;
}

/**
 * Image-bearing field names that still resolve to a real photo.
 *
 * A stopgap, kept verbatim from the two copies it replaces: no entity field in
 * the corpus can express an image type yet, and 470 string fields are named
 * this way, so deleting it would render broken `<img>` corpus-wide. Retire it
 * once a real `image` type exists — not before.
 */
export const IMAGE_FIELD_NAMES: ReadonlySet<string> = new Set([
  'image', 'imageurl', 'image_url',
  'photo', 'photourl', 'photo_url',
  'avatar', 'avatarurl', 'avatar_url',
  'thumbnail', 'thumbnailurl', 'thumbnail_url',
  'picture', 'pictureurl',
  'cover', 'coverurl',
  'banner', 'bannerurl',
]);

/** Deterministic stock-photo URL; the same entity+field renders the same image. */
export function sampleImageUrl(
  entityName: string,
  fieldName: string,
  ctx: SampleContext,
  width = 400,
  height = 400,
): string {
  const salt = ctx.strategy === 'seeded' ? randomInt({ min: 0, max: 1000 }) : ctx.index;
  const seed = `${entityName}-${fieldName}-${salt}`;
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${width}/${height}`;
}

/** `targetType` / `target_type` -> `Target Type`, for readable sample text. */
function titleCase(name: string): string {
  const spaced = name
    .split('')
    .flatMap((c) => (c === '_' || c === '-' ? [' '] : c === c.toUpperCase() && c !== c.toLowerCase() ? [' ', c] : [c]))
    .join('');
  return spaced
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Lowercase, punctuation-free fragment safe to embed in an email or URL. */
function slug(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'value';
}

/** A deterministic, validator-satisfying UUID for the pure-index strategy. */
function indexUuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0').slice(-12)}`;
}

/**
 * The closed VOCABULARY a field declares, if any — literal strings the field
 * legally holds. Deliberately EXCLUDES `type: 'union'`: its `values` carries
 * variant NAMES (a tagged struct union) or a single by-name recursive
 * back-reference (`type MenuItem = { subMenu : [MenuItem] }`), never legal
 * literal values — reading either as an enum vocabulary would sample the
 * variant/alias NAME itself as the field's value (mirrors the same skip on
 * the Rust side, `orbital-core/src/type_compat.rs`'s `enum_value_is_member`
 * callers and `runtime/seed.rs`'s dedicated `FieldType::Union` arm).
 */
function declaredValues(field: EntityField): readonly string[] | undefined {
  if (field.type === 'union') return undefined;
  const values = 'values' in field ? field.values : undefined;
  return values && values.length > 0 ? values : undefined;
}

/**
 * Is `field.default` a value the synthesizer must return verbatim?
 *
 * Exported so codegen and tests share the one predicate rather than restating it.
 *
 * `isRuntime` defaults to `false` (the persistent/multi-row behavior) —
 * a `[runtime]` singleton's seeded row must equal its declared-defaults
 * projection outright (gate 1: persistence must agree with the default
 * layer in the `@entity` merge, or the machine boots into the wrong
 * state), so ANY declared default is honored there, unconditionally.
 * For a persistent, multi-row entity a number/boolean default is a
 * NEW-RECORD default, not a claim about every existing row — same
 * reasoning already applied below to a string default on a closed
 * vocabulary (the row cycle wins over it). Honoring it verbatim made
 * every mock-seeded counter/amount field (`hours = 0`, `debit = 0`, a
 * runtime-only concern accidentally applied to every row of a real
 * collection) read as literally, uniformly zero across the whole
 * collection — confirmed 2026-09-17 across `LedgerEntry.debit/credit`,
 * `ExecTimeEntry.hours/costRate`, `ExecCost.amount`.
 */
export function isDeclaredDefaultHonored(field: EntityField, isRuntime = false): boolean {
  const value = field.default;
  if (value === undefined || value === null) return false;
  if (isRuntime) return true;
  if (typeof value === 'number' || typeof value === 'boolean') return false;
  if (Array.isArray(value)) return true;
  if (typeof value === 'object') return true;
  if (typeof value !== 'string') return false;

  const values = declaredValues(field);
  // Gate 3: '' is a placeholder unless the field's own vocabulary declares it.
  if (value === '') return values !== undefined && values.includes('');
  // A default on a closed vocabulary of a collection is a new-record default,
  // not a claim about existing rows — so the row cycle wins over it.
  return values === undefined;
}

/** Rows to synthesize. A `[runtime]` entity is a per-orbital singleton. */
export function sampleRowCount(entity: SampleEntity, requested: number): number {
  return entity.persistence === 'runtime' ? 1 : requested;
}

/**
 * Value for a declared `@mock "..."` field — the declared string used
 * LITERALLY, never interpreted through any domain-name lookup. Comma-
 * separated is an explicit candidate list the author supplies real values
 * for, rotated by row index (`@mock "Acme Corp, Globex Inc, Wayne
 * Enterprises"` -> row 1 gets "Acme Corp", row 2 "Globex Inc", ...). No
 * comma is a single literal value, index-suffixed so rows aren't
 * byte-identical (`@mock "person-name"` -> "person-name-1",
 * "person-name-2", ...). Mirrors `seed.rs`'s Rust twin exactly — same
 * split/rotate/suffix rule, no per-domain code on either side.
 */
/** A declared `@mock`'s comma-separated candidates, trimmed, empties dropped. Twin: `mock_candidates` in seed.rs. */
export function mockCandidates(declared: string): string[] {
  return declared
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function mockFieldValue(declared: string, index: number): string {
  const candidates = mockCandidates(declared);
  if (candidates.length > 1) {
    return candidates[(index - 1) % candidates.length]!;
  }
  return `${declared.trim()}-${index}`;
}

/**
 * A declared `@mock` value in its field's own type: numeric fields seed
 * numbers and boolean fields seed booleans, so aggregates over seeded rows
 * are real. A literal that doesn't parse stays the declared string. Mirrors
 * `seed.rs`'s `typed_mock_value`.
 */
export function typedMockValue(field: EntityField, literal: string): string | number | boolean {
  if (field.type === 'number' || field.type === 'money') {
    const n = Number(literal);
    return literal.trim() !== '' && Number.isFinite(n) ? n : literal;
  }
  if (field.type === 'boolean') {
    if (literal === 'true') return true;
    if (literal === 'false') return false;
  }
  return literal;
}

function sampleText(field: EntityField, ctx: SampleContext): string {
  const fieldName = field.name ?? 'field';
  if (IMAGE_FIELD_NAMES.has(fieldName.toLowerCase())) {
    return sampleImageUrl(ctx.entityName, fieldName, ctx);
  }
  // Seeded strings are display text (titles, names, labels) — title-case
  // them so a seeded record reads "Harbor Summit", not "harbor summit".
  return ctx.strategy === 'seeded'
    ? titleCase(randomWords(2))
    : `${titleCase(fieldName)} ${ctx.index}`;
}

/** The fixed "now" index-strategy rows resolve relative `@mock` dates against. Twin: `RELATIVE_MOCK_INDEX_ANCHOR_MS` in seed.rs. */
export const RELATIVE_MOCK_INDEX_ANCHOR = '2026-06-15T00:00:00.000Z';

const RELATIVE_MOCK_UNIT_MS: Readonly<Record<string, number>> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/**
 * A date field's `@mock` candidate: a signed offset (`-2h`, `-1d`, `+3w`; units m h d w) is that
 * far from now (seeded) or from the fixed anchor (index); anything else is used as written.
 * Twin: `mock_date_value` in seed.rs.
 */
export function mockDateValue(dateOnly: boolean, literal: string, strategy: SampleStrategy): string {
  const m = /^([+-])(\d+)([mhdw])$/.exec(literal.trim());
  if (m === null) return literal;
  const anchor = strategy === 'index' ? Date.parse(RELATIVE_MOCK_INDEX_ANCHOR) : Date.now();
  const offset = (m[1] === '-' ? -1 : 1) * Number(m[2]) * RELATIVE_MOCK_UNIT_MS[m[3]!]!;
  const iso = new Date(anchor + offset).toISOString();
  return dateOnly ? iso.split('T')[0]! : iso;
}

/**
 * Seeded dates fall within this many days either side of today: wide enough that a monthly
 * chart over mock rows has several months, while upcoming views still get future dates.
 * Twin: `SEEDED_DATE_WINDOW_DAYS` in orbital-core `runtime/seed.rs`.
 */
export const SEEDED_DATE_WINDOW_DAYS = 120;

function sampleDate(ctx: SampleContext, dateOnly: boolean): string {
  if (ctx.strategy === 'index') {
    const month = String((ctx.index % 12) + 1).padStart(2, '0');
    return dateOnly ? `2026-${month}-15` : `2026-${month}-15T00:00:00.000Z`;
  }
  const iso = randomStraddlingDate({ days: SEEDED_DATE_WINDOW_DAYS }).toISOString();
  return dateOnly ? iso.split('T')[0]! : iso;
}

function sampleRelation(field: RelationEntityField): FieldValue {
  // Placeholder; the caller's post-pass links real sibling ids.
  return field.relation?.cardinality === 'one' ? '' : [];
}

function sampleArray(field: ArrayEntityField, ctx: SampleContext): FieldValue {
  const depth = ctx.depth ?? 0;
  if (!field.items || depth >= MAX_NESTED_DEPTH) return [];
  const count = ctx.strategy === 'seeded' ? randomInt({ min: 3, max: 5 }) : 3;
  const elementName = field.name ?? 'item';
  const out: FieldValue[] = [];
  for (let i = 0; i < count; i++) {
    const element: EntityField = { ...field.items, name: `${elementName}[${i}]` };
    out.push(
      sampleFieldValue(element, {
        ...ctx,
        index: ctx.index * 10 + i,
        depth: depth + 1,
      }) ?? null,
    );
  }
  return out;
}

function sampleObject(field: ObjectEntityField, ctx: SampleContext): FieldValue {
  const depth = ctx.depth ?? 0;
  if (!field.properties || depth >= MAX_NESTED_DEPTH) return null;
  const out: Record<string, FieldValue> = {};
  // Sorted, so the seeded draws do not depend on declaration order (Rust holds properties in a map).
  const entries = Object.entries(field.properties).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [propName, propField] of entries) {
    const child: EntityField = { ...propField, name: propName };
    out[propName] = sampleFieldValue(child, { ...ctx, depth: depth + 1 }) ?? null;
  }
  return out;
}

/**
 * Seed the FIRST declared variant of a tagged union — picking by declaration
 * order is deterministic and any other choice would be arbitrary (mirrors
 * `orbital-core/src/runtime/seed.rs`'s `FieldType::Union` arm byte-for-byte).
 * A by-name recursive back-reference (`values` non-empty, `properties`
 * absent) has nothing to sample — `undefined` omits the key, same as an
 * array/object hitting the depth cap.
 */
function sampleUnion(field: UnionEntityField, ctx: SampleContext): FieldValue | undefined {
  const depth = ctx.depth ?? 0;
  if (!field.properties || field.values.length === 0 || depth >= MAX_NESTED_DEPTH) {
    return undefined;
  }
  const firstVariant = field.properties[field.values[0]!];
  if (!firstVariant) return undefined;
  const child: EntityField = { ...firstVariant, name: field.name };
  return sampleFieldValue(child, { ...ctx, depth: depth + 1 });
}

/**
 * Does row `ctx.index` leave undefaulted OPTIONAL fields unset?
 *
 * `seeded` only — the `index` strategy also backs the verifier's synthesized
 * PAYLOADS, which must stay complete regardless. Deterministic on the row
 * index, never on randomness: every EVEN row (2, 4, 6…) omits them, every ODD
 * row (starting at row 1) fills them in as before. Never on an `[identity]` entity, whose
 * rows are the persona roster. Row fields only (depth 0): an
 * array element or object property is part of a value, never an unset field. A row-count-1 entity (a
 * `[runtime]` singleton, or any collection seeded with exactly one row)
 * always lands on row 1 and is therefore never affected — singleton state
 * stays fully populated with no separate carve-out needed.
 */
/**
 * Where a field's value (each element's, for an array) is projected from: `.lolo` `T.f`.
 * Twin of `seed.rs` `projection_of`.
 */
export function projectionOf(field: EntityField): FieldProjection | undefined {
  if (field.projectedFrom !== undefined) return field.projectedFrom;
  return field.type === 'array' ? field.items?.projectedFrom : undefined;
}

function omitsUndefaultedOptionalFields(ctx: SampleContext): boolean {
  return ctx.strategy === 'seeded' && !ctx.identity && (ctx.depth ?? 0) === 0 && ctx.index % 2 === 0;
}

/**
 * One sample value for one field. `undefined` means OMIT the key.
 *
 * Order matters — see the four gates in the plan. Gates 1, 2 and 3 read
 * declared schema properties (`persistence`, `intrinsic`, `required`,
 * `default`, `type`), never field names.
 */
export function sampleFieldValue(field: EntityField, ctx: SampleContext): FieldValue | undefined {
  const honoredDefault =
    field.default !== undefined && isFieldValue(field.default) ? field.default : undefined;

  // Gate 2: the owning trait computes this, so the data layer must not write it.
  if (field.intrinsic === true) return honoredDefault;

  // Gate 1: a runtime singleton's seeded row must equal its declared-defaults
  // projection, or persistence disagrees with the default layer in the @entity
  // merge and boots the machine into the wrong state. A persistent (multi-row)
  // entity's number/boolean default is a new-record default, not a claim
  // about every existing row — see `isDeclaredDefaultHonored`'s own doc.
  const isRuntime = ctx.persistence === 'runtime';
  if (isDeclaredDefaultHonored(field, isRuntime) && honoredDefault !== undefined) {
    return honoredDefault;
  }

  // Gate 3: an undefaulted OPTIONAL field (no `required`, no declared
  // `default` at all — honored or not, the two gates above already routed a
  // defaulted field past here) is left UNSET on every other seeded row. Every
  // mock-seeded row previously carried every field, so an affordance gated on
  // "this field is not yet set" (e.g. a survey button disabled until
  // `csatScore` is absent) could never be exercised by any runtime walk, on
  // any organism. Relation fields are excluded — they always seed a
  // placeholder (`''` / `[]`) for the caller's relation-linking post-pass,
  // never a domain-data absence. Enum/vocabulary fields are NOT excluded —
  // they follow the same rule as any other optional field.
  if (
    !field.required &&
    field.default === undefined &&
    field.type !== 'relation' &&
    projectionOf(field) === undefined &&
    omitsUndefaultedOptionalFields(ctx)
  ) {
    return undefined;
  }

  // A declared `@mock "..."` wins over the type-based dispatch below and is
  // used LITERALLY — never mapped through a domain-name lookup table (that
  // would be this generator deciding what "person-name" means, exactly the
  // guess `.lolo`'s type system doesn't get to make). Comma-separated is an
  // explicit candidate list the AUTHOR supplies real values for, rotated by
  // row index. No comma is a single literal value, index-suffixed so rows
  // aren't byte-identical. No `@mock` at all falls straight through to the
  // ordinary type-based synthesis below, unchanged. Mirrors `seed.rs`'s
  // Rust twin exactly.
  if (field.mock !== undefined) {
    const ordinal = isRuntime ? 1 : ctx.index;
    // An enum's candidates are its members, used as is: an index suffix would seed a non-member.
    const members = declaredValues(field) ? mockCandidates(field.mock) : [];
    if (members.length > 0) return members[(ordinal - 1) % members.length]!;
    // A behavior field's candidates are behavior specifiers, used verbatim as behavior values.
    if (field.type === 'behavior') {
      const candidates = mockCandidates(field.mock);
      const behavior = candidates[(ordinal - 1) % candidates.length];
      return behavior === undefined ? null : { behavior };
    }
    if (field.type === 'date' || field.type === 'datetime' || field.type === 'timestamp') {
      const candidates = mockCandidates(field.mock);
      return mockDateValue(field.type === 'date', candidates[(ordinal - 1) % candidates.length] ?? field.mock, ctx.strategy);
    }
    return typedMockValue(field, mockFieldValue(field.mock, ordinal));
  }

  // `T.f`: an unlinked placeholder, filled from `T`'s seeded rows by the caller's link pass.
  if (projectionOf(field) !== undefined) return field.type === 'array' ? [] : '';

  // An enum with no `@mock` rotates its own values (a declared `@mock` wins above).
  const values = declaredValues(field);
  if (values) {
    // Row 1 yields values[0], which is the declared default for 85% of fields.
    const ordinal = isRuntime ? 1 : ctx.index;
    return values[(ordinal - 1) % values.length]!;
  }

  // An unbound type variable has no value to sample (seed.rs twin).
  if (isTypeVariableField(field)) return undefined;

  switch (field.type) {
    case 'string':
      return sampleText(field, ctx);
    // Semantic domains synthesize a value that SATISFIES their own validator —
    // the property that keeps the seeder and the validator from drifting.
    case 'email':
      return ctx.strategy === 'seeded'
        ? randomEmail()
        : `${slug(field.name ?? 'user')}${ctx.index}@example.com`;
    case 'url':
      return ctx.strategy === 'seeded'
        ? randomUrl()
        : `https://example.com/${slug(field.name ?? 'link')}/${ctx.index}`;
    case 'phone':
      return ctx.strategy === 'seeded'
        ? randomPhone()
        : `+1-555-${String(1000 + (ctx.index % 9000)).padStart(4, '0')}`;
    case 'uuid':
      return ctx.strategy === 'seeded' ? randomUuid() : indexUuid(ctx.index);
    case 'image':
      return sampleImageUrl(ctx.entityName, field.name ?? 'image', ctx);
    case 'number': {
      // A declared range constrains the value; an UNdeclared one must not, or
      // the index ladder silently flattens once it passes an invented ceiling.
      // Seeded fallback floors at 1 (declared min still wins): all-zero
      // counts/metrics made every mock-seeded page read as broken data.
      if (ctx.strategy === 'seeded') {
        return randomInt({ min: field.min ?? 1, max: field.max ?? 250 });
      }
      const stepped = (field.min ?? 0) + ctx.index * 10;
      return field.max !== undefined && stepped > field.max ? field.max : stepped;
    }
    // Money is numeric at rest — same sampling as `number` (index strategy
    // mirrors the Rust seeder for the shared parity fixture). Seeded fallback
    // avoids $0.00 amounts for the same reason as `number`.
    case 'money': {
      if (ctx.strategy === 'seeded') {
        return randomInt({ min: field.min ?? 10, max: field.max ?? 900 });
      }
      const steppedMoney = (field.min ?? 0) + ctx.index * 10;
      return field.max !== undefined && steppedMoney > field.max ? field.max : steppedMoney;
    }
    // File seeds the canonical struct value (satisfies isFileValue) —
    // mirrors the Rust seeder's FieldType::File arm byte-for-byte.
    case 'bytes':
      return 'AAECAwQFBgcICQ==';
    case 'file': {
      const base = slug(field.name ?? 'file');
      return {
        name: `${base}-${ctx.index}.pdf`,
        url: `https://example.com/files/${base}/${ctx.index}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: ctx.index * 1024,
      };
    }
    case 'boolean':
      return ctx.strategy === 'seeded' ? randomBoolean() : ctx.index % 2 === 0;
    case 'date':
      return sampleDate(ctx, true);
    case 'timestamp':
    case 'datetime':
      return sampleDate(ctx, false);
    case 'enum':
      // Reached only when the enum declares no values — a malformed field.
      return null;
    case 'relation':
      return sampleRelation(field);
    case 'array':
      return sampleArray(field, ctx);
    case 'object':
      return sampleObject(field, ctx);
    case 'union':
      return sampleUnion(field, ctx);
    // A trait or orbital value held as data seeds unbound — `none` (seed.rs twin); a behavior with `@mock` seeds above.
    case 'trait':
    case 'orbital':
    case 'behavior':
      return null;
    case 'slot':
    case 'pattern':
    // An event name is authored on the owning struct, never random text (seed.rs twin).
    case 'event':
    // Renderable content is computed by the owning trait's effects, never
    // seeded — same no-sample treatment as the config-only reference types.
    case 'node':
      return undefined;
    default:
      return sampleText(field, ctx);
  }
}

/**
 * One row. Reserved keys are left to the caller. Under `strategy: 'seeded'`,
 * every other row (see {@link omitsUndefaultedOptionalFields}) omits its
 * undefaulted optional fields — required/defaulted/relation fields are
 * always present.
 */
export function sampleRow(
  entity: SampleEntity,
  ctx: Omit<SampleContext, 'entityName' | 'depth'>,
): EntityRow {
  const row: EntityRow = {};
  for (const field of entity.fields) {
    const name = field.name;
    if (!name || RESERVED_FIELD_NAMES.has(name)) continue;
    const value = sampleFieldValue(field, {
      ...ctx,
      entityName: entity.name,
      persistence: ctx.persistence ?? entity.persistence,
      ...(entity.identity ? { identity: true } : {}),
    });
    if (value !== undefined) row[name] = value;
  }
  return row;
}

/** `count` rows, 1-based, honoring the runtime-singleton gate. */
export function sampleRows(
  entity: SampleEntity,
  count: number,
  strategy: SampleStrategy,
): EntityRow[] {
  const rowCount = sampleRowCount(entity, count);
  const rows: EntityRow[] = [];
  for (let i = 1; i <= rowCount; i++) {
    rows.push(sampleRow(entity, { index: i, strategy, persistence: entity.persistence }));
  }
  return rows;
}
