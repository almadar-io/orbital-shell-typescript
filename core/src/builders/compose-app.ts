/**
 * An app composed from its per-orbital files — the rules no single orbital can see, authored
 * or built in isolation: global page routes and inline trait names stay unique
 * (`dedupeComposedSurface`), exactly one `[identity]` entity survives (`dedupeComposedIdentity`,
 * FIX-K/L/N), the organisms' config is unioned (a multi-organism sidebar concatenates, deduped
 * by href) and every `navItems` list is narrowed to pages the app owns. One owner for rabit's
 * composer, the studio's app load and the seeding harnesses (moved from rabit 2026-10-04).
 *
 * App assembly, not the `behavior/compose` operator: `composeBehaviors` itself is unchanged.
 */
import { mergeExpectationShape } from '../expectation-shape.js';
import type { DeclaredTraitConfig, Entity, EntityField, ExpectDeclaration, IdentityLedger, JsonObject, JsonValue, OrbitalDefinition, OrbitalSchema, Trait, TraitConfigValue } from '../types/index.js';
import { entityRenameBlockers, renameEntity, renameEntityInSchema, type EntityRenameBlocker } from './rename-entity.js';
import { isEntityReferenceAny, isJsonObject, isPageReference, isRoutePage, ledgerRename, unionOsGrants } from '../types/index.js';
import { rewriteTraitRefsInTree } from '../factory-runtime/apply-params-to-orb.js';
import { collectOrbitalForwardedConfigKeys, navItemHref, unionOrganismConfigs } from '../embedded-trait-config.js';
import { humanizeKey } from '../factory/questions/generate.js';
import { asDefinitions, composeBehaviors, mergeLedgers, type ComposeBehaviorsResult } from './compose-behaviors.js';
import type { EventWiringEntry } from './event-wiring.js';
import type { LayoutStrategy } from './layout-strategy.js';
import { orbitalRouteSlug } from './route-slug.js';
import { collectOwnedSurface } from './owned-surface.js';
import { collectFieldComparisonLiterals, collectOwnerComparedFields, collectOwnerStampedFields } from './field-comparison-literals.js';

/** One compose-time deterministic rename applied to break a global collision. */
export interface SurfaceRename {
  orbitalName: string;
  from: string;
  to: string;
  /** V4 id of the renamed declaration (traits only), for ledger sync. */
  id?: string;
}

/** One compose-time identity demotion: an entity that lost the `@user` directive. */
export interface IdentityDemotion {
  orbitalName: string;
  entityName: string;
}

/**
 * FIX-K — literals unioned into the winning `[identity]` entity's
 * closed-vocabulary field because a demoted identity's organism baked
 * `*_policy` S-expressions comparing `@user.<field>` against its own role
 * vocabulary (after the demotion every `@user` resolves to the winner, so a
 * literal the winner's field cannot carry is a dead branch —
 * `ORB_S_ROLE_LITERAL_NOT_MEMBER`).
 */
export interface IdentityRoleUnion {
  /** Winning identity's orbital. */
  orbitalName: string;
  /** Winning identity entity that grew the literals. */
  entityName: string;
  field: string;
  addedLiterals: string[];
}

/**
 * FIX-L — a composed-surface `expects identity X` rewritten to
 * `expects entity X` because X lost the `[identity]` tag in this compose
 * (the entity is still provided, so the link-check passes; the compiled
 * path's own `ORB_S_EXPECTATION_PROVIDER_MISMATCH` suggestion is exactly
 * this rewrite).
 */
export interface IdentityExpectsRewrite {
  /** Consumer orbital whose declaration was rewritten. */
  orbitalName: string;
  /** Demoted entity the declaration named. */
  entityName: string;
}

/**
 * FIX-N — a relation field retargeted from a demoted identity to the
 * surviving one because the composed surface compares that field to
 * `@user.id` (an access directive's owner form, or a `persist` payload
 * stamping the viewer's key onto it). Owner-compared fields ONLY — a
 * blanket retarget would corrupt legitimate data relations
 * (`Sprint.members: [TeamMember]`).
 */
export interface IdentityRelationRetarget {
  /** Orbital owning the entity definition that was retargeted. */
  orbitalName: string;
  /** Entity owning the relation field. */
  entityName: string;
  field: string;
  fromEntity: string;
  toEntity: string;
}

export interface IdentityDedupeResult {
  demotions: IdentityDemotion[];
  roleUnions: IdentityRoleUnion[];
  expectsRewrites: IdentityExpectsRewrite[];
  relationsRetargeted: IdentityRelationRetarget[];
}

/** One `navItems` narrowing outcome: entries dropped from a single trait's config. */
export interface NavItemsNarrowResult {
  orbitalName: string;
  traitName: string;
  droppedHrefs: string[];
}

/**
 * Rewrite every intra-orbital reference to inline trait `oldName` → `newName`.
 * Targets are structural (never a broad string replace): the trait definition's
 * own `name`, page trait references (`{ ref: "<name>" }` or a bare string in a
 * `traits[]` array), and `source.trait` on a listens entry. The inline trait's
 * `ref` field points at the std pattern it wraps (a namespaced
 * `Alias.traits.X`), so it never equals the bare inline name and is left
 * untouched.
 */
function rewriteInlineTraitName(node: JsonValue, oldName: string, newName: string): void {
  if (Array.isArray(node)) {
    for (const item of node) rewriteInlineTraitName(item, oldName, newName);
    return;
  }
  if (!isJsonObject(node)) return;
  for (const key of ['name', 'ref', 'trait']) {
    if (node[key] === oldName) node[key] = newName;
  }
  const traits = node['traits'];
  if (Array.isArray(traits)) {
    for (let i = 0; i < traits.length; i += 1) {
      if (traits[i] === oldName) traits[i] = newName;
    }
  }
  for (const value of Object.values(node)) rewriteInlineTraitName(value, oldName, newName);
}

/**
 * Rewrite an orbital's own page route `oldPath` → `newPath`: the inline page's
 * `path` (and any `{ path: "<oldPath>" }` reference override) plus every
 * `["navigate", "<oldPath>"]` effect target inside the same orbital.
 */
function rewriteOwnRoute(node: JsonValue, oldPath: string, newPath: string): void {
  if (Array.isArray(node)) {
    if (node[0] === 'navigate' && node[1] === oldPath) node[1] = newPath;
    for (const item of node) rewriteOwnRoute(item, oldPath, newPath);
    return;
  }
  if (!isJsonObject(node)) return;
  if (node['path'] === oldPath) node['path'] = newPath;
  for (const value of Object.values(node)) rewriteOwnRoute(value, oldPath, newPath);
}

/** Round-trip an orbital def to a mutable JSON tree (JSON.parse returns `any`). */
function cloneOrbitalNode(orbital: OrbitalDefinition): JsonObject {
  return JSON.parse(JSON.stringify(orbital));
}

/** Round-trip a mutated JSON tree back to a typed orbital def. */
function nodeToOrbital(node: JsonObject): OrbitalDefinition {
  return JSON.parse(JSON.stringify(node));
}

