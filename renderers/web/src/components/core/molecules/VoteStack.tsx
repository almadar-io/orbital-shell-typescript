'use client';

import React, { useCallback } from "react";
import type { EventEmit, A11yProps } from "@almadar/core";
import { cn } from '../../../core';
import { Icon } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
export type VoteStackSize = "sm" | "md" | "lg";
export type VoteStackVariant = "vertical" | "horizontal";
/**
 * Current vote state. Both `null` (typical "cleared" sentinel for direct
 * consumers) and the string `"none"` (the .lolo enum spelling — `direction:
 * "up" | "down" | "none"`) are accepted; the component treats them
 * identically. Keeping both accommodates render-ui bindings without forcing
 * std atoms to drop their string sentinel.
 */
export type VoteValue = "up" | "down" | "none" | null;

export interface VoteStackProps extends A11yProps {
  /** Current tally */
  count: number;
  /** Current user's vote (null = no vote cast) */
  userVote?: VoteValue;
  /** Toggle handler. Clicking the same arrow clears (emits null). */
  onVote?: (next: VoteValue) => void;
  /** Event name dispatched on the bus when a vote is cast. Payload: { next: VoteValue }. */
  voteEvent?: EventEmit<{ next: VoteValue }>;
  /** Disabled state */
  disabled?: boolean;
  /** Size variant */
  size?: VoteStackSize;
  /** Layout orientation. `vertical` = forum/Q&A column; `horizontal` = compact row. */
  variant?: VoteStackVariant;
  /** Additional CSS classes */
  className?: string;
  /** Accessible label for the group */
  label?: string;
}

const sizeStyles: Record<VoteStackSize, { button: string; text: string; icon: string }> = {
  sm: {
    button: "w-7 h-7",
    text: "text-sm min-w-[2rem]",
    icon: "w-3 h-3",
  },
  md: {
    button: "w-9 h-9",
    text: "text-base min-w-[2.5rem]",
    icon: "w-4 h-4",
  },
  lg: {
    button: "w-11 h-11",
    text: "text-lg min-w-[3rem]",
    icon: "w-5 h-5",
  },
};

export const VoteStack: React.FC<VoteStackProps> = ({
  count,
  userVote = null,
  onVote,
  voteEvent,
  disabled = false,
  size = "md",
  variant = "vertical",
  className,
  label,
  ...rest
}) => {
  const styles = sizeStyles[size];
  const isUp = userVote === "up";
  const isDown = userVote === "down";
  const eventBus = useEventBus();
  const { t } = useTranslate();

  const handleUp = useCallback(() => {
    const next: VoteValue = isUp ? null : "up";
    onVote?.(next);
    if (voteEvent) {
      eventBus.emit(`UI:${voteEvent}`, { next });
    }
  }, [isUp, onVote, voteEvent, eventBus]);

  const handleDown = useCallback(() => {
    const next: VoteValue = isDown ? null : "down";
    onVote?.(next);
    if (voteEvent) {
      eventBus.emit(`UI:${voteEvent}`, { next });
    }
  }, [isDown, onVote, voteEvent, eventBus]);

  return (
    <div
      {...domPassthrough(rest)}
      className={cn(
        "inline-flex items-center justify-center",
        // Shrink-wrap in stretch contexts (slot/sidecar wrappers are
        // flex-column with stretch alignment): without this the root spans
        // the full wrapper width and the count row's `w-full` turns the
        // compact pill into a page-wide band.
        "w-fit",
        variant === "vertical" ? "flex-col" : "flex-row",
        "rounded-interactive",
        "border-[length:var(--border-width)] border-border",
        "bg-surface",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
      role="group"
      aria-label={rest['aria-label'] ?? label ?? t('voteStack.ariaLabel')}
    >
      <button
        type="button"
        onClick={handleUp}
        disabled={disabled}
        aria-label={t('aria.upvote')}
        aria-pressed={isUp}
        className={cn(
          "inline-flex items-center justify-center",
          variant === "vertical" ? "rounded-t-interactive" : "rounded-l-interactive",
          isUp ? "text-primary" : "text-muted-foreground",
          "hover:bg-muted",
          "active:bg-muted",
          "transition-colors duration-instant",
          "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent",
          "focus:outline-none focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-ring focus-visible:ring-inset",
          styles.button,
        )}
      >
        <Icon name="chevron-up" className={styles.icon} />
      </button>

      <span
        className={cn(
          "text-center font-bold tabular-nums select-none",
          "text-foreground",
          variant === "vertical"
            ? "border-y-[length:var(--border-width)] border-border w-full"
            : "border-x-[length:var(--border-width)] border-border h-full",
          "px-1 py-0.5",
          styles.text,
        )}
        aria-live="polite"
        aria-atomic="true"
      >
        {count}
      </span>

      <button
        type="button"
        onClick={handleDown}
        disabled={disabled}
        aria-label={t('aria.downvote')}
        aria-pressed={isDown}
        className={cn(
          "inline-flex items-center justify-center",
          variant === "vertical" ? "rounded-b-interactive" : "rounded-r-interactive",
          isDown ? "text-primary" : "text-muted-foreground",
          "hover:bg-muted",
          "active:bg-muted",
          "transition-colors duration-instant",
          "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent",
          "focus:outline-none focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-ring focus-visible:ring-inset",
          styles.button,
        )}
      >
        <Icon name="chevron-down" className={styles.icon} />
      </button>
    </div>
  );
};

VoteStack.displayName = "VoteStack";