/**
 * `applyParamsToOrb` — pure runtime overlay function. Equivalent to the body
 * the std-ts codegen emits inline for every std factory, lifted out so that:
 *   1. team-published behaviors (Firestore-stored) can dispatch through the
 *      same overlay as std behaviors;
 *   2. std factories can collapse to one-line wrappers calling this function.
 *
 * Reference: `docs/Almadar_Studio_SDK.md` §7.4.2.
 *
 * Pure data → data. No I/O.
 *
 * @packageDocumentation
 */

import type {
  Effect,
  Entity,
  EntityField,
  Expression,
  OrbitalDefinition,
  OrbitalEntity,
  OrbitalSchema,
  PageRefObject,
  PageTraitRef,
  SExpr,
  CallSiteConfig,
  CallSiteConfigEntry,
  Trait,
  TraitConfigValue,
  TraitEventContract,
  TraitEventListener,
  TraitReference,
  TraitTick,
  TraitId,
} from '../types/index.js';
import {
  isCallSiteConfigDeclaration,
  isConfigFieldSchema,
  mergeCallSiteConfigOverrides,
  overrideDeclaredKnobs,
  persistenceModeAllowsOverrides,
  ledgerRename,
} from '../types/index.js';
import type {
  MakePageRefOpts,
  MakeTraitRefOpts,
} from '../builders.js';
import {
  makeOrbitalWithUses,
  makePageRef,
  makeTraitRef,
} from '../builders.js';
import type { OrbitalParamsManifest } from './manifest-types.js';
import type {
  OrbitalFactoryParams,
  OrbitalTraitOverride,
  ParamValidationResult,
} from './types.js';
import { orbitalTouchesOwnRecord } from '../data-bearing.js';

/**
 * Structural validation of caller-supplied params against the manifest.
 * Rejects unknown top-level keys and unknown `traitOverrides` keys (the
 * latter against the manifest's `traitNames` allow-list).
 */
export function validateOrbitalFactoryParams(
  manifest: OrbitalParamsManifest,
  raw: object,
): ParamValidationResult {
  if (raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      error: { kind: 'not-object', received: Array.isArray(raw) ? 'array' : 'null' },
    };
  }

  const ALLOWED_KEYS = new Set<string>(manifest.paramFields.map((f) => f.name));
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, error: { kind: 'unknown-key', key } };
    }
  }

  const candidate = raw as OrbitalFactoryParams;
  if (candidate.traitOverrides !== undefined) {
    const to = candidate.traitOverrides;
    if (to === null || typeof to !== 'object' || Array.isArray(to)) {
      return {
        ok: false,
        error: {
          kind: 'trait-overrides-not-object',
          received: Array.isArray(to) ? 'array' : typeof to,
        },
      };
    }
    const allowed = new Set<string>(manifest.traitNames);
    for (const traitName of Object.keys(to)) {
      if (!allowed.has(traitName)) {
        return {
          ok: false,
          error: {
            kind: 'unknown-trait-override',
            trait: traitName,
            allowed: manifest.traitNames,
          },
        };
      }
    }
  }

  if (candidate.config !== undefined) {
    const cfg = candidate.config;
    if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
      return {
        ok: false,
        error: { kind: 'config-not-object', received: Array.isArray(cfg) ? 'array' : typeof cfg },
      };
    }
    const allowedKeys = manifest.configKeys ?? [];
    for (const key of Object.keys(cfg)) {
      if (!allowedKeys.includes(key)) {
        return { ok: false, error: { kind: 'unknown-config-key', key, allowed: allowedKeys } };
      }
    }
  }

  return { ok: true, params: candidate };
}

interface OverlayContext {
  readonly canonicalEntityName: string;
  readonly canonicalEntity: OrbitalEntity;
  readonly dataBearing: boolean;
}

function assertResolvedEntity(
  entity: OrbitalSchema['orbitals'][number]['entity'],
  orbitalName: string,
  orbName: string,
): OrbitalEntity {
  if (typeof entity === 'string') {
    throw new Error(
      `applyParamsToOrb: orbital "${orbitalName}" in orb "${orbName}" has an unresolved entity reference (string form). Pass a resolved .orb.`,
    );
  }
  if ('extends' in entity) {
    throw new Error(
      `applyParamsToOrb: orbital "${orbitalName}" in orb "${orbName}" has an unresolved EntityCall ("extends" form). Pass a resolved .orb.`,
    );
  }
  return entity;
}

