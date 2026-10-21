'use client';
/**
 * WizardProgress Component
 *
 * Step progress indicator for multi-step wizards.
 * Shows current step, completed steps, and allows navigation to completed steps.
 *
 * Uses wireframe theme styling (high contrast, sharp edges).
 */
import React from "react";
import type { EventEmit, A11yProps } from "@almadar/core";
import { Typography } from '../../../core';
import { Box } from '../../../core';
import { Icon } from '../../../core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { Button } from '../../../core';

import { domPassthrough } from '../../../core';
/**
 * Step info needed by WizardProgress.
 * Compatible with WizardContainer's WizardStep (subset of fields).
 */
export interface WizardProgressStep {
  /** Step identifier */
  id: string;
  /** Step title */
  title: string;
  /** Step description (optional) */
  description?: string;
}

export interface WizardProgressProps extends A11yProps {
  /** Step definitions (compatible with WizardContainer's WizardStep). A string is shorthand for `{ id: str, title: str }`. */
  steps?: (WizardProgressStep | string)[];
  /** Current step index (0-based) */
  currentStep: number;
  /** Callback when a completed step is clicked */
  onStepClick?: (stepIndex: number) => void;
  /** Allow clicking on completed steps to navigate back */
  allowNavigation?: boolean;
  /** Compact mode (smaller, no titles) */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
  /**
   * Declarative step click event — emits UI:{stepClickEvent} with { stepIndex }.
   * Setting it requires declaring that event (with a `{ stepIndex }` payload)
   * and a transition handling it in the same trait; omit this prop for
   * non-clickable progress indicators.
   */
  stepClickEvent?: EventEmit<{ stepIndex: number }>;
}

/**
 * WizardProgress - Step progress indicator
 */
export const WizardProgress: React.FC<WizardProgressProps> = ({
  steps,
  currentStep,
  onStepClick,
  allowNavigation = true,
  compact = false,
  className,
  stepClickEvent,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const normalizedSteps: WizardProgressStep[] = (steps ?? []).map((s, i) =>
    typeof s === "string" ? { id: `step-${i}`, title: s } : s,
  );
  const totalSteps = normalizedSteps.length;

  const handleStepClick = (index: number) => {
    const isCompleted = index < currentStep;
    if (isCompleted && allowNavigation) {
      if (stepClickEvent) eventBus.emit(`UI:${stepClickEvent}`, { stepIndex: index });
      onStepClick?.(index);
    }
  };

  return (
    <Box
      {...domPassthrough(rest)}
      border
      className={cn(
        "@container border-b-heavy border-x-0 border-t-0 border-border",
        compact ? "px-4 py-2" : "px-6 py-4",
        className,
      )}
    >
      <Box className="flex items-center gap-2">
        {normalizedSteps.map((step, index) => {
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;
          const canNavigate = isCompleted && allowNavigation;

          return (
            <React.Fragment key={step.id || `step-${index}`}>
              <Button
                variant="ghost"
                onClick={() => handleStepClick(index)}
                disabled={!canNavigate}
                aria-current={isActive ? "step" : undefined}
                aria-label={`${t("wizard.stepOf", { current: index + 1, total: totalSteps })}: ${step.title}`}
                className={cn(
                  "flex-shrink-0 p-0 rounded-full text-sm tabular-nums border-heavy disabled:opacity-100",
                  compact ? "w-6 h-6" : "w-8 h-8",
                  isActive || isCompleted
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border",
                  canNavigate && "hover:bg-primary-hover",
                )}
              >
                {isCompleted ? <Icon name="check" size="sm" /> : index + 1}
              </Button>

              {!compact && (
                <Box
                  data-step-title
                  className={cn("min-w-0", !isActive && "hidden @md:block", isActive ? "text-foreground" : "text-muted-foreground")}
                >
                  <Typography variant="small" weight="medium" truncate>
                    {step.title}
                  </Typography>
                </Box>
              )}

              {index < totalSteps - 1 && (
                <Box
                  aria-hidden="true"
                  className={cn("flex-1 min-w-4 h-0.5", index < currentStep ? "bg-primary" : "bg-border")}
                />
              )}
            </React.Fragment>
          );
        })}
      </Box>
    </Box>
  );
};

WizardProgress.displayName = "WizardProgress";

export default WizardProgress;
