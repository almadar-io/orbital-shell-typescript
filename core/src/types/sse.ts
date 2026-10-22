/**
 * Canonical SSE event types for the Almadar agent wire.
 *
 * These events are emitted by the rabit runtime (internal package
 * `@almadar-io/rabit`) and consumed by public SDK clients. Because the rabit
 * package is private, the SDK-relevant subset of the event surface is hoisted
 * here into `@almadar/core` so public consumers can type their `onEvent`
 * callbacks without depending on a private package.
 *
 * Rules for this file:
 *   - Use only types already exported by `@almadar/core`.
 *   - Do not import from `@almadar-io/rabit` or any other private package.
 *   - Keep the discriminated union exhaustive over the included event types.
 */

import type { JsonObject, JsonValue, ToolArgs } from './json.js';
import type { OrbitalDefinition } from './orbital.js';
import type { OrbitalSchema } from './schema.js';

export type SSEEventType =
  | 'start'
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'todo_update'
  | 'todo_detail'
  | 'file_operation'
  | 'file_written'
  | 'schema_update'
  | 'generation_log'
  | 'subagent_event'
  | 'subagent_start'
  | 'subagent_progress'
  | 'subagent_complete'
  | 'interrupt'
  | 'error'
  | 'cancelled'
  | 'complete'
  | 'app_created'
  | 'schema_phase_validated'
  | 'schema_phase_update'
  | 'orbital_added'
  | 'orbital_schema_complete'
  | 'process_start'
  | 'process_complete'
  | 'process_error'
  | 'process_repair'
  | 'process_repair_complete'
  | 'params_repair_emitted'
  | 'changeset_recorded'
  | 'snapshot_created';

export interface SSEEventBase {
  type: SSEEventType;
  timestamp: number;
}

export interface StartEvent extends SSEEventBase {
  type: 'start';
  data: {
    threadId: string;
    skill: string;
    workDir: string;
  };
}

/**
 * The LLM call behind a raw `message` frame — everything the trace records,
 * untruncated. A type alias (not an interface) so it stays assignable to
 * `EventPayload` when it rides a service result or a bus payload.
 */
export type LlmCallMeta = {
  service: string;
  provider: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  toolCallsJson?: string;
  attempt?: number;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedPromptTokens?: number;
  costUSD?: number;
};

export interface MessageEvent extends SSEEventBase {
  type: 'message';
  data: {
    content: string;
    role: 'assistant' | 'user' | 'system';
    isComplete: boolean;
    /** Present when the frame is a raw LLM response. */
    llm?: LlmCallMeta;
  };
}

export interface ToolCallEvent extends SSEEventBase {
  type: 'tool_call';
  data: {
    tool: string;
    args: ToolArgs;
  };
}

export interface ToolResultEvent extends SSEEventBase {
  type: 'tool_result';
  data: {
    tool: string;
    result: JsonValue;
    success: boolean;
  };
}

export interface TodoUpdateEvent extends SSEEventBase {
  type: 'todo_update';
  data: {
    todos: Array<{
      id: string;
      task: string;
      status: 'pending' | 'in_progress' | 'completed';
    }>;
  };
}

export type TodoActivityType = 'thinking' | 'tool_call' | 'tool_result' | 'code_change';

export interface TodoDetailEvent extends SSEEventBase {
  type: 'todo_detail';
  data: {
    todoId: string;
    activityType: TodoActivityType;
    content: string;
    tool?: string;
    args?: ToolArgs;
    success?: boolean;
    filePath?: string;
    diff?: string;
  };
}

export interface FileOperationEvent extends SSEEventBase {
  type: 'file_operation';
  data: {
    operation: 'ls' | 'read_file' | 'write_file' | 'edit_file';
    path: string;
    success: boolean;
  };
}

export interface FileWrittenEvent extends SSEEventBase {
  type: 'file_written';
  data: {
    path: string;
    fileType: 'schema' | 'orbital' | 'memory' | 'domain' | 'other';
    orbitalName?: string;
  };
}

export interface SchemaUpdateEvent extends SSEEventBase {
  type: 'schema_update';
  data: {
    appId: string;
    version: number;
    schema: OrbitalSchema;
    isNew: boolean;
    snapshotId?: string;
    changesetId?: string;
  };
}

export interface GenerationLogEvent extends SSEEventBase {
  type: 'generation_log';
  data: {
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    data?: JsonObject;
    orbitalName?: string;
  };
}

export interface SubagentEvent extends SSEEventBase {
  type: 'subagent_event';
  data: {
    orbitalName: string;
    orbitalIndex: number;
    totalOrbitals: number;
    event: {
      type: Exclude<SSEEventType, 'subagent_event'>;
      data: JsonObject;
      timestamp: number;
    };
  };
}

export interface SubagentStartEvent extends SSEEventBase {
  type: 'subagent_start';
  data: {
    subagentId: string;
    name: string;
    role: string;
    orbitalName?: string;
    parentId?: string;
    task: string;
  };
}

export interface SubagentProgressEvent extends SSEEventBase {
  type: 'subagent_progress';
  data: {
    subagentId: string;
    orbitalName?: string;
    message: string;
    toolCall?: { tool: string; argsPreview?: string };
  };
}

