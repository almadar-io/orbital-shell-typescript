/**
 * Schema Diffing & Protection
 *
 * Pure functions for comparing OrbitalSchema objects, detecting destructive changes,
 * and categorizing removals. No I/O — operates on in-memory schema objects.
 */

import type { OrbitalSchema } from './types/schema.js';
import type { OrbitalDefinition, PageRef } from './types/orbital.js';
import type { Trait, TraitRef } from './types/trait.js';
import type { Page } from './types/page.js';
// EntityField used transitively through entity.fields
import type { State, Transition } from './types/state-machine.js';
import type { Effect } from './types/effect.js';
import type {
  SchemaChange,
  ChangeSetDocument,
  CategorizedRemovals,
  ChangesetValue,
  PageContentReduction,
  SemanticSchemaChange,
} from './types/changeset.js';
import { isInlineTrait } from './types/trait.js';

// ============================================================================
// Schema Diffing
// ============================================================================

/**
 * Diff two OrbitalSchema objects and produce a list of changes.
 * Compares orbitals, entities, traits, pages, services, and top-level fields.
 */
export function diffSchemas(
  before: OrbitalSchema,
  after: OrbitalSchema,
): { changes: SchemaChange[] } {
  const changes: SchemaChange[] = [];
  let changeId = 0;
  const nextId = () => `change-${++changeId}`;

  // Compare top-level fields
  if (before.name !== after.name) {
    changes.push({
      id: nextId(),
      operation: 'modify',
      target: 'schema',
      path: ['name'],
      before: before.name,
      after: after.name,
      description: `Renamed schema from "${before.name}" to "${after.name}"`,
    });
  }

  if (before.description !== after.description) {
    changes.push({
      id: nextId(),
      operation: 'modify',
      target: 'schema',
      path: ['description'],
      before: before.description,
      after: after.description,
      description: `Modified schema description`,
    });
  }

  // Compare orbitals by name
  const beforeOrbitals = new Map(
    (before.orbitals || []).map((o, i) => [o.name, { orbital: o, index: i }]),
  );
  const afterOrbitals = new Map(
    (after.orbitals || []).map((o, i) => [o.name, { orbital: o, index: i }]),
  );

  // Detect removed orbitals
  for (const [name, { index }] of beforeOrbitals) {
    if (!afterOrbitals.has(name)) {
      changes.push({
        id: nextId(),
        operation: 'remove',
        target: 'orbital',
        path: ['orbitals', index],
        before: name,
        description: `Removed orbital: ${name}`,
      });
    }
  }

  // Detect added orbitals
  for (const [name, { index }] of afterOrbitals) {
    if (!beforeOrbitals.has(name)) {
      changes.push({
        id: nextId(),
        operation: 'add',
        target: 'orbital',
        path: ['orbitals', index],
        after: name,
        description: `Added orbital: ${name}`,
      });
    }
  }

  // Detect modified orbitals (deep compare via JSON)
  for (const [name, { orbital: afterOrbital, index }] of afterOrbitals) {
    const beforeEntry = beforeOrbitals.get(name);
    if (beforeEntry) {
      const beforeJson = JSON.stringify(beforeEntry.orbital);
      const afterJson = JSON.stringify(afterOrbital);
      if (beforeJson !== afterJson) {
        changes.push({
          id: nextId(),
          operation: 'modify',
          target: 'orbital',
          path: ['orbitals', index],
          description: `Modified orbital: ${name}`,
        });

        // Drill into entity changes
        const beforeEntity = beforeEntry.orbital.entity;
        const afterEntity = afterOrbital.entity;
        if (JSON.stringify(beforeEntity) !== JSON.stringify(afterEntity)) {
          const entityName =
            typeof afterEntity === 'string'
              ? afterEntity
              : afterEntity && typeof afterEntity === 'object' && 'name' in afterEntity
                ? (afterEntity as { name: string }).name
                : 'entity';
          changes.push({
            id: nextId(),
            operation: 'modify',
            target: 'entity',
            path: ['orbitals', index, 'entity'],
            description: `Modified entity: ${entityName}`,
          });
        }

        // Drill into trait changes
        const beforeTraits = beforeEntry.orbital.traits || [];
        const afterTraits = afterOrbital.traits || [];
        if (JSON.stringify(beforeTraits) !== JSON.stringify(afterTraits)) {
          changes.push({
            id: nextId(),
            operation: 'modify',
            target: 'traits',
            path: ['orbitals', index, 'traits'],
            description: `Modified traits in orbital: ${name}`,
          });
        }

        // Drill into page changes
        const beforePages = beforeEntry.orbital.pages || [];
        const afterPages = afterOrbital.pages || [];
        if (JSON.stringify(beforePages) !== JSON.stringify(afterPages)) {
          changes.push({
            id: nextId(),
            operation: 'modify',
            target: 'pages',
            path: ['orbitals', index, 'pages'],
            description: `Modified pages in orbital: ${name}`,
          });
        }
      }
    }
  }

  // Compare services
  const beforeServices = JSON.stringify(before.services || []);
  const afterServices = JSON.stringify(after.services || []);
  if (beforeServices !== afterServices) {
    changes.push({
      id: nextId(),
      operation: 'modify',
      target: 'services',
      path: ['services'],
      description: 'Modified services',
    });
  }

  return { changes };
}

