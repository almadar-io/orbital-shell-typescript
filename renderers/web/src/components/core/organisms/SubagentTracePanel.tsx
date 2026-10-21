'use client';
/**
 * SubagentTracePanel — contextual side panel that surfaces subagent activity.
 *
 * Density adapts to disclosure level:
 *   - L1/L2 (builder/designer): compact mode — name + role badge + last message
 *   - L3/L4 (architect): full mode — rich per-subagent activity streams
 *
 * Atomic design: composes Box / VStack / HStack / Typography / Badge / Icon /
 * Button / Modal / Accordion / CodeBlock / MarkdownContent from this package.
 * It reads the agent-trace view-model from `@almadar/core` (Trace* types) and
 * owns no transport — the consumer feeds it already-mapped view-model props.
 */

import React, { useState } from 'react';
import { Box } from '../../../core';
import { VStack, HStack } from '../../../core';
import { Typography } from '../../../core';
import { Badge } from '../../../core';
import { Icon } from '../../../core';
import { Button } from '../../../core';
import { Modal } from '../molecules/Modal';
import { Accordion, type AccordionItem } from '../molecules/Accordion';
import { CodeBlock, MarkdownContent } from '../molecules/markdown';
import { useTranslate, type TranslateFunction } from '../../../core';
import { pressableProps } from '../../../core';
import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../../core';
import type { DisplayStateProps } from './types';
import type {
  TraceActivity,
  TraceActivityItem,
  TraceSubagent,
  TraceSubagentMessage,
  TraceChatMessage,
  JsonValue,
  ToolArgs,
} from '@almadar/core';

/** Disclosure level driving panel density (builder=1 … architect=4). */
export type TraceDisclosureLevel = 1 | 2 | 3 | 4;

export interface SubagentTracePanelProps extends DisplayStateProps, Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** All known subagents from the runner. */
  subagents: TraceSubagent[];
  /** Current canvas focus orbital — only used by overlay mode. Tab mode ignores this. */
  focusedOrbital?: string;
  /** Drives density: 1-2 → compact, 3-4 → full activity embed (when mode='overlay'). */
  disclosureLevel: TraceDisclosureLevel;
  /** Whether the panel is visible. Typically auto-opens during generation in overlay mode. */
  open: boolean;
  /** Optional dismiss handler. */
  onClose?: () => void;
  /** Full coordinator activities (tool calls, results, messages, errors). */
  coordinatorActivities?: TraceActivity[];
  /**
   * Canonical Coordinator conversation — same shape live and on reload. When
   * present, takes precedence over `coordinatorActivities` for the Coordinator
   * section.
   */
  coordinatorMessages?: readonly TraceChatMessage[];
  /**
   * Rendering mode.
   * - `'overlay'` (default): floating side panel positioned absolutely over the
   *   canvas. Density follows `disclosureLevel` (compact L1/L2, rich L3+). The
   *   `open` flag actually hides the panel when false.
   * - `'tab'`: full-width content for a dedicated 'trace' supplemental tab.
   *   Always renders rich (regardless of disclosure level), always visible (the
   *   `open` flag is ignored), and includes an empty state when no subagents
   *   are present so users see the surface even before generation starts.
   */
  mode?: 'overlay' | 'tab';
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Group subagents by orbitalName. Subagents without an orbital go under `unattachedLabel`. */
function groupByOrbital(subagents: TraceSubagent[], unattachedLabel: string): Map<string, TraceSubagent[]> {
  const map = new Map<string, TraceSubagent[]>();
  for (const sub of subagents) {
    const key = sub.orbitalName ?? unattachedLabel;
    const arr = map.get(key) ?? [];
    arr.push(sub);
    map.set(key, arr);
  }
  return map;
}

/** Pick the right status icon name based on subagent state. */
function statusIconName(status: TraceSubagent['status']): string {
  switch (status) {
    case 'running': return 'loader';
    case 'complete': return 'check';
    case 'error': return 'x';
    default: return 'circle';
  }
}

/** Get the most recent progress message from a subagent's history. */
function lastMessage(sub: TraceSubagent): string | undefined {
  if (sub.messages.length === 0) return undefined;
  return sub.messages[sub.messages.length - 1].message;
}

function formatHHMMSS(ts: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ts));
}

function compactJson(value: JsonValue | ToolArgs | TraceActivityItem | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    const json = JSON.stringify(value);
    if (json.length <= 240) return json;
    return json.slice(0, 239) + '…';
  } catch {
    return String(value);
  }
}

function tryPrettyJson(s: string): string | null {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return null;
  }
}

function summarizeArgs(args: ToolArgs): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  return keys.slice(0, 3).join(', ') + (keys.length > 3 ? ', …' : '');
}

function previewText(text: string | undefined, max = 120): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// ─── Existing overlay components (kept unchanged) ─────────────────────

