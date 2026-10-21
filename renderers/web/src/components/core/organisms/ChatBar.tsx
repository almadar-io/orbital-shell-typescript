'use client';
/**
 * ChatBar Organism
 *
 * The always-visible bottom chat bar. A single-row input surface for talking
 * to the agent: status icon, optional context badge, text input, and a
 * status-driven action button (Send / Pause+Stop / Resume / Retry).
 *
 * The agent's activity stream lives in the dedicated Trace tab (see
 * SubagentTracePanel). ChatBar emits generic EventBus events
 * (`UI:CHAT_SEND`, `UI:ELEMENT_SELECTED` to clear the picked element, plus the
 * declarative `UI:*` actions the Button atom raises) — it owns no app-specific
 * state. What the host hands it (a focus request, the picked element) arrives as
 * declared props, never as a bus subscription.
 */

import React, { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Box } from '../../../core';
import { HStack } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';
import { Badge } from '../../../core';
import { Icon } from '../../../core';
import { Textarea } from '../../../core';
import { Spinner } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import type { DisplayStateProps } from './types';
import type { A11yProps, EditFocus, EventKey } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { ELEMENT_SELECTED_EVENT } from './trace-edit-focus';

// ─── Types ─────────────────────────────────────────────────

export type ChatBarStatus = 'idle' | 'running' | 'paused' | 'complete' | 'error';

/** A host handing the conversation to the user: focus the input, optionally with a prompt. */
export interface ChatFocusRequest {
  /** Changes for every new request; the same id re-rendered does not refocus. */
  id: string | number;
  /** Shown in the input until the next message is sent. */
  placeholder?: string;
}

export interface ChatBarProps extends DisplayStateProps, Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Pipeline status */
  status?: ChatBarStatus;
  /** Currently active gate label, e.g. "Gate 2: State machines" */
  activeGate?: string;
  /** JEPA validity probability 0-1 */
  jepaValidity?: number;
  /** Shown beside the gate while `status` is running; defaults to a Spinner (a host passes its brand mark). */
  runningIndicator?: React.ReactNode;
  /** Input placeholder text */
  placeholder?: string;
  /** Agent context description */
  context?: string;
  /** The event a message is sent as — `UI:{sendEvent}` with `{ message }`, from Enter or the send button. @default "CHAT_SEND" */
  sendEvent?: EventKey;
  /** Focus the input (with an optional prompt); a new `id` focuses again. */
  focusRequest?: ChatFocusRequest;
  /** The picked canvas element a sent message edits; its ✕ emits `UI:ELEMENT_SELECTED` with `{ focus: null }`. */
  editFocus?: EditFocus | null;
}

// ─── Helpers ───────────────────────────────────────────────

function getJepaBadgeVariant(probability: number): 'success' | 'warning' | 'danger' {
  if (probability >= 0.9) return 'success';
  if (probability >= 0.5) return 'warning';
  return 'danger';
}

/** About six lines of the input's text. */
const INPUT_MAX_HEIGHT_PX = 160;

// ─── Component ─────────────────────────────────────────────