// ============================================================================
// Destructive Change Detection
// ============================================================================

/**
 * Check if a changeset contains any removals.
 */
export function isDestructiveChange(changeSet: { changes: SchemaChange[] }): boolean {
  return changeSet.changes.some((c) => c.operation === 'remove');
}

/**
 * Extract all removal operations from a changeset.
 */
export function getRemovals(changeSet: { changes: SchemaChange[] }): SchemaChange[] {
  return changeSet.changes.filter((c) => c.operation === 'remove');
}

/**
 * Categorize removals by severity.
 *
 * - Critical: orbitals, entities, states, pages (require confirmation)
 * - Standard: fields, actions, traits (auto-snapshotted)
 * - Minor: transitions, guards (tracked)
 */
export function categorizeRemovals(changeSet: {
  changes: SchemaChange[];
}): CategorizedRemovals {
  const critical: SchemaChange[] = [];
  const standard: SchemaChange[] = [];
  const minor: SchemaChange[] = [];

  for (const change of changeSet.changes) {
    if (change.operation !== 'remove') continue;

    const target = change.target.toLowerCase();
    if (
      target === 'orbital' ||
      target === 'entity' ||
      target === 'state' ||
      target === 'page'
    ) {
      critical.push(change);
    } else if (
      target === 'field' ||
      target === 'action' ||
      target === 'trait' ||
      target === 'traits'
    ) {
      standard.push(change);
    } else {
      minor.push(change);
    }
  }

  return { critical, standard, minor, pageContentReductions: [] };
}

/**
 * Check if critical removals require explicit confirmation.
 */
export function requiresConfirmation(removals: CategorizedRemovals): boolean {
  return removals.critical.length > 0;
}

// ============================================================================
// Page Content Reduction
// ============================================================================

/**
 * Detect implicit content reduction within pages.
 * Catches cases where a page 'modify' reduces components/actions/displays
 * without an explicit 'remove' operation.
 */
export function detectPageContentReduction(
  beforePages: unknown[],
  afterPages: unknown[],
): PageContentReduction[] {
  const reductions: PageContentReduction[] = [];

  const getPageName = (p: unknown): string | null => {
    if (p && typeof p === 'object' && 'name' in p) {
      return (p as { name: string }).name;
    }
    return null;
  };

  const countContent = (
    page: unknown,
  ): { sections: number; actions: number } => {
    if (!page || typeof page !== 'object') return { sections: 0, actions: 0 };
    const p = page as { traits?: unknown[] };
    const traits = Array.isArray(p.traits) ? p.traits : [];
    return { sections: traits.length, actions: 0 };
  };

  // Build maps by name
  const beforeMap = new Map<string, unknown>();
  for (const p of beforePages) {
    const name = getPageName(p);
    if (name) beforeMap.set(name, p);
  }

  for (const afterPage of afterPages) {
    const name = getPageName(afterPage);
    if (!name) continue;
    const beforePage = beforeMap.get(name);
    if (!beforePage) continue;

    const beforeContent = countContent(beforePage);
    const afterContent = countContent(afterPage);

    const sectionsRemoved = beforeContent.sections - afterContent.sections;
    const actionsRemoved = beforeContent.actions - afterContent.actions;

    if (sectionsRemoved > 0 || actionsRemoved > 0) {
      reductions.push({
        pageName: name,
        componentsRemoved: sectionsRemoved,
        actionsRemoved,
        displaysRemoved: 0,
        before: beforeContent,
        after: afterContent,
        isSignificant: sectionsRemoved > 0,
      });
    }
  }

  return reductions;
}

