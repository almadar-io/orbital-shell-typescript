/**
 * CounterTemplate
 *
 * A presentational template for counter/incrementer features.
 * Supports increment, decrement, and reset operations.
 */

import React from "react";
import type { A11yProps, EventKey } from "@almadar/core";
import { domPassthrough } from '../../../core';
import { cn } from '../../../core';
import { Container } from "../molecules/Container";
import { VStack, HStack } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';
import { useTranslate } from '../../../core';
import type { TemplateProps } from "./types";

export type CounterSize = "sm" | "md" | "lg";
export type CounterVariant = "minimal" | "standard" | "full";

export interface CounterEntity {
  /** Entity ID */
  id: string;
  /** Current count value */
  count: number;
  /** Whether decrement button is disabled */
  decrementDisabled?: boolean;
  /** Whether increment button is disabled */
  incrementDisabled?: boolean;
  /** Step label for decrement button (e.g. "-5") */
  decrementLabel?: string;
  /** Step label for increment button (e.g. "+5") */
  incrementLabel?: string;
  /** Formatted range text (e.g. "Range: 0 to 100") */
  rangeText?: string;
}

export interface CounterTemplateProps extends TemplateProps<CounterEntity>, Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Called when increment is clicked */
  onIncrement?: () => void;
  /** Called when decrement is clicked */
  onDecrement?: () => void;
  /** Called when reset is clicked */
  onReset?: () => void;
  /** Declarative event key — emits UI:{incrementEvent} via bus on increment */
  incrementEvent?: EventKey;
  /** Declarative event key — emits UI:{decrementEvent} via bus on decrement */
  decrementEvent?: EventKey;
  /** Declarative event key — emits UI:{resetEvent} via bus on reset */
  resetEvent?: EventKey;
  /** Title displayed above the counter */
  title?: string;
  /** Show reset button */
  showReset?: boolean;
  /** Counter display size */
  size?: CounterSize;
  /** Template variant */
  variant?: CounterVariant;
}

const sizeStyles: Record<
  CounterSize,
  { display: string; button: "sm" | "md" | "lg" }
> = {
  sm: { display: "text-4xl", button: "sm" },
  md: { display: "text-6xl", button: "md" },
  lg: { display: "text-8xl", button: "lg" },
};

function CounterMinimal({
  entity,
  size = "md",
  onDecrement,
  onIncrement,
  decrementEvent,
  incrementEvent,
  className,
  ...rest
}: CounterTemplateProps): React.JSX.Element | null {
  const resolved = (entity && typeof entity === 'object' && !Array.isArray(entity)) ? entity as CounterEntity : undefined;
  if (!resolved) return null;
  return (
    <HStack gap="lg" align="center" justify="center" {...domPassthrough(rest)} className={className}>
      <Button
        variant="secondary"
        size={sizeStyles[size].button}
        action={decrementEvent}
        onClick={onDecrement}
        disabled={resolved.decrementDisabled}
        icon="minus"
      >
        {resolved.decrementLabel}
      </Button>
      <Typography
        variant="h1"
        className={cn(
          sizeStyles[size].display,
          "tabular-nums min-w-[3ch] text-center",
        )}
      >
        {resolved.count}
      </Typography>
      <Button
        variant="secondary"
        size={sizeStyles[size].button}
        action={incrementEvent}
        onClick={onIncrement}
        disabled={resolved.incrementDisabled}
        icon="plus"
      >
        {resolved.incrementLabel}
      </Button>
    </HStack>
  );
}
CounterMinimal.displayName = "CounterMinimal";

function CounterStandard({
  entity,
  size = "md",
  title: titleProp,
  showReset = true,
  onDecrement,
  onIncrement,
  onReset,
  decrementEvent,
  incrementEvent,
  resetEvent,
  className,
  ...rest
}: CounterTemplateProps): React.JSX.Element | null {
  const { t } = useTranslate();
  const title = titleProp ?? t("counter.title");
  const resolved = (entity && typeof entity === 'object' && !Array.isArray(entity)) ? entity as CounterEntity : undefined;
  if (!resolved) return null;
  return (
    <Container size="sm" padding="lg" {...domPassthrough(rest)} className={className}>
      <VStack gap="lg" align="center">
        <Typography
          variant="h2"
          className="text-muted-foreground"
        >
          {title}
        </Typography>
        <Typography
          variant="h1"
          className={cn(
            sizeStyles[size].display,
            "tabular-nums text-primary",
          )}
        >
          {resolved.count}
        </Typography>
        <HStack gap="md">
          <Button
            variant="secondary"
            size={sizeStyles[size].button}
            action={decrementEvent}
            onClick={onDecrement}
            disabled={resolved.decrementDisabled}
            icon="minus"
          />
          <Button
            variant="primary"
            size={sizeStyles[size].button}
            action={incrementEvent}
            onClick={onIncrement}
            disabled={resolved.incrementDisabled}
            icon="plus"
          />
        </HStack>
        {showReset && (
          <Button
            variant="ghost"
            size="sm"
            action={resetEvent}
            onClick={onReset}
            icon="rotate-ccw"
          >
            {t("common.reset")}
          </Button>
        )}
      </VStack>
    </Container>
  );
}
CounterStandard.displayName = "CounterStandard";

function CounterFull({
  entity,
  size = "md",
  title: titleProp,
  showReset = true,
  onDecrement,
  onIncrement,
  onReset,
  decrementEvent,
  incrementEvent,
  resetEvent,
  className,
  ...rest
}: CounterTemplateProps): React.JSX.Element | null {
  const { t } = useTranslate();
  const title = titleProp ?? t("counter.title");
  const resolved = (entity && typeof entity === 'object' && !Array.isArray(entity)) ? entity as CounterEntity : undefined;
  if (!resolved) return null;
  return (
    <Container size="sm" padding="lg" {...domPassthrough(rest)} className={className}>
      <VStack gap="xl" align="center">
        <Typography
          variant="h2"
          className="text-muted-foreground"
        >
          {title}
        </Typography>
        <VStack gap="sm" align="center">
          <Typography
            variant="h1"
            className={cn(
              sizeStyles[size].display,
              "tabular-nums text-primary",
            )}
          >
            {resolved.count}
          </Typography>
          {resolved.rangeText && (
            <Typography variant="small" color="muted">
              {resolved.rangeText}
            </Typography>
          )}
        </VStack>
        <HStack gap="md">
          <Button
            variant="secondary"
            size={sizeStyles[size].button}
            action={decrementEvent}
            onClick={onDecrement}
            disabled={resolved.decrementDisabled}
            icon="minus"
          >
            {resolved.decrementLabel}
          </Button>
          <Button
            variant="primary"
            size={sizeStyles[size].button}
            action={incrementEvent}
            onClick={onIncrement}
            disabled={resolved.incrementDisabled}
            icon="plus"
          >
            {resolved.incrementLabel}
          </Button>
        </HStack>
        {showReset && (
          <Button
            variant="ghost"
            size="sm"
            action={resetEvent}
            onClick={onReset}
            icon="rotate-ccw"
          >
            {t("counter.resetToZero")}
          </Button>
        )}
      </VStack>
    </Container>
  );
}
CounterFull.displayName = "CounterFull";

export const CounterTemplate: React.FC<CounterTemplateProps> = (props) => {
  switch (props.variant) {
    case "minimal":
      return <CounterMinimal {...props} />;
    case "full":
      return <CounterFull {...props} />;
    default:
      return <CounterStandard {...props} />;
  }
};

CounterTemplate.displayName = "CounterTemplate";

export default CounterTemplate;
