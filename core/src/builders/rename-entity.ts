/**
 * One structural rename of an entity across a set of orbitals — the positions the compiler's
 * visitors read an entity name from (`orbital-core/src/stamp.rs`, `orbital-compiler`'s
 * `inline/rewrite.rs` `visit_entity_slots` + `ENTITY_VALUED_PROPS`, `rename_entities_in_trait`,
 * relation/page/expects passes), never a text search:
 *
 * - declarations: an object carrying `name` + `fields` (primary/auxiliary entities, a trait's
 *   `sourceEntityDefinition` and `dataEntities`), optionally given a new `collection`;
 * - `@Name` / `@Name.<path>` tokens anywhere (guards, effects, ticks, listens, policies, config);
 * - the entity slot of `["fetch", N]`, `["persist", create|update|delete, N]`
 *   and `["spawn", N]`;
 * - entity-valued keys (`entity`, `source`, `entityType`, `linkedEntity`, `primaryEntity`,
 *   `payloadEntity`, `extends`) and payload `type` references (`N`, `[N]`, `projectedFrom.type`);
 * - config fields typed `entity`, `expects` entries, and the `entityRefIds` key (its id stays);
 * - an effect-row use's `resource` when its `kind` is `persist` or `fetch`.
 *
 * Ids are kept, so readers that resolve by id still land on the renamed declaration. Pure: the
 * input is not mutated. Used where an app namespaces a colliding organism (`compose-app.ts`).
 */
import type { OrbitalDefinition, OrbitalSchema, Trait } from '../types/index.js';
import { isCallSiteConfigDeclaration, ledgerRename } from '../types/index.js';
import type { JsonObject, JsonValue } from '../types/json.js';
import { isJsonObject } from '../types/json.js';

const ENTITY_VALUED_KEYS: ReadonlySet<string> = new Set(['entity', 'source', 'entityType', 'linkedEntity', 'primaryEntity', 'payloadEntity', 'extends']);
const PERSIST_ACTIONS: ReadonlySet<string> = new Set(['create', 'upsert', 'update', 'delete']);

export interface RenameEntityOptions {
  /** The renamed declaration's collection, set explicitly (the compiler and runtime derive differently). */
  collection?: string;
  /**
   * The atom's own declaration of the trait a reference names (`Alias.traits.T`, resolved through
   * the orbital's `uses`). A call site restates knob values and type arguments without their types,
   * so the atom is the only source for which knobs are `entity`-typed (`targetEntity : entity`) and
   * which type parameters are Entity-kind; callers that hold the registry supply it. Without it
   * such values are left as they are.
   */
  atomTraitOf?: (orbital: OrbitalDefinition, traitRef: string) => Trait | undefined;
}

/** A trait reference with its atom-declared entity-typed knobs and Entity-kind type arguments renamed. */
function renameAtomEntitySlots(trait: JsonValue, atomOf: (ref: string) => Trait | undefined, from: string, to: string): JsonValue {
  if (!isJsonObject(trait) || typeof trait['ref'] !== 'string') return trait;
  const atom = atomOf(trait['ref']);
  if (atom === undefined) return trait;
  const next: JsonObject = { ...trait };
  // No `linkedEntity` binds the atom's own entity by name: renaming that name makes the binding explicit.
  if (trait['linkedEntity'] === undefined && atom.linkedEntity === from) next['linkedEntity'] = to;
  const config = trait['config'];
  if (isJsonObject(config)) {
    const renamed: JsonObject = { ...config };
    for (const [knob, declared] of Object.entries(atom.config ?? {})) {
      const field = renamed[knob];
      if (isCallSiteConfigDeclaration(declared) && declared.type === 'entity' && isJsonObject(field) && field['default'] === from) renamed[knob] = { ...field, default: to };
    }
    next['config'] = renamed;
  }
  const typeArgs = trait['typeArgs'];
  if (isJsonObject(typeArgs)) {
    const entityParams = new Set((atom.typeParams ?? []).filter((p) => p.kind === 'Entity').map((p) => p.name));
    next['typeArgs'] = Object.fromEntries(Object.entries(typeArgs).map(([param, value]) => [param, entityParams.has(param) && value === from ? to : value]));
  }
  return next;
}