/**
 * Check if page content reductions are significant.
 */
export function hasSignificantPageReduction(
  reductions: PageContentReduction[],
): boolean {
  return reductions.some((r) => r.isSignificant);
}

// ============================================================================
// Semantic Schema Diffing
// ============================================================================

/** Stable JSON comparison. */
function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

/** Every trait an orbital declares, keyed by its name (a composed trait without a `name` goes by its `ref`). */
function namedTraitMap(refs: TraitRef[]): Map<string, TraitRef> {
  const map = new Map<string, TraitRef>();
  for (const r of refs) {
    const key = typeof r === 'string' ? r : isInlineTrait(r) ? r.name : (r.name ?? r.ref);
    map.set(key, r);
  }
  return map;
}

/** The atom a composed trait points at; `null` for an inline trait. */
function composedSource(r: TraitRef): string | null {
  if (typeof r === 'string') return r;
  return isInlineTrait(r) ? null : r.ref;
}

function traitConfigOf(r: TraitRef): Trait['config'] | Exclude<TraitRef, string | Trait>['config'] {
  return typeof r === 'string' ? undefined : r.config;
}

function inlinePageMap(refs: PageRef[]): Map<string, Page> {
  const map = new Map<string, Page>();
  for (const r of refs) {
    if (typeof r === 'string') continue;
    if ('ref' in r && !('name' in r)) continue;
    const page = r as Page;
    if (page.path) map.set(page.path, page);
  }
  return map;
}

function isRenderUIEffect(effect: Effect): boolean {
  if (!Array.isArray(effect)) return false;
  return String(effect[0]) === 'render-ui' || String(effect[0]) === 'renderUI';
}

function tKey(t: Transition): string {
  return `${t.from ?? ''}+${t.event}`;
}

function diffSemanticTransitions(
  orbitalName: string, traitName: string,
  before: Transition[], after: Transition[],
): SemanticSchemaChange[] {
  const changes: SemanticSchemaChange[] = [];
  const bMap = new Map(before.map(t => [tKey(t), t]));
  const aMap = new Map(after.map(t => [tKey(t), t]));

  for (const [key, aT] of aMap) {
    const bT = bMap.get(key);
    if (!bT) continue;

    if (!jsonEqual(bT.guard, aT.guard)) {
      changes.push({ kind: 'guard-changed', orbitalName, traitName, transitionEvent: aT.event });
    }

    if (!jsonEqual(bT.effects, aT.effects)) {
      const bEffects = bT.effects ?? [];
      const aEffects = aT.effects ?? [];
      const bRUI = bEffects.filter(isRenderUIEffect);
      const aRUI = aEffects.filter(isRenderUIEffect);

      if (bRUI.length !== aRUI.length || !jsonEqual(bRUI, aRUI)) {
        changes.push({ kind: 'render-ui-changed', orbitalName, traitName, transitionEvent: aT.event });
      } else {
        changes.push({ kind: 'effect-changed', orbitalName, traitName, transitionEvent: aT.event });
      }
    }
  }
  return changes;
}