function findOrbitalOrThrow(
  orb: OrbitalSchema,
  orbitalName: string,
): OrbitalSchema['orbitals'][number] {
  const orbital = orb.orbitals.find((o) => o.name === orbitalName);
  if (!orbital) {
    throw new Error(
      `applyParamsToOrb: orbital "${orbitalName}" not found in orb "${orb.name}". Available: ${orb.orbitals
        .map((o) => o.name)
        .join(', ')}`,
    );
  }
  return orbital;
}

function buildEntity(
  ctx: OverlayContext,
  effectiveName: string,
  effectiveCollection: string | undefined,
  params: OrbitalFactoryParams,
): Entity {
  const canonicalFields: readonly EntityField[] = Array.isArray(ctx.canonicalEntity.fields)
    ? ctx.canonicalEntity.fields
    : [];

  const extras: readonly EntityField[] = params.fields ?? [];

  for (const f of extras) {
    if (f.type === 'enum') {
      if (!Array.isArray(f.values) || f.values.length === 0) {
        throw new Error(
          `Field "${f.name ?? '<unnamed>'}" (type: "enum") requires a non-empty \`values: string[]\` array. ` +
            `Got: ${f.values === undefined ? 'undefined' : JSON.stringify(f.values)}.`,
        );
      }
    }
    if (f.type === 'relation') {
      const rel = f.relation;
      if (!rel || typeof rel.entity !== 'string' || rel.entity.length === 0) {
        throw new Error(
          `Field "${f.name ?? '<unnamed>'}" (type: "relation") requires \`relation: { entity: <EntityName>, cardinality: "one" | "many" }\`. ` +
            `Got: ${rel === undefined ? 'undefined' : JSON.stringify(rel)}.`,
        );
      }
      if (rel.cardinality !== 'one' && rel.cardinality !== 'many') {
        throw new Error(
          `Field "${f.name ?? '<unnamed>'}" (type: "relation") requires \`relation.cardinality: "one" | "many"\`. ` +
            `Got: ${rel.cardinality === undefined ? 'undefined' : JSON.stringify(rel.cardinality)}.`,
        );
      }
    }
  }

  let mergedFields: readonly EntityField[];
  if (extras.length === 0) {
    mergedFields = canonicalFields;
  } else {
    const extraNames = new Set(extras.map((f) => f.name));
    mergedFields = [
      ...canonicalFields.filter((f) => !extraNames.has(f.name)),
      ...extras,
    ];
  }

  const allowPersistenceOverride = persistenceModeAllowsOverrides(
    ctx.canonicalEntity.persistence,
    ctx.dataBearing,
  );

  const entity: Entity = {
    name: effectiveName,
    persistence: allowPersistenceOverride
      ? (params.persistence ?? ctx.canonicalEntity.persistence)
      : ctx.canonicalEntity.persistence,
    fields: [...mergedFields],
  };
  if (allowPersistenceOverride && effectiveCollection !== undefined) {
    entity.collection = effectiveCollection;
  } else if (allowPersistenceOverride && entity.persistence === 'persistent' && ctx.canonicalEntity.persistence === 'runtime') {
    // A runtime record made persistent has no canonical collection to inherit.
    entity.collection = `${(params.entityName ?? effectiveName).toLowerCase()}s`;
  }
  return entity;
}

type TraitOrInline = OrbitalSchema['orbitals'][number]['traits'][number];
type PageOrRef = NonNullable<OrbitalSchema['orbitals'][number]['pages']>[number];

type TraitRefObject = Extract<TraitOrInline, { ref: string }>;

function isTraitReferenceObject(t: TraitOrInline): t is TraitRefObject {
  if (t === null || typeof t !== 'object') return false;
  if (!('ref' in t)) return false;
  return typeof t.ref === 'string';
}

function isPageRefObject(p: PageOrRef): p is PageRefObject {
  if (p === null || typeof p !== 'object') return false;
  if (!('ref' in p)) return false;
  return typeof p.ref === 'string';
}

function rewriteInlineLinkedEntity<T extends { linkedEntity?: string }>(
  shape: T,
  oldName: string,
  newName: string,
): T {
  if (shape.linkedEntity !== oldName) return shape;
  return { ...shape, linkedEntity: newName };
}

const ENTITY_POSITIONAL_OPS: ReadonlyArray<{
  readonly op: string;
  readonly actionGuard?: ReadonlySet<string>;
  readonly entityIndex: number;
}> = [
  { op: 'fetch', entityIndex: 1 },
  { op: 'ref', entityIndex: 1 },
  { op: 'spawn', entityIndex: 1 },
  { op: 'persist', actionGuard: new Set(['create', 'update', 'delete']), entityIndex: 2 },
];