export interface SubagentCompleteEvent extends SSEEventBase {
  type: 'subagent_complete';
  data: {
    subagentId: string;
    orbitalName?: string;
    success: boolean;
    durationMs: number;
    summary?: string;
  };
}

export interface InterruptEvent extends SSEEventBase {
  type: 'interrupt';
  data: {
    threadId: string;
    actionRequests: Array<{
      tool: string;
      args: ToolArgs;
      allowedDecisions: ('approve' | 'edit' | 'reject')[];
      description?: string;
    }>;
  };
}

export interface ErrorEvent extends SSEEventBase {
  type: 'error';
  data: {
    error: string;
    code?: string;
    /** Orbital names that failed, when a generation run ends in failure. */
    failedOrbitals?: string[];
    /** Typed validate/failure lines backing `error` (same format as `cache_demoted.errors`). */
    errors?: string[];
  };
}

export interface CancelledEvent extends SSEEventBase {
  type: 'cancelled';
  data: {
    threadId: string;
    message: string;
  };
}

export interface CompleteEvent extends SSEEventBase {
  type: 'complete';
  data: {
    threadId: string;
    skill: string;
    workDir: string;
    schemaGenerated: boolean;
    appCompiled: boolean;
    schema?: OrbitalSchema;
    appId?: string;
    schemaPersisted?: boolean;
    snapshotId?: string;
    changesetId?: string;
  };
}

export interface AppCreatedEvent extends SSEEventBase {
  type: 'app_created';
  data: {
    appId: string;
    name?: string;
    orbitalCount?: number;
    fromOrbitalPersistence?: boolean;
  };
}

export interface SchemaPhaseValidatedEvent extends SSEEventBase {
  type: 'schema_phase_validated';
  data: {
    appId: string;
    success: boolean;
    errors?: JsonValue[];
  };
}

export interface SchemaPhaseUpdateEvent extends SSEEventBase {
  type: 'schema_phase_update';
  data: JsonObject;
}

export interface OrbitalAddedEvent extends SSEEventBase {
  type: 'orbital_added';
  data: {
    appId: string;
    orbitalName: string;
    orbitalIndex: number;
    totalOrbitals: number;
    isNew?: boolean;
    orbitalSchema?: OrbitalDefinition;
  };
}

export interface OrbitalSchemaCompleteEvent extends SSEEventBase {
  type: 'orbital_schema_complete';
  data: {
    appId: string;
    totalOrbitals: number;
    orbitalNames: string[];
  };
}

export interface ProcessStartEvent extends SSEEventBase {
  type: 'process_start';
  data: {
    orbitalName: string;
    method: 'deterministic' | 'llm';
    behavior?: string;
  };
}

export interface ProcessCompleteEvent extends SSEEventBase {
  type: 'process_complete';
  data: {
    orbitalName: string;
    method: 'deterministic' | 'llm';
    traitCount?: number;
    transitionCount?: number;
    duration?: number;
  };
}

export interface ProcessErrorEvent extends SSEEventBase {
  type: 'process_error';
  data: {
    orbitalName: string;
    method: 'deterministic' | 'llm';
    error: string;
    /** Typed validate/failure lines for this orbital (from `orbital_failed.errors`). */
    errors?: string[];
  };
}

export interface ProcessRepairEvent extends SSEEventBase {
  type: 'process_repair';
  data: {
    orbitalName: string;
    errorCount: number;
    attempt: number;
  };
}

export interface ProcessRepairCompleteEvent extends SSEEventBase {
  type: 'process_repair_complete';
  data: { orbitalName: string };
}

export interface ParamsRepairEmittedEvent extends SSEEventBase {
  type: 'params_repair_emitted';
  data: { orbitalName: string; attempt: number };
}

export interface ChangesetRecordedEvent extends SSEEventBase {
  type: 'changeset_recorded';
  data: {
    appId: string;
    changesetId: string;
    version: number;
    trackingMode: 'initial' | 'update';
    summary: {
      added: number;
      modified: number;
      removed: number;
    };
    source?: string;
  };
}

export interface SnapshotCreatedEvent extends SSEEventBase {
  type: 'snapshot_created';
  data: {
    appId: string;
    snapshotId: string;
    version: number;
    reason: string;
  };
}

export type SSEEvent =
  | StartEvent
  | MessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | TodoUpdateEvent
  | TodoDetailEvent
  | FileOperationEvent
  | FileWrittenEvent
  | SchemaUpdateEvent
  | GenerationLogEvent
  | SubagentEvent
  | SubagentStartEvent
  | SubagentProgressEvent
  | SubagentCompleteEvent
  | InterruptEvent
  | ErrorEvent
  | CancelledEvent
  | CompleteEvent
  | AppCreatedEvent
  | SchemaPhaseValidatedEvent
  | SchemaPhaseUpdateEvent
  | OrbitalAddedEvent
  | OrbitalSchemaCompleteEvent
  | ProcessStartEvent
  | ProcessCompleteEvent
  | ProcessErrorEvent
  | ProcessRepairEvent
  | ProcessRepairCompleteEvent
  | ParamsRepairEmittedEvent
  | ChangesetRecordedEvent
  | SnapshotCreatedEvent;
