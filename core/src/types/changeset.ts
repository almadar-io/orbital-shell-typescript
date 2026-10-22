/**
 * Changeset & Snapshot Types
 *
 * Unified types for schema change tracking, snapshots, and removal categorization.
 * Used by @almadar/server for Firestore storage and by consumers for type safety.
 */

import type { OrbitalSchema } from './schema.js';
import type { Orbital } from './orbital.js';
import type { Trait } from './trait.js';
import type { Entity } from './entity.js';
import type { Page } from './page.js';
import type { EventPayloadValue } from './expression.js';

// ============================================================================
// Schema Change Types
// ============================================================================

/**
 * Value attached to a SchemaChange entry's `before` / `after`.
 *
 * Either a JSON-shaped LLM payload (`EventPayloadValue`), a single schema
 * fragment (`Orbital`, `Trait`, `Entity`, `Page`, `OrbitalSchema`), or an
 * array of such fragments. Mirrors the exact shapes the builder's changeset
 * writers actually persist when adding/replacing a slice of the schema.
 */
export type ChangesetValue =
  | EventPayloadValue
  | OrbitalSchema
  | Orbital
  | Trait
  | Entity
  | Page
  | Orbital[]
  | Trait[]
  | Entity[]
  | Page[];

/**
 * A single change within a changeset.
 */
export interface SchemaChange {
  id: string;
  operation: 'add' | 'modify' | 'remove' | 'rename';
  target: string;
  path: (string | number)[];
  before?: ChangesetValue;
  after?: ChangesetValue;
  description: string;
  reason?: string;
  dependsOn?: string[];
}

/**
 * Author of a changeset.
 */
export interface ChangeAuthor {
  type: 'agent' | 'user';
  id?: string;
  name?: string;
}

/**
 * Summary statistics for a changeset.
 */
export interface ChangeSummary {
  added: number;
  modified: number;
  removed: number;
  description: string;
}

/**
 * Complete changeset document.
 * Stored at: users/{uid}/apps/{appId}/changesets/{changeSetId}
 */
export interface ChangeSetDocument {
  id: string;
  version: number;
  timestamp: number;
  source: 'requirements-agent' | 'builder-agent' | 'user' | 'auto-fix';
  author: ChangeAuthor;
  trigger?: string;
  changes: SchemaChange[];
  summary: ChangeSummary;
  status: 'applied' | 'reverted' | 'pending';
  description: string;
}

// ============================================================================
// Snapshot Types
// ============================================================================

/**
 * Schema snapshot document.
 * Stored at: users/{uid}/apps/{appId}/snapshots/{snapshotId}
 */
export interface SnapshotDocument {
  id: string;
  timestamp: number;
  schema: OrbitalSchema;
  reason: string;
  version?: number;
}

// ============================================================================
// Schema Protection Types
// ============================================================================

/**
 * Removals categorized by severity.
 */
export interface CategorizedRemovals {
  /** States, pages, entities — always require confirmation */
  critical: SchemaChange[];
  /** Fields, actions — auto-snapshotted */
  standard: SchemaChange[];
  /** Transitions, guards — tracked */
  minor: SchemaChange[];
  /** Implicit content removal within pages */
  pageContentReductions: PageContentReduction[];
}

/**
 * Detected reduction in page content (components, actions, displays removed).
 */
export interface PageContentReduction {
  pageName: string;
  componentsRemoved: number;
  actionsRemoved: number;
  displaysRemoved: number;
  before: { sections: number; actions: number };
  after: { sections: number; actions: number };
  isSignificant: boolean;
}

// ============================================================================
// History Metadata Types
// ============================================================================

/**
 * History metadata stored in main app document for quick access.
 */
export interface HistoryMeta {
  latestSnapshotId?: string;
  latestChangeSetId?: string;
  snapshotCount: number;
  changeSetCount: number;
}

/**
 * Validation metadata stored in main app document for quick access.
 */
export interface ValidationMeta {
  errorCount: number;
  warningCount: number;
  validatedAt: number;
}

// ============================================================================
// Semantic Schema Change (concept-level diffing)
// ============================================================================

/**
 * What kind of .orb concept changed between two schema versions.
 * Used by canvas focus derivation, CLI narration, selective re-verification.
 */
export const SEMANTIC_CHANGE_KINDS = [
  'orbital-added',
  'orbital-removed',
  'entity-fields-changed',
  'trait-added',
  'trait-removed',
  'trait-config-changed',
  'state-machine-changed',
  'guard-changed',
  'effect-changed',
  'render-ui-changed',
  'event-wiring-changed',
  'page-changed',
  'theme-changed',
  'behavior-composed',
] as const;

export type SemanticChangeKind = (typeof SEMANTIC_CHANGE_KINDS)[number];

/**
 * A semantic change between two OrbitalSchema versions.
 * Identifies WHAT concept changed and WHERE in the schema.
 */
export interface SemanticSchemaChange {
  kind: SemanticChangeKind;
  orbitalName: string;
  traitName?: string;
  transitionEvent?: string;
  fieldName?: string;
}
