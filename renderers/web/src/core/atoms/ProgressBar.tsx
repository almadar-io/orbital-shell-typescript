/**
 * ProgressBar Atom Component
 *
 * A progress bar component with linear, circular, and stepped variants.
 */

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../lib/domPassthrough';
import React from "react";
import { cn } from "../lib/cn";
import type { ColorToken } from "./types";
import { useTranslate, useFormatContext } from "../hooks/useTranslate";
import { formatValue } from "../lib/format";

export type ProgressBarType = "linear" | "circular" | "stepped";
export type ProgressBarVariant =
  | "default"
  | "primary"
  | "success"
  | "warning"
  | "error"
  | "danger"; // backward-compat alias for 'error'
export type ProgressBarColor = ProgressBarVariant;

export interface ProgressBarProps extends A11yProps {
  /**
   * Progress value (0-100)
   */
  value: number;

  /**
   * Maximum value (for calculating percentage)
   * @default 100
   */
  max?: number;

  /**
   * Type of the progress bar (linear, circular, stepped)
   * @default 'linear'
   */
  progressType?: ProgressBarType;

  /**
   * Variant/color of the progress bar
   * @default 'primary'
   */
  variant?: ProgressBarVariant;

  /**
   * Color variant (alias for variant; `variant` applies when omitted)
   */
  color?: ProgressBarColor;

  /**
   * Show percentage text
   * @default false
   */
  showPercentage?: boolean;

  /**
   * Alias for showPercentage (pattern compatibility)
   */
  showLabel?: boolean;

  /**
   * Label text
   */
  label?: string;

  /**
   * Size (for circular variant)
   * @default 'md'
   */
  size?: "sm" | "md" | "lg";

  /**
   * Number of steps (for stepped variant)
   * @default 5
   */
  steps?: number;

  /**
   * Additional CSS classes
   */
  className?: string;
}

const colorClasses: Record<ProgressBarVariant, string> = {
  default: "bg-primary",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
  danger: "bg-error",
};

const circularSizeClasses = {
  sm: "w-16 h-16",
  md: "w-24 h-24",
  lg: "w-32 h-32",
};

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  progressType = "linear",
  variant = "primary",
  color,
  showPercentage = false,
  showLabel = false,
  label,
  size = "md",
  steps = 5,
  className,
  ...rest
}) => {
  const { t } = useTranslate();
  const fmt = useFormatContext();
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  const percentText = formatValue(Math.round(percentage), "percent", fmt);
  // Use color if provided, else variant
  const effectiveColor = color ?? variant;
  // Use showLabel as alias for showPercentage
  const effectiveShowPercentage = showPercentage || showLabel;

  const progressSemantics = {
    role: "progressbar" as const,
    "aria-valuenow": value,
    "aria-valuemin": 0,
    "aria-valuemax": max,
    "aria-label": rest["aria-label"] ?? (label || t("progressBar.ariaLabel", { percent: percentText })),
  };

  if (progressType === "linear") {
    const showHeader = label || effectiveShowPercentage;
    return (
      <div className={cn("w-full", className)} {...domPassthrough(rest)} {...progressSemantics}>
        {showHeader && (
          <div className="flex items-center justify-between mb-1.5">
            {label && (
              <span className="text-sm font-bold text-foreground">
                {label}
              </span>
            )}
            {effectiveShowPercentage && (
              <span className={cn("text-sm text-foreground font-medium", !label && "ml-auto")}>
                {percentText}
              </span>
            )}
          </div>
        )}
        <div className="w-full h-2 bg-muted border border-border overflow-hidden">
          <div
            className={cn(
              "h-full transition-all duration-normal ease-emphasized",
              colorClasses[effectiveColor],
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    );
  }

  if (progressType === "circular") {
    const radius = size === "sm" ? 28 : size === "md" ? 40 : 56;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;

    return (
      <div
        className={cn(
          "relative inline-flex items-center justify-center",
          className,
        )}
        {...domPassthrough(rest)}
        {...progressSemantics}
      >
        <svg
          className={cn("transform -rotate-90", circularSizeClasses[size])}
          viewBox="0 0 100 100"
        >
          {/* Background circle */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            stroke="currentColor"
            strokeWidth="8"
            fill="none"
            className="text-muted"
          />
          {/* Progress circle */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            stroke="currentColor"
            strokeWidth="8"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className={cn(
              "transition-all duration-normal ease-emphasized",
              colorClasses[effectiveColor],
            )}
          />
        </svg>
        {effectiveShowPercentage && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-bold text-foreground">
              {percentText}
            </span>
          </div>
        )}
      </div>
    );
  }

  if (progressType === "stepped") {
    const stepValue = max / steps;
    const activeSteps = Math.floor(value / stepValue);
    const partialStep = (value % stepValue) / stepValue;

    const showStepHeader = label || effectiveShowPercentage;
    return (
      <div className={cn("w-full", className)} {...domPassthrough(rest)} {...progressSemantics}>
        {showStepHeader && (
          <div className="flex items-center justify-between mb-2">
            {label && (
              <span className="text-sm font-medium text-foreground">
                {label}
              </span>
            )}
            {effectiveShowPercentage && (
              <span className={cn("text-sm text-muted-foreground", !label && "ml-auto")}>
                {percentText}
              </span>
            )}
          </div>
        )}
        <div className="flex gap-1">
          {Array.from({ length: steps }).map((_, index) => {
            const isActive = index < activeSteps;
            const isPartial = index === activeSteps && partialStep > 0;

            return (
              <div
                key={index}
                className="flex-1 h-2 bg-muted border border-border overflow-hidden"
              >
                <div
                  className={cn(
                    "h-full transition-all duration-normal ease-emphasized",
                    (isActive || isPartial) && colorClasses[effectiveColor],
                  )}
                  style={{
                    width: isPartial
                      ? `${partialStep * 100}%`
                      : isActive
                        ? "100%"
                        : "0%",
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
};

ProgressBar.displayName = "ProgressBar";
