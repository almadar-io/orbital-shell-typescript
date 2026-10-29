import type { A11yProps } from '@almadar/core';
import React from "react";
import { Icon } from "./Icon";
import { cn } from "../lib/cn";
import { useTranslate } from "../hooks/useTranslate";

export type TrendDirection = "up" | "down" | "flat";
export type TrendIndicatorSize = "sm" | "md" | "lg";

/**
 * @role status
 * @tokens --color-success --color-error --color-muted-foreground
 * @motion none
 */
export interface TrendIndicatorProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, keyof A11yProps>, A11yProps {
  /** Additional CSS classes applied to the root element. */
  className?: string;
  /** Numeric value to display (e.g., 12.5 for +12.5%) */
  value?: number;
  /** Override automatic direction detection (positive=up, negative=down, zero=flat) */
  direction?: TrendDirection;
  /** Show the formatted value text next to the arrow */
  showValue?: boolean;
  /** Invert color logic (for metrics where down is good, e.g., error rate, bounce rate) */
  invert?: boolean;
  /** Accessible label override */
  label?: string;
  /** Size of the indicator */
  size?: TrendIndicatorSize;
}

const sizeStyles: Record<TrendIndicatorSize, { icon: string; text: string }> = {
  sm: { icon: "w-3 h-3", text: "text-xs" },
  md: { icon: "w-4 h-4", text: "text-sm" },
  lg: { icon: "w-5 h-5", text: "text-base" },
};

function resolveDirection(value: number | undefined, direction: TrendDirection | undefined): TrendDirection {
  if (direction) return direction;
  if (value === undefined || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

function resolveColor(dir: TrendDirection, invert: boolean): string {
  if (dir === "flat") return "text-muted-foreground";
  const isPositive = dir === "up";
  const isGood = invert ? !isPositive : isPositive;
  return isGood ? "text-success" : "text-error";
}

const iconNameMap: Record<TrendDirection, string> = {
  up: "trending-up",
  down: "trending-down",
  flat: "arrow-right",
};

export const TrendIndicator = React.forwardRef<HTMLSpanElement, TrendIndicatorProps>(
  (
    {
      className,
      value,
      direction,
      showValue = true,
      invert = false,
      label,
      size = "md",
      ...props
    },
    ref,
  ) => {
    const { t, locale } = useTranslate();
    // No trend data and no explicit direction — render nothing rather than
    // a fabricated flat "→" (same contract as Badge's empty render). Unset
    // bindings can arrive as null or "" depending on the path, so only a
    // finite number counts as data.
    const hasValue = typeof value === "number" && Number.isFinite(value);
    if (!hasValue && !direction) return null;
    const dir = resolveDirection(hasValue ? value : undefined, direction);
    const colorClass = resolveColor(dir, invert);
    const iconName = iconNameMap[dir];
    const styles = sizeStyles[size];

    const formattedValue = hasValue
      ? new Intl.NumberFormat(locale, { style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 2 }).format(value / 100)
      : undefined;

    const ariaLabel = label ?? (formattedValue ? t("trendIndicator.withValue", { direction: t(`trendIndicator.${dir}`), value: formattedValue }) : t(`trendIndicator.${dir}`));

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1 font-medium",
          colorClass,
          styles.text,
          className,
        )}
        role="status"
        aria-label={ariaLabel}
        {...props}
      >
        <Icon name={iconName} className={styles.icon} />
        {showValue && formattedValue && (
          <span>{formattedValue}</span>
        )}
      </span>
    );
  },
);

TrendIndicator.displayName = "TrendIndicator";