const ENTITY_VALUED_PROPS: ReadonlySet<string> = new Set([
  'entity',
  'source',
  'entityType',
  'linkedEntity',
]);

interface SExprMap { readonly [k: string]: SExpr }

function rewriteEntityInSExpr(value: SExpr, oldName: string, newName: string): SExpr {
  if (value === null) return null;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const prefix = `@${oldName}`;
    if (value === prefix || value.startsWith(`${prefix}.`)) {
      return `@${newName}${value.slice(prefix.length)}`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === 'string') {
      for (const entry of ENTITY_POSITIONAL_OPS) {
        if (first !== entry.op) continue;
        if (entry.actionGuard !== undefined) {
          const action = value[1];
          if (typeof action !== 'string' || !entry.actionGuard.has(action)) continue;
        }
        const at = entry.entityIndex;
        const slot = value[at];
        if (typeof slot !== 'string' || slot !== oldName) continue;
        const rewritten: SExpr[] = [];
        for (let i = 0; i < value.length; i++) {
          rewritten.push(i === at ? newName : rewriteEntityInSExpr(value[i], oldName, newName));
        }
        return rewritten;
      }
    }
    return value.map((v) => rewriteEntityInSExpr(v, oldName, newName));
  }
  return rewriteEntityInSExprMap(value as SExprMap, oldName, newName);
}

function rewriteEntityInSExprMap(obj: SExprMap, oldName: string, newName: string): SExprMap {
  const next: { [k: string]: SExpr } = {};
  for (const [k, v] of Object.entries(obj)) {
    if (ENTITY_VALUED_PROPS.has(k) && typeof v === 'string' && v === oldName) {
      next[k] = newName;
    } else {
      next[k] = rewriteEntityInSExpr(v, oldName, newName);
    }
  }
  return next;
}

function rewritePayloadFieldType(typeStr: string, oldName: string, newName: string): string {
  if (typeStr === oldName) return newName;
  if (typeStr === `[${oldName}]`) return `[${newName}]`;
  return typeStr;
}

function rewriteEventContract(
  contract: TraitEventContract,
  oldName: string,
  newName: string,
): TraitEventContract {
  if (!contract.payloadSchema || contract.payloadSchema.length === 0) return contract;
  return {
    ...contract,
    payloadSchema: contract.payloadSchema.map((f) => {
      const next = { ...f, type: rewritePayloadFieldType(f.type, oldName, newName) };
      if (typeof f.entity === 'string' && f.entity === oldName) {
        next.entity = newName;
      }
      return next;
    }),
  };
}

function rewriteListener(
  listener: TraitEventListener,
  oldName: string,
  newName: string,
): TraitEventListener {
  if (!listener.payloadMapping) return listener;
  const nextMapping: Record<string, SExpr> = {};
  for (const [k, v] of Object.entries(listener.payloadMapping)) {
    nextMapping[k] = rewriteEntityInSExpr(v, oldName, newName);
  }
  return { ...listener, payloadMapping: nextMapping };
}

function rewriteTick(tick: TraitTick, oldName: string, newName: string): TraitTick {
  const next: TraitTick = { ...tick };
  if (next.guard !== undefined && next.guard !== null) {
    next.guard = rewriteEntityInSExpr(next.guard as SExpr, oldName, newName) as Expression;
  }
  next.effects = next.effects.map(
    (e) => rewriteEntityInSExpr(e as SExpr, oldName, newName) as Effect,
  );
  return next;
}

/**
 * Rebind an inline `Trait` to a renamed entity. Combines top-level
 * `linkedEntity` rewrite + body-level entity-ref rewriting (SExpr literals
 * in transitions / effects / ticks / payloads / listens).
 */
export function rebindInlineTraitEntity(trait: Trait, oldName: string, newName: string): Trait {
  if (oldName === newName) return trait;
  return rewriteEntityInInlineTrait(rewriteInlineLinkedEntity(trait, oldName, newName), oldName, newName);
}