function diffSemanticOrbital(
  name: string, before: OrbitalDefinition, after: OrbitalDefinition,
): SemanticSchemaChange[] {
  const changes: SemanticSchemaChange[] = [];

  // Entity fields
  const bEntity = typeof before.entity === 'object' ? before.entity : null;
  const aEntity = typeof after.entity === 'object' ? after.entity : null;
  if (bEntity && aEntity) {
    if (!jsonEqual(bEntity.fields, aEntity.fields)) {
      changes.push({ kind: 'entity-fields-changed', orbitalName: name });
    }
  } else if (bEntity !== aEntity) {
    changes.push({ kind: 'entity-fields-changed', orbitalName: name });
  }

  // Traits — inline and composed (`ref`) alike, keyed by the name the orbital knows them by.
  const bTraits = namedTraitMap(before.traits ?? []);
  const aTraits = namedTraitMap(after.traits ?? []);

  for (const [tName] of aTraits) {
    if (!bTraits.has(tName)) changes.push({ kind: 'trait-added', orbitalName: name, traitName: tName });
  }
  for (const [tName] of bTraits) {
    if (!aTraits.has(tName)) changes.push({ kind: 'trait-removed', orbitalName: name, traitName: tName });
  }

  for (const [tName, aRef] of aTraits) {
    const bRef = bTraits.get(tName);
    if (bRef === undefined) continue;

    if (composedSource(bRef) !== composedSource(aRef)) {
      changes.push({ kind: 'trait-removed', orbitalName: name, traitName: tName });
      changes.push({ kind: 'trait-added', orbitalName: name, traitName: tName });
      continue;
    }
    if (!jsonEqual(traitConfigOf(bRef), traitConfigOf(aRef))) {
      changes.push({ kind: 'trait-config-changed', orbitalName: name, traitName: tName });
    }
    if (!isInlineTrait(bRef) || !isInlineTrait(aRef)) {
      if (typeof bRef !== 'string' && typeof aRef !== 'string'
        && (!jsonEqual(bRef.linkedEntity, aRef.linkedEntity) || !jsonEqual(bRef.events, aRef.events))) {
        changes.push({ kind: 'event-wiring-changed', orbitalName: name, traitName: tName });
      }
      continue;
    }
    const bTrait = bRef;
    const aTrait = aRef;

    const bSM = bTrait.stateMachine;
    const aSM = aTrait.stateMachine;

    if (!bSM && !aSM) continue;
    if (!bSM || !aSM) {
      changes.push({ kind: 'state-machine-changed', orbitalName: name, traitName: tName });
      continue;
    }

    const bStates = new Set((bSM.states ?? []).map((s: State) => s.name));
    const aStates = new Set((aSM.states ?? []).map((s: State) => s.name));
    if (!setsEqual(bStates, aStates)) {
      changes.push({ kind: 'state-machine-changed', orbitalName: name, traitName: tName });
    }

    const bTKeys = new Set((bSM.transitions ?? []).map(tKey));
    const aTKeys = new Set((aSM.transitions ?? []).map(tKey));
    if (!setsEqual(bTKeys, aTKeys)) {
      if (!changes.some(c => c.kind === 'state-machine-changed' && c.traitName === tName)) {
        changes.push({ kind: 'state-machine-changed', orbitalName: name, traitName: tName });
      }
    }

    changes.push(...diffSemanticTransitions(name, tName, bSM.transitions ?? [], aSM.transitions ?? []));

    if (!jsonEqual(bTrait.emits, aTrait.emits) || !jsonEqual(bTrait.listens, aTrait.listens)) {
      changes.push({ kind: 'event-wiring-changed', orbitalName: name, traitName: tName });
    }
  }

  if (!jsonEqual(before.theme, after.theme)) {
    changes.push({ kind: 'theme-changed', orbitalName: name });
  }

  // Pages
  const bPages = inlinePageMap(before.pages ?? []);
  const aPages = inlinePageMap(after.pages ?? []);
  const bPaths = new Set(bPages.keys());
  const aPaths = new Set(aPages.keys());

  if (!setsEqual(bPaths, aPaths)) {
    changes.push({ kind: 'page-changed', orbitalName: name });
  } else {
    for (const [path, aPage] of aPages) {
      if (!jsonEqual(bPages.get(path), aPage)) {
        changes.push({ kind: 'page-changed', orbitalName: name });
        break;
      }
    }
  }

  return changes;
}

/**
 * Semantic diff: what .orb CONCEPTS changed between two schema versions.
 *
 * Unlike `diffSchemas()` which produces operational CRUD changes for persistence,
 * this produces concept-level changes (guard-changed, render-ui-changed, etc.)
 * for canvas focus derivation, CLI narration, and selective re-verification.
 */