function renameToken(value: string, from: string, to: string): string {
  if (value === `@${from}`) return `@${to}`;
  if (value.startsWith(`@${from}.`)) return `@${to}${value.slice(from.length + 1)}`;
  return value;
}

function walk(node: JsonValue, from: string, to: string, options: RenameEntityOptions): JsonValue {
  if (typeof node === 'string') return renameToken(node, from, to);
  if (Array.isArray(node)) {
    const out = node.map((item) => walk(item, from, to, options));
    const op = node[0];
    if ((op === 'fetch' || op === 'spawn') && node[1] === from) out[1] = to;
    if (op === 'persist' && typeof node[1] === 'string' && PERSIST_ACTIONS.has(node[1]) && node[2] === from) out[2] = to;
    return out;
  }
  if (!isJsonObject(node)) return node;

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'entityRefIds' && isJsonObject(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, id]) => [name === from ? to : name, id]));
      continue;
    }
    if (typeof value === 'string' && ENTITY_VALUED_KEYS.has(key) && value === from) {
      out[key] = to;
      continue;
    }
    if (key === 'type' && typeof value === 'string' && (value === from || value === `[${from}]`)) {
      out[key] = value === from ? to : `[${to}]`;
      continue;
    }
    out[key] = walk(value, from, to, options);
  }

  const isDeclaration = node['name'] === from && Array.isArray(node['fields']);
  if (isDeclaration) {
    out['name'] = to;
    if (options.collection !== undefined) out['collection'] = options.collection;
  }
  // An effect-row use: `resource` is the entity only for the data effects (a slot, an event or a path otherwise).
  if ((node['kind'] === 'persist' || node['kind'] === 'fetch') && node['resource'] === from) out['resource'] = to;
  const isExpectation = node['name'] === from && (node['kind'] === 'entity' || node['kind'] === 'identity');
  if (isExpectation) out['name'] = to;
  if (node['type'] === 'entity' && node['default'] === from) out['default'] = to;
  return out;
}

/** `orbitals` with entity `from` renamed `to` at every position an entity name is read from. */
export function renameEntity(
  orbitals: ReadonlyArray<OrbitalDefinition>,
  from: string,
  to: string,
  options: RenameEntityOptions = {},
): OrbitalDefinition[] {
  if (from === to) return [...orbitals];
  return orbitals.map((orbital) => {
    const tree: JsonValue = JSON.parse(JSON.stringify(orbital));
    const atomTraitOf = options.atomTraitOf;
    if (atomTraitOf !== undefined && isJsonObject(tree)) {
      const atomOf = (ref: string): Trait | undefined => atomTraitOf(orbital, ref);
      if (Array.isArray(tree['traits'])) tree['traits'] = tree['traits'].map((t) => renameAtomEntitySlots(t, atomOf, from, to));
      if (Array.isArray(tree['pages'])) {
        tree['pages'] = tree['pages'].map((page) => (isJsonObject(page) && Array.isArray(page['traits'])
          ? { ...page, traits: page['traits'].map((t) => renameAtomEntitySlots(t, atomOf, from, to)) }
          : page));
      }
    }
    const renamed: OrbitalDefinition = JSON.parse(JSON.stringify(walk(tree, from, to, options)));
    return renamed;
  });
}

/** The ids of the declarations named `name` (an entity declaration carries its own stable id). */
function declarationIds(orbitals: ReadonlyArray<OrbitalDefinition>, name: string): string[] {
  const ids: string[] = [];
  const visit = (node: JsonValue): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isJsonObject(node)) return;
    if (node['name'] === name && Array.isArray(node['fields']) && typeof node['id'] === 'string') ids.push(node['id']);
    Object.values(node).forEach(visit);
  };
  visit(JSON.parse(JSON.stringify(orbitals)));
  return ids;
}

/** `renameEntity` over a whole schema: its orbitals, and the ledger rows of the renamed declarations. */
export function renameEntityInSchema(
  schema: OrbitalSchema,
  from: string,
  to: string,
  options: RenameEntityOptions = {},
  at: string = new Date().toISOString(),
): OrbitalSchema {
  const orbitals = renameEntity(schema.orbitals, from, to, options);
  let ledger = schema.ledger;
  if (ledger !== undefined) {
    for (const id of declarationIds(schema.orbitals, from)) {
      if (ledger.entries[id] !== undefined) ledger = ledgerRename(ledger, id, to, at);
    }
  }
  return { ...schema, orbitals, ...(ledger !== undefined ? { ledger } : {}) };
}

