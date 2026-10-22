/**
 * Agent Types
 *
 * Defines the AgentContext interface and related types for the agent/* operator namespace.
 * These types are the contract between operators (language) and implementation (runtime).
 *
 * @packageDocumentation
 */

import type { ServiceParams } from './service.js';
import type { EventPayloadValue } from './expression.js';
import type { FieldValue } from './entity.js';
import type { JsonSchema } from '../factory/types.js';
import type { ValidationError } from './validation.js';
import type { Orbital } from './orbital.js';
import type { OrbitalSchema } from './schema.js';
import type { JsonValue, RuntimeValue } from './json.js';
import type { AnalysisResult, PlanSnapshot } from './plan.js';

// ============================================================================
// Agent Memory Types
// ============================================================================

/**
 * Categories for agent memories.
 */
export type AgentMemoryCategory =
    | 'preference'
    | 'correction'
    | 'pattern-affinity'
    | 'entity-template'
    | 'error-resolution';

/**
 * A single memory record stored by the agent.
 */
export interface AgentMemoryRecord {
    /** Unique memory identifier */
    id: string;
    /** Memory content (natural language) */
    content: string;
    /** Memory category */
    category: AgentMemoryCategory;
    /** Strength value (0.0-1.0), decays over time unless pinned */
    strength: number;
    /** Whether this memory is pinned (immune to decay) */
    pinned: boolean;
    /** Memory scope */
    scope: 'global' | 'project';
    /** ISO timestamp of last access */
    lastAccessedAt: string;
    /** ISO timestamp of creation */
    createdAt: string;
}

// ============================================================================
// Agent Context Types
// ============================================================================

/**
 * Strategy for context compaction.
 */
export type AgentCompactStrategy = 'hybrid' | 'summarize' | 'truncate' | 'extract';

/**
 * Result of a context compaction operation.
 */
export interface AgentCompactResult {
    /** Token count before compaction */
    before: number;
    /** Token count after compaction */
    after: number;
    /** Strategy used */
    strategy: AgentCompactStrategy;
    /** Optional summary generated during compaction */
    summary?: string;
}

// ============================================================================
// Agent LLM Types
// ============================================================================

/**
 * Options for agent/generate calls.
 */
export interface AgentGenerateOptions {
    /** LLM provider override */
    provider?: string;
    /** Model override */
    model?: string;
    /** Maximum tokens to generate */
    maxTokens?: number;
}

// ============================================================================
// LLM Tool-Calling Contract Types
// ============================================================================
//
// These are the LANGUAGE-LEVEL contract types for the llm/* substrate
// operators. The provider chat-completion types are the WIRE FORMAT; the
// runtime handler maps between them. Defined here so
// the dependency direction stays core → nothing.

/**
 * A message in an LLM tool-calling conversation.
 */
export interface LlmMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    /** Present on assistant messages that called tools. */
    toolCalls?: ReadonlyArray<LlmToolCall>;
    /** Present on tool-role messages — matches the preceding toolCall's id. */
    toolCallId?: string;
}

/**
 * A tool call requested by the assistant.
 */
export interface LlmToolCall {
    id: string;
    name: string;
    /** JSON-encoded arguments string (as returned by the LLM). */
    arguments: string;
}

/**
 * A tool definition passed to llm/call-tools.
 */
export interface LlmToolDef {
    name: string;
    description: string;
    /** JSON Schema describing the tool's parameters. */
    parameters: JsonSchema;
}

/**
 * Result of llm/call-tools.
 */
export interface LlmCallToolsResult {
    /** The assistant's text response (may be empty when only tool_calls fired). */
    content: string;
    /** Tool calls the assistant requested, if any. */
    toolCalls?: ReadonlyArray<LlmToolCall>;
    /** Token usage from the call. */
    usage: LlmTokenUsage;
}

/**
 * Token usage from an LLM call.
 */
export interface LlmTokenUsage {
    prompt: number;
    completion: number;
    total: number;
}

// ============================================================================
// Agent Search Types
// ============================================================================

/**
 * Result from agent/search-code.
 */
export interface AgentCodeSearchResult {
    /** Repository name (owner/repo) */
    repo: string;
    /** File path within the repository */
    path: string;
    /** URL to the file */
    url: string;
}

// ============================================================================
// Substrate Result Types
// ============================================================================
//
// Language-level contracts for compose/behavior/validate operator returns.
// Defined in @almadar/core (not @almadar-io/rabit) because the compiled path
// also needs them — emitted TS code references these types without depending
// on rabit. rabit's TS implementations produce/consume these shapes.

/** Result of validate/validate for a single orbital or the composed schema. */
export interface ValidateResult {
    valid: boolean;
    errorCount: number;
    errors: ValidationError[];
    orbitalName?: string;
}

/** Result of the repair service. */
export interface RepairResult {
    orbitalName: string;
    success: boolean;
    attempt: number;
    paramsChanged: boolean;
    error?: string;
}

/** Result of the planner service. */
export interface PlannerResult {
    organism: string;
    operationCount: number;
    pendingQuestions: boolean;
    cached: boolean;
    success: boolean;
    error?: string;
}

/** Result of the executor (spawn-subagents). */
export interface ExecutePlanResult {
    dispatchedOrbitals: string[];
    noopForBuild: boolean;
    success: boolean;
    error?: string;
}

/** Result of dispatch-updates. */
export interface DispatchUpdatesResult {
    updatedOrbitals: string[];
    updateCount: number;
    success: boolean;
}

/** Discriminated union of all substrate service-call results. */
export type ServiceCallResult =
    | ValidateResult
    | RepairResult
    | PlannerResult
    | ExecutePlanResult
    | DispatchUpdatesResult;

