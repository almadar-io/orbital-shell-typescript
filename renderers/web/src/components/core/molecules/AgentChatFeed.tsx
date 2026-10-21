/**
 * AgentChatFeed — the in-app assistant's conversation (Almadar_UX §3.6).
 * Messages are bubbles by sender with their time; each turn's tool and model
 * steps fold under the reply behind one "Worked through N steps" disclosure
 * (open while the assistant is still working on that turn); replies carry a
 * copy action; days are separated; and the feed follows new messages only
 * while the reader is at the bottom, otherwise it shows a "New messages" cue.
 * Raw LLM responses stay behind a switch inside the steps, remembered per host.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TraceActivity } from '@almadar/core';
import { Box } from '../../../core';
import { Button } from '../../../core';
import { Icon } from '../../../core';
import { Switch } from '../../../core';
import { Typography } from '../../../core';
import { VStack } from '../../../core';
import { EmptyState } from './EmptyState';
import { useTranslate } from '../../../core';
import { AgentActivityRow, AgentThinkingRow, activityRowFacts } from './AgentActivityFeed';

export interface AgentChatFeedProps {
  /** Activities already selected by the host's manifest audience. */
  activities: readonly TraceActivity[];
  emptyTitle: string;
  /** localStorage key remembering the Raw LLM switch for this host. */
  rawLlmPreferenceKey: string;
  /** Prefix for the scroller test id and the switch's element id. */
  idPrefix: string;
  /** The agent is running — the feed shows it is thinking. */
  working?: boolean;
  className?: string;
}

/** One exchange: the user's request, the steps the assistant took, and what it answered. */
interface ChatTurn {
  request?: TraceActivity;
  steps: TraceActivity[];
  replies: TraceActivity[];
  startedAt: number;
}

const FOLLOW_SLACK_PX = 48;

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function isUserMessage(a: TraceActivity): boolean {
  return a.type === 'message' && a.role === 'user';
}

function isReply(a: TraceActivity): boolean {
  return (a.type === 'message' && a.role !== 'user') || a.type === 'error';
}

function groupTurns(activities: readonly TraceActivity[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const activity of activities) {
    const current = turns[turns.length - 1];
    if (isUserMessage(activity) || current === undefined) {
      turns.push({
        ...(isUserMessage(activity) ? { request: activity } : {}),
        steps: isUserMessage(activity) || isReply(activity) ? [] : [activity],
        replies: isReply(activity) ? [activity] : [],
        startedAt: activity.timestamp,
      });
    } else if (isReply(activity)) {
      current.replies.push(activity);
    } else {
      current.steps.push(activity);
    }
  }
  return turns;
}

function dayKey(ts: number): string {
  return new Date(ts).toDateString();
}

function messageText(a: TraceActivity): string {
  return a.type === 'message' ? a.content : '';
}

function DaySeparator({ ts }: { ts: number }): React.ReactElement {
  const { t } = useTranslate();
  const today = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - 24 * 60 * 60 * 1000);
  const key = dayKey(ts);
  const label = key === today
    ? t('agentChat.today')
    : key === yesterday
      ? t('agentChat.yesterday')
      : new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <Box className="flex items-center gap-2 w-full py-1" data-testid="agent-chat-day" role="separator">
      <Box className="h-px flex-1 bg-[var(--color-border)]" />
      <Typography variant="caption" color="muted">{label}</Typography>
      <Box className="h-px flex-1 bg-[var(--color-border)]" />
    </Box>
  );
}

function Time({ ts, align }: { ts: number; align: 'start' | 'end' }): React.ReactElement {
  return (
    <Typography variant="caption" color="muted" className={align === 'end' ? 'self-end' : 'self-start'}>
      {new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
    </Typography>
  );
}

function CopyReply({ text }: { text: string }): React.ReactElement {
  const { t } = useTranslate();
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={copy}
      aria-label={copied ? t('agentChat.copied') : t('agentChat.copy')}
      title={copied ? t('agentChat.copied') : t('agentChat.copy')}
      data-testid="agent-chat-copy"
    >
      <Icon name={copied ? 'check' : 'copy'} size="xs" />
    </Button>
  );
}

function StepRows({ steps }: { steps: readonly TraceActivity[] }): React.ReactElement {
  const facts = activityRowFacts(steps, (a) => a);
  return (
    <VStack gap="xs" className="w-full">
      {steps.map((step, i) => (
        <AgentActivityRow key={`${step.type}-${step.timestamp}-${i}`} activity={step} facts={facts[i]} />
      ))}
    </VStack>
  );
}