export function diffSchemaSemantics(
  before: OrbitalSchema,
  after: OrbitalSchema,
): SemanticSchemaChange[] {
  const changes: SemanticSchemaChange[] = [];

  const bOrbitals = new Map<string, OrbitalDefinition>();
  for (const o of before.orbitals ?? []) {
    const orb = o as OrbitalDefinition;
    bOrbitals.set(orb.name, orb);
  }

  const aOrbitals = new Map<string, OrbitalDefinition>();
  for (const o of after.orbitals ?? []) {
    const orb = o as OrbitalDefinition;
    aOrbitals.set(orb.name, orb);
  }

  const added: string[] = [];
  for (const [name] of aOrbitals) {
    if (!bOrbitals.has(name)) {
      changes.push({ kind: 'orbital-added', orbitalName: name });
      added.push(name);
    }
  }
  for (const [name] of bOrbitals) {
    if (!aOrbitals.has(name)) {
      changes.push({ kind: 'orbital-removed', orbitalName: name });
    }
  }
  if (added.length > 1) {
    changes.push({ kind: 'behavior-composed', orbitalName: added[0] });
  }

  for (const [name, aOrb] of aOrbitals) {
    const bOrb = bOrbitals.get(name);
    if (bOrb) changes.push(...diffSemanticOrbital(name, bOrb, aOrb));
  }

  // An app-level theme or token change restyles every orbital.
  if (!jsonEqual(before.theme, after.theme) || !jsonEqual(before.designTokens, after.designTokens)) {
    for (const [name] of aOrbitals) {
      if (!changes.some((c) => c.kind === 'theme-changed' && c.orbitalName === name)) {
        changes.push({ kind: 'theme-changed', orbitalName: name });
      }
    }
  }

  return changes;
}

// ============================================================================
// High-level Orbital Schema Diff (changeset envelope)
// ============================================================================

/**
 * Source label for a changeset. The persistence layer accepts the canonical
 * agent labels plus `skill-agent:<skill>`-style identifiers, so the type stays
 * open as a string.
 */
export type SchemaDiffSource =
  | 'requirements-agent'
  | 'builder-agent'
  | 'user'
  | 'auto-fix'
  | (string & {});

/** Tracking granularity used when generating the diff. */
export type SchemaDiffMode = 'initial' | 'update';

/** Author identification carried on the changeset envelope. */
export interface SchemaDiffAuthor {
  userId: string;
  name?: string;
}

/** Options that shape the resulting diff envelope. */
export interface SchemaDiffOptions {
  mode: SchemaDiffMode;
  author: SchemaDiffAuthor;
  source: SchemaDiffSource;
}

/** Per-change entry in the diff envelope. */
export interface SchemaDiffChange {
  operation: 'add' | 'modify' | 'remove' | 'rename' | 'merge' | 'set';
  path: string;
  value?: ChangesetValue;
  previousValue?: ChangesetValue;
}

/** Aggregate orbital/trait deltas surfaced by the diff. */
export interface SchemaDiffSummary {
  orbitalsAdded: string[];
  orbitalsRemoved: string[];
  orbitalsModified: string[];
  traitsAdded: string[];
  traitsModified: string[];
  traitsRemoved: string[];
}

/** Changeset envelope produced by `diffOrbitalSchemas`. */
export interface SchemaDiffChangeset {
  id: string;
  source: SchemaDiffSource;
  author: SchemaDiffAuthor;
  description: string;
  changes: SchemaDiffChange[];
}

/** Result of comparing two OrbitalSchema versions. */
export interface SchemaDiff {
  hasChanges: boolean;
  changeCount: number;
  changeset: SchemaDiffChangeset;
  summary: SchemaDiffSummary;
}

/**
 * Compare two `OrbitalSchema` versions and produce a changeset envelope.
 *
 * Higher-level companion to `diffSchemas`: where `diffSchemas` returns a flat
 * list of `SchemaChange` entries keyed by structural path, this returns the
 * envelope the persistence layer ships to Firestore (id, author, source,
 * summary buckets).
 *
 * Identifier generation: `changeset.id` is a deterministic `chg_<hex>` value
 * derived from the schema name + change count when `globalThis.crypto.randomUUID`
 * is unavailable; otherwise a UUID is used. Callers that need a stable id
 * across regenerations should supply one themselves.
 */