// ============================================================================
// Session History
// ============================================================================

/** A single entry in an orbital's session history (build/conversation log). */
export interface SessionHistoryEntry {
    /** Role of the entry's author (e.g. 'user', 'assistant', 'system') */
    role: string;
    /** Entry content (natural language or structured description) */
    content: string;
    /** Epoch milliseconds when the entry was recorded */
    timestamp: number;
}

/**
 * Runtime guard for `SessionHistoryEntry` — narrows interpreter-produced
 * `unknown` values at the `SessionContext.appendHistory` boundary.
 */
export function isSessionHistoryEntry(value: RuntimeValue): value is SessionHistoryEntry {
    if (typeof value !== 'object' || value === null) return false;
    return (
        'role' in value && typeof value.role === 'string' &&
        'content' in value && typeof value.content === 'string' &&
        'timestamp' in value && typeof value.timestamp === 'number'
    );
}

// ============================================================================
// Agent Context Interface
// ============================================================================

/**
 * AgentContext is the runtime contract for agent/* operators.
 *
 * The evaluator dispatches agent/* operators to methods on this interface.
 * Pure methods (usable in guards) return synchronously.
 * Effect methods return Promises.
 *
 * When ctx.agent is undefined, operators return safe defaults ([], 0, false, "").
 * Implementations live in @almadar-io/agent-runtime (Phase 2B).
 */
export interface AgentContext {
    // Memory (pure)
    recall(query: string, limit?: number): AgentMemoryRecord[];
    memories(category?: AgentMemoryCategory): AgentMemoryRecord[];
    memoryStrength(id: string): number;
    isPinned(id: string): boolean;

    // Memory (effects)
    memorize(content: string, category: AgentMemoryCategory, scope?: 'global' | 'project'): Promise<string>;
    forget(id: string): Promise<void>;
    pin(id: string): Promise<void>;
    reinforce(id: string): Promise<void>;
    decay(): Promise<number>;

    // LLM (pure)
    provider(): string;
    model(): string;

    // LLM (effects)
    generate(prompt: string, options?: AgentGenerateOptions): Promise<string>;
    switchProvider(provider: string, model?: string): void;

    // Tools (pure)
    tools(): string[];

    // Tools (effects)
    invoke(toolName: string, args: ServiceParams): Promise<EventPayloadValue>;

    // Context (pure)
    tokenCount(): number;
    contextUsage(): number;

    // Context (effects)
    compact(strategy?: AgentCompactStrategy): Promise<AgentCompactResult>;

    // Session (pure)
    sessionId(): string;

    // Session (effects)
    fork(label?: string): Promise<string>;
    label(text: string): void;

    // Search (effects)
    searchCode(query: string, language?: string): Promise<AgentCodeSearchResult[]>;
}

// ============================================================================
// Substrate Context Interfaces
// ============================================================================
//
// Focused runtime contracts for the substrate operator namespaces. Each
// interface backs one module of operators (llm/*, workspace/*, etc.). The
// evaluator reads from ctx.<namespace>; the runtime (rabit) supplies
// concrete implementations via contextExtensions. When a context is
// undefined, operators return safe defaults (matching the agent/* pattern).

/** Backs the llm/* operators (6 ops). */
export interface LlmContext {
    generate(prompt: string, options?: { json?: boolean; maxTokens?: number; provider?: string; model?: string }): Promise<string>;
    callTools(messages: LlmMessage[], tools: LlmToolDef[]): Promise<LlmCallToolsResult>;
    embed(texts: string[]): Promise<number[][]>;
    tokenCount(): number;
    switchProvider(provider: string, model?: string): void;
    compact(strategy?: string): Promise<{ before: number; after: number }>;
}

/** Backs the workspace/* operators (11 ops). */
export interface WorkspaceContext {
    readOrbital(name: string): Promise<Orbital>;
    writeOrbital(name: string, content: Orbital): Promise<void>;
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    exists(path: string): boolean;
    listOrbitals(): string[];
    readSchema(): Promise<OrbitalSchema>;
    writeSchema(schema: OrbitalSchema): Promise<void>;
    readPlan(): Promise<PlanSnapshot>;
    writePlan(plan: PlanSnapshot): Promise<void>;
    archiveOrbital(name: string): Promise<void>;
}

/** Backs the session/* operators (9 ops). */
export interface SessionContext {
    readSpec(orbitalName: string): Promise<Orbital>;
    writeSpec(orbitalName: string, spec: Orbital): Promise<void>;
    readMemory(orbitalName: string): Promise<AgentMemoryRecord[]>;
    writeMemory(orbitalName: string, memory: AgentMemoryRecord[]): Promise<void>;
    readHistory(orbitalName: string): Promise<SessionHistoryEntry[]>;
    appendHistory(orbitalName: string, entry: SessionHistoryEntry): Promise<void>;
    readErrors(orbitalName: string): Promise<string[]>;
    writeErrors(orbitalName: string, errors: string[]): Promise<void>;
    readAnalysis(orbitalName: string): Promise<AnalysisResult>;
}

/** Backs the memory/* operators (3 ops). */
export interface MemoryContext {
    recall(query: string, limit?: number): AgentMemoryRecord[];
    store(content: string, category?: string, strength?: number): Promise<string>;
    list(category?: string): AgentMemoryRecord[];
}

/** Backs the trace/* operators (2 ops). */
export interface TraceContext {
    emit(event: string, payload?: EventPayloadValue): void;
    log(message: string, level?: 'log' | 'warn' | 'error', data?: EventPayloadValue): void;
}
