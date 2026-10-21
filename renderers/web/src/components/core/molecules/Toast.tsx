'use client';
/**
 * Toast Molecule Component
 *
 * A toast notification component with auto-dismiss and action buttons.
 * Uses theme-aware CSS variables for styling.
 */

import React, { useEffect, useRef, useState } from "react";
import type { EventEmit, A11yProps } from "@almadar/core";
import { Box } from '../../../core';
import { Icon } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';
import { Badge } from '../../../core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
export type ToastVariant = "success" | "error" | "info" | "warning";

export interface ToastProps extends A11yProps {
  /** Toast variant */
  variant?: ToastVariant;
  /** Toast message */
  message: string;
  /** Toast title (optional) */
  title?: string;
  /**
   * Auto-dismiss duration in milliseconds (0 = no auto-dismiss). The timer
   * pauses while the toast is hovered or focused, and a toast carrying an
   * action (`actionLabel` with `onAction`/`actionEvent`) never auto-dismisses.
   */
  duration?: number;
  /** Show dismiss button */
  dismissible?: boolean;
  /** Callback when toast is dismissed */
  onDismiss?: () => void;
  /** Action button label */
  actionLabel?: string;
  /** Action button click handler */
  onAction?: () => void;
  /** Badge count (optional) */
  badge?: string | number;
  /** Additional CSS classes */
  className?: string;
  /** Declarative dismiss event — emits UI:{dismissEvent} via eventBus when toast is dismissed */
  dismissEvent?: EventEmit<Record<string, never>>;
  /** Declarative action event — emits UI:{actionEvent} via eventBus when action button is clicked */
  actionEvent?: EventEmit<Record<string, never>>;
}

// Theme-aware variant styles
const variantClasses: Record<ToastVariant, string> = {
  success:
    "bg-card border-[length:var(--border-width)] border-success",
  error:
    "bg-card border-[length:var(--border-width)] border-error",
  info: "bg-card border-[length:var(--border-width)] border-info",
  warning:
    "bg-card border-[length:var(--border-width)] border-warning",
};

const iconMap: Record<ToastVariant, string> = {
  success: "check-circle",
  error: "alert-circle",
  info: "info",
  warning: "alert-triangle",
};

const iconColors: Record<ToastVariant, string> = {
  success: "text-success",
  error: "text-error",
  info: "text-info",
  warning: "text-warning",
};

export const Toast: React.FC<ToastProps> = ({
  variant = "info",
  message,
  title,
  duration = 5000,
  dismissible = true,
  onDismiss,
  actionLabel,
  onAction,
  badge,
  className,
  dismissEvent,
  actionEvent,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  // Self-managed exit: dismiss starts the out-animation; the real onDismiss
  // fires after it completes (so the parent keeps the toast mounted through
  // the exit). Enter animation runs on mount.
  const [leaving, setLeaving] = useState(false);

  const doRealDismiss = () => {
    if (dismissEvent) eventBus.emit(`UI:${dismissEvent}`, {});
    onDismiss?.();
  };

  const handleDismiss = () => {
    if (leaving) return;
    setLeaving(true);
  };

  const handleAction = () => {
    if (actionEvent) eventBus.emit(`UI:${actionEvent}`, {});
    onAction?.();
  };

  const handleAnimEnd = (e: React.AnimationEvent) => {
    if (e.target !== e.currentTarget) return;
    if (leaving) doRealDismiss();
  };

  const hasAction = Boolean(actionLabel) && Boolean(onAction || actionEvent);
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(duration);
  useEffect(() => {
    remainingRef.current = duration;
  }, [duration]);

  useEffect(() => {
    if (duration <= 0 || hasAction || paused || (!onDismiss && !dismissEvent)) {
      return;
    }

    const startedAt = Date.now();
    const timer = setTimeout(() => {
      handleDismiss();
    }, remainingRef.current);

    return () => {
      clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
    };
  }, [duration, hasAction, paused, onDismiss, dismissEvent]); // handleDismiss is stable across renders

  return (
    <Box
      {...domPassthrough(rest)}
      className={cn(
        // `min-w-[300px]` only kicks in at `sm:` and above so a phone
        // viewport doesn't get a toast wider than the screen near the
        // edge. `max-w-[calc(100vw-2rem)]` clamps to viewport too.
        "border-l-heavy p-4 shadow-elevation-toast min-w-0 sm:min-w-[300px] max-w-md max-w-[calc(100vw-2rem)]",
        "rounded-container surface-material",
        leaving ? "animate-toast-out" : "animate-toast-in",
        variantClasses[variant],
        className,
      )}
      role={variant === "error" || variant === "warning" ? "alert" : "status"}
      onAnimationEnd={handleAnimEnd}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Box className="flex items-start gap-3">
        <Box className="flex-shrink-0 mt-0.5">
          <Icon
            name={iconMap[variant]}
            size="md"
            className={iconColors[variant]}
          />
        </Box>

        <Box className="flex-1 min-w-0">
          {title && (
            <Typography variant="h6" className="mb-1">
              {title}
            </Typography>
          )}
          <Typography variant="small" className="text-sm">
            {message}
          </Typography>

          {actionLabel && (onAction || actionEvent) && (
            <Box className="mt-3">
              <Button variant="ghost" size="sm" onClick={handleAction}>
                {actionLabel}
              </Button>
            </Box>
          )}
        </Box>

        <Box className="flex items-start gap-2 flex-shrink-0">
          {badge !== undefined && (
            <Badge variant="default" size="sm">
              {badge}
            </Badge>
          )}
          {dismissible && (
            <Button
              variant="ghost"
              size="sm"
              icon="x"
              onClick={handleDismiss}
              aria-label={t('aria.closeToast')}
              className="flex-shrink-0"
            />
          )}
        </Box>
      </Box>
    </Box>
  );
};

Toast.displayName = "Toast";