/** A reference trait whose atom fixes its entity binding (not `@rebindable`). */
export interface EntityRenameBlocker {
  orbitalName: string;
  traitName: string;
  traitRef: string;
}

/**
 * The reference traits that pin entity `name`: an atom that does not mark its binding
 * `@rebindable` owns the entity it binds, so renaming it is `ORB_T_ENTITY_NOT_REBINDABLE`. An atom
 * the resolver cannot find pins it too — rebindability is never assumed.
 */
export function entityRenameBlockers(
  orbitals: ReadonlyArray<OrbitalDefinition>,
  name: string,
  atomTraitOf: (orbital: OrbitalDefinition, traitRef: string) => Trait | undefined,
): EntityRenameBlocker[] {
  const isRebindable = (orbital: OrbitalDefinition, ref: string): boolean => atomTraitOf(orbital, ref)?.entityRebindable === true;
  const blockers: EntityRenameBlocker[] = [];
  for (const orbital of orbitals) {
    for (const trait of orbital.traits ?? []) {
      if (typeof trait !== 'object' || !('ref' in trait) || typeof trait.ref !== 'string') continue;
      const bound = trait.linkedEntity ?? atomTraitOf(orbital, trait.ref)?.linkedEntity;
      if (bound !== name || isRebindable(orbital, trait.ref)) continue;
      blockers.push({ orbitalName: orbital.name, traitName: trait.name ?? trait.ref, traitRef: trait.ref });
    }
  }
  return blockers;
}

/**
 * `atomTraitOf` for a registry: `Alias.traits.T` resolved through the orbital's `uses` to the
 * behavior it imports (the last segment of `from`, `std/behaviors/std-x` → `std-x`), then to that
 * behavior's declaration of trait `T`. `loadBehaviorOrb` is the caller's registry; each behavior
 * is loaded once.
 */
export function atomTraitResolver(
  loadBehaviorOrb: (behaviorName: string) => OrbitalSchema | null,
): (orbital: OrbitalDefinition, traitRef: string) => Trait | undefined {
  const loaded = new Map<string, OrbitalSchema | null>();
  return (orbital, traitRef) => {
    const [alias, kind, traitName] = traitRef.split('.');
    if (kind !== 'traits' || traitName === undefined) return undefined;
    const use = (orbital.uses ?? []).find((u) => u.as === alias);
    if (use === undefined) return undefined;
    const behavior = use.from.split('/').pop() ?? use.from;
    if (!loaded.has(behavior)) loaded.set(behavior, loadBehaviorOrb(behavior));
    for (const atomOrbital of loaded.get(behavior)?.orbitals ?? []) {
      for (const trait of atomOrbital.traits ?? []) {
        if (typeof trait === 'object' && !('ref' in trait) && trait.name === traitName) return trait;
      }
    }
    return undefined;
  };
}

function renameOrbitalNode(node: JsonValue, from: string, to: string): JsonValue {
  if (Array.isArray(node)) return node.map((item) => renameOrbitalNode(item, from, to));
  if (!isJsonObject(node)) return node;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) out[key] = renameOrbitalNode(value, from, to);
  if (node['kind'] === 'orbital' && node['orbital'] === from) out['orbital'] = to;
  return out;
}

/**
 * `orbitals` with orbital `from` held as `to`: its declaration and every listen sourced from it
 * (`{ kind: 'orbital', orbital, trait }`, the compiler's listen-source rewrite). For an app that
 * holds an organism's orbital under that organism's prefix, applied over the organism's own files.
 */
export function renameOrbital(orbitals: ReadonlyArray<OrbitalDefinition>, from: string, to: string): OrbitalDefinition[] {
  if (from === to) return [...orbitals];
  return orbitals.map((orbital) => {
    const renamed: OrbitalDefinition = JSON.parse(JSON.stringify(renameOrbitalNode(JSON.parse(JSON.stringify(orbital)), from, to)));
    return renamed.name === from ? { ...renamed, name: to } : renamed;
  });
}
