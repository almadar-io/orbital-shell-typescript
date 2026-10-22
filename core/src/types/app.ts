/**
 * App-Level Types
 *
 * Types for app summaries, stats, and save operations.
 */

import type { CategorizedRemovals } from './changeset.js';
import type { DomainContext } from './domain.js';

// ============================================================================
// GitHub Integration
// ============================================================================

/**
 * GitHub repository link metadata stored in Firestore.
 * Enables GitHub as the source of truth for schema files.
 */
export interface GitHubLink {
  repoUrl: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  connectedAt: number;
  schemaFile?: string;  // e.g. "trait-wars.orb" — defaults to "schema.orb"
}

// ============================================================================
// Stats & Summary
// ============================================================================

/**
 * Dashboard stats derived from schema.
 */
export interface StatsView {
  states: number;
  events: number;
  pages: number;
  entities: number;
  transitions: number;
}

/**
 * App summary for list views.
 */
export interface AppSummary {
  id: string;
  name: string;
  description?: string;
  updatedAt: number;
  createdAt: number;
  stats: StatsView;
  domain?: { category: string; subDomain?: string };
  /**
   * Canonical domain classification + vocabulary projected onto the list
   * view. Same shape as `OrbitalSchema.domainContext`.
   */
  domainContext?: DomainContext;
  hasValidationErrors: boolean;
  github?: GitHubLink;
}

// ============================================================================
// Save Operations
// ============================================================================

/**
 * Options for saving a schema.
 */
export interface SaveOptions {
  confirmRemovals?: boolean;
  snapshotReason?: string;
  skipProtection?: boolean;
  expectedVersion?: number;
  source?: 'requirements-agent' | 'builder-agent' | 'manual';
}

/**
 * Result of saving a schema.
 */
export interface SaveResult {
  success: boolean;
  requiresConfirmation?: boolean;
  removals?: CategorizedRemovals;
  error?: string;
  snapshotId?: string;
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Context attached to validation issues originating from LLM output.
 * Mirrors the `LLMErrorContext` shapes used by `@almadar/validation`
 * and the builder's fix-prompt pipeline.
 */
export interface LLMErrorContext {
  /** Preview of the raw LLM output */
  rawValuePreview?: string;
  /** Expected type or structure */
  expectedType?: string;
  /** Actual type received */
  actualType?: string;
  /** Where the error originated */
  source?: {
    agent: 'requirements' | 'builder' | 'view-planner';
    operation: string;
    promptHash?: string;
  };
  tokenUsage?: { prompt: number; completion: number };
}

/**
 * Validation issue with optional LLM context.
 */
export interface ValidationIssue {
  code: string;
  message: string;
  path: (string | number)[];
  severity: 'error' | 'warning' | 'info';
  suggestion?: string;
  llmContext?: LLMErrorContext;
}

/**
 * Validation results.
 */
export interface ValidationResults {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  validatedAt: number;
}

/**
 * Validation document stored in subcollection.
 */
export interface ValidationDocument {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  validatedAt: number;
}
