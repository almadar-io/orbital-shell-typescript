/**
 * Agent-trace view-model — the canonical render shapes for the studio's
 * agent-trace UI (ChatBar, SubagentTracePanel and their sub-components).
 *
 * Promoted out of apps/builder so the trace components can move into
 * `@almadar/ui` without depending on `@almadar-io/agent-trace`,
 * `@almadar-io/rabit`, or apps/builder-local hooks. These are pure
 * presentation shapes — what the components read, nothing the runtime
 * produces. Arbitrary tool payloads use core's `JsonValue` / `ToolArgs`
 * (see `./types/json`), never `unknown`.
 *
 * @packageDocumentation
 */

import type { JsonValue, ToolArgs } from './types/json.js';
import type { SemanticChangeKind } from './types/changeset.js';
import type { LlmCallMeta } from './types/sse.js';
import { EventPayloadSchema, type EventPayload } from './types/expression.js';

// ----------------------------------------------------------------------------
// Shared leaf shapes
// ----------------------------------------------------------------------------

/** Which kind of tool an in-app assistant used: a declared input, an entity read, or a name it was not given. Absent for other agents' tools. */
export type AppToolKind = 'input' | 'read' | 'invalid';

/** Conversational role rendered with an avatar/icon in the trace stream. */
export type TraceAvatarRole = 'user' | 'assistant' | 'system';

/** File-mutation kind surfaced by a `file_operation` trace activity. */
export type TraceFileOperation = 'ls' | 'read_file' | 'write_file' | 'edit_file';

/** A single line within a unified-diff hunk. */
export interface TraceDiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
}

/** A unified-diff hunk rendered by a `schema_diff` trace activity. */
export interface TraceDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: TraceDiffLine[];
}

// ----------------------------------------------------------------------------
// TraceActivity — the coordinator/page-level `Activity` discriminated union
// ----------------------------------------------------------------------------

/**
 * Page-level agent activity. Discriminated by `type`; each variant carries
 * only the fields the trace components read. Mirrors apps/builder's local
 * `Activity` union (useAgentChat.ts). Tool args are `ToolArgs`, tool results
 * are `JsonValue` — no `unknown`.
 */
export type TraceActivity =
  | { type: 'message'; role: TraceAvatarRole; content: string; timestamp: number; isStreaming?: boolean }
  /** The agent used a tool. `argsText` is the arguments exactly as the model wrote them. */
  | { type: 'tool_call'; tool: string; kind?: AppToolKind; argsText: string; timestamp: number; isExecuting?: boolean }
  /** What the tool answered: whether it took effect, why not, how many rows a read returned, and the full answer the model saw. */
  | { type: 'tool_result'; tool: string; kind?: AppToolKind; success: boolean; detail?: string; rows?: number; resultText: string; timestamp: number }
  | { type: 'file_operation'; operation: TraceFileOperation; path: string; success?: boolean; timestamp: number }
  | { type: 'schema_diff'; filePath: string; hunks: TraceDiffHunk[]; timestamp: number }
  | { type: 'error'; message: string; code?: string; timestamp: number }
  | { type: 'coordinator_decision'; organism: string; reason: string; priorOrganism: string | null; timestamp: number }
  | { type: 'plan_committed'; orbitals: string[]; timestamp: number }
  | { type: 'pending_question'; questionId: string; question: string; orbitalName?: string; timestamp: number }
  | {
      type: 'clarification_question';
      level: 'organism' | 'molecule' | 'atom_trait';
      scope: { orbitalName?: string; traitName?: string };
      question: string;
      candidates: Array<{
        id: string;
        label: string;
        description: string;
        whyThisFits: string;
      }>;
      skipDefault: string;
      timestamp: number;
    }
  | {
      type: 'analysis';
      organism: string;
      organismReason?: string;
      complexity?: { category: string; reasoning: string };
      renames: Array<{ from: string; to: string }>;
      deletes: string[];
      timestamp: number;
    }
  | { type: 'orbital_started'; orbitalName: string; timestamp: number }
  | { type: 'orbital_done'; orbitalName: string; traitCount?: number; transitionCount?: number; timestamp: number }
  | {
      type: 'schema_change';
      changeKind: SemanticChangeKind;
      orbitalName: string;
      traitName?: string;
      transitionEvent?: string;
      timestamp: number;
    }
  | { type: 'done'; orbitalCount: number; timestamp: number }
  | { type: 'cancelled'; message: string; timestamp: number }
  /** A raw LLM response, with the call that produced it when known. */
  | { type: 'llm_response'; content: string; llm?: LlmCallMeta; timestamp: number };

/** Every `TraceActivity` type — the vocabulary a host picks an audience's view from. */
export const TRACE_ACTIVITY_TYPES = [
  'message',
  'tool_call',
  'tool_result',
  'file_operation',
  'schema_diff',
  'error',
  'coordinator_decision',
  'plan_committed',
  'pending_question',
  'clarification_question',
  'analysis',
  'orbital_started',
  'orbital_done',
  'schema_change',
  'done',
  'cancelled',
  'llm_response',
] as const satisfies ReadonlyArray<TraceActivity['type']>;

