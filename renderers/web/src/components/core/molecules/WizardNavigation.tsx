'use client';
/**
 * WizardNavigation Component
 *
 * Navigation buttons for multi-step wizards.
 * Includes Back, Next, and Complete buttons with proper state handling.
 *
 * Emits events via useEventBus for trait integration.
 * Uses wireframe theme styling (high contrast, sharp edges).
 */
import React from "react";
import type { EventEmit, A11yProps } from "@almadar/core";
import { Button } from '../../../core';
import { Typography } from '../../../core';
import { Box } from '../../../core';
import { HStack } from '../../../core';
import { Icon } from '../../../core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
/**
 * Safe event bus hook that works outside EventBusProvider context.
 * Returns a no-op emit function if not in EventBusProvider context.
 */
function useSafeEventBus() {
  try {
    return useEventBus();
  } catch {
    // Outside EventBusProvider context - return no-op
    return { emit: () => {}, on: () => () => {}, once: () => {} };
  }
}

export interface WizardNavigationProps extends A11yProps {
  /** Current step index (0-based) */
  currentStep: number;
  /** Total number of steps */
  totalSteps: number;
  /** Whether the current step is valid (enables Next/Complete) */
  isValid?: boolean;
  /** Show the Back button */
  showBack?: boolean;
  /** Show the Next button */
  showNext?: boolean;
  /** Show the Complete button (on last step) */
  showComplete?: boolean;
  /** Custom label for Back button */
  backLabel?: string;
  /** Custom label for Next button */
  nextLabel?: string;
  /** Custom label for Complete button */
  completeLabel?: string;
  /** Event to emit on Back click — emits UI:{onBack} with { currentStep, totalSteps } */
  onBack?: EventEmit<{ currentStep: number; totalSteps: number }>;
  /** Event to emit on Next click — emits UI:{onNext} with { currentStep, totalSteps } */
  onNext?: EventEmit<{ currentStep: number; totalSteps: number }>;
  /** Event to emit on Complete click — emits UI:{onComplete} with { currentStep, totalSteps } */
  onComplete?: EventEmit<{ currentStep: number; totalSteps: number }>;
  /** Direct callback for Back (alternative to event) */
  onBackClick?: () => void;
  /** Direct callback for Next (alternative to event) */
  onNextClick?: () => void;
  /** Direct callback for Complete (alternative to event) */
  onCompleteClick?: () => void;
  /** Compact mode (smaller padding) */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * WizardNavigation - Wizard navigation buttons
 */
export const WizardNavigation: React.FC<WizardNavigationProps> = ({
  currentStep,
  totalSteps,
  isValid = true,
  showBack = true,
  showNext = true,
  showComplete = true,
  backLabel,
  nextLabel,
  completeLabel,
  onBack = "WIZARD_BACK",
  onNext = "WIZARD_NEXT",
  onComplete = "WIZARD_COMPLETE",
  onBackClick,
  onNextClick,
  onCompleteClick,
  compact = false,
  className,
  ...rest
}) => {
  const eventBus = useSafeEventBus();
  const { t } = useTranslate();

  const resolvedBackLabel = backLabel ?? t('wizard.back');
  const resolvedNextLabel = nextLabel ?? t('wizard.next');
  const resolvedCompleteLabel = completeLabel ?? t('wizard.complete');

  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === totalSteps - 1;

  const handleBack = () => {
    if (onBackClick) {
      onBackClick();
    } else {
      eventBus.emit(`UI:${onBack}`, { currentStep, totalSteps });
    }
  };

  const handleNext = () => {
    if (onNextClick) {
      onNextClick();
    } else {
      eventBus.emit(`UI:${onNext}`, { currentStep, totalSteps });
    }
  };

  const handleComplete = () => {
    if (onCompleteClick) {
      onCompleteClick();
    } else {
      eventBus.emit(`UI:${onComplete}`, { currentStep, totalSteps });
    }
  };

  return (
    <Box
      {...domPassthrough(rest)}
      border
      className={cn(
        // `flex-wrap gap-2` lets the Back / Step / Next trio reflow on
        // narrow viewports rather than crushing the step counter.
        "border-t-heavy border-x-0 border-b-0 border-border flex flex-wrap gap-2 justify-between items-center",
        compact ? "px-4 py-2" : "px-6 py-4",
        className,
      )}
    >
      {/* Back button */}
      {showBack ? (
        <Button variant="secondary" onClick={handleBack} disabled={isFirstStep}>
          <Icon name="chevron-left" size="sm" />
          {resolvedBackLabel}
        </Button>
      ) : (
        <Box />
      )}

      {/* Step counter */}
      <HStack align="center" gap="sm">
        <Typography variant="caption" className="text-muted-foreground">
          {t('wizard.stepOf', { current: String(currentStep + 1), total: String(totalSteps) })}
        </Typography>
      </HStack>

      {/* Next/Complete button */}
      {isLastStep && showComplete ? (
        <Button variant="primary" onClick={handleComplete} disabled={!isValid}>
          {resolvedCompleteLabel}
        </Button>
      ) : showNext ? (
        <Button variant="primary" onClick={handleNext} disabled={!isValid}>
          {resolvedNextLabel}
          <Icon name="chevron-right" size="sm" />
        </Button>
      ) : (
        <Box />
      )}
    </Box>
  );
};

WizardNavigation.displayName = "WizardNavigation";

export default WizardNavigation;