/** Convert page-level TraceActivity[] to TraceActivityItem[] for the inline stream. */
function coordinatorToActivityItems(activities: TraceActivity[], t: TranslateFunction): TraceActivityItem[] {
  return activities.flatMap((a): TraceActivityItem[] => {
    switch (a.type) {
      case 'tool_call':
        return [{ type: 'tool_call', tool: a.tool, argsText: a.argsText, timestamp: a.timestamp }];
      case 'tool_result':
        return [{ type: 'tool_result', tool: a.tool, resultText: a.resultText, success: a.success, timestamp: a.timestamp }];
      case 'message':
        return [{
          type: 'message',
          role: a.role,
          content: a.content,
          timestamp: a.timestamp,
        }];
      case 'error':
        return [{
          type: 'message',
          role: 'system' as const,
          content: t('subagentTrace.errorMessage', { message: a.message }),
          timestamp: a.timestamp,
        }];
      case 'coordinator_decision':
      case 'plan_committed':
      case 'pending_question':
      case 'clarification_question':
      case 'analysis':
      case 'orbital_started':
      case 'orbital_done':
      case 'schema_change':
      case 'done':
      case 'cancelled':
        return [];
      case 'llm_response':
        return [{
          type: 'message',
          role: 'assistant',
          content: a.content,
          timestamp: a.timestamp,
        }];
      case 'file_operation':
        return [{
          type: 'file_operation',
          operation: a.operation,
          path: a.path,
          success: a.success,
          timestamp: a.timestamp,
        }];
      case 'schema_diff':
        return [{
          type: 'schema_diff',
          filePath: a.filePath,
          hunks: a.hunks,
          timestamp: a.timestamp,
        }];
    }
  });
}

interface CoordinatorSnapshot {
  decision: Extract<TraceActivity, { type: 'coordinator_decision' }> | null;
  plan: Extract<TraceActivity, { type: 'plan_committed' }> | null;
  pendingQuestions: Extract<TraceActivity, { type: 'pending_question' }>[];
}

function pluckCoordinatorState(activities: TraceActivity[]): CoordinatorSnapshot {
  let decision: CoordinatorSnapshot['decision'] = null;
  let plan: CoordinatorSnapshot['plan'] = null;
  const pendingQuestions: CoordinatorSnapshot['pendingQuestions'] = [];
  for (const a of activities) {
    if (a.type === 'coordinator_decision') decision = a;
    else if (a.type === 'plan_committed') plan = a;
    else if (a.type === 'pending_question') pendingQuestions.push(a);
  }
  return { decision, plan, pendingQuestions };
}

interface InlineRowProps extends DisplayStateProps {
  activity: TraceActivityItem;
}