/** Which activities one audience sees. */
export interface TraceActivityAudience {
  types: ReadonlyArray<TraceActivity['type']>;
  /** Message roles shown; omitted = every role. */
  messageRoles?: ReadonlyArray<TraceAvatarRole>;
  /** `schema_change` kinds shown; omitted = every kind. */
  schemaChangeKinds?: ReadonlyArray<SemanticChangeKind>;
}

export function selectTraceActivities(
  activities: readonly TraceActivity[],
  audience: TraceActivityAudience,
): TraceActivity[] {
  return activities.filter((activity) => {
    if (!audience.types.includes(activity.type)) return false;
    if (activity.type === 'message' && audience.messageRoles) return audience.messageRoles.includes(activity.role);
    if (activity.type === 'schema_change' && audience.schemaChangeKinds) {
      return audience.schemaChangeKinds.includes(activity.changeKind);
    }
    return true;
  });
}

/**
 * One activity as the payload a host delivers for a live step
 * (`ServiceHostPorts.message`): `{ activity }`. Absent optional fields are dropped.
 */
export function traceActivityPayload(activity: TraceActivity): EventPayload {
  return EventPayloadSchema.parse({ activity: JSON.parse(JSON.stringify(activity)) });
}

// ----------------------------------------------------------------------------
// TraceActivityItem — the agent-trace `ActivityItem` render union
// ----------------------------------------------------------------------------

/**
 * Trace-stream activity item, the shape `InlineActivityRow` /
 * `InlineActivityStream` render. Mirrors `@almadar-io/agent-trace`'s
 * `ActivityItem`. Distinct from `TraceActivity`: `message.role` includes
 * `'tool'` and an optional `label`; it omits the coordinator/plan/question
 * variants. A tool's arguments and answer are text (`argsText`, `resultText`):
 * exactly what the agent sent and got back.
 */
export type TraceActivityItem =
  | {
      type: 'message';
      role: TraceAvatarRole | 'tool';
      content: string;
      timestamp: number;
      isStreaming?: boolean;
      label?: string;
    }
  | { type: 'tool_call'; tool: string; argsText: string; timestamp: number; isExecuting?: boolean }
  | { type: 'tool_result'; tool: string; resultText: string; success: boolean; timestamp: number; durationMs?: number }
  | { type: 'file_operation'; operation: TraceFileOperation; path: string; success?: boolean; timestamp: number }
  | { type: 'schema_diff'; filePath: string; hunks: TraceDiffHunk[]; timestamp: number }
  | { type: 'error'; message: string; code?: string; timestamp: number }
  | { type: 'milestone'; milestone: string; summary?: string; timestamp: number };

// ----------------------------------------------------------------------------
// TraceSubagent — the `SubagentState` panel model
// ----------------------------------------------------------------------------

/** One progress entry within a subagent's running log. */
export interface TraceSubagentMessage {
  message: string;
  tool?: string;
  timestamp: number;
}

/**
 * Live subagent state rendered by `SubagentRow` / `SubagentRichCard` /
 * `OrbitalGroup`. Mirrors apps/builder's `SubagentState`. `orbitalName` is
 * the canvas-focus filter key.
 */
export interface TraceSubagent {
  id: string;
  name: string;
  role: string;
  orbitalName?: string;
  parentId?: string;
  status: 'running' | 'complete' | 'error';
  task: string;
  messages: TraceSubagentMessage[];
  durationMs?: number;
  /** Full nested activity (tool calls, messages, milestones) for a rich
   *  per-subagent detail view — additive, optional; `messages` remains the
   *  flat progress-log shape for consumers that only need that. */
  timeline?: ReadonlyArray<TraceActivityItem>;
}

// ----------------------------------------------------------------------------
// TraceChatMessage — the rabit tool-loop `ChatMessage` model
// ----------------------------------------------------------------------------

/** A tool call emitted by an assistant `TraceChatMessage`. */
export interface TraceChatMessageToolCall {
  id: string;
  name: string;
  /** Parsed JSON arguments (the LLM emits a JSON string; stored parsed). */
  args: ToolArgs;
}

/**
 * Canonical coordinator conversation message rendered by `ChatMessageRow` /
 * `CoordinatorConversation`. Mirrors rabit's tool-loop `ChatMessage`
 * (role/content/toolCalls/toolCallId/toolName/reasoningContent).
 */
export interface TraceChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present on assistant messages that called tools. */
  toolCalls?: ReadonlyArray<TraceChatMessageToolCall>;
  /** Present on tool messages — matches the `id` of the corresponding tool_call. */
  toolCallId?: string;
  /** Tool name on tool messages (cosmetic — helps tracing). */
  toolName?: string;
  /** Thinking-mode chain-of-thought (DeepSeek), echoed back on tool round-trips. */
  reasoningContent?: string;
}


export interface AgentTraceState {
  activities: TraceActivity[];
  subagents: TraceSubagent[];
  coordinatorMessages: TraceChatMessage[];
  status: 'idle' | 'running' | 'paused' | 'complete' | 'error';
}
