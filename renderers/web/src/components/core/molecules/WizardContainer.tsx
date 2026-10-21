'use client';
/**
 * WizardContainer Component
 *
 * Multi-step wizard pattern with progress indicator.
 * Composes Box, Typography, and Button atoms.
 *
 * Uses wireframe theme styling (high contrast, sharp edges).
 */
import React, { useState, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { JsonValue, EventKey, EventEmit, ControlValue, FieldValue, A11yProps } from "@almadar/core";
import { Button } from '../../../core';
import { Typography } from '../../../core';
import { Box } from '../../../core';
import { HStack } from '../../../core';
import { Icon } from '../../../core';
import { cn } from '../../../core';
import { useTranslate } from '../../../core';
import { useEventBus } from '../../../core';
import type { SExpr } from "@almadar/core";
import type { UiError } from '../../../core';
import { WizardProgress } from "./WizardProgress";

import { domPassthrough } from '../../../core';
/** Form field definition for wizard sections */
export interface WizardField {
  id: string;
  type: string;
  label?: string;
  required?: boolean;
  repeatable?: boolean;
  options?: Array<{ value: string; label: string; isDefault?: boolean }>;
  defaultValue?: ControlValue;
  condition?: SExpr;
  placeholder?: string;
  entityField?: string;
  minLength?: number;
  maxLength?: number;
  dataSource?: Record<string, FieldValue>;
  displayFields?: string[];
  searchConfig?: Record<string, FieldValue>;
  hiddenCalculations?: Array<{
    variable: string;
    expression: string;
    scope?: string;
  }>;
  signatureConfig?: Record<string, FieldValue>;
  displayTemplate?: Record<string, FieldValue>;
  lawReference?: Record<string, FieldValue>;
  contextMenu?: string[];
  calculated?: Record<string, FieldValue>;
  readOnly?: boolean;
  minDate?: string;
  stats?: Array<{ label: string; value: ControlValue; icon?: string }>;
  items?: Array<{ id: string; label: string; autoCheck?: boolean }>;
  [key: string]: JsonValue | SExpr | ControlValue | Record<string, FieldValue> | undefined;
}

/** Section within a wizard step */
export interface WizardSection {
  id: string;
  title?: string;
  description?: string;
  fields?: WizardField[];
  subsections?: WizardSection[];
  condition?: SExpr;
  repeatable?: boolean;
  minItems?: number;
  addButtonLabel?: string;
  hiddenCalculations?: Array<{
    variable: string;
    expression: string;
    scope?: string;
  }>;
  dataSource?: Record<string, FieldValue>;
  readOnly?: boolean;
  [key: string]: JsonValue | SExpr | Record<string, FieldValue> | WizardField[] | WizardSection[] | undefined;
}

/** Entity mapping configuration */
export interface WizardEntityMapping {
  entity: string;
  mode:
    | "search_or_create"
    | "create_multiple"
    | "select_one"
    | "update"
    | string;
  parentField?: string;
  idField?: string;
  [key: string]: JsonValue | undefined;
}

/** Validation rule for wizard steps */
export interface WizardValidationRule {
  condition: SExpr;
  message: string;
}

/** Law reference for compliance */
export interface WizardLawReference {
  law: string;
  article: string;
  description?: string;
}

export interface WizardStep {
  /** Step identifier */
  id?: string;
  /** Tab identifier (schema-driven) */
  tabId?: string;
  /** Step title */
  title?: string;
  /** Step name (schema-driven, used as title if title not provided) */
  name?: string;
  /** Step description (optional) */
  description?: string;
  /** Step content (React component mode) */
  content?: React.ReactNode;
  /** Whether this step can be skipped */
  optional?: boolean;
  /** Custom validation for this step */
  isValid?: () => boolean;

  // Schema-driven wizard properties
  /** Form sections within this step */
  sections?: WizardSection[];
  /** Global variables required before entering this step */
  globalVariablesRequired?: string[];
  /** Global variables set by this step */
  globalVariablesSet?: string[];
  /** Local variables scoped to this step */
  localVariables?: string[];
  /** Entity mapping configuration */
  entityMapping?: WizardEntityMapping;
  /** Validation rules for this step */
  validationRules?: WizardValidationRule[];
  /** Law references for compliance */
  lawReferences?: WizardLawReference[];
  /** Phase of the inspection process */
  phase?: string;
  /** Context menu actions */
  contextMenu?: string[];

  /** Allow additional properties from schema */
  [key: string]: JsonValue | React.ReactNode | WizardSection[] | WizardEntityMapping | WizardValidationRule[] | WizardLawReference[] | (() => boolean) | undefined;
}

export interface WizardContainerProps extends A11yProps {
  /** Wizard steps */
  steps: WizardStep[];
  /** Current step index (controlled) - accepts number or string for generated code compatibility */
  currentStep?: number | string;
  /**
   * Callback when step changes
   * @notification
   */
  onStepChange?: (stepIndex: number) => void;
  /** Callback when wizard is completed */
  onComplete?: () => void;
  /** Show progress indicator */
  showProgress?: boolean;
  /** Allow navigation to previous steps */
  allowBack?: boolean;
  /** Modal mode (compact header, no padding) */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Loading state indicator */
  isLoading?: boolean;
  /** Error state */
  error?: UiError | null;
  /** Emits UI:{nextEvent} when advancing to next step */
  nextEvent?: EventEmit<{ step: number }>;
  /** Emits UI:{backEvent} when going to previous step */
  backEvent?: EventEmit<{ step: number }>;
  /** Emits UI:{completeEvent} when wizard completes */
  completeEvent?: EventKey;
}

/**
 * WizardContainer - Multi-step wizard
 */
export const WizardContainer: React.FC<WizardContainerProps> = ({
  steps,
  currentStep: controlledStep,
  onStepChange,
  onComplete,
  showProgress = true,
  allowBack = true,
  compact = false,
  className,
  nextEvent,
  backEvent,
  completeEvent,
  ...rest
}) => {
  const { t } = useTranslate();
  const eventBus = useEventBus();
  const [internalStep, setInternalStep] = useState(0);

  // Normalize controlledStep to number (handles string/unknown from generated code)
  const normalizedControlledStep = (() => {
    if (controlledStep === undefined || controlledStep === null)
      return undefined;
    if (typeof controlledStep === "number") return controlledStep;
    if (typeof controlledStep === "string") return parseInt(controlledStep, 10);
    // Handle unknown - try to convert to number
    const num = Number(controlledStep);
    return isNaN(num) ? undefined : num;
  })();
  const currentStep =
    normalizedControlledStep !== undefined
      ? normalizedControlledStep
      : internalStep;
  const totalSteps = steps.length;
  const currentStepData = steps[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === totalSteps - 1;

  const goToStep = useCallback(
    (stepIndex: number) => {
      if (stepIndex < 0 || stepIndex >= totalSteps) return;

      if (controlledStep === undefined) {
        setInternalStep(stepIndex);
      }
      onStepChange?.(stepIndex);
    },
    [controlledStep, totalSteps, onStepChange],
  );

  const handleNext = () => {
    // Validate current step if validator exists
    if (currentStepData.isValid && !currentStepData.isValid()) {
      return;
    }

    if (isLastStep) {
      if (completeEvent) eventBus.emit(`UI:${completeEvent}`, { step: currentStep });
      onComplete?.();
    } else {
      if (nextEvent) eventBus.emit(`UI:${nextEvent}`, { step: currentStep + 1 });
      goToStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (!isFirstStep && allowBack) {
      if (backEvent) eventBus.emit(`UI:${backEvent}`, { step: currentStep - 1 });
      goToStep(currentStep - 1);
    }
  };

  return (
    <Box {...domPassthrough(rest)} className={cn("flex flex-col h-full", className)}>
      {showProgress && (
        <WizardProgress
          steps={steps.map((step, index) => ({
            id: step.id ?? step.tabId ?? `step-${index}`,
            title: step.title ?? step.name ?? t("wizard.stepOf", { current: index + 1, total: totalSteps }),
          }))}
          currentStep={currentStep}
          onStepClick={goToStep}
          allowNavigation={allowBack}
          compact={compact}
        />
      )}

      {/* Step header */}
      {!compact && currentStepData && (
        <Box
          paddingX="lg"
          paddingY="md"
          border
          className="border-b-heavy border-x-0 border-t-0 border-border"
        >
          <Typography variant="h4" as="h2">
            {currentStepData.title ??
              currentStepData.name ??
              t("wizard.stepOf", { current: currentStep + 1, total: totalSteps })}
          </Typography>
          {currentStepData.description && (
            <Typography
              variant="body2"
              className="text-muted-foreground mt-1"
            >
              {currentStepData.description}
            </Typography>
          )}
        </Box>
      )}

      {/* Step content */}
      <Box className={cn("flex-1 overflow-auto", compact ? "p-4" : "p-6")}>
        {currentStepData?.content}
      </Box>

      {/* Navigation buttons */}
      <Box
        border
        className={cn(
          "border-t-heavy border-x-0 border-b-0 border-border flex justify-between",
          compact ? "px-4 py-2" : "px-6 py-4",
        )}
      >
        <Button
          variant="secondary"
          onClick={handleBack}
          disabled={isFirstStep || !allowBack}
        >
          <Icon icon={ChevronLeft} size="sm" />
          {t('wizard.back')}
        </Button>

        <HStack gap="sm" align="center">
          <Typography
            variant="caption"
            className="text-muted-foreground"
          >
            {t('wizard.stepOf', { current: String(currentStep + 1), total: String(steps.length) })}
          </Typography>
        </HStack>

        <Button variant="primary" onClick={handleNext}>
          {isLastStep ? t('wizard.complete') : t('wizard.next')}
          {!isLastStep && <Icon icon={ChevronRight} size="sm" />}
        </Button>
      </Box>
    </Box>
  );
};

WizardContainer.displayName = "WizardContainer";

export default WizardContainer;
