'use client';

import React, { useCallback } from "react";
import type { A11yProps, EventEmit } from "@almadar/core";
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { Box } from '../../../core';
import { domPassthrough } from '../../../core';
import { Button } from '../../../core';
import { Label } from '../../../core';
import { Radio } from '../../../core';

export type LikertScaleSize = "sm" | "md" | "lg";
export type LikertScaleVariant = "radios" | "buttons";

export interface LikertOption {
  /** Underlying value bound to the option */
  value: number | string;
  /** Visible label below (radios) or inside (buttons) the control */
  label: string;
}

/**
 * @role radiogroup
 * @tokens --color-primary --color-muted --color-surface --color-border --color-foreground
 * @contrast foreground surface
 * @motion css
 */
export interface LikertScaleProps extends A11yProps {
  /** Optional row prompt above the scale */
  question?: string;
  /** Scale points (defaults to a translated 5-point agree/disagree set) */
  options?: LikertOption[];
  /** Selected value (controlled) */
  value?: number | string | null;
  /** Change callback */
  onChange?: (value: number | string) => void;
  /** Event name dispatched via event bus on change. Payload: { value: number | string } */
  changeEvent?: EventEmit<{ value: number | string }>;
  /** Disabled state */
  disabled?: boolean;
  /** Size variant */
  size?: LikertScaleSize;
  /** Visual variant: classic radios or pill segmented buttons */
  variant?: LikertScaleVariant;
  /** Additional CSS classes */
  className?: string;
}

export const DEFAULT_LIKERT_OPTION_KEYS: ReadonlyArray<{ value: number | string; labelKey: string }> = [
  { value: 1, labelKey: "likert.stronglyDisagree" },
  { value: 2, labelKey: "likert.disagree" },
  { value: 3, labelKey: "likert.neutral" },
  { value: 4, labelKey: "likert.agree" },
  { value: 5, labelKey: "likert.stronglyAgree" },
];

const radioSizes: Record<LikertScaleSize, { label: string; gap: string }> = {
  sm: { label: "text-xs", gap: "gap-1.5" },
  md: { label: "text-sm", gap: "gap-2" },
  lg: { label: "text-base", gap: "gap-2.5" },
};

const buttonSizes: Record<LikertScaleSize, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
  lg: "px-4 py-2 text-base",
};

const questionSizes: Record<LikertScaleSize, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
};

export const LikertScale = React.forwardRef<HTMLDivElement, LikertScaleProps>(
  (
    {
      question,
      options: optionsProp,
      value = null,
      onChange,
      changeEvent,
      disabled = false,
      size = "md",
      variant = "radios",
      className,
      ...rest
    },
    ref,
  ) => {
    const groupId = React.useId();
    const eventBus = useEventBus();
    const { t } = useTranslate();
    const options: LikertOption[] =
      optionsProp ?? DEFAULT_LIKERT_OPTION_KEYS.map((o) => ({ value: o.value, label: t(o.labelKey) }));

    const handleSelect = useCallback(
      (next: number | string) => {
        if (disabled) return;
        onChange?.(next);
        if (changeEvent) {
          eventBus.emit(`UI:${changeEvent}`, { value: next });
        }
      },
      [disabled, onChange, changeEvent, eventBus],
    );

    return (
      <Box
        ref={ref}
        {...domPassthrough(rest)}
        className={cn(
          "w-full",
          disabled && "opacity-50 cursor-not-allowed",
          className,
        )}
        role="radiogroup"
        aria-label={rest['aria-label'] ?? question ?? t("likert.ariaLabel")}
      >
        {question && (
          <Box
            className={cn(
              "mb-3 font-medium text-foreground",
              questionSizes[size],
            )}
          >
            {question}
          </Box>
        )}

        {variant === "buttons" ? (
          <Box
            className={cn(
              "inline-flex w-full items-stretch rounded-interactive overflow-hidden",
              "border-[length:var(--border-width)] border-border",
              "bg-surface",
            )}
          >
            {options.map((opt, idx) => {
              const selected = value !== null && value !== undefined && value === opt.value;
              return (
                <Button
                  key={String(opt.value)}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => handleSelect(opt.value)}
                  className={cn(
                    "flex-1 text-center font-medium transition-colors duration-instant",
                    "focus:outline-none focus:ring-[length:var(--focus-ring-width)] focus:ring-ring focus:ring-inset",
                    "disabled:cursor-not-allowed",
                    "rounded-none gap-0 shadow-none border-none",
                    idx > 0 && "border-l-[length:var(--border-width)] border-border",
                    buttonSizes[size],
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface text-foreground hover:bg-muted",
                  )}
                >
                  {opt.label}
                </Button>
              );
            })}
          </Box>
        ) : (
          <Box
            className={cn(
              "flex w-full items-start justify-between",
              radioSizes[size].gap,
            )}
          >
            {options.map((opt) => {
              const selected = value !== null && value !== undefined && value === opt.value;
              const inputId = `${groupId}-${String(opt.value)}`;
              return (
                <Box
                  key={String(opt.value)}
                  className={cn(
                    "flex flex-1 flex-col items-center",
                    radioSizes[size].gap,
                  )}
                >
                  <Radio
                    id={inputId}
                    name={groupId}
                    size={size}
                    checked={selected}
                    disabled={disabled}
                    onChange={() => handleSelect(opt.value)}
                  />
                  <Label
                    htmlFor={inputId}
                    className={cn(
                      "text-center select-none",
                      radioSizes[size].label,
                      selected
                        ? "text-foreground font-medium"
                        : "text-muted-foreground",
                      disabled ? "cursor-not-allowed" : "cursor-pointer",
                    )}
                  >
                    {opt.label}
                  </Label>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    );
  },
);

LikertScale.displayName = "LikertScale";
