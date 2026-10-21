'use client';
/**
 * AgentActivityFeed Molecule
 *
 * The one row renderer for the agent's activities (`@almadar/core`
 * `TraceActivity`, mapped by rabit's `mapSSEToTraceActivities`). Every
 * persona's chat surface mounts it with the activities its manifest's
 * `activity` audience selects.
 */

import React, { useEffect, useRef } from 'react';
import type { SemanticChangeKind, TraceActivity } from '@almadar/core';
import { Accordion } from './Accordion';
import { EmptyState } from './EmptyState';
import { MarkdownContent } from './markdown/MarkdownContent';
import { Box } from '../../../core';
import { VStack } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';
import { Icon, type IconAnimation } from '../../../core';
import { useTranslate, type TranslateFunction } from '../../../core';

/** Where an activity's "jump to" affordance should take a canvas. */
export interface AgentActivityJumpTarget {
  orbital: string;
  trait?: string;
  transition?: string;
}

const CHANGE_KIND_ICON: Record<SemanticChangeKind, string> = {
  'orbital-added': 'circle-plus',
  'orbital-removed': 'circle-minus',
  'entity-fields-changed': 'database',
  'trait-added': 'plus-square',
  'trait-removed': 'minus-square',
  'trait-config-changed': 'sliders-horizontal',
  'state-machine-changed': 'git-branch',
  'guard-changed': 'shield',
  'effect-changed': 'zap',
  'render-ui-changed': 'layout-panel-top',
  'event-wiring-changed': 'cable',
  'page-changed': 'file',
  'theme-changed': 'palette',
  'behavior-composed': 'layers',
};

type RowColor = 'muted' | 'success' | 'error' | 'warning' | 'primary';

interface RowSpec {
  icon: string;
  color: RowColor;
  animation?: IconAnimation;
  text: string;
  details: string[];
  /** The exchange verbatim (a tool's arguments or answer): collapsed under the row, never cut. */
  raw?: string;
}

function jumpTargetOf(activity: TraceActivity): AgentActivityJumpTarget | undefined {
  switch (activity.type) {
    case 'orbital_started':
    case 'orbital_done':
      return { orbital: activity.orbitalName };
    case 'schema_change':
      return {
        orbital: activity.orbitalName,
        ...(activity.traitName !== undefined ? { trait: activity.traitName } : {}),
        ...(activity.transitionEvent !== undefined ? { transition: activity.transitionEvent } : {}),
      };
    default:
      return undefined;
  }
}

/** What a row can only know from the list it sits in. */
export interface RowFacts {
  /** An `orbital_started` whose run has finished (an `orbital_done` for it follows). */
  settled: boolean;
  /** At a `done` row: how many orbitals this run finished (its own "ready" rows). */
  readyCount: number;
}

/**
 * Per-item facts for a feed. Each `orbital_done` settles the latest still-open
 * start of its orbital (an orbital can be built more than once); each `done`
 * counts the distinct orbitals that finished since the previous `done`.
 * Non-activity items (`activityOf` → null) get neutral facts.
 */
export function activityRowFacts<T>(items: readonly T[], activityOf: (item: T) => TraceActivity | null): RowFacts[] {
  const facts: RowFacts[] = items.map(() => ({ settled: false, readyCount: 0 }));
  const open = new Map<string, number[]>();
  let ready = new Set<string>();
  items.forEach((item, index) => {
    const activity = activityOf(item);
    if (activity === null) return;
    if (activity.type === 'orbital_started') {
      open.set(activity.orbitalName, [...(open.get(activity.orbitalName) ?? []), index]);
    } else if (activity.type === 'orbital_done') {
      const starts = open.get(activity.orbitalName) ?? [];
      const last = starts.pop();
      if (last !== undefined) facts[last].settled = true;
      open.set(activity.orbitalName, starts);
      ready.add(activity.orbitalName);
    } else if (activity.type === 'done') {
      facts[index].readyCount = ready.size;
      ready = new Set();
    }
  });
  return facts;
}

