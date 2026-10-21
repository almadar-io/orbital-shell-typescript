/**
 * ConditionalWrapper Atom Component
 *
 * A wrapper component that conditionally renders its children based on
 * S-expression evaluation. Used for dynamic field visibility in inspection forms.
 */

import React from 'react';
import { Box } from './Box';
import { toWireValue, type FieldValue, type SExpr } from '@almadar/core';
import type { EvalContextWire } from '@almadar/core/kernel-wire';
import { guardsHold } from '../lib/render-eval';

/**
 * Context for conditional evaluation
 */
export type ConditionalContext = {
  formValues: Record<string, FieldValue>;
  globalVariables: Record<string, FieldValue>;
  localVariables?: Record<string, FieldValue>;
  entity?: Record<string, FieldValue>;
};

export interface ConditionalWrapperProps {
  /** The S-expression condition to evaluate */
  condition?: SExpr;
  /** Context for evaluating the condition */
  context: ConditionalContext;
  /** Children to render when condition is true (or when no condition is provided) */
  children: React.ReactNode;
  /** Optional fallback to render when condition is false */
  fallback?: React.ReactNode;
  /** Whether to animate the transition (uses CSS transitions) */
  animate?: boolean;
}

/**
 * The kernel binding context of a wrapper.
 *
 * The entity object is structured as:
 * {
 *   formValues: { fieldId: value, ... },
 *   globalVariables: { HG_VAR: value, ... },
 *   localVariables: { H_VAR: value, ... },
 *   ...additionalEntityFields
 * }
 *
 * Bindings use: @entity.formValues.fieldId, @entity.globalVariables.HG_VAR
 */
function toEvalContext(ctx: ConditionalContext): EvalContextWire {
  return {
    entity: toWireValue({
      formValues: ctx.formValues,
      globalVariables: ctx.globalVariables,
      localVariables: ctx.localVariables ?? {},
      ...ctx.entity,
    }),
    state: 'active',
  };
}

/**
 * ConditionalWrapper conditionally renders children based on S-expression evaluation.
 *
 * Supported bindings:
 * - @entity.formValues.fieldId - Access form field values
 * - @entity.globalVariables.HG_VAR - Access global inspection variables
 * - @entity.localVariables.H_VAR - Access document-local variables
 * - @state - Current state machine state
 * - @now - Current timestamp
 *
 * @example
 * // Simple condition - show field when another field equals a value
 * <ConditionalWrapper
 *   condition={["=", "@entity.formValues.vehicleType", "commercial"]}
 *   context={{ formValues: { vehicleType: "commercial" }, globalVariables: {} }}
 * >
 *   <Input name="commercialLicenseNumber" />
 * </ConditionalWrapper>
 *
 * @example
 * // With fallback - show message when condition not met
 * <ConditionalWrapper
 *   condition={[">=", "@entity.formValues.loadWeight", 3500]}
 *   context={formContext}
 *   fallback={<Typography variant="small">Load weight must be at least 3500kg</Typography>}
 * >
 *   <HeavyVehicleFields />
 * </ConditionalWrapper>
 *
 * @example
 * // Using global variables for cross-form conditions
 * <ConditionalWrapper
 *   condition={["=", "@entity.globalVariables.HG_POTROSNIKI", "DA"]}
 *   context={{ formValues: {}, globalVariables: { HG_POTROSNIKI: "DA" } }}
 * >
 *   <PriceMarkingSection />
 * </ConditionalWrapper>
 */
export const ConditionalWrapper: React.FC<ConditionalWrapperProps> = ({
  condition,
  context,
  children,
  fallback = null,
  animate = false,
}) => {
  // If no condition is provided, always render children
  if (!condition) {
    return <>{children}</>;
  }

  // Evaluate the condition
  const [isVisible] = guardsHold(toEvalContext(context), [condition]);

  // Animate transitions if requested
  if (animate) {
    return (
      <Box
        overflow="hidden"
        className={`transition-all duration-fast ${
          isVisible ? 'opacity-100 max-h-[1000px]' : 'opacity-0 max-h-0'
        }`}
      >
        {isVisible ? children : fallback}
      </Box>
    );
  }

  // Simple conditional rendering
  return isVisible ? <>{children}</> : <>{fallback}</>;
};

ConditionalWrapper.displayName = 'ConditionalWrapper';