function TurnSteps({ steps, showRawLlm, onToggleRaw, idPrefix, index }: {
  steps: readonly TraceActivity[];
  showRawLlm: boolean;
  onToggleRaw: (checked: boolean) => void;
  idPrefix: string;
  index: number;
}): React.ReactElement | null {
  const { t } = useTranslate();
  const [open, setOpen] = useState(false);
  const visible = showRawLlm ? steps : steps.filter((s) => s.type !== 'llm_response');
  const toolSteps = steps.filter((s) => s.type !== 'llm_response').length;
  const hasRaw = steps.some((s) => s.type === 'llm_response');
  if (toolSteps === 0 && !hasRaw) return null;
  return (
    <VStack gap="xs" className="self-start w-full max-w-[90%]" data-testid="agent-chat-steps">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="self-start"
        data-testid="agent-chat-steps-toggle"
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size="xs" />
        <Typography variant="caption" color="muted">{t('agentChat.workedThrough', { count: toolSteps })}</Typography>
      </Button>
      {open ? (
        <VStack gap="xs" className="w-full border-s-[length:var(--border-width)] border-[var(--color-border)] ps-3">
          {hasRaw ? (
            <Switch checked={showRawLlm} onChange={onToggleRaw} label={t('agentActivity.showRawLlm')} id={`${idPrefix}-show-raw-llm-${index}`} />
          ) : null}
          <StepRows steps={visible} />
        </VStack>
      ) : null}
    </VStack>
  );
}

export function AgentChatFeed({ activities, emptyTitle, rawLlmPreferenceKey, idPrefix, working = false, className }: AgentChatFeedProps): React.ReactElement {
  const { t } = useTranslate();
  const [showRawLlm, setShowRawLlm] = useState(() => readFlag(rawLlmPreferenceKey));
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const [unseen, setUnseen] = useState(false);

  const handleToggle = useCallback((checked: boolean) => {
    setShowRawLlm(checked);
    try {
      localStorage.setItem(rawLlmPreferenceKey, String(checked));
    } catch {
      // Storage unavailable (private window) — the switch still works for this session.
    }
  }, [rawLlmPreferenceKey]);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX;
    if (atBottomRef.current) setUnseen(false);
  }, []);

  const jumpToLatest = useCallback(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
    atBottomRef.current = true;
    setUnseen(false);
  }, []);

  useEffect(() => {
    if (atBottomRef.current) endRef.current?.scrollIntoView?.({ block: 'end' });
    else setUnseen(true);
  }, [activities.length, working]);

  const turns = useMemo(() => groupTurns(activities), [activities]);

  if (activities.length === 0 && !working) {
    return (
      <VStack gap="none" className={`min-h-0 items-center justify-center ${className ?? ''}`}>
        <EmptyState icon="sparkles" title={emptyTitle} description={t('agentChat.emptyDescription')} />
      </VStack>
    );
  }

  return (
    <Box className={`relative flex flex-col min-h-0 ${className ?? ''}`}>
      <Box
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto p-3"
        data-testid={`${idPrefix}-scroller`}
        role="log"
        aria-live="polite"
      >
        <VStack gap="sm" className="w-full">
          {turns.map((turn, i) => {
            const previous = turns[i - 1];
            const newDay = previous === undefined || dayKey(previous.startedAt) !== dayKey(turn.startedAt);
            const isLast = i === turns.length - 1;
            const live = isLast && working && turn.replies.length === 0;
            return (
              <VStack key={`turn-${turn.startedAt}-${i}`} gap="xs" className="w-full">
                {newDay ? <DaySeparator ts={turn.startedAt} /> : null}
                {turn.request !== undefined ? (
                  <VStack gap="none" className="w-full">
                    <AgentActivityRow activity={turn.request} facts={activityRowFacts([turn.request], (a) => a)[0]} />
                    <Time ts={turn.request.timestamp} align="end" />
                  </VStack>
                ) : null}
                {live ? (
                  <StepRows steps={showRawLlm ? turn.steps : turn.steps.filter((s) => s.type !== 'llm_response')} />
                ) : (
                  <TurnSteps steps={turn.steps} showRawLlm={showRawLlm} onToggleRaw={handleToggle} idPrefix={idPrefix} index={i} />
                )}
                {turn.replies.map((reply, r) => (
                  <VStack key={`reply-${reply.timestamp}-${r}`} gap="none" className="w-full">
                    <AgentActivityRow activity={reply} facts={activityRowFacts([reply], (a) => a)[0]} />
                    <Box className="flex items-center gap-1 self-start">
                      <Time ts={reply.timestamp} align="start" />
                      {reply.type === 'message' ? <CopyReply text={messageText(reply)} /> : null}
                    </Box>
                  </VStack>
                ))}
              </VStack>
            );
          })}
          {working ? <AgentThinkingRow /> : null}
          <Box ref={endRef} />
        </VStack>
      </Box>
      {unseen ? (
        <Box className="absolute inset-x-0 bottom-2 flex justify-center pointer-events-none">
          <Button
            variant="secondary"
            size="sm"
            onClick={jumpToLatest}
            className="pointer-events-auto shadow-elevation-toast"
            data-testid="agent-chat-new-messages"
          >
            <Icon name="arrow-down" size="xs" />
            <Typography variant="caption">{t('agentChat.newMessages')}</Typography>
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

AgentChatFeed.displayName = 'AgentChatFeed';