function describe(activity: TraceActivity, t: TranslateFunction, facts: RowFacts): RowSpec {
  switch (activity.type) {
    case 'message':
      return { icon: 'info', color: 'muted', text: activity.content, details: [] };
    case 'tool_call':
      return {
        icon: 'wrench',
        color: 'muted',
        text: t('agentActivity.toolCall', { tool: activity.tool }),
        details: [],
        ...(activity.argsText !== '' && activity.argsText !== '{}' ? { raw: activity.argsText } : {}),
      };
    case 'tool_result':
      return {
        icon: activity.success ? 'corner-down-right' : 'alert-circle',
        color: activity.success ? 'muted' : 'error',
        text: t('agentActivity.toolResult', { tool: activity.tool }),
        details: [
          ...(activity.detail !== undefined ? [activity.detail] : []),
          ...(activity.rows !== undefined ? [t('agentActivity.toolRows', { count: activity.rows })] : []),
        ],
        raw: activity.resultText,
      };
    case 'file_operation':
      return { icon: 'file-text', color: 'muted', text: t('agentActivity.fileOperation', { operation: activity.operation }), details: [activity.path] };
    case 'schema_diff':
      return { icon: 'file-diff', color: 'muted', text: t('agentActivity.schemaDiff', { filePath: activity.filePath }), details: [] };
    case 'error':
      return { icon: 'alert-circle', color: 'error', text: activity.message, details: activity.code ? [activity.code] : [] };
    case 'coordinator_decision':
      return { icon: 'compass', color: 'muted', text: t('agentActivity.coordinatorDecision', { organism: activity.organism }), details: [activity.reason] };
    case 'plan_committed':
      return { icon: 'layers', color: 'muted', text: t('agentActivity.roster', { count: activity.orbitals.length }), details: [activity.orbitals.join(', ')] };
    case 'pending_question':
      return { icon: 'help-circle', color: 'warning', text: activity.question, details: [] };
    case 'clarification_question':
      return {
        icon: 'help-circle',
        color: 'warning',
        text: activity.question,
        details: activity.candidates.map((c) => (c.whyThisFits ? `${c.label} — ${c.whyThisFits}` : c.label)),
      };
    case 'analysis':
      return {
        icon: 'check',
        color: 'success',
        text: t('agentActivity.analyzed', { organism: activity.organism }),
        details: [
          ...(activity.organismReason ? [activity.organismReason] : []),
          ...(activity.complexity?.reasoning ? [activity.complexity.reasoning] : []),
          ...activity.renames.map((r) => t('agentActivity.renamed', { from: r.from, to: r.to })),
          ...activity.deletes.map((d) => t('agentActivity.deleted', { orbitalName: d })),
        ],
      };
    case 'orbital_started':
      return facts.settled
        ? { icon: 'layers', color: 'muted', text: t('agentActivity.orbitalStartedSettled', { orbitalName: activity.orbitalName }), details: [] }
        : { icon: 'loader', color: 'primary', animation: 'spin', text: t('agentActivity.orbitalStarted', { orbitalName: activity.orbitalName }), details: [] };
    case 'orbital_done':
      return {
        icon: 'check',
        color: 'success',
        text: t('agentActivity.orbitalDone', { orbitalName: activity.orbitalName }),
        details:
          activity.traitCount !== undefined || activity.transitionCount !== undefined
            ? [t('agentActivity.orbitalCounts', { traitCount: activity.traitCount ?? 0, transitionCount: activity.transitionCount ?? 0 })]
            : [],
      };
    case 'schema_change':
      return {
        icon: CHANGE_KIND_ICON[activity.changeKind],
        color: 'primary',
        text: t(`agentActivity.change.${activity.changeKind}`, { orbitalName: activity.orbitalName }),
        details: [activity.traitName, activity.transitionEvent].filter((d): d is string => d !== undefined),
      };
    case 'done':
      return { icon: 'check-circle', color: 'success', text: t('agentActivity.done', { count: facts.readyCount }), details: [] };
    case 'cancelled':
      return { icon: 'circle-x', color: 'muted', text: activity.message || t('agentActivity.cancelled'), details: [] };
    case 'llm_response':
      return { icon: 'cpu', color: 'muted', text: t('agentActivity.llmResponse'), details: [activity.content] };
  }
}

type LlmResponse = Extract<TraceActivity, { type: 'llm_response' }>;

function llmSummary(activity: LlmResponse, t: TranslateFunction): string {
  const llm = activity.llm;
  if (!llm) return t('agentActivity.llmResponse');
  const parts = [
    `${llm.service} · ${llm.model}`,
    t('agentActivity.llmDuration', { seconds: (llm.durationMs / 1000).toFixed(1) }),
    ...(llm.promptTokens !== undefined || llm.completionTokens !== undefined
      ? [t('agentActivity.llmTokens', { prompt: llm.promptTokens ?? 0, completion: llm.completionTokens ?? 0 })]
      : []),
    ...(llm.costUSD !== undefined ? [`$${llm.costUSD.toFixed(4)}`] : []),
  ];
  return parts.join(' · ');
}

