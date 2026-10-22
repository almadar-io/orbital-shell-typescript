/**
 * Plan & Analysis Types
 *
 * Lifted from @almadar-io/rabit's coordinator types. These are the
 * language-level contracts for the planner/analysis pipeline — the
 * session/* and workspace/* substrate operators produce and consume
 * these shapes. Defined here (not in rabit) so both the compiled path
 * (orbital-rust codegen → @almadar/server) and the interpreted path
 * (@almadar/runtime) reference the same types without depending on rabit.
 *
 * @packageDocumentation
 */

import type { EntityField } from './field.js';
import type { EntityPersistence } from './entity.js';
import type { RuntimeValue } from './json.js';
import type { OrbitalSchema } from './schema.js';
import type { PageTraitRef } from './page.js';
import type { TraitReference, TraitConfigObject } from './trait.js';
import type { ThemeDefinition } from './domain.js';
import type { RuleOverlay, TraitOverlay } from '../factory/overlays.js';
import type {
    EventWiringEntry,
    LayoutStrategy,
    MakeTraitRefOpts,
} from '../builders/index.js';

// ============================================================================
// Clarification System
// ============================================================================

export type ClarificationLevel = 'organism' | 'molecule' | 'atom_trait';

export interface ClarificationCandidate {
    id: string;
    label: string;
    description: string;
    whyThisFits: string;
}

export interface Clarification {
    level: ClarificationLevel;
    scope: { orbitalName?: string; traitName?: string };
    question: string;
    candidates: ClarificationCandidate[];
    skipDefault: string;
    skippable: true;
}

// ============================================================================
// Orbital Analysis Params
// ============================================================================

export interface AnalysisPageOverride {
    name: string;
    path?: string;
    linkedEntity?: string;
    traits?: PageTraitRef[];
}

export interface ExtraTraitRef
    extends Pick<
        TraitReference,
        'ref' | 'name' | 'linkedEntity' | 'config' | 'events' | 'listens' | 'emitsScope'
    > {
    from: string;
    as: string;
}

export interface AnalysisOrbitalParams {
    fields?: EntityField[];
    pagePath?: string;
    persistence?: EntityPersistence;
    entityName?: string;
    collection?: string;
    traitOverrides?: Record<
        string,
        Pick<MakeTraitRefOpts, 'config' | 'linkedEntity' | 'events' | 'name' | 'emitsScope' | 'listens'>
    >;
    extraTraits?: ExtraTraitRef[];
    pages?: AnalysisPageOverride[];
}

// ============================================================================
// Analysis Result
// ============================================================================

export interface AnalysisOrbital {
    orbitalName: string;
    suggestedBehavior: string | null;
    entityName?: string;
    pageNames?: ReadonlyArray<string>;
    params?: AnalysisOrbitalParams;
    traitOverlay?: TraitOverlay;
    paletteTopics?: string[];
    primitiveHints?: string[];
}

export interface AnalysisRename {
    oldName: string;
    newName: string;
}

export interface ComplexityAssessment {
    score: number;
    category: 'simple' | 'moderate' | 'complex';
    reasoning: string;
    detectedEntities?: string[];
    detectedFeatures?: string[];
}

export interface AnalysisResult {
    userRequest: string;
    complexity: ComplexityAssessment;
    route: 'direct' | 'direct_with_questions' | 'decompose';
    organism: string;
    appName: string;
    organismReason: string;
    orbitals: AnalysisOrbital[];
    renames?: AnalysisRename[];
    deletedOrbitals?: string[];
    ruleOverlay?: RuleOverlay;
    estimatedMinutes?: number;
    schema: OrbitalSchema;
    wiring?: EventWiringEntry[];
    layout?: LayoutStrategy | 'detect';
    themeOverrides?: Partial<ThemeDefinition>;
    pendingClarifications?: Clarification[];
}

// ============================================================================
// Plan Snapshot
// ============================================================================

export interface SpawnResult {
    orbitalName: string;
    ok: boolean;
    traitNames: ReadonlyArray<string>;
    error?: string;
    durationMs: number;
}

export type PlanSnapshotStatus = 'proposed' | 'confirmed' | 'built' | 'failed';

export interface PlanSnapshot {
    schemaVersion: 1;
    status: PlanSnapshotStatus;
    builtAt: string;
    organism: string | null;
    appName: string | null;
    organismReason: string | null;
    complexity: ComplexityAssessment | null;
    themeOverrides: Partial<ThemeDefinition>;
    ruleOverlay: RuleOverlay | null;
    orbitals: ReadonlyArray<AnalysisOrbital>;
    renames: ReadonlyArray<AnalysisRename>;
    deletedOrbitals: ReadonlyArray<string>;
    priorBuiltOrbitals: ReadonlyArray<AnalysisOrbital>;
    spawnedOrbitalResults: ReadonlyArray<SpawnResult>;
    skippedOrbitalNames: ReadonlyArray<string>;
    pendingClarifications: ReadonlyArray<Clarification>;
    paletteTopics?: string[];
}

/**
 * Runtime guard for `PlanSnapshot` — narrows interpreter-produced `unknown`
 * values at the `WorkspaceContext.writePlan` boundary. Discriminates on the
 * snapshot envelope (schemaVersion, status, roster arrays), not deep contents.
 */
export function isPlanSnapshot(value: RuntimeValue): value is PlanSnapshot {
    if (typeof value !== 'object' || value === null) return false;
    const statuses: ReadonlyArray<PlanSnapshotStatus> = ['proposed', 'confirmed', 'built', 'failed'];
    return (
        'schemaVersion' in value && value.schemaVersion === 1 &&
        'status' in value && statuses.some((s) => s === value.status) &&
        'builtAt' in value && typeof value.builtAt === 'string' &&
        'orbitals' in value && Array.isArray(value.orbitals) &&
        'renames' in value && Array.isArray(value.renames) &&
        'deletedOrbitals' in value && Array.isArray(value.deletedOrbitals)
    );
}

// ============================================================================
// Compose Options
// ============================================================================

export interface ComposeOptions {
    appName?: string;
    wiring?: EventWiringEntry[];
    layout?: LayoutStrategy | 'auto';
    themeOverrides?: Partial<ThemeDefinition>;
}