export function diffOrbitalSchemas(
  before: OrbitalSchema | null,
  after: OrbitalSchema,
  options: SchemaDiffOptions,
): SchemaDiff {
  const summary: SchemaDiffSummary = {
    orbitalsAdded: [],
    orbitalsRemoved: [],
    orbitalsModified: [],
    traitsAdded: [],
    traitsModified: [],
    traitsRemoved: [],
  };
  const changes: SchemaDiffChange[] = [];

  if (!before) {
    for (const orbital of after.orbitals ?? []) {
      const orb = orbital as OrbitalDefinition;
      summary.orbitalsAdded.push(orb.name);
      changes.push({
        operation: 'add',
        path: `orbitals[${summary.orbitalsAdded.length - 1}]`,
        value: orb,
      });
    }
  } else {
    const beforeOrbitals = new Map<string, OrbitalDefinition>();
    for (const o of before.orbitals ?? []) {
      const orb = o as OrbitalDefinition;
      beforeOrbitals.set(orb.name, orb);
    }
    const afterOrbitals = new Map<string, OrbitalDefinition>();
    for (const o of after.orbitals ?? []) {
      const orb = o as OrbitalDefinition;
      afterOrbitals.set(orb.name, orb);
    }

    let idx = 0;
    for (const [name, orb] of afterOrbitals) {
      const prev = beforeOrbitals.get(name);
      if (!prev) {
        summary.orbitalsAdded.push(name);
        changes.push({
          operation: 'add',
          path: `orbitals[${idx}]`,
          value: orb,
        });
      } else if (JSON.stringify(prev) !== JSON.stringify(orb)) {
        summary.orbitalsModified.push(name);
        changes.push({
          operation: 'merge',
          path: `orbitals[${idx}]`,
          previousValue: prev,
          value: orb,
        });
      }
      idx++;
    }
    for (const [name, orb] of beforeOrbitals) {
      if (!afterOrbitals.has(name)) {
        summary.orbitalsRemoved.push(name);
        changes.push({
          operation: 'remove',
          path: `orbitals[${name}]`,
          previousValue: orb,
        });
      }
    }

    if (before.name !== after.name) {
      changes.push({
        operation: 'set',
        path: 'name',
        previousValue: before.name,
        value: after.name,
      });
    }
    if (before.version !== after.version) {
      changes.push({
        operation: 'set',
        path: 'version',
        previousValue: before.version,
        value: after.version,
      });
    }
    if (before.description !== after.description) {
      changes.push({
        operation: 'set',
        path: 'description',
        previousValue: before.description,
        value: after.description,
      });
    }
    if (before.summary !== after.summary) {
      changes.push({
        operation: 'set',
        path: 'summary',
        previousValue: before.summary,
        value: after.summary,
      });
    }
  }

  const hasChanges = changes.length > 0;
  const description = describeDiff(summary, options.mode, after.name);

  return {
    hasChanges,
    changeCount: changes.length,
    changeset: {
      id: generateChangesetId(after.name, changes.length),
      source: options.source,
      author: options.author,
      description,
      changes,
    },
    summary,
  };
}

function describeDiff(
  summary: SchemaDiffSummary,
  mode: SchemaDiffMode,
  schemaName: string,
): string {
  const parts: string[] = [];
  if (summary.orbitalsAdded.length > 0) {
    parts.push(`+${summary.orbitalsAdded.length} orbital(s)`);
  }
  if (summary.orbitalsModified.length > 0) {
    parts.push(`~${summary.orbitalsModified.length} orbital(s)`);
  }
  if (summary.orbitalsRemoved.length > 0) {
    parts.push(`-${summary.orbitalsRemoved.length} orbital(s)`);
  }
  if (parts.length === 0) return 'No changes';
  return `${mode === 'initial' ? 'Initial' : 'Update'} ${schemaName}: ${parts.join(', ')}`;
}

function generateChangesetId(seed: string, count: number): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  let hash = 0;
  const source = `${seed}:${count}:${Date.now()}`;
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) | 0;
  }
  return `chg_${(hash >>> 0).toString(16)}_${count}`;
}