function LlmSection({ label, text }: { label: string; text: string }): React.ReactElement {
  return (
    <VStack gap="none" className="w-full">
      <Typography variant="caption" weight="semibold" color="muted">{label}</Typography>
      <Typography variant="caption" className="whitespace-pre-wrap break-all font-mono">{text}</Typography>
    </VStack>
  );
}

/** A raw LLM call: one collapsed line, expanding to the full response, prompts and tool calls. */
function LlmResponseRow({ activity }: { activity: LlmResponse }): React.ReactElement {
  const { t } = useTranslate();
  const llm = activity.llm;
  return (
    <Box className="w-full" data-testid="agent-activity-llm_response">
      <Accordion
        items={[{
          id: `llm-${activity.timestamp}`,
          header: (
            <Box className="flex items-center gap-2 min-w-0">
              <Icon name="cpu" size="sm" color="muted" className="shrink-0" />
              <Typography variant="caption" color="muted" className="truncate">{llmSummary(activity, t)}</Typography>
            </Box>
          ),
          content: (
            <VStack gap="sm" className="w-full">
              <LlmSection label={t('agentActivity.llmResponseLabel')} text={activity.content} />
              {llm && <LlmSection label={t('agentActivity.llmSystemPrompt')} text={llm.systemPrompt} />}
              {llm && <LlmSection label={t('agentActivity.llmUserPrompt')} text={llm.userPrompt} />}
              {llm?.toolCallsJson && <LlmSection label={t('agentActivity.llmToolCalls')} text={llm.toolCallsJson} />}
            </VStack>
          ),
        }]}
      />
    </Box>
  );
}

export interface AgentActivityRowProps {
  activity: TraceActivity;
  /** "Jump to" affordance — rendered only when supplied and the activity names an orbital. */
  onJump?: (target: AgentActivityJumpTarget) => void;
  /** What the row knows from its list (`activityRowFacts`). */
  facts: RowFacts;
}

export function AgentActivityRow({ activity, onJump, facts }: AgentActivityRowProps): React.ReactElement {
  const { t } = useTranslate();

  if (activity.type === 'llm_response') return <LlmResponseRow activity={activity} />;

  if (activity.type === 'message' && activity.role !== 'system') {
    const mine = activity.role === 'user';
    return (
      <Box
        data-testid={`agent-activity-${mine ? 'user' : 'assistant'}-message`}
        className={`max-w-[90%] rounded-[var(--radius-lg)] px-3 py-2 ${
          mine
            ? 'self-end bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
            : 'self-start bg-[var(--color-surface)]'
        }`}
      >
        {mine ? (
          <Typography variant="body2" color="inherit" className="whitespace-pre-wrap break-words">
            {activity.content}
          </Typography>
        ) : (
          <MarkdownContent content={activity.content} className="prose-sm break-words" />
        )}
      </Box>
    );
  }

  const spec = describe(activity, t, facts);
  const target = jumpTargetOf(activity);
  return (
    <Box className="flex items-start gap-2 w-full" data-testid={`agent-activity-${activity.type}`}>
      <Icon name={spec.icon} size="sm" color={spec.color} animation={spec.animation} className="mt-0.5 shrink-0" />
      <VStack gap="none" className="flex-1 min-w-0">
        {spec.raw === undefined ? (
          <Typography variant="body2" className="break-words">{spec.text}</Typography>
        ) : (
          <Accordion
            items={[{
              id: `${activity.type}-${activity.timestamp}`,
              header: <Typography variant="body2" className="break-words">{spec.text}</Typography>,
              content: <Typography variant="caption" className="whitespace-pre-wrap break-all font-mono">{spec.raw}</Typography>,
            }]}
          />
        )}
        {spec.details.map((detail, i) => (
          <Typography key={i} variant="caption" color="muted" className="break-all whitespace-pre-wrap">
            {detail}
          </Typography>
        ))}
      </VStack>
      {onJump && target && (
        <Button variant="ghost" size="sm" onClick={() => onJump(target)} data-testid="agent-activity-jump">
          <Typography variant="caption">{t('agentActivity.jump')}</Typography>
          <Icon name="arrow-right" size="xs" />
        </Button>
      )}
    </Box>
  );
}