const InlineActivityRow: React.FC<InlineRowProps> = ({ activity }) => {
  const { locale } = useTranslate();
  const time = formatHHMMSS(activity.timestamp, locale);
  const baseRow = 'items-start px-3 py-1 hover:bg-[var(--color-surface)]';

  if (activity.type === 'tool_call') {
    return (
      <HStack gap="sm" className={baseRow}>
        <Icon name="terminal" size="xs" className="mt-0.5 flex-shrink-0 text-[var(--color-primary)]" />
        <Typography variant="caption" className="flex-1 min-w-0 text-[11px] font-mono break-all whitespace-pre-wrap">
          <Typography as="span" variant="caption" weight="semibold" className="text-[11px] font-mono">
            {activity.tool}
          </Typography>
          {activity.argsText !== '' && activity.argsText !== '{}' && (
            <Typography as="span" variant="caption" color="muted" className="text-[11px] font-mono">
              {' '}{activity.argsText}
            </Typography>
          )}
        </Typography>
        <Typography variant="caption" color="muted" className="text-[10px] flex-shrink-0 tabular-nums mt-0.5">
          {time}
        </Typography>
      </HStack>
    );
  }

  if (activity.type === 'tool_result') {
    const success = activity.success !== false;
    return (
      <HStack gap="sm" className={baseRow}>
        <Icon
          name={success ? 'check' : 'x'}
          size="xs"
          className={`mt-0.5 flex-shrink-0 ${success ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}
        />
        <Typography variant="caption" className="flex-1 min-w-0 text-[11px] font-mono break-all whitespace-pre-wrap">
          <Typography as="span" variant="caption" color="muted" className="text-[11px] font-mono">
            {activity.tool}:{' '}
          </Typography>
          <Typography as="span" variant="caption" className="text-[11px] font-mono">
            {activity.resultText}
          </Typography>
        </Typography>
        <Typography variant="caption" color="muted" className="text-[10px] flex-shrink-0 tabular-nums mt-0.5">
          {time}
        </Typography>
      </HStack>
    );
  }

  if (activity.type === 'message') {
    const role = activity.role;
    const iconName = role === 'user' ? 'user' : role === 'system' ? 'info' : 'sparkles';
    const roleColor =
      role === 'user' ? 'text-[var(--color-primary)]'
      : role === 'system' ? 'text-[var(--color-muted-foreground)]'
      : 'text-[var(--color-foreground)]';
    return (
      <HStack gap="sm" className={baseRow}>
        <Icon name={iconName} size="xs" className={`mt-0.5 flex-shrink-0 ${roleColor}`} />
        <Typography variant="caption" className="flex-1 min-w-0 text-[11px] whitespace-pre-wrap break-words">
          {activity.content}
        </Typography>
        <Typography variant="caption" color="muted" className="text-[10px] flex-shrink-0 tabular-nums mt-0.5">
          {time}
        </Typography>
      </HStack>
    );
  }

  if (activity.type === 'error') {
    return (
      <HStack gap="sm" className={baseRow}>
        <Icon name="alert-triangle" size="xs" className="mt-0.5 flex-shrink-0 text-[var(--color-danger)]" />
        <Typography variant="caption" className="flex-1 min-w-0 text-[11px] text-[var(--color-danger)] whitespace-pre-wrap break-words">
          {activity.message}
        </Typography>
        <Typography variant="caption" color="muted" className="text-[10px] flex-shrink-0 tabular-nums mt-0.5">
          {time}
        </Typography>
      </HStack>
    );
  }

  return (
    <HStack gap="sm" className={baseRow}>
      <Icon name="file" size="xs" className="mt-0.5 flex-shrink-0 text-[var(--color-muted-foreground)]" />
      <Typography variant="caption" color="muted" className="flex-1 min-w-0 text-[11px] font-mono break-all">
        [{activity.type}] {compactJson(activity)}
      </Typography>
      <Typography variant="caption" color="muted" className="text-[10px] flex-shrink-0 tabular-nums mt-0.5">
        {time}
      </Typography>
    </HStack>
  );
};

interface InlineActivityStreamProps extends DisplayStateProps {
  activities: readonly TraceActivityItem[];
  autoScroll?: boolean;
}

const InlineActivityStream: React.FC<InlineActivityStreamProps> = ({ activities, autoScroll = true, className }) => {
  const endRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!autoScroll) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activities.length, autoScroll]);

  return (
    <Box className={className}>
      {activities.map((a, i) => (
        <InlineActivityRow key={`${a.timestamp}-${i}`} activity={a} />
      ))}
      <Box ref={endRef} />
    </Box>
  );
};

interface CoordinatorCardProps extends DisplayStateProps {
  snapshot: CoordinatorSnapshot;
}

const CoordinatorCard: React.FC<CoordinatorCardProps> = ({ snapshot, className }) => {
  const { t } = useTranslate();
  const { decision, plan, pendingQuestions } = snapshot;
  if (!decision && !plan && pendingQuestions.length === 0) return null;
  return (
    <Box
      className={`px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-muted)]/30 ${className ?? ''}`}
    >
      <HStack gap="xs" className="items-center mb-2">
        <Icon name="compass" size="xs" />
        <Typography variant="caption" className="font-semibold text-[11px]">
          {t('subagentTrace.coordinator')}
        </Typography>
      </HStack>

      {decision && (
        <VStack gap="none" className="mb-2">
          <HStack gap="xs" className="items-center">
            <Typography variant="caption" color="muted" className="text-[10px] uppercase tracking-wide">
              {t('subagentTrace.organism')}
            </Typography>
            <Badge variant="default" className="text-[10px]">
              {decision.organism}
            </Badge>
            {decision.priorOrganism && decision.priorOrganism !== decision.organism && (
              <Typography variant="caption" color="muted" className="text-[10px]">
                {t('subagentTrace.wasOrganism', { organism: decision.priorOrganism })}
              </Typography>
            )}
          </HStack>
          {decision.reason && (
            <Typography variant="caption" color="muted" className="text-[11px] mt-0.5">
              {decision.reason}
            </Typography>
          )}
        </VStack>
      )}

      {plan && plan.orbitals.length > 0 && (
        <VStack gap="none" className="mb-2">
          <Typography variant="caption" color="muted" className="text-[10px] uppercase tracking-wide mb-0.5">
            {plan.orbitals.length === 1
              ? t('subagentTrace.planOrbital', { count: plan.orbitals.length })
              : t('subagentTrace.planOrbitals', { count: plan.orbitals.length })}
          </Typography>
          <HStack gap="xs" className="flex-wrap">
            {plan.orbitals.map(o => (
              <Badge key={o} variant="neutral" className="text-[10px]">
                {o}
              </Badge>
            ))}
          </HStack>
        </VStack>
      )}

      {pendingQuestions.length > 0 && (
        <VStack gap="none">
          <Typography variant="caption" color="muted" className="text-[10px] uppercase tracking-wide mb-0.5">
            {pendingQuestions.length === 1
              ? t('subagentTrace.pendingQuestion', { count: pendingQuestions.length })
              : t('subagentTrace.pendingQuestions', { count: pendingQuestions.length })}
          </Typography>
          {pendingQuestions.map(q => (
            <HStack key={q.questionId} gap="xs" className="items-start">
              <Icon name="help-circle" size="xs" className="mt-0.5 flex-shrink-0 text-[var(--color-warning)]" />
              <Typography variant="caption" className="text-[11px] flex-1 min-w-0">
                {q.question}
                {q.orbitalName && (
                  <Typography variant="caption" color="muted" className="text-[10px] ml-1">
                    ({q.orbitalName})
                  </Typography>
                )}
              </Typography>
            </HStack>
          ))}
        </VStack>
      )}
    </Box>
  );
};

function subagentMessagesToActivities(messages: TraceSubagentMessage[]): TraceActivityItem[] {
  return messages.map((m): TraceActivityItem => {
    if (m.tool) {
      return {
        type: 'tool_call',
        tool: m.tool,
        argsText: m.message,
        timestamp: m.timestamp,
      };
    }
    return {
      type: 'message',
      role: 'system',
      content: m.message,
      timestamp: m.timestamp,
    };
  });
}

interface SubagentRowProps extends DisplayStateProps {
  subagent: TraceSubagent;
}

const SubagentRow: React.FC<SubagentRowProps> = ({ subagent }) => {
  const recent = lastMessage(subagent);
  return (
    <HStack
      gap="sm"
      className="items-start px-3 py-2 border-b border-[var(--color-border)]"
    >
      <Box className="pt-0.5">
        <Icon name={statusIconName(subagent.status)} size="xs" />
      </Box>
      <VStack gap="none" className="flex-1 min-w-0">
        <HStack gap="sm" className="items-center">
          <Typography variant="caption" className="font-medium truncate">
            {subagent.name}
          </Typography>
          <Badge variant="default">{subagent.role}</Badge>
        </HStack>
        <Typography variant="caption" color="muted" className="truncate">
          {recent ?? subagent.task}
        </Typography>
      </VStack>
    </HStack>
  );
};

interface OrbitalGroupProps extends DisplayStateProps {
  orbitalName: string;
  subagents: TraceSubagent[];
}

const OrbitalGroup: React.FC<OrbitalGroupProps> = ({ orbitalName, subagents }) => {
  const { t } = useTranslate();
  const runningCount = subagents.filter(s => s.status === 'running').length;
  const completeCount = subagents.filter(s => s.status === 'complete').length;
  return (
    <VStack gap="none" className="border-b border-[var(--color-border)]">
      <HStack
        gap="sm"
        className="items-center px-3 py-2 bg-[var(--color-surface)] border-b border-[var(--color-border)]"
      >
        <Icon name="circle" size="xs" />
        <Typography variant="caption" className="font-semibold flex-1 truncate">
          {orbitalName}
        </Typography>
        <Badge variant="default">
          {runningCount > 0
            ? t('subagentTrace.countRunning', { count: runningCount })
            : t('subagentTrace.countDone', { count: completeCount })}
        </Badge>
      </HStack>
      {subagents.map(sub => (
        <SubagentRow key={sub.id} subagent={sub} />
      ))}
    </VStack>
  );
};

interface SubagentRichCardProps extends DisplayStateProps {
  subagent: TraceSubagent;
}

const SubagentRichCard: React.FC<SubagentRichCardProps> = ({ subagent }) => {
  const { t } = useTranslate();
  const activities = React.useMemo(
    () => subagentMessagesToActivities(subagent.messages),
    [subagent.messages],
  );
  return (
    <VStack gap="none" className="border-b border-[var(--color-border)] p-3">
      <HStack gap="sm" className="items-center mb-2">
        <Box
          style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            backgroundColor: subagent.status === 'complete' ? 'var(--color-success)'
              : subagent.status === 'error' ? 'var(--color-error)'
              : 'var(--color-primary)',
            ...(subagent.status === 'running' ? { animation: 'pulse 1.5s infinite' } : {}),
          }}
        />
        <Typography variant="caption" className="font-semibold flex-1 truncate">
          {subagent.name}
        </Typography>
        <Badge variant={subagent.role === 'deterministic' ? 'default' : subagent.role === 'llm' ? 'info' : 'warning'}>
          {subagent.role}
        </Badge>
        {subagent.durationMs !== undefined && subagent.durationMs > 0 && (
          <Typography variant="caption" color="muted">
            {subagent.durationMs < 1000 ? `${subagent.durationMs}ms` : `${(subagent.durationMs / 1000).toFixed(1)}s`}
          </Typography>
        )}
      </HStack>
      <Typography variant="caption" color="muted" className="mb-2">
        {subagent.task}
      </Typography>
      {activities.length > 0 ? (
        <Box className="max-h-64 overflow-y-auto border-t border-[var(--color-border)]">
          <InlineActivityStream activities={activities} autoScroll />
        </Box>
      ) : (
        <Typography variant="caption" color="muted" className="italic text-[10px]">
          {subagent.status === 'complete' ? t('subagentTrace.noConversationLog') : t('subagentTrace.waitingForProcessData')}
        </Typography>
      )}
    </VStack>
  );
};

const roleBadgeVariant: Record<TraceChatMessage['role'], 'default' | 'info' | 'warning' | 'neutral'> = {
  system: 'neutral',
  user: 'info',
  assistant: 'default',
  tool: 'warning',
};

interface ChatMessageRowProps extends DisplayStateProps {
  message: TraceChatMessage;
  index: number;
}

const ChatMessageRow: React.FC<ChatMessageRowProps> = ({ message, index }) => {
  const { t } = useTranslate();
  const { role, content, toolCalls, reasoningContent, toolCallId, toolName } = message;

  if (role === 'tool') {
    const pretty = tryPrettyJson(content);
    const title = `${toolName ?? t('subagentTrace.role.tool')} →${toolCallId ? ` ${toolCallId.slice(0, 8)}` : ''}`;
    const body: React.ReactNode = pretty !== null
      ? <CodeBlock code={pretty} language="json" maxHeight="24rem" />
      : <Typography variant="body" className="whitespace-pre-wrap font-mono text-[11px]">{content}</Typography>;
    const items: AccordionItem[] = [{ id: `tool-${index}`, title, content: body }];
    return (
      <Box className="px-3 py-2 border-b border-[var(--color-border)]">
        <Accordion items={items} />
      </Box>
    );
  }

  const hasReasoning = typeof reasoningContent === 'string' && reasoningContent.length > 0;
  const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

  return (
    <VStack gap="xs" className="px-3 py-2 border-b border-[var(--color-border)]">
      <HStack gap="xs" className="items-center">
        <Badge variant={roleBadgeVariant[role]} className="text-[10px] uppercase">{t(`subagentTrace.role.${role}`)}</Badge>
        {hasReasoning && (
          <Typography variant="caption" color="muted" className="text-[10px]">· {t('subagentTrace.thinking')}</Typography>
        )}
        {hasToolCalls && (
          <Typography variant="caption" color="muted" className="text-[10px]">· {toolCalls!.length === 1
            ? t('subagentTrace.toolCallCount', { count: toolCalls!.length })
            : t('subagentTrace.toolCallCountPlural', { count: toolCalls!.length })}</Typography>
        )}
      </HStack>

      {hasReasoning && (
        <Accordion items={[{
          id: `reasoning-${index}`,
          title: t('subagentTrace.reasoning'),
          content: <MarkdownContent content={reasoningContent!} />,
        }]} />
      )}

      {content.length > 0 && <MarkdownContent content={content} />}

      {hasToolCalls && (
        <Accordion
          multiple
          items={toolCalls!.map((tc, i) => ({
            id: `tc-${index}-${i}`,
            title: `${tc.name}(${summarizeArgs(tc.args)})`,
            content: <CodeBlock code={JSON.stringify(tc.args, null, 2)} language="json" maxHeight="24rem" />,
          }))}
        />
      )}
    </VStack>
  );
};

interface CoordinatorConversationProps extends DisplayStateProps {
  messages: readonly TraceChatMessage[];
  autoScroll?: boolean;
}

const CoordinatorConversation: React.FC<CoordinatorConversationProps> = ({ messages, autoScroll = true, className }) => {
  const endRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!autoScroll) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, autoScroll]);
  return (
    <Box className={className}>
      {messages.map((m, i) => (
        <ChatMessageRow key={`msg-${i}`} message={m} index={i} />
      ))}
      <Box ref={endRef} />
    </Box>
  );
};

// ─── Tab mode: unified timeline ───────────────────────────────────────

type TimelineItem =
  | { source: 'message'; data: TraceChatMessage; index: number }
  | { source: 'activity'; data: TraceActivity }
  | { source: 'subagent'; data: TraceSubagent };

function buildTimelineItems(
  messages: readonly TraceChatMessage[] | undefined,
  activities: TraceActivity[] | undefined,
  subagents: TraceSubagent[],
): TimelineItem[] {
  const items: TimelineItem[] = [];
  if (messages) {
    messages.forEach((m, i) => items.push({ source: 'message', data: m, index: i }));
  }
  if (activities) {
    activities.forEach(a => items.push({ source: 'activity', data: a }));
  }
  subagents.forEach(s => items.push({ source: 'subagent', data: s }));
  return items;
}

function timelineItemIcon(item: TimelineItem): { name: string; color: string } {
  switch (item.source) {
    case 'message': {
      const m = item.data;
      if (m.role === 'tool') return { name: 'terminal', color: 'text-[var(--color-primary)]' };
      if (m.reasoningContent) return { name: 'sparkles', color: 'text-[var(--color-primary)]' };
      if (m.role === 'user') return { name: 'user', color: 'text-[var(--color-primary)]' };
      return { name: 'message-square', color: 'text-[var(--color-muted-foreground)]' };
    }
    case 'activity': {
      const a = item.data;
      switch (a.type) {
        case 'tool_call': return { name: 'terminal', color: 'text-[var(--color-primary)]' };
        case 'tool_result':
          return { name: a.success !== false ? 'check' : 'x', color: a.success !== false ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]' };
        case 'error': return { name: 'alert-triangle', color: 'text-[var(--color-danger)]' };
        case 'file_operation': return { name: 'file', color: 'text-[var(--color-muted-foreground)]' };
        case 'schema_diff': return { name: 'git-commit', color: 'text-[var(--color-muted-foreground)]' };
        default: return { name: 'info', color: 'text-[var(--color-muted-foreground)]' };
      }
    }
    case 'subagent':
      return { name: 'bot', color: 'text-[var(--color-primary)]' };
  }
}

/** Closed vocabulary of activity kinds → translated badge text. */
function activityTypeLabel(type: TraceActivity['type'] | TraceActivityItem['type'], t: TranslateFunction): string {
  return t(`subagentTrace.activityType.${type}`);
}

function timelineItemLabel(item: TimelineItem, t: TranslateFunction): string {
  switch (item.source) {
    case 'message': {
      const m = item.data;
      if (m.role === 'tool') return t('subagentTrace.role.tool');
      if (m.reasoningContent) return t('subagentTrace.thinking');
      return t(`subagentTrace.role.${m.role}`);
    }
    case 'activity':
      return activityTypeLabel(item.data.type, t);
    case 'subagent':
      return t('subagentTrace.subagent');
  }
}

function timelineItemPreview(item: TimelineItem, t: TranslateFunction): string {
  switch (item.source) {
    case 'message': {
      const m = item.data;
      if (m.role === 'tool') return `${m.toolName ?? t('subagentTrace.role.tool')} → ${m.toolCallId?.slice(0, 8) ?? ''}`;
      if (m.reasoningContent) return previewText(m.reasoningContent, 120);
      return previewText(m.content, 120);
    }
    case 'activity': {
      const a = item.data;
      switch (a.type) {
        case 'tool_call': return `${a.tool}(${previewText(a.argsText, 120)})`;
        case 'tool_result': return `${a.tool}: ${previewText(a.resultText, 120)}`;
        case 'message': return previewText(a.content, 120);
        case 'error': return previewText(a.message, 120);
        case 'file_operation': return `${t(`subagentTrace.fileOperation.${a.operation}`)} ${a.path}`;
        case 'schema_diff': return t('subagentTrace.diffPreview', { path: a.filePath });
        default: return String(a.type);
      }
    }
    case 'subagent':
      return `${item.data.name} · ${item.data.task}`;
  }
}

function timelineItemTimeLabel(item: TimelineItem, locale: string): string | undefined {
  if (item.source === 'activity') return formatHHMMSS(item.data.timestamp, locale);
  if (item.source === 'subagent') {
    const ts = item.data.messages[0]?.timestamp;
    return ts !== undefined ? formatHHMMSS(ts, locale) : undefined;
  }
  return undefined;
}

// ─── Tab mode: detail modal content ───────────────────────────────────

function TraceDetailContent({ item }: { item: TimelineItem }): React.ReactElement {
  const { t, locale } = useTranslate();
  switch (item.source) {
    case 'message': {
      const m = item.data;
      return (
        <VStack gap="md">
          <HStack gap="xs" className="items-center">
            <Badge variant={roleBadgeVariant[m.role]} className="text-[10px] uppercase">{t(`subagentTrace.role.${m.role}`)}</Badge>
          </HStack>
          {typeof m.reasoningContent === 'string' && m.reasoningContent.length > 0 && (
            <Box>
              <Typography variant="caption" color="muted" className="mb-1">{t('subagentTrace.reasoning')}</Typography>
              <MarkdownContent content={m.reasoningContent} />
            </Box>
          )}
          {m.content.length > 0 && (
            <Box>
              <Typography variant="caption" color="muted" className="mb-1">{t('subagentTrace.content')}</Typography>
              {m.role === 'tool' ? (
                (() => {
                  const pretty = tryPrettyJson(m.content);
                  return pretty !== null
                    ? <CodeBlock code={pretty} language="json" maxHeight="24rem" />
                    : <Typography variant="body" className="whitespace-pre-wrap font-mono text-[11px]">{m.content}</Typography>;
                })()
              ) : (
                <MarkdownContent content={m.content} />
              )}
            </Box>
          )}
          {Array.isArray(m.toolCalls) && m.toolCalls.length > 0 && (
            <Box>
              <Typography variant="caption" color="muted" className="mb-1">{t('subagentTrace.toolCalls')}</Typography>
              <Accordion
                multiple
                items={m.toolCalls.map((tc, i) => ({
                  id: `tc-detail-${i}`,
                  title: `${tc.name}(${summarizeArgs(tc.args)})`,
                  content: <CodeBlock code={JSON.stringify(tc.args, null, 2)} language="json" maxHeight="24rem" />,
                }))}
              />
            </Box>
          )}
        </VStack>
      );
    }
    case 'activity': {
      const a = item.data;
      switch (a.type) {
        case 'tool_call':
          return (
            <VStack gap="md">
              <HStack gap="xs" className="items-center">
                <Badge variant="default" className="text-[10px]">{activityTypeLabel('tool_call', t)}</Badge>
                <Typography variant="caption" color="muted">{formatHHMMSS(a.timestamp, locale)}</Typography>
              </HStack>
              <Typography variant="body2">{a.tool}</Typography>
              <CodeBlock code={a.argsText} language="json" maxHeight="60vh" />
            </VStack>
          );
        case 'tool_result':
          return (
            <VStack gap="md">
              <HStack gap="xs" className="items-center">
                <Badge variant={a.success !== false ? 'default' : 'warning'} className="text-[10px]">
                  {a.success !== false ? t('subagentTrace.success') : t('subagentTrace.fail')}
                </Badge>
                <Typography variant="caption" color="muted">{formatHHMMSS(a.timestamp, locale)}</Typography>
              </HStack>
              <Typography variant="body2">{a.tool}</Typography>
              <CodeBlock code={a.resultText} language="json" maxHeight="60vh" />
            </VStack>
          );
        case 'message':
          return (
            <VStack gap="md">
              <HStack gap="xs" className="items-center">
                <Badge variant="neutral" className="text-[10px]">{t(`subagentTrace.role.${a.role}`)}</Badge>
                <Typography variant="caption" color="muted">{formatHHMMSS(a.timestamp, locale)}</Typography>
              </HStack>
              <Typography variant="body2" className="whitespace-pre-wrap">{a.content}</Typography>
            </VStack>
          );
        case 'error':
          return (
            <VStack gap="md">
              <HStack gap="xs" className="items-center">
                <Badge variant="warning" className="text-[10px]">{t('subagentTrace.badgeError')}</Badge>
                <Typography variant="caption" color="muted">{formatHHMMSS(a.timestamp, locale)}</Typography>
              </HStack>
              <Typography variant="body2" className="whitespace-pre-wrap text-[var(--color-danger)]">{a.message}</Typography>
            </VStack>
          );
        case 'file_operation':
          return (
            <VStack gap="md">
              <HStack gap="xs" className="items-center">
                <Badge variant="neutral" className="text-[10px]">{t('subagentTrace.badgeFile')}</Badge>
                <Typography variant="caption" color="muted">{formatHHMMSS(a.timestamp, locale)}</Typography>
              </HStack>
              <Typography variant="body2">{t(`subagentTrace.fileOperation.${a.operation}`)} {a.path}</Typography>
            </VStack>
          );
        case 'schema_diff':
          return (
            <VStack gap="md">
              <HStack gap="xs" className="items-center">
                <Badge variant="neutral" className="text-[10px]">{t('subagentTrace.badgeDiff')}</Badge>
                <Typography variant="caption" color="muted">{formatHHMMSS(a.timestamp, locale)}</Typography>
              </HStack>
              <Typography variant="body2">{a.filePath}</Typography>
            </VStack>
          );
        default:
          return (
            <VStack gap="md">
              <Typography variant="caption" color="muted">{formatHHMMSS(a.timestamp, locale)}</Typography>
              <Typography variant="body2">{String(a.type)}</Typography>
            </VStack>
          );
      }
    }
    case 'subagent': {
      const s = item.data;
      const activities = subagentMessagesToActivities(s.messages);
      const ts = s.messages[0]?.timestamp;
      return (
        <VStack gap="md">
          <HStack gap="xs" className="items-center">
            <Badge variant="default" className="text-[10px]">{s.role}</Badge>
            {ts !== undefined && (
              <Typography variant="caption" color="muted">{formatHHMMSS(ts, locale)}</Typography>
            )}
          </HStack>
          <Typography variant="body2" weight="semibold">{s.name}</Typography>
          <Typography variant="body2" color="muted">{s.task}</Typography>
          {activities.length > 0 && (
            <Box className="border-t border-[var(--color-border)] pt-2">
              <InlineActivityStream activities={activities} autoScroll={false} />
            </Box>
          )}
        </VStack>
      );
    }
  }
}

// ─── Main panel ───────────────────────────────────────────────────────

export const SubagentTracePanel: React.FC<SubagentTracePanelProps> = ({
  subagents,
  focusedOrbital,
  disclosureLevel,
  open,
  onClose,
  className,
  mode = 'overlay',
  coordinatorActivities,
  coordinatorMessages,
  ...rest
}) => {
  const { t, locale } = useTranslate();
  const [selectedItem, setSelectedItem] = useState<TimelineItem | null>(null);
  const densityLabel = (rich: boolean): string => rich ? t('subagentTrace.densityRich') : t('subagentTrace.densityCompact');

  // In tab mode, the panel is always visible — the `open` flag is ignored
  // because the tab IS the visibility state.
  if (mode === 'overlay' && !open) return null;

  const isTabMode = mode === 'tab';
  const isRichMode = isTabMode || disclosureLevel >= 3;

  // ─── Tab mode: unified timeline ─────────────────────────────────────
  if (isTabMode) {
    const timelineItems = buildTimelineItems(coordinatorMessages, coordinatorActivities, subagents);
    const hasData = timelineItems.length > 0;

    return (
      <Box {...domPassthrough(rest)} className={`h-full w-full bg-[var(--color-card)] overflow-hidden flex flex-col ${className ?? ''}`}>
        <HStack
          gap="sm"
          className="items-center px-3 py-2 border-b border-[var(--color-border)]"
        >
          <Icon name="activity" size="sm" />
          <Typography variant="caption" className="font-semibold flex-1">
            {t('subagentTrace.trace')}
          </Typography>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <Icon name="x" size="xs" />
            </Button>
          )}
        </HStack>

        {!hasData && (
          <Box className="flex-1 flex items-center justify-center px-4">
            <Typography variant="body2" color="muted" className="text-center">
              {t('subagentTrace.noAgentActivity')}
            </Typography>
          </Box>
        )}

        {hasData && (
          <Box className="flex-1 overflow-y-auto">
            <VStack gap="none">
              {timelineItems.map((item, i) => {
                const { name: iconName, color: iconColor } = timelineItemIcon(item);
                const isLast = i === timelineItems.length - 1;
                return (
                  <Box
                    key={`${item.source}-${i}`}
                    className="flex items-start px-3 py-2 border-b border-[var(--color-border)] hover:bg-[var(--color-muted)]/30 transition-colors duration-fast cursor-pointer"
                    {...pressableProps(() => setSelectedItem(item))}
                  >
                    {/* Timeline gutter */}
                    <Box className="flex flex-col items-center mr-3 mt-0.5" style={{ width: 20 }}>
                      <Box
                        className="rounded-full flex-shrink-0"
                        style={{
                          width: 8,
                          height: 8,
                          backgroundColor: 'var(--color-primary)',
                        }}
                      />
                      {!isLast && (
                        <Box
                          className="flex-1"
                          style={{
                            width: 2,
                            backgroundColor: 'var(--color-border)',
                            marginTop: 4,
                            minHeight: 24,
                          }}
                        />
                      )}
                    </Box>

                    {/* Content */}
                    <VStack gap="xs" className="flex-1 min-w-0">
                      <HStack gap="xs" className="items-center">
                        <Icon name={iconName} size="xs" className={`flex-shrink-0 ${iconColor}`} />
                        {timelineItemTimeLabel(item, locale) && (
                          <Typography variant="caption" color="muted">
                            {timelineItemTimeLabel(item, locale)}
                          </Typography>
                        )}
                        <Badge variant="neutral" className="text-[10px]">
                          {timelineItemLabel(item, t)}
                        </Badge>
                      </HStack>
                      <HStack gap="sm" className="items-start">
                        <Typography variant="body2" color="muted" className="flex-1 min-w-0 line-clamp-2">
                          {timelineItemPreview(item, t)}
                        </Typography>
                        <Button variant="ghost" size="sm" className="flex-shrink-0 mt-0" onClick={(e) => { e.stopPropagation(); setSelectedItem(item); }}>
                          <Icon name="maximize-2" size="xs" />
                        </Button>
                      </HStack>
                    </VStack>
                  </Box>
                );
              })}
            </VStack>
          </Box>
        )}

        <Modal
          isOpen={selectedItem !== null}
          onClose={() => setSelectedItem(null)}
          title={selectedItem ? `${timelineItemLabel(selectedItem, t)}${timelineItemTimeLabel(selectedItem, locale) ? ` · ${timelineItemTimeLabel(selectedItem, locale)}` : ''}` : ''}
          size="lg"
        >
          {selectedItem && <TraceDetailContent item={selectedItem} />}
        </Modal>
      </Box>
    );
  }

  // ─── Overlay mode: original behavior (unchanged) ────────────────────

  // Filter or group based on canvas focus
  const filtered = focusedOrbital
    ? subagents.filter(s => s.orbitalName === focusedOrbital)
    : subagents;

  const wrapperClass = isRichMode
    ? `absolute inset-x-3 bottom-3 sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-3 w-full sm:w-[28rem] max-w-[calc(100vw-1.5rem)] max-h-[60vh] sm:max-h-none bg-[var(--color-card)] border border-[var(--color-border)] rounded-container shadow-elevation-popover surface-material overflow-hidden flex flex-col ${className ?? ''}`
    : `absolute inset-x-3 bottom-3 sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-3 w-full sm:w-80 max-w-[calc(100vw-1.5rem)] max-h-[60vh] sm:max-h-none bg-[var(--color-card)] border border-[var(--color-border)] rounded-container shadow-elevation-popover surface-material overflow-hidden flex flex-col ${className ?? ''}`;
  const wrapperStyle = { zIndex: 20 };

  // Empty state
  const hasCoordinatorData = (coordinatorMessages && coordinatorMessages.length > 0)
    || (coordinatorActivities && coordinatorActivities.length > 0);
  if (filtered.length === 0 && !hasCoordinatorData) {
    return (
      <Box {...domPassthrough(rest)} className={wrapperClass} style={wrapperStyle}>
        <HStack
          gap="sm"
          className="items-center px-3 py-2 border-b border-[var(--color-border)]"
        >
          <Icon name="activity" size="sm" />
          <Typography variant="caption" className="font-semibold flex-1">
            {t('subagentTrace.subagents')}
          </Typography>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <Icon name="x" size="xs" />
            </Button>
          )}
        </HStack>
        <Box className="flex-1 flex items-center justify-center px-4">
          <Typography variant="caption" color="muted" className="text-center">
            {focusedOrbital
              ? t('subagentTrace.noSubagentsForOrbital', { orbital: focusedOrbital })
              : t('subagentTrace.noSubagentsActive')}
          </Typography>
        </Box>
      </Box>
    );
  }

  // Filtered (zoomed into a specific orbital): flat list, no group headers
  if (focusedOrbital) {
    return (
      <Box {...domPassthrough(rest)} className={wrapperClass} style={wrapperStyle}>
        <HStack
          gap="sm"
          className="items-center px-3 py-2 border-b border-[var(--color-border)]"
        >
          <Icon name="activity" size="sm" />
          <VStack gap="none" className="flex-1 min-w-0">
            <Typography variant="caption" className="font-semibold truncate">
              {focusedOrbital}
            </Typography>
            <Typography variant="caption" color="muted">
              {(filtered.length === 1
                ? t('subagentTrace.subagentCount', { count: filtered.length })
                : t('subagentTrace.subagentCountPlural', { count: filtered.length }))} · {densityLabel(isRichMode)}
            </Typography>
          </VStack>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <Icon name="x" size="xs" />
            </Button>
          )}
        </HStack>
        <Box className="flex-1 overflow-y-auto">
          {filtered.map(sub => (
            isRichMode
              ? <SubagentRichCard key={sub.id} subagent={sub} />
              : <SubagentRow key={sub.id} subagent={sub} />
          ))}
        </Box>
      </Box>
    );
  }

  // L1/L2 overview: group by orbital with compact rows
  // L3/L4 overview: flat list of rich cards
  const grouped = groupByOrbital(filtered, t('subagentTrace.unattached'));
  const coordinatorSnapshot = pluckCoordinatorState(coordinatorActivities ?? []);
  return (
    <Box {...domPassthrough(rest)} className={wrapperClass} style={wrapperStyle}>
      <HStack
        gap="sm"
        className="items-center px-3 py-2 border-b border-[var(--color-border)]"
      >
        <Icon name="activity" size="sm" />
        <Typography variant="caption" className="font-semibold flex-1">
          {t('subagentTrace.subagentsWithCount', { count: filtered.length })} · {densityLabel(isRichMode)}
        </Typography>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            <Icon name="x" size="xs" />
          </Button>
        )}
      </HStack>
      <Box className="flex-1 overflow-y-auto">
        {!focusedOrbital && isRichMode && (
          <CoordinatorCard snapshot={coordinatorSnapshot} />
        )}
        {coordinatorMessages && coordinatorMessages.length > 0 ? (
          <Box className="border-b border-[var(--color-border)]">
            <HStack gap="xs" className="items-center px-3 py-1.5 bg-[var(--color-card)] border-b border-[var(--color-border)]">
              <Box style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--color-primary)', flexShrink: 0 }} />
              <Typography variant="caption" className="font-semibold text-[11px]">
                {t('subagentTrace.coordinator')}
              </Typography>
              <Typography variant="caption" color="muted" className="text-[10px]">{t('subagentTrace.messagesCount', { count: coordinatorMessages.length })}</Typography>
            </HStack>
            <Box className="max-h-[36rem] overflow-y-auto">
              <CoordinatorConversation messages={coordinatorMessages} autoScroll />
            </Box>
          </Box>
        ) : (coordinatorActivities && coordinatorActivities.length > 0 && (() => {
          const filteredCoordinator = coordinatorActivities;
          if (filteredCoordinator.length === 0) return null;
          return (
            <Box className="border-b border-[var(--color-border)]">
              <HStack gap="xs" className="items-center px-3 py-1.5 bg-[var(--color-card)] border-b border-[var(--color-border)]">
                <Box style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--color-primary)', flexShrink: 0 }} />
                <Typography variant="caption" className="font-semibold text-[11px]">
                  {t('subagentTrace.coordinator')}
                </Typography>
                <Typography variant="caption" color="muted" className="text-[10px]">{t('subagentTrace.eventsCount', { count: filteredCoordinator.length })}</Typography>
              </HStack>
              <Box className="max-h-60 overflow-y-auto">
                <InlineActivityStream
                  activities={coordinatorToActivityItems(filteredCoordinator, t)}
                  autoScroll
                />
              </Box>
            </Box>
          );
        })())}
        {isRichMode
          ? filtered.map(sub => <SubagentRichCard key={sub.id} subagent={sub} />)
          : Array.from(grouped.entries()).map(([orbitalName, subs]) => (
              <OrbitalGroup
                key={orbitalName}
                orbitalName={orbitalName}
                subagents={subs}
              />
            ))}
      </Box>
    </Box>
  );
};

SubagentTracePanel.displayName = 'SubagentTracePanel';

export default SubagentTracePanel;