export function rewriteEntityInInlineTrait(trait: Trait, oldName: string, newName: string): Trait {
  if (oldName === newName) return trait;
  const next: Trait = { ...trait };

  if (next.stateMachine) {
    next.stateMachine = {
      ...next.stateMachine,
      transitions: next.stateMachine.transitions.map((t) => {
        const updated = { ...t };
        if (updated.guard !== undefined && updated.guard !== null) {
          updated.guard = rewriteEntityInSExpr(updated.guard as SExpr, oldName, newName) as Expression;
        }
        if (updated.effects) {
          updated.effects = updated.effects.map(
            (e) => rewriteEntityInSExpr(e as SExpr, oldName, newName) as Effect,
          );
        }
        return updated;
      }),
    };
  }

  if (next.initialEffects) {
    next.initialEffects = next.initialEffects.map(
      (e) => rewriteEntityInSExpr(e as SExpr, oldName, newName) as Effect,
    );
  }

  if (next.ticks) {
    next.ticks = next.ticks.map((t) => rewriteTick(t, oldName, newName));
  }

  if (next.emits) {
    next.emits = next.emits.map((c) => rewriteEventContract(c, oldName, newName));
  }

  if (next.listens) {
    next.listens = next.listens.map((l) => rewriteListener(l, oldName, newName));
  }

  return next;
}

type TraitInput = OrbitalSchema['orbitals'][number]['traits'][number];
type PageInput = NonNullable<OrbitalSchema['orbitals'][number]['pages']>[number];

// V4-W4 stamp-before-rename: traits/pages are emitted CANONICAL. Inline traits
// (and string refs) pass through untouched — their `@entity.<canonical>` tokens
// + `linkedEntity` stay canonical and resolve by stamped id. Reference objects
// are still normalised through `makeTraitRef`/`makePageRef` (shape only, no
// entity rewrite); their canonical `linkedEntity` is renamed post-stamp.
function rebuildTraits(
  traits: OrbitalSchema['orbitals'][number]['traits'],
): OrbitalDefinition['traits'] {
  return traits.map((t): TraitInput => {
    if (!isTraitReferenceObject(t)) return t;
    return makeTraitRef({ ...t } as MakeTraitRefOpts);
  });
}

function rebuildPages(
  pages: OrbitalSchema['orbitals'][number]['pages'],
): NonNullable<OrbitalDefinition['pages']> {
  if (!pages) return [];
  return pages.map((p): PageInput => {
    if (!isPageRefObject(p)) return p;
    return makePageRef({ ...p } as MakePageRefOpts);
  });
}

export { mergeCallSiteConfigOverrides } from '../types/index.js';

/**
 * Read-only structural view over the JSON lattice the reference-rewrite
 * walker traverses — same trick as the expectation shape union (`SExpr` and
 * `TraitConfigValue` both assign to it). Exported alongside
 * `rewriteTraitRefsInTree` for the rabit composer's dedupe backstop.
 */
export type WalkableData =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<WalkableData>
  | { readonly [key: string]: WalkableData };

/**
 * Boundary-checked `@trait.<from>` → `@trait.<to>` rewrite of one string
 * (next char `.`/`[`/end), mirroring the compiler's
 * `rewrite_trait_embed_in_sexpr`.
 */