/** Shown at the end of a feed while the agent works, so a long LLM call never looks idle. */
export function AgentThinkingRow(): React.ReactElement {
  const { t } = useTranslate();
  return (
    <Box className="flex items-center gap-2 w-full" data-testid="agent-activity-thinking" role="status" aria-live="polite">
      <Icon name="loader" size="sm" color="primary" animation="spin" className="shrink-0" />
      <Typography variant="body2" color="muted">{t('agentActivity.thinking')}</Typography>
    </Box>
  );
}

/** One conversation: the user's prompt and everything the agent did for it. */
export interface AgentConversation {
  /** The prompt that started it; undefined for activity recorded before any prompt. */
  prompt?: string;
  startedAt: number;
  activities: TraceActivity[];
}

/** Split a feed into conversations, each starting at a user prompt. */
export function groupIntoConversations(activities: readonly TraceActivity[]): AgentConversation[] {
  const groups: AgentConversation[] = [];
  for (const activity of activities) {
    const isPrompt = activity.type === 'message' && activity.role === 'user';
    const current = groups[groups.length - 1];
    if (isPrompt || !current) {
      groups.push({ ...(isPrompt ? { prompt: activity.content } : {}), startedAt: activity.timestamp, activities: [activity] });
    } else {
      current.activities.push(activity);
    }
  }
  return groups;
}

function ConversationRows({ activities, onJump }: { activities: readonly TraceActivity[]; onJump?: AgentActivityRowProps['onJump'] }): React.ReactElement {
  const facts = activityRowFacts(activities, (activity) => activity);
  return (
    <>
      {activities.map((activity, index) => (
        <AgentActivityRow key={`${activity.type}-${activity.timestamp}-${index}`} activity={activity} onJump={onJump} facts={facts[index]} />
      ))}
    </>
  );
}

/** Earlier conversations, collapsed under their prompt — open one to see what the agent did. */
function EarlierConversations({ conversations, onJump }: { conversations: readonly AgentConversation[]; onJump?: AgentActivityRowProps['onJump'] }): React.ReactElement {
  const { t } = useTranslate();
  return (
    <Box className="flex flex-col gap-1 w-full" data-testid="agent-earlier-conversations">
      <Typography variant="caption" color="muted" weight="semibold">
        {t('agentActivity.earlierConversations', { count: conversations.length })}
      </Typography>
      <Accordion
        multiple
        items={conversations.map((conversation, i) => ({
          id: `conversation-${conversation.startedAt}-${i}`,
          header: (
            <Box className="flex items-center gap-2 min-w-0" data-testid="agent-earlier-conversation">
              <Icon name="message-square" size="sm" color="muted" className="shrink-0" />
              <Typography variant="body2" className="truncate">
                {conversation.prompt ?? t('agentActivity.earlierActivity')}
              </Typography>
            </Box>
          ),
          content: (
            <Box className="flex flex-col gap-2 w-full">
              <ConversationRows
                activities={conversation.prompt === undefined ? conversation.activities : conversation.activities.slice(1)}
                onJump={onJump}
              />
            </Box>
          ),
        }))}
      />
    </Box>
  );
}

export interface AgentActivityFeedProps {
  activities: readonly TraceActivity[];
  /** The agent is running: show the thinking row after the last activity. */
  working?: boolean;
  onJump?: (target: AgentActivityJumpTarget) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Scroll the latest row into view as rows arrive. Off for a list of feeds (a run history). @default true */
  followLatest?: boolean;
  className?: string;
}

export function AgentActivityFeed({ activities, working = false, onJump, emptyTitle, emptyDescription, followLatest = true, className }: AgentActivityFeedProps): React.ReactElement {
  const { t } = useTranslate();
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (followLatest) endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [activities.length, working, followLatest]);

  const conversations = groupIntoConversations(activities);
  const earlier = conversations.slice(0, -1);
  const current = conversations[conversations.length - 1];

  if (activities.length === 0 && !working) {
    return (
      <EmptyState
        icon="sparkles"
        title={emptyTitle ?? t('agentActivity.emptyTitle')}
        description={emptyDescription ?? t('agentActivity.emptyDescription')}
      />
    );
  }
  return (
    <Box className={`flex flex-col gap-2 ${className ?? ''}`} data-testid="agent-activity-feed">
      {earlier.length > 0 ? <EarlierConversations conversations={earlier} onJump={onJump} /> : null}
      <ConversationRows activities={current?.activities ?? []} onJump={onJump} />
      {working ? <AgentThinkingRow /> : null}
      <Box ref={endRef} />
    </Box>
  );
}

AgentActivityFeed.displayName = 'AgentActivityFeed';
AgentActivityRow.displayName = 'AgentActivityRow';