/** First unused candidate: `base`, then `base2`, `base3`, … (the seen set decides). */
function firstFreeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** First unused route: `/<slug>`, then `/<slug>-2`, … (the seen set decides). */
function firstFreeRoute(slug: string, taken: ReadonlySet<string>): string {
  const base = `/${slug}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Compose-time backstop for the two global-uniqueness collision classes a
 * per-orbital free-compose subagent cannot see (it authors its `.orb` in
 * isolation): duplicate page routes (`PageDuplicatePath`) and duplicate inline
 * trait names (`ORB_T_DUPLICATE_NAME`). Deterministic, keyed on the composed
 * `orbitals[]` order (`listOrbitals()` is sorted): the FIRST orbital to claim a
 * route/trait name keeps it, later claimants are re-slugged / orbital-prefixed
 * with references rewritten in lockstep — the declaration's own `name`, page
 * trait refs, `source.trait`, AND every `@trait.<old>` token anywhere in the
 * orbital JSON (config values at any depth, state-machine trees — the same
 * coverage as the factory path's `applyDeclarationTraitRenames`, whose
 * exported walker is reused here; FIX-M: a `children` default holding
 * `"@trait.InlineIconRender6"` otherwise dangles with
 * `ORB_BINDING_TRAIT_UNKNOWN` on every recompose). Mutates the passed array
 * in place and returns the applied renames so the caller can emit typed
 * trace events. A clean plan (distinct routes, distinct trait names) is a
 * no-op.
 */
export function dedupeComposedSurface(orbitals: OrbitalDefinition[]): {
  routes: SurfaceRename[];
  traits: SurfaceRename[];
  pageNames: SurfaceRename[];
} {
  const routes: SurfaceRename[] = [];
  const traits: SurfaceRename[] = [];
  const pageNames: SurfaceRename[] = [];
  const seenRoutes = new Set<string>();
  const seenTraits = new Set<string>();
  const seenPageNames = new Set<string>();

  for (let i = 0; i < orbitals.length; i += 1) {
    let node = cloneOrbitalNode(orbitals[i]);
    const orbitalName = typeof node['name'] === 'string' ? node['name'] : `orbital-${i}`;
    let mutated = false;

    // Routes — inline pages own a string `path`; references do not.
    const pages = node['pages'];
    const ownRoutes: string[] = [];
    if (Array.isArray(pages)) {
      for (const p of pages) {
        if (isJsonObject(p) && typeof p['path'] === 'string') ownRoutes.push(p['path']);
      }
    }
    const reservedRoutes = new Set([...seenRoutes, ...ownRoutes]);
    for (const route of ownRoutes) {
      if (!seenRoutes.has(route)) {
        seenRoutes.add(route);
        continue;
      }
      const next = firstFreeRoute(orbitalRouteSlug(orbitalName), reservedRoutes);
      rewriteOwnRoute(node, route, next);
      seenRoutes.add(next);
      reservedRoutes.add(next);
      routes.push({ orbitalName, from: route, to: next });
      mutated = true;
    }

    // Inline page names — the page's own `name` is global too (two organisms both ship "People").
    if (Array.isArray(pages)) {
      const ownPageNames = pages.flatMap((p) => (isJsonObject(p) && typeof p['path'] === 'string' && typeof p['name'] === 'string' ? [p['name']] : []));
      const reservedPageNames = new Set([...seenPageNames, ...ownPageNames]);
      for (const p of pages) {
        if (!isJsonObject(p) || typeof p['path'] !== 'string' || typeof p['name'] !== 'string') continue;
        const pageName = p['name'];
        if (!seenPageNames.has(pageName)) {
          seenPageNames.add(pageName);
          continue;
        }
        const next = firstFreeName(`${orbitalName.replace(/Orbital$/, '')}${pageName}`, reservedPageNames);
        p['name'] = next;
        seenPageNames.add(next);
        reservedPageNames.add(next);
        pageNames.push({ orbitalName, from: pageName, to: next });
        mutated = true;
      }
    }

    // Inline trait names — the `orbital.traits[]` objects with a string `name`.
    const traitDefs = node['traits'];
    const ownTraitNames: string[] = [];
    if (Array.isArray(traitDefs)) {
      for (const t of traitDefs) {
        if (isJsonObject(t) && typeof t['name'] === 'string') ownTraitNames.push(t['name']);
      }
    }
    const prefix = orbitalName.replace(/Orbital$/, '');
    const reservedTraits = new Set([...seenTraits, ...ownTraitNames]);
    const tokenRenames = new Map<string, string>();
    for (const traitName of ownTraitNames) {
      if (!seenTraits.has(traitName)) {
        seenTraits.add(traitName);
        continue;
      }
      const next = firstFreeName(`${prefix}${traitName}`, reservedTraits);
      // Capture the renamed declaration's V4 id BEFORE the rewrite (names are
      // unique within one orbital) so the caller can sync the merged ledger.
      let traitId: string | undefined;
      if (Array.isArray(traitDefs)) {
        for (const t of traitDefs) {
          if (isJsonObject(t) && t['name'] === traitName && typeof t['id'] === 'string') {
            traitId = t['id'];
            break;
          }
        }
      }
      rewriteInlineTraitName(node, traitName, next);
      tokenRenames.set(traitName, next);
      seenTraits.add(next);
      reservedTraits.add(next);
      traits.push({ orbitalName, from: traitName, to: next, ...(traitId !== undefined ? { id: traitId } : {}) });
      mutated = true;
    }

    // `@trait.<old>` tokens (config values, state-machine trees) — the
    // structural rewrite above only covers bare-name positions.
    if (tokenRenames.size > 0) {
      node = rewriteTraitRefsInTree(node, tokenRenames) as JsonObject;
    }

    if (mutated) orbitals[i] = nodeToOrbital(node);
  }

  return { routes, traits, pageNames };
}

/**
 * Compose-time backstop: keep exactly ONE `[identity]` entity in the composed
 * surface. Every organism bakes its own `@user` entity (`OnlineUser`,
 * `TeamMember`, …), so any multi-organism roster collides on
 * `ORB_S_IDENTITY_NOT_UNIQUE` — an error no per-orbital subagent can see and
 * plan-repair could only "fix" by rewriting a sibling's source (battery
 * 2026-08-06 edit-in-complex-app: repair stubbed the 9-trait factory
 * `OnlineUserOrbital` down to 1 trait to strip its identity). Roster order
 * decides the winner (deterministic); losers are demoted in the composed
 * surface only — per-orbital files stay untouched, same contract as
 * `dedupeComposedSurface`.
 *
 * A demotion has two deterministic follow-ons, applied in the same pass:
 *
 * - FIX-K — the loser's organism compares `@user.<field>` against the LOSER's
 *   role vocabulary — in baked `*_policy` S-expressions, and through config
 *   (an atom's `allowedRoles`) where compose cannot see the comparison.
 *   Post-dedupe every `@user` resolves to the winner schema-wide, so the
 *   loser's declared vocabulary and every literal it compares join the
 *   winner's closed vocabulary (the loser's users keep their roles; owner
 *   ruling 2026-10-04).
 *   A literal compared against a field the winner does not declare is a
 *   shape mismatch: compose fails with a deterministic error rather than
 *   silently shipping dead policy branches.
 * A loser is a demoted identity, or an identity an orbital `expects` by name that no orbital
 * provides as identity (composed from another organism): its role vocabulary joins the winner's,
 * and its expectation is rewritten when the app holds it as a plain record.
 *
 * - FIX-L — a composed `expects identity <Loser>` would fail the link-check
 *   (`ORB_S_EXPECTATION_PROVIDER_MISMATCH`) on every recompose; it is
 *   rewritten to `expects entity <Loser>` — the compiled path's own
 *   suggestion — which the still-provided demoted entity satisfies.
 * - FIX-N — relation fields targeting the demoted identity that the composed
 *   surface compares to `@user.id` (owner form in a baked access directive,
 *   or a `persist` payload stamping the viewer's key) fail
 *   `ORB_S_OWNER_FIELD_NOT_IDENTITY_TYPED` once `@user` resolves to the
 *   winner; their `relation.entity` is retargeted to the winner. Owner-
 *   compared fields ONLY — a blanket retarget would corrupt legitimate data
 *   relations (`Sprint.members: [TeamMember]`).
 */
export function dedupeComposedIdentity(orbitals: OrbitalDefinition[]): IdentityDedupeResult {
  const demotions: IdentityDemotion[] = [];
  const demotedEntities: Entity[] = [];
  let winnerIndex = -1;
  for (let i = 0; i < orbitals.length; i += 1) {
    const def = orbitals[i]!;
    const entity = def.entity;
    if (entity === undefined || isEntityReferenceAny(entity)) continue;
    if (entity.identity !== true) continue;
    if (winnerIndex === -1) {
      winnerIndex = i;
      continue;
    }
    const demoted = { ...entity };
    delete demoted.identity;
    orbitals[i] = { ...def, entity: demoted };
    demotions.push({ orbitalName: def.name, entityName: entity.name });
    demotedEntities.push(demoted);
  }
  if (winnerIndex === -1) {
    return { demotions, roleUnions: [], expectsRewrites: [], relationsRetargeted: [] };
  }
  // An orbital composed from another organism expects that organism's identity by name; after
  // compose `@user` is the winner, so a named identity nothing provides as identity is a loser too.
  const winnerName = orbitalEntityName(orbitals[winnerIndex]!);
  if (winnerName === null) throw new Error("identity dedupe requires a named identity entity");
  const demotedNames = new Set(demotions.map((d) => d.entityName));
  const strayExpects: Array<{ name: string; shape: EntityField[] }> = [];
  for (const def of orbitals) {
    for (const e of def.expects ?? []) {
      if (e.kind !== 'identity' || e.name === undefined || e.name === winnerName || demotedNames.has(e.name)) continue;
      strayExpects.push({ name: e.name, shape: e.shape ?? [] });
    }
  }
  if (demotions.length === 0 && strayExpects.length === 0) {
    return { demotions, roleUnions: [], expectsRewrites: [], relationsRetargeted: [] };
  }
  const providedNames = new Set(orbitals.flatMap((def) => inlineEntitiesOf(def).map((e) => e.name)));
  const roleUnions = unionDemotedRoleVocabularies(orbitals, winnerIndex, [
    ...demotedEntities.map((d) => ({ name: d.name, fields: d.fields })),
    ...strayExpects.map((e) => ({ name: e.name, fields: e.shape })),
  ]);
  const loserNames = new Set([
    ...demotedNames,
    ...strayExpects.map((e) => e.name).filter((name) => providedNames.has(name)),
  ]);
  const expectsRewrites = rewriteDemotedIdentityExpects(orbitals, loserNames, winnerName);
  const relationsRetargeted = retargetDemotedOwnerRelations(orbitals, winnerIndex, loserNames);
  return { demotions, roleUnions, expectsRewrites, relationsRetargeted };
}

/** The closed vocabulary of a field — `values`, or the element schema's `values` (mirrors `user_identity.rs`'s `vocabulary`). */
function fieldVocabulary(field: EntityField): readonly string[] | null {
  if ('values' in field && Array.isArray(field.values) && field.values.length > 0) return field.values;
  if ((field.type === 'array' || field.type === 'object') && field.items !== undefined) {
    return fieldVocabulary(field.items);
  }
  return null;
}

function withUnionedVocabulary(field: EntityField, missing: readonly string[]): EntityField {
  if ('values' in field && Array.isArray(field.values) && field.values.length > 0) {
    return { ...field, values: [...field.values, ...missing] };
  }
  if ((field.type === 'array' || field.type === 'object') && field.items !== undefined) {
    return { ...field, items: withUnionedVocabulary(field.items, missing) };
  }
  return field;
}

export interface IdentityVocabularyDelta {
  /** The identity's closed-vocabulary fields, widened — a same-named field delta replaces the canonical one. */
  fields: EntityField[];
  added: Array<{ field: string; literals: string[] }>;
}

/**
 * The literals other orbitals compare `@user.<field>` against that the identity's closed vocabulary
 * lacks, as a field delta the plan applies to the identity line (G-RABIT-036).
 */
export function identityVocabularyDelta(identity: Entity, others: ReadonlyArray<OrbitalDefinition>): IdentityVocabularyDelta {
  const delta: IdentityVocabularyDelta = { fields: [], added: [] };
  for (const field of identity.fields ?? []) {
    if (typeof field.name !== 'string') continue;
    const vocab = fieldVocabulary(field);
    if (vocab === null) continue;
    const referenced = new Set<string>();
    for (const def of others) {
      collectFieldComparisonLiterals(def, { entityName: identity.name, isIdentity: true, scopeEntityName: orbitalEntityName(def), field: field.name }, referenced);
    }
    const missing = [...referenced].filter((l) => !vocab.includes(l)).sort();
    if (missing.length === 0) continue;
    delta.fields.push(withUnionedVocabulary(field, missing));
    delta.added.push({ field: field.name, literals: missing });
  }
  return delta;
}

/**
 * FIX-K — union the role literals a demoted identity's organism hardcoded in
 * its baked policies into the winning identity entity's vocabulary. Field
 * attribution is by NAME: a `@user.<field>` comparison the loser authored
 * against its own `<field>` resolves to the winner's `<field>` after the
 * demotion. Literals referencing a field the winner does not declare cannot
 * be carried over — that shape mismatch is a deterministic compose error.
 */
function unionDemotedRoleVocabularies(
  orbitals: OrbitalDefinition[],
  winnerIndex: number,
  /** Each losing identity's fields: a demoted entity's, or a stray expectation's shape. */
  demotedEntities: ReadonlyArray<{ name: string; fields: ReadonlyArray<EntityField> }>,
): IdentityRoleUnion[] {
  const winnerDef = orbitals[winnerIndex]!;
  const winnerEntity = winnerDef.entity;
  if (winnerEntity === undefined || isEntityReferenceAny(winnerEntity)) return [];
  const winnerFields = winnerEntity.fields;

  const fieldNames = new Set<string>();
  for (const demoted of demotedEntities) {
    for (const f of demoted.fields) {
      if (typeof f.name === 'string') fieldNames.add(f.name);
    }
  }

  const unions: IdentityRoleUnion[] = [];
  const replacements = new Map<string, EntityField>();
  const mismatches: string[] = [];
  for (const fieldName of [...fieldNames].sort()) {
    const referenced = new Set<string>();
    for (const def of orbitals) {
      collectFieldComparisonLiterals(def, {
        entityName: winnerEntity.name,
        isIdentity: true,
        scopeEntityName: orbitalEntityName(def),
        field: fieldName,
      }, referenced);
    }
    const winnerField = winnerFields.find((f) => f.name === fieldName);
    // Literals the demoted organisms compare only through config (an atom's `allowedRoles`) never
    // appear in a comparison here: the demoted identity's declared vocabulary carries them.
    if (winnerField !== undefined && fieldVocabulary(winnerField) !== null) {
      for (const demoted of demotedEntities) {
        const own = demoted.fields.find((f) => f.name === fieldName);
        for (const literal of (own !== undefined ? fieldVocabulary(own) : null) ?? []) referenced.add(literal);
      }
    }
    if (referenced.size === 0) continue;
    if (winnerField === undefined) {
      const sources = demotedEntities
        .filter((d) => d.fields.some((f) => f.name === fieldName))
        .map((d) => d.name);
      mismatches.push(
        `@user.${fieldName} is compared against ${[...referenced].sort().map((l) => JSON.stringify(l)).join(', ')} ` +
        `(field declared by demoted ${sources.join(', ')}), but the surviving [identity] entity ` +
        `${winnerEntity.name} declares no field "${fieldName}"`,
      );
      continue;
    }
    const vocab = fieldVocabulary(winnerField);
    if (vocab === null) continue;
    const missing = [...referenced].filter((l) => !vocab.includes(l)).sort();
    if (missing.length === 0) continue;
    replacements.set(fieldName, withUnionedVocabulary(winnerField, missing));
    unions.push({
      orbitalName: winnerDef.name,
      entityName: winnerEntity.name,
      field: fieldName,
      addedLiterals: missing,
    });
  }

  if (mismatches.length > 0) {
    throw new Error(
      `identity dedupe shape mismatch — ${mismatches.join('; ')}. The identity shapes cannot be ` +
      'reconciled deterministically and silently dropping the literals ships dead policy branches ' +
      '(ORB_S_ROLE_LITERAL_NOT_MEMBER); compose cannot proceed.',
    );
  }

  if (replacements.size > 0) {
    orbitals[winnerIndex] = {
      ...winnerDef,
      entity: {
        ...winnerEntity,
        fields: winnerFields.map((f) => (typeof f.name === 'string' ? replacements.get(f.name) ?? f : f)),
      },
    };
  }
  return unions;
}

/**
 * The payload fields `node`'s `persist create|update <entityName> {…}` effects write (a trailing
 * object carrying `emit` is the resolver's options bag, not data — the persist.rs convention).
 */
function collectPersistedFields(node: unknown, entityName: string, out: Set<string>): void {
  if (Array.isArray(node)) {
    if (node[0] === 'persist' && (node[1] === 'create' || node[1] === 'upsert' || node[1] === 'update') && node[2] === entityName) {
      const payload: unknown = node[3];
      const isOptionsBag = node.length === 4 && payload !== null && typeof payload === 'object' && !Array.isArray(payload) && 'emit' in payload;
      if (payload !== null && typeof payload === 'object' && !Array.isArray(payload) && !isOptionsBag) {
        for (const key of Object.keys(payload)) out.add(key);
      }
    }
    for (const item of node) collectPersistedFields(item, entityName, out);
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node)) collectPersistedFields(value, entityName, out);
  }
}

/**
 * FIX-L — rewrite composed-surface `expects identity <demoted>` → `expects entity <demoted>`.
 * An identity shape described `@user`, not the record; as an entity shape each field it names is
 * carried as the entity declares it, and each field the orbital persists to the entity joins it.
 */
function rewriteDemotedIdentityExpects(
  orbitals: OrbitalDefinition[],
  demotedNames: ReadonlySet<string>,
  winnerName: string,
): IdentityExpectsRewrite[] {
  const entityByName = new Map<string, Entity>();
  for (const def of orbitals) for (const entity of inlineEntitiesOf(def)) entityByName.set(entity.name, entity);
  const rewrites: IdentityExpectsRewrite[] = [];
  for (let i = 0; i < orbitals.length; i += 1) {
    const def = orbitals[i]!;
    const expects = def.expects;
    if (expects === undefined) continue;
    let mutated = false;
    let viewerShape: EntityField[] | undefined;
    const next: ExpectDeclaration[] = expects.map((e): ExpectDeclaration => {
      if (e.kind !== 'identity' || e.name === undefined || !demotedNames.has(e.name)) return e;
      viewerShape = mergeExpectationShape(viewerShape, e.shape);
      mutated = true;
      rewrites.push({ orbitalName: def.name, entityName: e.name });
      if (e.shape === undefined) return { kind: 'entity', name: e.name };
      const persisted = new Set<string>();
      collectPersistedFields(def.traits ?? [], e.name, persisted);
      const declared = new Set(e.shape.map((f) => f.name));
      const entity = entityByName.get(e.name);
      const asDeclared = (field: EntityField): EntityField => entity?.fields.find((f) => f.name === field.name) ?? field;
      const added = [...persisted].sort().flatMap((field) => {
        if (declared.has(field)) return [];
        const own = entity?.fields.find((f) => f.name === field);
        return own !== undefined ? [own] : [];
      });
      return { kind: 'entity', name: e.name, shape: [...e.shape.map(asDeclared), ...added] };
    });
    if (mutated) {
      const viewerIndex = next.findIndex(e => e.kind === 'identity' && (e.name === winnerName || e.name === undefined));
      const viewer = next[viewerIndex];
      const shape = mergeExpectationShape(viewer?.kind === 'identity' ? viewer.shape : undefined, viewerShape);
      const requirement: ExpectDeclaration = { kind: 'identity', name: winnerName, ...(shape !== undefined ? { shape } : {}) };
      if (viewerIndex < 0) next.push(requirement);
      else next[viewerIndex] = requirement;
      orbitals[i] = { ...def, expects: next };
    }
  }
  return rewrites;
}

/** The inline entities an orbital owns (primary + auxiliary). */
function inlineEntitiesOf(def: OrbitalDefinition): Entity[] {
  const out: Entity[] = [];
  if (def.entity !== undefined && !isEntityReferenceAny(def.entity)) out.push(def.entity);
  for (const er of def.auxiliaryEntities ?? []) {
    if (!isEntityReferenceAny(er)) out.push(er);
  }
  return out;
}

function retargetOwnerRelationFields(
  entity: Entity,
  fieldNames: ReadonlySet<string> | undefined,
  demotedNames: ReadonlySet<string>,
  winner: Entity,
): { entity: Entity; applied: Array<{ field: string; fromEntity: string; toEntity: string }> } | null {
  if (fieldNames === undefined) return null;
  const applied: Array<{ field: string; fromEntity: string; toEntity: string }> = [];
  const fields = entity.fields.map((f) => {
    if (f.name === undefined || !fieldNames.has(f.name) || f.type !== 'relation') return f;
    if (!demotedNames.has(f.relation.entity)) return f;
    applied.push({ field: f.name, fromEntity: f.relation.entity, toEntity: winner.name });
    const relation = { ...f.relation, entity: winner.name };
    if (relation.entityId !== undefined) {
      if (winner.id !== undefined) relation.entityId = winner.id;
      else delete relation.entityId;
    }
    return { ...f, relation };
  });
  return applied.length === 0 ? null : { entity: { ...entity, fields }, applied };
}

/**
 * FIX-N — retarget owner-compared relation fields off a demoted identity
 * onto the winner. A field qualifies ONLY when the composed surface compares
 * it to `@user.id`: the `=`/`==` owner form in the entity's own baked access
 * directives (any `or`/`and` nesting), or a `persist` create/update payload
 * stamping `"<F>": "@user.id"` onto the named entity. Anything else
 * targeting the demoted entity (e.g. `Sprint.members: [TeamMember]`) is a
 * legitimate data relation and stays pointed at it.
 */
function retargetDemotedOwnerRelations(
  orbitals: OrbitalDefinition[],
  winnerIndex: number,
  demotedNames: ReadonlySet<string>,
): IdentityRelationRetarget[] {
  const winnerDef = orbitals[winnerIndex]!;
  const winnerEntity = winnerDef.entity;
  if (winnerEntity === undefined || isEntityReferenceAny(winnerEntity)) return [];

  const candidates = new Map<string, Set<string>>();
  const addAll = (entityName: string, fields: ReadonlySet<string>) => {
    if (fields.size === 0) return;
    const set = candidates.get(entityName) ?? new Set<string>();
    for (const f of fields) set.add(f);
    candidates.set(entityName, set);
  };
  for (const def of orbitals) {
    for (const entity of inlineEntitiesOf(def)) {
      const fields = new Set<string>();
      for (const policy of [entity.read_policy, entity.create_policy, entity.update_policy, entity.delete_policy]) {
        if (policy !== undefined) collectOwnerComparedFields(policy, fields);
      }
      addAll(entity.name, fields);
    }
    const stamped = new Map<string, Set<string>>();
    collectOwnerStampedFields(def.traits ?? [], stamped);
    for (const [entityName, fields] of stamped) addAll(entityName, fields);
  }

  const retargets: IdentityRelationRetarget[] = [];
  for (let i = 0; i < orbitals.length; i += 1) {
    const def = orbitals[i]!;
    let next = def;
    if (next.entity !== undefined && !isEntityReferenceAny(next.entity)) {
      const replaced = retargetOwnerRelationFields(next.entity, candidates.get(next.entity.name), demotedNames, winnerEntity);
      if (replaced !== null) {
        next = { ...next, entity: replaced.entity };
        for (const a of replaced.applied) retargets.push({ orbitalName: def.name, entityName: replaced.entity.name, ...a });
      }
    }
    const aux = next.auxiliaryEntities;
    if (aux !== undefined) {
      let auxNext = aux;
      for (let j = 0; j < aux.length; j += 1) {
        const er = aux[j]!;
        if (isEntityReferenceAny(er)) continue;
        const replaced = retargetOwnerRelationFields(er, candidates.get(er.name), demotedNames, winnerEntity);
        if (replaced === null) continue;
        if (auxNext === aux) auxNext = [...aux];
        auxNext[j] = replaced.entity;
        for (const a of replaced.applied) retargets.push({ orbitalName: def.name, entityName: replaced.entity.name, ...a });
      }
      if (auxNext !== aux) next = { ...next, auxiliaryEntities: auxNext };
    }
    if (next !== def) orbitals[i] = next;
  }
  return retargets;
}

/**
 * Narrow `OrbitalDefinition['entity']` to the object form carrying
 * `name` + `fields` — same accessor shape as `per-orbital-build.ts`'s
 * `asEntityObject`; the bare string-ref form declares no fields.
 */
export function asEntityObject(
  entity: OrbitalDefinition['entity'],
): { name?: string; fields?: ReadonlyArray<EntityField> } | null {
  if (entity === undefined || entity === null || typeof entity === 'string') return null;
  return entity;
}

/** The entity an orbital DECLARES (object form only — a bare string ref owns nothing here). */
export function orbitalEntityName(def: OrbitalDefinition): string | null {
  const name = asEntityObject(def.entity)?.name;
  return typeof name === 'string' ? name : null;
}

/**
 * Structural check for a declared `[NavItem]` config field — the ONE knob
 * type in the whole library (`std-app-layout.lolo`'s `navItems`), matched by
 * its compiler-assigned type tag rather than by field name so the check stays
 * correct if a second `[NavItem]`-typed knob is ever declared elsewhere. A
 * `default` of `"@pages"` (the atom's own host-orbital-scoped binding, see
 * `orbital-compiler/phases/resolve.rs`) is a string, not an array, and is
 * left untouched here — only a literal call-site override array is narrowed.
 */
function isNavItemsConfigField(entry: JsonValue): entry is JsonObject & { default: JsonValue[] } {
  return isJsonObject(entry) && entry['type'] === '[NavItem]' && Array.isArray(entry['default']);
}

/**
 * S14 — narrow every surviving orbital's literal `navItems` override to
 * hrefs owned by an orbital IN THIS composed surface. A partial roster
 * (Rabit decomposes an organism to a subset by design) otherwise ships the
 * organism's full sidebar, including dead links to pages no orbital in this
 * build produced. `ownedPages` is derived from the SAME `collectOwnedSurface`
 * walk the delete-turn cleanup uses (`orbitals/coordinator/loop.ts`) — one
 * page↔orbital ownership source, not a second text-matching walker. An entry
 * whose `href` cannot be read at all is kept, never guessed away.
 */
function narrowNavItemsToOwnedPages(orbitals: OrbitalDefinition[], ownedPages: ReadonlySet<string>): NavItemsNarrowResult[] {

  const drops: NavItemsNarrowResult[] = [];
  for (let i = 0; i < orbitals.length; i += 1) {
    const node = cloneOrbitalNode(orbitals[i]);
    const orbitalName = typeof node['name'] === 'string' ? node['name'] : `orbital-${i}`;
    const traitDefs = node['traits'];
    if (!Array.isArray(traitDefs)) continue;
    let mutated = false;

    for (const t of traitDefs) {
      if (!isJsonObject(t)) continue;
      const config = t['config'];
      if (!isJsonObject(config)) continue;
      const traitName = typeof t['name'] === 'string' ? t['name'] : typeof t['ref'] === 'string' ? t['ref'] : 'trait';

      for (const [key, entry] of Object.entries(config)) {
        if (!isNavItemsConfigField(entry)) continue;
        const kept: JsonValue[] = [];
        const droppedHrefs: string[] = [];
        for (const item of entry.default) {
          const href = isJsonObject(item) && typeof item['href'] === 'string' ? item['href'] : undefined;
          if (href !== undefined && !ownedPages.has(href)) {
            droppedHrefs.push(href);
          } else {
            kept.push(item);
          }
        }
        if (droppedHrefs.length > 0) {
          config[key] = { ...entry, default: kept };
          mutated = true;
          drops.push({ orbitalName, traitName, droppedHrefs });
        }
      }
    }

    if (mutated) orbitals[i] = nodeToOrbital(node);
  }

  return drops;
}

/**
 * Every page path the surface owns: each orbital's own pages, and for an orbital IMPORT (pages
 * empty until `orb resolve` expands it) its source orbital's pages through the import's `pages`
 * remap (G-CORE-017).
 */
function collectOwnedPages(
  orbitals: ReadonlyArray<OrbitalDefinition>,
  importedOrbitalOf: ((orbital: OrbitalDefinition) => OrbitalDefinition | undefined) | undefined,
): Set<string> {
  const owned = new Set<string>();
  const traitNames = new Set<string>();
  for (const orbital of orbitals) {
    collectOwnedSurface(cloneOrbitalNode(orbital), owned, traitNames);
    if (importedOrbitalOf === undefined) continue;
    for (const path of importedPagePaths(orbital, importedOrbitalOf, new Set())) owned.add(path);
  }
  return owned;
}

/** The local page paths an orbital import owns: its upstream's pages (through nested imports), minus `omit`, remapped. */
function importedPagePaths(
  orbital: OrbitalDefinition,
  importedOrbitalOf: (orbital: OrbitalDefinition) => OrbitalDefinition | undefined,
  seen: Set<OrbitalDefinition>,
): string[] {
  const reference = orbital.reference;
  if (reference === undefined || seen.has(orbital)) return [];
  seen.add(orbital);
  const upstream = importedOrbitalOf(orbital);
  if (upstream === undefined) return [];
  const upstreamPaths: string[] = [];
  for (const page of upstream.pages ?? []) {
    if (!isPageReference(page) && isRoutePage(page) && typeof page.path === 'string') upstreamPaths.push(page.path);
  }
  upstreamPaths.push(...importedPagePaths(upstream, importedOrbitalOf, seen));
  const omitted = new Set(reference.omit ?? []);
  const remap = reference.pages ?? {};
  return upstreamPaths.filter((path) => !omitted.has(path)).map((path) => remap[path] ?? path);
}

/**
 * `organismOrderOf` for a registry: an orbital's position among its organism's declared orbitals,
 * by the catalog orbital it was built from (`catalogOrbitalOf`, rename-stable). Each organism is
 * loaded once.
 */
export function organismOrderResolver(
  catalogOrbitalOf: (orbitalName: string) => { organism: string; orbital: string } | undefined,
  loadOrganism: (organism: string) => OrbitalSchema | null,
): (orbitalName: string) => number | undefined {
  const declared = new Map<string, string[] | null>();
  return (orbitalName) => {
    const source = catalogOrbitalOf(orbitalName);
    if (source === undefined) return undefined;
    if (!declared.has(source.organism)) {
      declared.set(source.organism, loadOrganism(source.organism)?.orbitals.map((o) => o.name) ?? null);
    }
    const index = declared.get(source.organism)?.indexOf(source.orbital) ?? -1;
    return index >= 0 ? index : undefined;
  };
}

/**
 * `importedOrbitalOf` for a registry: an import's `reference.ref` (`Alias.orbitals.Name`)
 * resolved through the orbital's `uses` to the behavior it imports, then to that behavior's
 * orbital `Name`. `loadBehaviorOrb` is the caller's registry; each behavior is loaded once.
 */
export function orbitalImportResolver(
  loadBehaviorOrb: (behaviorName: string) => OrbitalSchema | null,
): (orbital: OrbitalDefinition) => OrbitalDefinition | undefined {
  const loaded = new Map<string, OrbitalSchema | null>();
  return (orbital) => {
    const ref = orbital.reference?.ref;
    if (ref === undefined) return undefined;
    const [alias, kind, name] = ref.split('.');
    if (kind !== 'orbitals' || name === undefined) return undefined;
    const use = (orbital.uses ?? []).find((u) => u.as === alias);
    if (use === undefined) return undefined;
    const behavior = use.from.split('/').pop() ?? use.from;
    if (!loaded.has(behavior)) loaded.set(behavior, loadBehaviorOrb(behavior));
    return loaded.get(behavior)?.orbitals.find((o) => o.name === name);
  };
}

/** A `[NavItem]` list dropped entries from the organisms' unioned config (`config.<knob>`). */
export interface ConfigNavItemsNarrowResult {
  knob: string;
  droppedHrefs: string[];
}

/** The unioned organism config with every `[NavItem]` list narrowed to `ownedPages`. */
function narrowConfigNavItems(
  config: DeclaredTraitConfig,
  ownedPages: ReadonlySet<string>,
): { config: DeclaredTraitConfig; drops: ConfigNavItemsNarrowResult[] } {
  const drops: ConfigNavItemsNarrowResult[] = [];
  const next: Record<string, DeclaredTraitConfig[string]> = { ...config };
  for (const [knob, field] of Object.entries(config)) {
    if (field.type !== '[NavItem]' || !Array.isArray(field.default)) continue;
    const droppedHrefs: string[] = [];
    const kept = field.default.filter((item) => {
      const href = navItemHref(item);
      if (href !== undefined && !ownedPages.has(href)) {
        droppedHrefs.push(href);
        return false;
      }
      return true;
    });
    if (droppedHrefs.length === 0) continue;
    next[knob] = { ...field, default: kept };
    drops.push({ knob, droppedHrefs });
  }
  return { config: next, drops };
}

/** An organism's landing page given a nav entry because it no longer boots the app. */
export interface LandingNavResult {
  organism: string;
  href: string;
}

/** Every page path the app links: `href` strings and `navigate` targets anywhere in `node`. */
function collectLinkedPaths(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    if (node[0] === 'navigate' && typeof node[1] === 'string') out.add(node[1]);
    for (const item of node) collectLinkedPaths(item, out);
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'href' && typeof value === 'string') out.add(value);
      collectLinkedPaths(value, out);
    }
  }
}

/** An orbital's first inline page (a reference names no path of its own). */
function firstInlinePage(orbital: OrbitalDefinition): { name: string; path: string } | undefined {
  for (const page of orbital.pages ?? []) {
    if (isPageReference(page) || !isRoutePage(page)) continue;
    if (typeof page.path === 'string' && typeof page.name === 'string') return { name: page.name, path: page.path };
  }
  return undefined;
}

/**
 * Inside its organism an organism's first page boots the app, reachable by construction; composed
 * behind another organism it boots nothing. Each such landing page nothing links joins the app's
 * one `[NavItem]` list, labelled by its declared page name as words (owner ruling 2026-10-04). An organism
 * whose files declare no nav of its own (free-composed lines, a reused atom) links none of its
 * orbitals, so each of them is one. Entries keep roster order. Parameterized pages are reached
 * through their list pages and never listed.
 */
function linkLandingPages(
  orbitals: ReadonlyArray<OrbitalDefinition>,
  config: DeclaredTraitConfig,
  organismOf: (orbitalName: string) => string | undefined,
  /** Orbitals whose own file declares a `[NavItem]` list — their organism links its other orbitals itself. */
  navDeclaringOrbitals: ReadonlySet<string>,
  /** An orbital's position in its organism's declared orbitals; absent, composed order stands in. */
  organismOrderOf?: (orbitalName: string) => number | undefined,
): { config: DeclaredTraitConfig; added: LandingNavResult[] } {
  const navKnobs = Object.entries(config).filter(([, field]) => field.type === '[NavItem]' && Array.isArray(field.default));
  if (navKnobs.length !== 1) return { config, added: [] };
  const [knob, field] = navKnobs[0]!;
  const list = Array.isArray(field.default) ? field.default : [];
  const linked = new Set<string>();
  collectLinkedPaths(orbitals, linked);
  collectLinkedPaths(config, linked);

  // Each entry sits in roster order: after every entry owned by an earlier orbital.
  const ownerIndex = new Map<string, number>();
  orbitals.forEach((orbital, i) => {
    for (const page of orbital.pages ?? []) {
      if (!isPageReference(page) && isRoutePage(page) && typeof page.path === 'string' && !ownerIndex.has(page.path)) ownerIndex.set(page.path, i);
    }
  });
  const indexOf = (entry: TraitConfigValue): number => {
    const href = navItemHref(entry);
    return href !== undefined ? (ownerIndex.get(href) ?? -1) : -1;
  };

  const added: LandingNavResult[] = [];
  const next: TraitConfigValue[] = [...list];
  const navOrganisms = new Set<string>();
  for (const name of navDeclaringOrbitals) {
    const organism = organismOf(name);
    if (organism !== undefined) navOrganisms.add(organism);
  }
  // Each organism's landing: its taken orbital declared first in the organism.
  const landingOf = new Map<string, { name: string; rank: number }>();
  orbitals.forEach((orbital, i) => {
    const organism = organismOf(orbital.name);
    if (organism === undefined || firstInlinePage(orbital) === undefined) return;
    const rank = organismOrderOf?.(orbital.name) ?? orbitals.length + i;
    const current = landingOf.get(organism);
    if (current === undefined || rank < current.rank) landingOf.set(organism, { name: orbital.name, rank });
  });
  let bootOrganism: string | undefined;
  let booted = false;
  orbitals.forEach((orbital, i) => {
    const page = firstInlinePage(orbital);
    if (page === undefined) return;
    const organism = organismOf(orbital.name);
    if (!booted) {
      booted = true;
      bootOrganism = organism;
      return;
    }
    if (organism === undefined) return;
    if (navOrganisms.has(organism) && (organism === bootOrganism || landingOf.get(organism)?.name !== orbital.name)) return;
    if (linked.has(page.path) || page.path.split('/').some((segment) => segment.startsWith(':'))) return;
    let at = 0;
    next.forEach((entry, p) => {
      if (indexOf(entry) < i) at = p + 1;
    });
    next.splice(at, 0, { href: page.path, label: humanizeKey(page.name) });
    linked.add(page.path);
    added.push({ organism, href: page.path });
  });
  if (added.length === 0) return { config, added };
  return { config: { ...config, [knob]: { ...field, default: next } }, added };
}

/** The app surface composed from its files: deduped orbitals, unioned config and ledger. */
export interface ComposedSurface {
  orbitals: OrbitalDefinition[];
  config?: DeclaredTraitConfig;
  ledger?: IdentityLedger;
  surfaceRenames: { routes: SurfaceRename[]; traits: SurfaceRename[]; pageNames: SurfaceRename[] };
  identity: IdentityDedupeResult;
  navItemsNarrowed: NavItemsNarrowResult[];
  configNavItemsNarrowed: ConfigNavItemsNarrowResult[];
  landingNavAdded: LandingNavResult[];
  organismRenames: OrganismRename[];
  unrenamableCollisions: UnrenamableCollision[];
}

/**
 * The app's surface from its per-orbital files, in the files' order (roster order decides every
 * collision): routes and inline trait names deduped, one `[identity]`, the organisms' config and
 * ledgers unioned (ledger rows follow the trait renames), every `navItems` list narrowed to pages
 * the app owns. No pages or layout are generated. The caller's files are not mutated.
 */
/** The names a later organism took under its prefix because an earlier one owned them. */
export interface OrganismRename {
  organism: string;
  entities: Array<{ from: string; to: string }>;
  collections: Array<{ from: string; to: string }>;
  /** Route roots moved under the organism's own path (`/projects` → `/project-manager/projects`). */
  routes: Array<{ from: string; to: string }>;
}

/** A colliding entity an atom's fixed binding pins: it keeps its name, and the collision stands. */
export interface UnrenamableCollision {
  organism: string;
  entity: string;
  blockers: EntityRenameBlocker[];
}

/** `std-hr-portal` → `HrPortal` (the organism's entity prefix). */
function organismPrefix(organism: string): string {
  return organism.replace(/^std-/, '').split(/[^a-zA-Z0-9]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
}

/** `HrPortal` → `hr_portal` (the organism's collection prefix). */
function snakePrefix(prefix: string): string {
  return prefix.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** A route with its parameters normalized (`/projects/:id` and `/projects/:slug` are one route). */
function routeShape(path: string): string {
  return path.split('/').map((segment) => (segment.startsWith(':') ? ':' : segment)).join('/');
}

/** A route's first segment (`/projects/:id` → `/projects`). */
function routeRoot(path: string): string {
  return `/${path.split('/')[1] ?? ''}`;
}

function underRoot(link: string, root: string): boolean {
  return link === root || link.startsWith(`${root}/`);
}

/** The inline page paths of a file's orbitals. */
function pagePaths(file: OrbitalDefinition | OrbitalSchema): string[] {
  return asDefinitions([file]).flatMap((orbital) => (orbital.pages ?? []).flatMap((page) => (!isPageReference(page) && typeof page.path === 'string' ? [page.path] : [])));
}

/** `node` with page paths and links under any of `roots` moved under `base` (segments and parameters kept). */
function moveRoutes(node: JsonValue, roots: ReadonlySet<string>, base: string, inPages = false): JsonValue {
  const move = (path: string): string => (path === '/' ? base : `${base}${path}`);
  const hit = (value: string): boolean => [...roots].some((root) => underRoot(value, root));
  if (Array.isArray(node)) {
    const out = node.map((item) => moveRoutes(item, roots, base, inPages));
    if (node[0] === 'navigate' && typeof node[1] === 'string' && hit(node[1])) out[1] = move(node[1]);
    return out;
  }
  if (!isJsonObject(node)) return node;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && ((key === 'href') || (inPages && key === 'path')) && hit(value)) out[key] = move(value);
    else out[key] = moveRoutes(value, roots, base, key === 'pages');
  }
  return out;
}

/** The inline entity declarations of a file's orbitals (primary and auxiliary). */
function declaredEntities(file: OrbitalDefinition | OrbitalSchema): Entity[] {
  return asDefinitions([file]).flatMap((orbital) => inlineEntitiesOf(orbital));
}

function renameCollection(file: OrbitalDefinition | OrbitalSchema, from: string, to: string): OrbitalDefinition | OrbitalSchema {
  const swap = (entity: Entity): Entity => (entity.collection === from ? { ...entity, collection: to } : entity);
  const each = (orbital: OrbitalDefinition): OrbitalDefinition => ({
    ...orbital,
    ...(orbital.entity !== undefined && !isEntityReferenceAny(orbital.entity) ? { entity: swap(orbital.entity) } : {}),
    ...(orbital.auxiliaryEntities !== undefined ? { auxiliaryEntities: orbital.auxiliaryEntities.map((e) => (isEntityReferenceAny(e) ? e : swap(e))) } : {}),
  });
  return 'orbitals' in file ? { ...file, orbitals: file.orbitals.map(each) } : each(file);
}

/**
 * Organisms are namespaces (owner design 2026-10-04): each stays self-consistent, so a later
 * organism (roster order) whose entity name or explicit collection an earlier organism already
 * owns takes it under its own prefix (`Staff` → `HrPortalStaff`, `staff` → `hr_portal_staff`),
 * every reference in its own files rewritten (`renameEntity`; organisms never reference each
 * other's entities). An entity an atom's fixed binding pins keeps its name and is reported.
 */
function namespaceOrganisms(
  files: ReadonlyArray<OrbitalDefinition | OrbitalSchema>,
  organismOf: (orbitalName: string) => string | undefined,
  atomTraitOf: (orbital: OrbitalDefinition, traitRef: string) => Trait | undefined,
): { files: Array<OrbitalDefinition | OrbitalSchema>; renames: OrganismRename[]; unrenamable: UnrenamableCollision[] } {
  const organismOfFile = (file: OrbitalDefinition | OrbitalSchema): string | undefined => {
    const first = asDefinitions([file])[0];
    return first !== undefined ? organismOf(first.name) : undefined;
  };
  const out = [...files];
  const order: string[] = [];
  for (const file of files) {
    const organism = organismOfFile(file);
    if (organism !== undefined && !order.includes(organism)) order.push(organism);
  }
  const entityOwner = new Map<string, string>();
  const collectionOwner = new Map<string, string>();
  const routeOwner = new Map<string, string>();
  const renames: OrganismRename[] = [];
  const unrenamable: UnrenamableCollision[] = [];

  // A reference with no `linkedEntity` brings its atom's own entity, materialized at resolve. That
  // name cannot move (nothing declares it), so a declared entity of another organism yields to it.
  // Two organisms bringing it implicitly share one entity only when it materializes identically —
  // the same atom trait with the same type arguments; otherwise the collision is pinned.
  const implicitOwner = new Map<string, string>();
  const implicitKey = new Map<string, string>();
  for (const organism of order) {
    const own = files.filter((file) => organismOfFile(file) === organism);
    const declared = new Set(own.flatMap((file) => declaredEntities(file).map((e) => e.name)));
    const conflicts = new Map<string, EntityRenameBlocker[]>();
    for (const orbital of asDefinitions([...own])) {
      const node = cloneOrbitalNode(orbital);
      const traits = Array.isArray(node['traits']) ? node['traits'] : [];
      for (const trait of traits) {
        if (!isJsonObject(trait) || typeof trait['ref'] !== 'string' || trait['linkedEntity'] !== undefined) continue;
        const ref = trait['ref'];
        const implicit = atomTraitOf(orbital, ref)?.linkedEntity;
        if (implicit === undefined || declared.has(implicit)) continue;
        const alias = ref.split('.')[0];
        const behavior = (orbital.uses ?? []).find((u) => u.as === alias)?.from ?? alias;
        const typeArgs = isJsonObject(trait['typeArgs']) ? Object.entries(trait['typeArgs']).sort(([a], [b]) => a.localeCompare(b)) : [];
        const key = JSON.stringify([behavior, ref.split('.').slice(1), typeArgs]);
        const owner = implicitOwner.get(implicit);
        if (owner === undefined) {
          implicitOwner.set(implicit, organism);
          implicitKey.set(implicit, key);
        } else if (owner !== organism && implicitKey.get(implicit) !== key) {
          const blockers = conflicts.get(implicit) ?? [];
          blockers.push({ orbitalName: orbital.name, traitName: typeof trait['name'] === 'string' ? trait['name'] : ref, traitRef: ref });
          conflicts.set(implicit, blockers);
        }
      }
    }
    for (const [entity, blockers] of conflicts) unrenamable.push({ organism, entity, blockers });
  }

  for (const organism of order) {
    const indices = out.flatMap((file, i) => (organismOfFile(file) === organism ? [i] : []));
    const orbitalsOf = (): OrbitalDefinition[] => indices.flatMap((i) => asDefinitions([out[i]!]));
    const prefix = organismPrefix(organism);
    const rename: OrganismRename = { organism, entities: [], collections: [], routes: [] };

    const names = [...new Set(indices.flatMap((i) => declaredEntities(out[i]!).map((e) => e.name)))];
    for (const name of names) {
      const owner = entityOwner.get(name);
      const implicit = implicitOwner.get(name);
      const collides = (owner !== undefined && owner !== organism) || (implicit !== undefined && implicit !== organism);
      if (!collides) continue;
      const blockers = entityRenameBlockers(orbitalsOf(), name, atomTraitOf);
      if (blockers.length > 0) {
        unrenamable.push({ organism, entity: name, blockers });
        continue;
      }
      const to = `${prefix}${name}`;
      for (const i of indices) {
        const file = out[i]!;
        out[i] = 'orbitals' in file ? renameEntityInSchema(file, name, to, { atomTraitOf }) : renameEntity([file], name, to, { atomTraitOf })[0]!;
      }
      rename.entities.push({ from: name, to });
    }

    // Routes: a page an earlier organism already serves moves, with its whole subtree, under this
    // organism's own path; parameters and the organism's links (dynamic ones included) follow.
    const roots = new Set(indices.flatMap((i) => pagePaths(out[i]!)).filter((path) => {
      const owner = routeOwner.get(routeShape(path));
      return owner !== undefined && owner !== organism;
    }).map(routeRoot));
    if (roots.size > 0) {
      const base = `/${organism.replace(/^std-/, '')}`;
      for (const i of indices) {
        const file = out[i]!;
        const moved: JsonValue = moveRoutes(JSON.parse(JSON.stringify(file)), roots, base);
        if (isJsonObject(moved)) out[i] = JSON.parse(JSON.stringify(moved));
      }
      rename.routes.push(...[...roots].map((root) => ({ from: root, to: `${base}${root === '/' ? '' : root}` })));
    }

    const collections = [...new Set(indices.flatMap((i) => declaredEntities(out[i]!).flatMap((e) => (e.collection !== undefined ? [e.collection] : []))))];
    for (const collection of collections) {
      const owner = collectionOwner.get(collection);
      if (owner === undefined || owner === organism) continue;
      const to = `${snakePrefix(prefix)}_${collection}`;
      for (const i of indices) out[i] = renameCollection(out[i]!, collection, to);
      rename.collections.push({ from: collection, to });
    }

    for (const i of indices) {
      for (const path of pagePaths(out[i]!)) if (!routeOwner.has(routeShape(path))) routeOwner.set(routeShape(path), organism);
      for (const entity of declaredEntities(out[i]!)) {
        if (!entityOwner.has(entity.name)) entityOwner.set(entity.name, organism);
        if (entity.collection !== undefined && !collectionOwner.has(entity.collection)) collectionOwner.set(entity.collection, organism);
      }
    }
    if (rename.entities.length > 0 || rename.collections.length > 0 || rename.routes.length > 0) renames.push(rename);
  }
  return { files: out, renames, unrenamable };
}

export interface ComposeSurfaceOptions {
  /**
   * The organism an orbital came from (its spec's `organism`). A page route renamed on compose is
   * then renamed in the nav of every file of that organism; without it, only the renamed orbital's
   * own file follows.
   */
  organismOf?: (orbitalName: string) => string | undefined;
  /**
   * An orbital's position in its organism's declared orbitals. The first declared orbital boots
   * the organism standalone, so composed behind another organism it is the landing page the nav
   * must link; without it, the first composed orbital of the organism stands in.
   */
  organismOrderOf?: (orbitalName: string) => number | undefined;
  /** The atom's declaration of a referenced trait (see `RenameEntityOptions.atomTraitOf`); namespacing reads it. */
  atomTraitOf?: (orbital: OrbitalDefinition, traitRef: string) => Trait | undefined;
  /** An orbital import's source orbital (`orbitalImportResolver`); its pages count as owned when nav is narrowed. */
  importedOrbitalOf?: (orbital: OrbitalDefinition) => OrbitalDefinition | undefined;
}

/** `[NavItem]` lists in `config` with every `from` href rewritten to `to`; the same object when none matched. */
function renameNavHrefs(config: DeclaredTraitConfig, from: string, to: string): DeclaredTraitConfig {
  let next: Record<string, DeclaredTraitConfig[string]> | undefined;
  for (const [knob, field] of Object.entries(config)) {
    if (field.type !== '[NavItem]' || !Array.isArray(field.default)) continue;
    if (!field.default.some((item) => navItemHref(item) === from)) continue;
    next ??= { ...config };
    next[knob] = { ...field, default: field.default.map((item) => (navItemHref(item) === from && isJsonObject(item) ? { ...item, href: to } : item)) };
  }
  return next ?? config;
}

/** `node` with listens sourced from `orbital`'s trait `from` re-sourced to `to`. */
function renameListenSources(node: JsonValue, orbital: string, from: string, to: string): JsonValue {
  if (Array.isArray(node)) return node.map((item) => renameListenSources(item, orbital, from, to));
  if (!isJsonObject(node)) return node;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) out[key] = renameListenSources(value, orbital, from, to);
  if (node['kind'] === 'orbital' && node['orbital'] === orbital && node['trait'] === from) out['trait'] = to;
  return out;
}

/** `node` with links to route `from` (`navigate` targets, `href` values) pointed at `to`; page `path`s untouched. */
function renameRouteLinks(node: JsonValue, from: string, to: string): JsonValue {
  if (Array.isArray(node)) {
    const out = node.map((item) => renameRouteLinks(item, from, to));
    if (node[0] === 'navigate' && node[1] === from) out[1] = to;
    return out;
  }
  if (!isJsonObject(node)) return node;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) out[key] = key === 'href' && value === from ? to : renameRouteLinks(value, from, to);
  return out;
}

export function composeOrbitalSurface(
  files: ReadonlyArray<OrbitalDefinition | OrbitalSchema>,
  options: ComposeSurfaceOptions = {},
): ComposedSurface {
  const namespaced = options.organismOf !== undefined
    ? namespaceOrganisms(files, options.organismOf, options.atomTraitOf ?? (() => undefined))
    : { files: [...files], renames: [], unrenamable: [] };
  files = namespaced.files;
  const orbitals = [...asDefinitions([...files])];
  const surfaceRenames = dedupeComposedSurface(orbitals);
  // A listen names its source by orbital + trait, so a trait renamed on compose is followed app-wide.
  for (const r of surfaceRenames.traits) {
    for (let i = 0; i < orbitals.length; i += 1) {
      const next = nodeToOrbital(renameListenSources(cloneOrbitalNode(orbitals[i]!), r.orbitalName, r.from, r.to) as JsonObject);
      if (JSON.stringify(next) !== JSON.stringify(orbitals[i])) orbitals[i] = next;
    }
  }
  // A renamed route is its organism's own page: its siblings' links follow it (another organism's do not).
  if (options.organismOf !== undefined) {
    for (const r of surfaceRenames.routes) {
      const organism = options.organismOf(r.orbitalName);
      if (organism === undefined) continue;
      for (let i = 0; i < orbitals.length; i += 1) {
        const orbital = orbitals[i]!;
        if (orbital.name === r.orbitalName || options.organismOf(orbital.name) !== organism) continue;
        const next = nodeToOrbital(renameRouteLinks(cloneOrbitalNode(orbital), r.from, r.to) as JsonObject);
        if (JSON.stringify(next) !== JSON.stringify(orbital)) orbitals[i] = next;
      }
    }
  }
  const organismOfFile = (file: OrbitalDefinition | OrbitalSchema): Set<string | undefined> =>
    new Set(asDefinitions([file]).map((o) => options.organismOf?.(o.name)));
  const renamedFiles = files.map((file) => {
    if (!('orbitals' in file) || file.config === undefined) return file;
    const ownNames = new Set(file.orbitals.map((o) => o.name));
    const organisms = organismOfFile(file);
    // Paths this file's own orbitals still own after the renames — another orbital's rename
    // of the same path never retargets this file's entry for its own page.
    const ownPaths = new Set<string>();
    for (const o of orbitals) {
      if (!ownNames.has(o.name)) continue;
      for (const page of o.pages ?? []) {
        if (!isPageReference(page) && isRoutePage(page) && typeof page.path === 'string') ownPaths.add(page.path);
      }
    }
    let config = file.config;
    for (const r of surfaceRenames.routes) {
      const organism = options.organismOf?.(r.orbitalName);
      if (!ownNames.has(r.orbitalName) && ownPaths.has(r.from)) continue;
      if (ownNames.has(r.orbitalName) || (organism !== undefined && organisms.has(organism))) config = renameNavHrefs(config, r.from, r.to);
    }
    return config === file.config ? file : { ...file, config };
  });
  const identity = dedupeComposedIdentity(orbitals);
  const ownedPages = collectOwnedPages(orbitals, options.importedOrbitalOf);
  const navItemsNarrowed = narrowNavItemsToOwnedPages(orbitals, ownedPages);

  let ledger = mergeLedgers([...renamedFiles]);
  if (ledger !== undefined) {
    for (const r of surfaceRenames.traits) {
      if (r.id !== undefined) ledger = ledgerRename(ledger, r.id, r.to, new Date().toISOString());
    }
  }

  // D32: an orbital's own `[NavItem]` knob its traits forward as `@config.<key>` is the app's nav —
  // it joins the one app list in roster order instead of shadowing it on that orbital alone.
  const hoistedNav = new Map<string, DeclaredTraitConfig>();
  for (let i = 0; i < orbitals.length; i += 1) {
    const orbital = orbitals[i]!;
    if (orbital.config === undefined) continue;
    const forwarded = collectOrbitalForwardedConfigKeys(orbital);
    const lifted = Object.entries(orbital.config).filter(([key, field]) => field.type === '[NavItem]' && forwarded.has(key));
    if (lifted.length === 0) continue;
    hoistedNav.set(orbital.name, Object.fromEntries(lifted));
    const kept = Object.fromEntries(Object.entries(orbital.config).filter(([key]) => !lifted.some(([k]) => k === key)));
    const { config: _dropped, ...rest } = orbital;
    orbitals[i] = Object.keys(kept).length > 0 ? { ...rest, config: kept } : rest;
  }
  const configSources = renamedFiles.flatMap((f): Array<Pick<OrbitalSchema, 'config'>> => [
    ...('orbitals' in f ? [f] : []),
    ...asDefinitions([f]).flatMap((o) => {
      const config = hoistedNav.get(o.name);
      return config === undefined ? [] : [{ config }];
    }),
  ]);
  const unioned = unionOrganismConfigs(configSources);
  let config: DeclaredTraitConfig | undefined;
  let configNavItemsNarrowed: ConfigNavItemsNarrowResult[] = [];
  if (unioned !== undefined) {
    const narrowed = narrowConfigNavItems(unioned, ownedPages);
    config = narrowed.config;
    configNavItemsNarrowed = narrowed.drops;
  }
  let landingNavAdded: LandingNavResult[] = [];
  if (config !== undefined && options.organismOf !== undefined) {
    const navDeclaringOrbitals = new Set<string>();
    for (const f of renamedFiles) {
      if (!('orbitals' in f) || f.config === undefined) continue;
      if (!Object.values(f.config).some((entry) => entry.type === '[NavItem]')) continue;
      for (const o of f.orbitals) navDeclaringOrbitals.add(o.name);
    }
    const linked = linkLandingPages(orbitals, config, options.organismOf, navDeclaringOrbitals, options.organismOrderOf);
    config = linked.config;
    landingNavAdded = linked.added;
  }

  return {
    orbitals,
    ...(config !== undefined ? { config } : {}),
    ...(ledger !== undefined ? { ledger } : {}),
    surfaceRenames,
    identity,
    navItemsNarrowed,
    configNavItemsNarrowed,
    landingNavAdded,
    organismRenames: namespaced.renames,
    unrenamableCollisions: namespaced.unrenamable,
  };
}

export interface ComposeAppFromFilesOptions extends ComposeSurfaceOptions {
  appName: string;
  layoutStrategy?: LayoutStrategy | 'auto';
  eventWiring?: EventWiringEntry[];
  /** The program an import orbital takes its source from: its `inbound` hooks and `egress` origins join the app's. */
  importedProgramOf?: (orbital: OrbitalDefinition) => OrbitalSchema | undefined;
}

/** Each import orbital with the os grants its upstream orbital declares on itself: the authority the imported traits need, and no more. */
function withUpstreamOsGrants(
  files: ReadonlyArray<OrbitalDefinition | OrbitalSchema>,
  importedOrbitalOf: ((orbital: OrbitalDefinition) => OrbitalDefinition | undefined) | undefined,
): Array<OrbitalDefinition | OrbitalSchema> {
  const granted = (orbital: OrbitalDefinition): OrbitalDefinition => {
    const upstream = orbital.reference === undefined ? undefined : importedOrbitalOf?.(orbital);
    return upstream?.osGrants === undefined ? orbital : { ...orbital, osGrants: unionOsGrants(orbital.osGrants, upstream.osGrants) };
  };
  return files.map((file) => ('orbitals' in file ? { ...file, orbitals: file.orbitals.map(granted) } : granted(file)));
}

/** The hooks and origins the composed programs declare, and those of the programs their import orbitals come from, in first-seen order. */
function declaredReach(
  files: ReadonlyArray<OrbitalDefinition | OrbitalSchema>,
  importedProgramOf: ((orbital: OrbitalDefinition) => OrbitalSchema | undefined) | undefined,
): { inbound: string[]; egress: string[] } {
  const inbound: string[] = [];
  const egress: string[] = [];
  const add = (into: string[], items: readonly string[] | undefined): void => {
    for (const item of items ?? []) if (!into.includes(item)) into.push(item);
  };
  for (const file of files) {
    if (!('orbitals' in file)) continue;
    add(inbound, file.inbound);
    add(egress, file.egress);
    for (const orbital of file.orbitals) {
      const upstream = importedProgramOf?.(orbital);
      add(inbound, upstream?.inbound);
      add(egress, upstream?.egress);
    }
  }
  return { inbound, egress };
}

export interface ComposeAppFromFilesResult extends Omit<ComposedSurface, 'orbitals' | 'config' | 'ledger'> {
  schema: OrbitalSchema;
  layout: ComposeBehaviorsResult['layout'];
  wiring: ComposeBehaviorsResult['wiring'];
}

/**
 * A whole app from its per-orbital files: `composeOrbitalSurface`, then `composeBehaviors` for
 * pages, layout and wiring, with the surface's unioned config and ledger on the schema. Bare
 * definitions compose exactly as `composeBehaviors` composes them.
 */
export function composeAppFromFiles(
  inputs: ReadonlyArray<OrbitalDefinition | OrbitalSchema>,
  options: ComposeAppFromFilesOptions,
): ComposeAppFromFilesResult {
  const files = withUpstreamOsGrants(inputs, options.importedOrbitalOf);
  const { orbitals, config, ledger, ...outcomes } = composeOrbitalSurface(files, {
    ...(options.organismOf !== undefined ? { organismOf: options.organismOf } : {}),
    ...(options.atomTraitOf !== undefined ? { atomTraitOf: options.atomTraitOf } : {}),
    ...(options.importedOrbitalOf !== undefined ? { importedOrbitalOf: options.importedOrbitalOf } : {}),
    ...(options.organismOrderOf !== undefined ? { organismOrderOf: options.organismOrderOf } : {}),
  });
  const result = composeBehaviors({
    appName: options.appName,
    orbitals,
    ...(options.layoutStrategy !== undefined ? { layoutStrategy: options.layoutStrategy } : {}),
    ...(options.eventWiring !== undefined ? { eventWiring: options.eventWiring } : {}),
  });
  const reach = declaredReach(files, options.importedProgramOf);
  return {
    schema: {
      ...result.schema,
      ...(ledger !== undefined ? { ledger } : {}),
      ...(config !== undefined ? { config } : {}),
      ...(reach.inbound.length > 0 ? { inbound: reach.inbound } : {}),
      ...(reach.egress.length > 0 ? { egress: reach.egress } : {}),
    },
    layout: result.layout,
    wiring: result.wiring,
    ...outcomes,
  };
}