export function ChatBar({
  status = 'idle',
  activeGate,
  jepaValidity,
  runningIndicator,
  placeholder,
  context,
  sendEvent = 'CHAT_SEND',
  focusRequest,
  editFocus,
  className,
  ...rest
}: ChatBarProps): React.ReactElement {
  const { t } = useTranslate();
  const eventBus = useEventBus();
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The focus request's prompt, shown until the next message is sent.
  const [requestedPlaceholder, setRequestedPlaceholder] = useState<string | null>(null);
  const focus = editFocus ?? null;
  const requestId = focusRequest?.id;
  const requestPlaceholder = focusRequest?.placeholder;

  useEffect(() => {
    if (requestId === undefined) return;
    if (requestPlaceholder !== undefined && requestPlaceholder.length > 0) setRequestedPlaceholder(requestPlaceholder);
    inputRef.current?.focus();
  }, [requestId, requestPlaceholder]);

  // Grow with the text up to about six lines, then scroll inside the input.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const fitted = Math.min(el.scrollHeight, INPUT_MAX_HEIGHT_PX);
    el.style.height = `${fitted}px`;
    el.style.overflowY = el.scrollHeight > INPUT_MAX_HEIGHT_PX ? 'auto' : 'hidden';
  }, [inputValue]);

  const clearFocus = useCallback(() => {
    eventBus.emit(ELEMENT_SELECTED_EVENT, { focus: null });
  }, [eventBus]);

  // Inside a trait scope the send goes out under qualified keys only, so the bar
  // never hears its own emit: both entry points clear it here.
  const clearSent = useCallback(() => {
    setInputValue('');
    setRequestedPlaceholder(null);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    e.preventDefault();
    eventBus.emit(`UI:${sendEvent}`, { message: trimmed });
    clearSent();
  }, [inputValue, eventBus, sendEvent, clearSent]);

  // A send emitted elsewhere on the bus (a host's own send button) clears the bar too.
  useEffect(() => eventBus.on(`UI:${sendEvent}`, clearSent), [eventBus, sendEvent, clearSent]);

  // Fused trailing action(s) — Send by default; status-specific replacements
  // for error / running / paused. All variants share `rounded-none` so they
  // sit flush against the right edge of the bordered input container, and
  // a shared `px-3` keeps the button width visually consistent across
  // states. Action names are bare — the Button atom prepends `UI:`.
  const trailingAction =
    status === 'error' ? (
      <Button variant="secondary" size="sm" action="RETRY_GENERATION" className="rounded-none flex-shrink-0 h-auto">
        <Icon name="refresh-cw" size="xs" />
        <Typography variant="caption">{t('openFile.retry')}</Typography>
      </Button>
    ) : status === 'running' ? (
      <>
        <Button
          variant="ghost"
          size="sm"
          action="PAUSE"
          title={t('chatBar.pauseTheAgentYouCanEdit')}
          className="rounded-none flex-shrink-0 h-auto"
        >
          <Icon name="pause" size="xs" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          action="STOP"
          title={t('chatBar.cancelGeneration')}
          className="rounded-none flex-shrink-0 h-auto border-l border-[var(--color-border)]"
        >
          <Icon name="square" size="xs" />
        </Button>
      </>
    ) : status === 'paused' ? (
      <Button
        variant="primary"
        size="sm"
        action="RESUME"
        title={t('chatBar.resumeTheAgentYourCanvasEdits')}
        className="rounded-none flex-shrink-0 h-auto"
      >
        <Icon name="play" size="xs" />
        <Typography variant="caption">{t('chatBar.resume')}</Typography>
      </Button>
    ) : (
      <Button
        variant="primary"
        size="sm"
        action={sendEvent}
        actionPayload={{ message: inputValue.trim() }}
        onClick={clearSent}
        disabled={!inputValue.trim()}
        aria-label={t('chatBar.sendMessage')}
        className="rounded-none flex-shrink-0 h-auto"
      >
        <Icon name="send" size="xs" />
      </Button>
    );

  return (
    <Box {...domPassthrough(rest)} className={`border-t border-[var(--color-border)] bg-[var(--color-card)] ${className ?? ''}`}>
      {/* Contextual-edit focus chip — the picked canvas element. Sending a
          message applies the edit to it; the ✕ clears the selection. */}
      {focus && (
        <HStack gap="xs" className="items-center px-4 pt-2">
          <Badge variant="secondary" size="sm" className="flex items-center gap-1 max-w-full">
            <Icon name="mouse-pointer-2" size="xs" />
            <Typography variant="caption" className="text-inherit truncate">
              {t('chatBar.editing')}: {focus.label}
            </Typography>
            <Box
              onClick={clearFocus}
              title={t('chatBar.clearSelection')}
              className="cursor-pointer flex items-center ml-1 hover:opacity-70"
            >
              <Icon name="x" size="xs" />
            </Box>
          </Badge>
        </HStack>
      )}

      <HStack gap="sm" className="items-center px-4 py-2">
        {/* Agent context label */}
        {context && (
          <Badge variant="primary" size="sm" className="whitespace-nowrap flex-shrink-0">
            <Typography variant="caption" className="text-inherit">{context}</Typography>
          </Badge>
        )}

        {/* Fused input + trailing action(s) — one bordered surface so the
            send button sits flush against the right edge of the input with
            no visual gap. Input is borderless/transparent inside; the outer
            Box owns the border, radius, and focus state. */}
        <Box className="flex-1 min-w-0 flex items-stretch rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] focus-within:border-[var(--color-primary)] overflow-hidden">
          {/* Textarea (not Input) — the Input atom wraps its <input> in a
              `<div class="relative">`, which collapses to the input's
              intrinsic `size=20` width when placed in a flex row. Textarea
              renders the <textarea> directly, so flex-1 actually grows it.
              Single-row default with `rows={1}` + `resize-none`. */}
          <Textarea
            ref={inputRef}
            value={inputValue}
            placeholder={requestedPlaceholder ?? placeholder ?? t('chatBar.askTheAgentAnything')}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            className="flex-1 min-w-0 min-h-0 text-sm border-0 rounded-none shadow-none bg-transparent resize-none focus:ring-0"
          />
          {trailingAction}
        </Box>

        {/* Right: Active gate + JEPA badge. Only rendered when at least one
            is present so an empty flex slot can't claim layout width and
            squeeze the input on the left. While running, the gate steps up
            to body size with a working indicator: a follow-up turn can run
            for minutes and a muted caption was the only sign of it. */}
        {(activeGate || jepaValidity !== undefined) && (
          <HStack gap="xs" className="items-center flex-shrink-0">
            {status === 'running' && (
              <Box data-testid="chat-bar-running" className="flex items-center">
                {runningIndicator ?? <Spinner size="sm" />}
              </Box>
            )}
            {activeGate && (
              <Typography
                variant={status === 'running' ? 'body' : 'caption'}
                weight={status === 'running' ? 'medium' : undefined}
                color={status === 'running' ? undefined : 'muted'}
                className="whitespace-nowrap"
              >
                {activeGate}
              </Typography>
            )}
            {jepaValidity !== undefined && (
              <Badge variant={getJepaBadgeVariant(jepaValidity)} size="sm">
                <Typography variant="caption" className="text-inherit">
                  {(jepaValidity * 100).toFixed(1)}%
                </Typography>
              </Badge>
            )}
          </HStack>
        )}
      </HStack>
    </Box>
  );
}

ChatBar.displayName = 'ChatBar';