function rewriteTraitRefToken(value: string, renames: ReadonlyMap<string, string>): string {
  const prefix = '@trait.';
  if (!value.startsWith(prefix)) return value;
  const rest = value.slice(prefix.length);
  const splitAt = rest.search(/[.[]/);
  const name = splitAt === -1 ? rest : rest.slice(0, splitAt);
  const to = renames.get(name);
  if (to === undefined) return value;
  return `${prefix}${to}${splitAt === -1 ? '' : rest.slice(splitAt)}`;
}

/**
 * Deep `@trait.<from>` → `@trait.<to>` token rewrite over a JSON tree —
 * config values at any depth, state-machine trees, listen/tick arms. The
 * rename pass (`applyDeclarationTraitRenames`) and the rabit composer's
 * inline-trait dedupe backstop share this one walker so both cover exactly
 * the positions the compiled path's `rewrite_trait_embed_in_sexpr` does.
 */
export function rewriteTraitRefsInTree(node: WalkableData, renames: ReadonlyMap<string, string>): WalkableData {
  if (typeof node === 'string') return rewriteTraitRefToken(node, renames);
  if (Array.isArray(node)) return node.map((item) => rewriteTraitRefsInTree(item, renames));
  if (node !== null && typeof node === 'object') {
    const out: { [key: string]: WalkableData } = {};
    for (const [key, value] of Object.entries(node)) out[key] = rewriteTraitRefsInTree(value, renames);
    return out;
  }
  return node;
}

/**
 * Re-key a `traitEmbedIds` side-map for the renamed tokens: the map is keyed
 * by the token NAME as it appears in the body, so after the body tokens move
 * to the new name the side-map key must follow (id value unchanged — the
 * compiled path's `identity_normalize` then sees token == current name and
 * no-ops, and the runtime's id-primary lookup keeps resolving).
 */
function rekeyTraitEmbedIds(
  embedIds: Record<string, TraitId>,
  renames: ReadonlyMap<string, string>,
): Record<string, TraitId> {
  let out: Record<string, TraitId> | undefined;
  for (const [token, id] of Object.entries(embedIds)) {
    const to = renames.get(token);
    if (to === undefined) continue;
    out = out ?? { ...embedIds };
    delete out[token];
    out[to] = id;
  }
  return out ?? embedIds;
}

/**
 * Apply `traitOverrides.<T>.name` renames to trait DECLARATIONS, AFTER the
 * schema has been stamped (V4-W4 stamp-before-rename).
 *
 * The rename moves the declaration (`traits[].name` for inline traits, the
 * ref object's local `name` for reference traits), the ledger `curName` of
 * each renamed declaration id, AND every name-based reference to the old
 * name: `@trait.<old>` tokens in config values and state-machine/tick effect
 * trees, the `traitEmbedIds` side-map keys that index those tokens, and page
 * trait refs (`pages[].traits[].ref`). The dual-carry ids (`refId`,
 * `traitEmbedIds` values) are untouched, so the compiled path's
 * `identity_normalize` pass observes tokens already equal to the id-resolved
 * current name and no-ops, while the JS runtime — which resolves `@trait.X`
 * config knobs (e.g. `DashboardLayout.config.tile2Trait`) and page refs BY
 * NAME — never sees a dangling reference (FIX-H, dashboard-edit-title-string
 * 2026-08-06: the declaration-only rename left `@trait.DefaultRevenueChart`
 * in a sibling's config and the page ref while validate stayed green).
 *
 * The keys are canonical names because stamping ran while the declaration
 * still carried its canonical name (the factory no longer renames — see
 * `applyParamsToOrb`), so `trait.name === canonicalKey` at this point.
 *
 * Pure — returns a new schema. Applied per orbital; the same override key
 * renames the matching declaration in every orbital that owns it (matches
 * the former per-orbital `applyParamsToOrb` semantics).
 */
export function applyDeclarationTraitRenames(
  schema: OrbitalSchema,
  renames: ReadonlyMap<string, string>,
  /**
   * Rename timestamp (ISO string) for the ledger `renames[]` audit row. Threaded
   * from the persistence layer (which owns the clock). The stamp keyed each inline
   * trait's ledger `curName` to its canonical name; without this update the renamed
   * declaration disagrees with `curName` → `ORB_ID_NAME_MISMATCH` on the page ref.
   */
  at: string,
): OrbitalSchema {
  if (renames.size === 0) return schema;

  type TraitElem = OrbitalDefinition['traits'][number];
  const renamedTraitIds: Array<{ id: string; to: string }> = [];
  const renameDeclaration = (t: TraitElem): TraitElem => {
    if (typeof t !== 'object' || t === null) return t;
    let next = t;
    const named = t as { name?: string };
    if (typeof named.name === 'string') {
      const renamed = renames.get(named.name);
      if (renamed !== undefined) {
        const id = (t as { id?: string }).id;
        if (typeof id === 'string') renamedTraitIds.push({ id, to: renamed });
        next = { ...next, name: renamed };
      }
    }
    const walked = rewriteTraitRefsInTree(next as WalkableData, renames) as TraitElem;
    // `walked` is the walker's fresh copy — re-keying its side-map mutates no input.
    const embedIds = (walked as { traitEmbedIds?: Record<string, TraitId> }).traitEmbedIds;
    if (embedIds !== undefined) {
      const rekeyed = rekeyTraitEmbedIds(embedIds, renames);
      if (rekeyed !== embedIds) {
        (walked as { traitEmbedIds?: Record<string, TraitId> }).traitEmbedIds = rekeyed;
      }
    }
    return walked;
  };
  const renamePageTraitRefs = (p: PageInput): PageInput => {
    if (typeof p !== 'object' || p === null) return p;
    // Deep walk first: page-trait `config` values can carry `@trait.<old>` too
    // (the compiler's config-ref normalization covers page-ref config).
    const walked = rewriteTraitRefsInTree(p as WalkableData, renames) as Exclude<PageInput, string>;
    const traits = (walked as { traits?: ReadonlyArray<PageTraitRef | string> }).traits;
    if (!Array.isArray(traits)) return walked;
    return {
      ...walked,
      traits: traits.map((t) => {
        if (typeof t === 'string') return renames.get(t) ?? t;
        const to = renames.get(t.ref);
        return to === undefined ? t : { ...t, ref: to };
      }),
    } as PageInput;
  };

  const orbitals = schema.orbitals.map((orbital) => {
    if (!('traits' in orbital) || !Array.isArray(orbital.traits)) return orbital;
    return {
      ...orbital,
      traits: orbital.traits.map(renameDeclaration),
      ...(orbital.pages !== undefined ? { pages: orbital.pages.map(renamePageTraitRefs) } : {}),
    };
  });

  // Update the ledger `curName` for each renamed trait declaration id so the
  // declaration + ledger agree — clears `ORB_ID_NAME_MISMATCH`; the compiler's
  // identity-normalization pass then rewrites the canonical page `ref` /
  // `@trait.<canonical>` tokens by id. Covers inline bodies AND Reference-form
  // declarations (both carry a local `id` since the composed-surface backbone).
  let ledger = schema.ledger;
  if (ledger !== undefined) {
    for (const { id, to } of renamedTraitIds) {
      ledger = ledgerRename(ledger, id, to, at);
    }
  }

  return { ...schema, orbitals, ...(ledger !== schema.ledger ? { ledger } : {}) };
}

/** The entity name an orbital declares: its inline entity's, or an import's `reference.entity`. */
export function declaredEntityName(orbital: OrbitalDefinition): string | null {
  const entity = orbital.entity;
  if (typeof entity === 'object' && entity !== null && typeof entity.name === 'string') return entity.name;
  return orbital.reference?.entity ?? null;
}

/** A single entity display rename: `from` (canonical name at stamp) → `to`. */
export interface EntityDeclarationRename {
  readonly from: string;
  readonly to: string;
}

/**
 * Apply an entity rename to DECLARATIONS only, AFTER the schema has been
 * stamped (V4-W4 stamp-before-rename). The entity, its `@entity.<from>` body
 * tokens, and every trait/page `linkedEntity` were all emitted CANONICAL by
 * the factory, so stamping keyed `entityRefIds`/`linkedEntityId` by `from`.
 *
 * This renames only the visible declaration surface — `entity.name` and every
 * trait/page `linkedEntity` whose value is `from` — leaving the `@entity.<from>`
 * body tokens and every stamped id untouched. Readers resolve those tokens by
 * `entityRefIds` id and resolve `linkedEntity` by `linkedEntityId`, so the
 * rename lands on the right declaration without any body rewrite (this is what
 * lets the factory stop calling `rebindInlineTraitEntity`). Collection is not
 * renamed here — its effective value was already baked at build time.
 *
 * Pure — returns a new schema. Applied to every orbital whose primary entity
 * is named `from` (mirrors the former per-orbital `applyParamsToOrb` scope for
 * a single-orbital write).
 */
export function applyDeclarationEntityRename(
  schema: OrbitalSchema,
  rename: EntityDeclarationRename,
  /**
   * Rename timestamp (ISO string) for the ledger `renames[]` audit row. Threaded
   * from the persistence layer (which owns the clock). The stamp keyed the ledger
   * `curName` to the canonical entity name; without this update the renamed
   * declaration disagrees with `curName` → `ORB_ID_NAME_MISMATCH`.
   */
  at: string,
): OrbitalSchema {
  if (rename.from === rename.to) return schema;

  const linkedEntityIsFrom = (shape: object): boolean =>
    (shape as { linkedEntity?: string }).linkedEntity === rename.from;

  const renamedEntityIds: string[] = [];
  const orbitals = schema.orbitals.map((orbital) => {
    const entity = orbital.entity;
    if (orbital.reference !== undefined && orbital.reference.entity === rename.from) {
      return {
        ...orbital,
        reference: { ...orbital.reference, entity: rename.to },
        traits: orbital.traits.map((t): TraitInput =>
          typeof t === 'object' && t !== null && linkedEntityIsFrom(t) ? { ...t, linkedEntity: rename.to } : t,
        ),
      };
    }
    if (typeof entity !== 'object' || entity === null || entity.name !== rename.from) {
      return orbital;
    }
    const entityId = (entity as { id?: string }).id;
    if (typeof entityId === 'string') renamedEntityIds.push(entityId);

    const traits = orbital.traits.map((t): TraitInput =>
      typeof t === 'object' && t !== null && linkedEntityIsFrom(t)
        ? { ...t, linkedEntity: rename.to }
        : t,
    );
    const pages = orbital.pages?.map((p): PageInput =>
      typeof p === 'object' && p !== null && linkedEntityIsFrom(p)
        ? { ...p, linkedEntity: rename.to }
        : p,
    );

    return {
      ...orbital,
      entity: { ...entity, name: rename.to },
      traits,
      ...(pages !== undefined ? { pages } : {}),
    };
  });

  // Update the ledger `curName` for each renamed entity id (route to the
  // canonical owner) so the declaration + ledger agree — clears
  // `ORB_ID_NAME_MISMATCH`; the compiler's identity-normalization pass then
  // rewrites the canonical `@entity`/`fetch`/`persist` tokens by id.
  let ledger = schema.ledger;
  if (ledger !== undefined) {
    for (const id of renamedEntityIds) {
      ledger = ledgerRename(ledger, id, rename.to, at);
    }
  }

  return { ...schema, orbitals, ...(ledger !== schema.ledger ? { ledger } : {}) };
}

/**
 * Ledger/declaration agreement heal for the factory build path: every entity
 * declaration carrying an id must find its ledger row naming the SAME name
 * the declaration carries. A re-instantiate adopts the prior `.orb`'s ledger
 * via `orb stamp --prior` — including rename rows an earlier build recorded —
 * while the factory re-emits the entity at its baked/requested name, so a
 * stale `curName` would survive a corrective rebuild unchanged and
 * manufacture an `ORB_ID_NAME_MISMATCH` no repair pass can edit away
 * (battery 2026-08-06 domain-rule: param-fill renamed MarketplaceUserOrbital's
 * entity to `Product`; the corrective re-instantiate at `entityName:
 * "MarketplaceUser"` applies NO rename — from === to — and the adopted row
 * kept `curName: "Product"` against a `MarketplaceUser` declaration).
 *
 * Sound on this path only: the factory always re-emits the declaration at the
 * requested/baked name, so the declaration is the build's truth and the
 * adopted row carries identity (the id) forward. No-op when they agree.
 */
export function healEntityLedgerRows(schema: OrbitalSchema, at: string): OrbitalSchema {
  let ledger = schema.ledger;
  if (ledger === undefined) return schema;
  for (const orbital of schema.orbitals) {
    const entity = orbital.entity;
    if (typeof entity !== 'object' || entity === null) continue;
    const id = (entity as { id?: string }).id;
    const name = entity.name;
    if (typeof id !== 'string' || typeof name !== 'string') continue;
    const entry = ledger.entries[id];
    if (entry === undefined || entry.kind !== 'entity' || entry.curName === name) continue;
    ledger = ledgerRename(ledger, id, name, at);
  }
  return ledger !== schema.ledger ? { ...schema, ledger } : schema;
}

/**
 * Trait-declaration sibling of `healEntityLedgerRows`. A re-instantiate with
 * NO trait renames in its params (a corrective rebuild, or the plan-repair
 * reset-to-factory-defaults verb) adopts the prior `.orb`'s ledger — including
 * trait rename rows an earlier build recorded — while the factory re-emits
 * every trait declaration at its baked/requested name, so the stale `curName`
 * would manufacture an `ORB_ID_NAME_MISMATCH` (the entity twin of this is the
 * battery 2026-08-06 `healEntityLedgerRows` case). Same soundness argument:
 * on this path the factory re-emission is the build's truth and the adopted
 * row carries identity (the id) forward. Reference-form declarations resolve
 * their current name as `name ?? <ref last segment>` (mirrors the compiler's
 * `collect_trait_id_names`). No-op when they agree.
 */
export function healTraitLedgerRows(schema: OrbitalSchema, at: string): OrbitalSchema {
  let ledger = schema.ledger;
  if (ledger === undefined) return schema;
  for (const orbital of schema.orbitals) {
    for (const trait of orbital.traits ?? []) {
      if (typeof trait !== 'object' || trait === null) continue;
      const id = (trait as { id?: string }).id;
      if (typeof id !== 'string') continue;
      const declared = (trait as { name?: string; ref?: string });
      const name =
        typeof declared.name === 'string'
          ? declared.name
          : typeof declared.ref === 'string'
            ? declared.ref.slice(declared.ref.lastIndexOf('.') + 1)
            : undefined;
      if (name === undefined) continue;
      const entry = ledger.entries[id];
      if (entry === undefined || entry.kind !== 'trait' || entry.curName === name) continue;
      ledger = ledgerRename(ledger, id, name, at);
    }
  }
  return ledger !== schema.ledger ? { ...schema, ledger } : schema;
}

/**
 * The overlay. Resolves the effective entity name + collection, calls
 * `makeOrbitalWithUses` with the rewritten data, then applies the params'
 * trait/page overrides post-hoc.
 */
export function applyParamsToOrb(
  orb: OrbitalSchema,
  orbitalName: string,
  _manifest: OrbitalParamsManifest,
  params: OrbitalFactoryParams,
): OrbitalDefinition {
  const orbital = findOrbitalOrThrow(orb, orbitalName);
  const canonicalEntity = assertResolvedEntity(orbital.entity, orbitalName, orb.name);
  const canonicalEntityName = canonicalEntity.name;
  // V4-W4 stamp-before-rename: emit the entity + every `@entity`/`linkedEntity`
  // ref CANONICAL. The effective-name rename is a declaration-only concern
  // applied post-stamp (see `applyDeclarationEntityRename`), so the stamped
  // `entityRefIds`/`linkedEntityId` side-maps are keyed by the canonical name
  // that still agrees with the un-rewritten `@entity.<canonical>` tokens.
  // Readers resolve those tokens by stable id onto the renamed declaration.
  // The collection is inert for stamping (not an identity key), so its
  // effective value is baked at build time — only name + linkedEntity rename.
  const effectiveCollection =
    typeof canonicalEntity.collection === 'string'
      ? (params.collection ??
        (params.entityName
          ? `${params.entityName.toLowerCase()}s`
          : canonicalEntity.collection))
      : params.collection;

  const ctx: OverlayContext = { canonicalEntityName, canonicalEntity, dataBearing: orbitalTouchesOwnRecord(orbital) };

  const built = makeOrbitalWithUses({
    name: orbital.name,
    uses: orbital.uses ?? [],
    // Derived `expects` declarations ride the overlay untouched — they name
    // SIBLING entities (never the orbital's own), so the entityName rename
    // below cannot affect them.
    ...(orbital.expects !== undefined ? { expects: orbital.expects } : {}),
    entity: buildEntity(ctx, canonicalEntityName, effectiveCollection, params),
    traits: rebuildTraits(orbital.traits),
    pages: rebuildPages(orbital.pages),
  });

  // This orbital's OWN declared knobs (`Orbital.config`) ride through
  // untouched when the caller supplies no override, and get their
  // `default`s folded when `params.config` is set. Silently no-ops when the
  // orbital declares no config of its own — mirrors `buildEntity`'s
  // persistence-override gate (an override with nothing to apply to is
  // ignored, not an error; `validateOrbitalFactoryParams` is what rejects a
  // `config` param against a manifest with no `configKeys`).
  if (orbital.config !== undefined) {
    built.config =
      params.config !== undefined
        ? overrideDeclaredKnobs(orbital.config, params.config)
        : orbital.config;
  }

  if (built.traits && params.traitOverrides !== undefined) {
    built.traits = built.traits.map((t) => {
      if (!isTraitReferenceObject(t) || typeof t.name !== 'string') return t;
      const override: OrbitalTraitOverride | undefined = params.traitOverrides?.[t.name];
      if (!override) return t;
      const merged: TraitReference = { ...t };
      if (override.config !== undefined) {
        merged.config = mergeCallSiteConfigOverrides(t.config ?? {}, override.config);
      }
      if (override.linkedEntity !== undefined) merged.linkedEntity = override.linkedEntity;
      if (override.events !== undefined) {
        if (
          override.events === null ||
          typeof override.events !== 'object' ||
          Array.isArray(override.events)
        ) {
          throw new Error(
            `traitOverrides["${t.name}"].events must be a Record<string,string> ` +
              `(rename map like { "OPEN": "ADD_ITEM" }), got ${
                Array.isArray(override.events) ? 'an array' : typeof override.events
              }`,
          );
        }
        for (const [k, v] of Object.entries(override.events)) {
          if (typeof v !== 'string') {
            throw new Error(
              `traitOverrides["${t.name}"].events["${k}"] must be a string ` +
                `(target event name), got ${typeof v}`,
            );
          }
        }
        merged.events = { ...(t.events ?? {}), ...override.events };
      }
      // V4-W4: the trait NAME override is NOT applied here. Names are a
      // display concern applied declaration-only AFTER stamping (see
      // `applyDeclarationTraitRenames`), so the stamped ids/side-maps/page
      // refIds are keyed by canonical names that still agree with the
      // (un-rewritten) `@trait.<canonical>` tokens + page `ref`s. Readers
      // then resolve those tokens by stable id onto the renamed declaration —
      // no token rewrite (the deleted `applyTraitRenames`) required.
      if (override.emitsScope !== undefined) merged.emitsScope = override.emitsScope;
      if (override.listens !== undefined) merged.listens = override.listens;
      return merged;
    });
  }

  if (built.pages && params.pagePath !== undefined) {
    built.pages = built.pages.map((p, idx) => {
      if (!isPageRefObject(p) || idx !== 0) return p;
      return { ...p, path: params.pagePath } as PageRefObject;
    });
  }

  return built;
}
