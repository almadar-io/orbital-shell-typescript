import type { A11yProps } from '@almadar/core';
import React from "react";
import { cn } from "../lib/cn";
import { useTranslate } from "../hooks/useTranslate";

export type StatusDotStatus = "online" | "offline" | "away" | "busy" | "warning" | "critical";
export type StatusDotSize = "sm" | "md" | "lg";

/**
 * @role status
 * @tokens --color-success --color-warning --color-error --color-muted-foreground
 * @motion css
 */
export interface StatusDotProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, keyof A11yProps>, A11yProps {
  /** Additional CSS classes applied to the root element. */
  className?: string;
  /** Status determines the dot color */
  status?: StatusDotStatus;
  /** Enable pulse animation for active/critical states */
  pulse?: boolean;
  /** Dot size */
  size?: StatusDotSize;
  /** Accessible label (rendered as sr-only text) */
  label?: string;
}

const statusColors: Record<StatusDotStatus, string> = {
  online: "bg-success",
  offline: "bg-muted-foreground",
  away: "bg-warning",
  busy: "bg-error",
  warning: "bg-warning",
  critical: "bg-error",
};

const pulseRingColors: Record<StatusDotStatus, string> = {
  online: "ring-success",
  offline: "ring-muted-foreground",
  away: "ring-warning",
  busy: "ring-error",
  warning: "ring-warning",
  critical: "ring-error",
};

const sizeStyles: Record<StatusDotSize, string> = {
  sm: "w-2 h-2",
  md: "w-2.5 h-2.5",
  lg: "w-3 h-3",
};

export const StatusDot = React.forwardRef<HTMLSpanElement, StatusDotProps>(
  ({ className, status = "offline", pulse = false, size = "md", label, ...props }, ref) => {
    const { t } = useTranslate();
    return (
      <span
        ref={ref}
        className={cn(
          "inline-block rounded-full flex-shrink-0",
          statusColors[status],
          sizeStyles[size],
          pulse && [
            "animate-pulse",
            "ring-2 ring-offset-1",
            pulseRingColors[status],
            "ring-opacity-40",
          ],
          className,
        )}
        role="status"
        aria-label={label ?? t(`statusDot.${status}`)}
        {...props}
      />
    );
  },
);

StatusDot.displayName = "StatusDot";
