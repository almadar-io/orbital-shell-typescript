/**
 * Radio Atom Component
 *
 * A radio button component with label support and accessibility.
 */

import React from "react";
import type { A11yProps, EventEmit } from "@almadar/core";
import { cn } from "../lib/cn";
import { useEventBus } from "../hooks/useEventBus";
import { domPassthrough } from "../lib/domPassthrough";

/** @accessibleName label */
export interface RadioProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "size" | keyof A11yProps
>, A11yProps {
  /** Additional CSS classes applied to the root element. */
  className?: string;
  /** Radio options (string array or SelectOption array) */
  options?: string[];
  /** Current selected value */
  value?: string;
  /** Declarative event name for trait dispatch */
  action?: EventEmit<{ value: string }>;
  /**
   * Label text displayed next to the radio button
   */
  label?: string;

  /**
   * Helper text displayed below the radio button
   */
  helperText?: string;

  /**
   * Error message displayed below the radio button
   */
  error?: string;

  /**
   * Size of the radio button
   * @default 'md'
   */
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "w-4 h-4",
  md: "w-5 h-5",
  lg: "w-6 h-6",
} as const;

const dotSizeClasses = {
  sm: "w-2 h-2",
  md: "w-2.5 h-2.5",
  lg: "w-3 h-3",
} as const;

export const Radio = React.forwardRef<HTMLInputElement, RadioProps>(
  (
    {
      label,
      helperText,
      error,
      size = "md",
      className,
      id,
      checked,
      disabled,
      options,
      value,
      action,
      name,
      onChange,
      required,
      ...props
    },
    ref,
  ) => {
    const reactId = React.useId();
    const baseId = id || `radio-${reactId}`;
    const hasError = !!error;
    const eventBus = useEventBus();

    // Track selection internally so a click shows feedback even when the caller
    // doesn't drive `value`/`checked`. A controlled `value` keeps it in sync.
    const [selected, setSelected] = React.useState<string | undefined>(value);
    React.useEffect(() => {
      if (value !== undefined) setSelected(value);
    }, [value]);

    const pick = (next: string, e: React.ChangeEvent<HTMLInputElement>): void => {
      setSelected(next);
      if (action) eventBus.emit(`UI:${action}`, { value: next });
      onChange?.(e);
    };

    // Visual radio control (sr-only input + styled label with selected dot).
    const control = (key: string, inputId: string, isChecked: boolean, input: React.ReactNode): React.ReactNode => (
      <div key={key} className="relative flex-shrink-0 mt-0.5">
        {input}
        <label
          htmlFor={inputId}
          className={cn(
            "flex items-center justify-center",
            "border-[length:var(--border-width)] transition-all cursor-pointer",
            sizeClasses[size],
            hasError
              ? "border-error peer-focus-visible:ring-error/20"
              : "border-border peer-focus-visible:ring-ring/20",
            isChecked ? (hasError ? "border-error" : "border-primary bg-primary") : "",
            "peer-focus:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2",
            disabled && "opacity-50 cursor-not-allowed",
            !disabled && "hover:border-[var(--color-border-hover)]",
          )}
        >
          {isChecked && (
            <div
              className={cn(
                "transition-all",
                dotSizeClasses[size],
                hasError ? "bg-error" : "bg-primary-foreground",
              )}
            />
          )}
        </label>
      </div>
    );

    const optionLabel = (inputId: string, text: string): React.ReactNode => (
      <div className="flex-1 min-w-0">
        <label
          htmlFor={inputId}
          className={cn(
            "block text-sm font-medium cursor-pointer select-none",
            hasError ? "text-error" : "text-foreground",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        >
          {text}
        </label>
      </div>
    );

    const describedBy = (extra?: string): string | undefined =>
      [extra, error ? `${baseId}-error` : helperText ? `${baseId}-helper` : undefined].filter(Boolean).join(" ") || undefined;

    const helper =
      helperText || error ? (
        <div className="mt-1.5 ml-8">
          {error && (
            <p id={`${baseId}-error`} className="text-sm text-error font-medium" role="alert">
              {error}
            </p>
          )}
          {!error && helperText && (
            <p id={`${baseId}-helper`} className="text-sm text-muted-foreground">
              {helperText}
            </p>
          )}
        </div>
      ) : null;

    // Group mode: render one radio per option, single-selection by `value`.
    if (options && options.length > 0) {
      const groupName = name || baseId;
      return (
        <>
          <div
            {...domPassthrough(props)}
            className="flex flex-col gap-3"
            role="radiogroup"
            aria-label={props["aria-label"] ?? (props["aria-labelledby"] ? undefined : label)}
            aria-invalid={hasError}
            aria-required={required ? true : undefined}
            aria-describedby={describedBy(props["aria-describedby"])}
          >
            {options.map((opt, i) => {
              const inputId = `${baseId}-${i}`;
              const isChecked = selected === opt;
              return (
                <div key={opt} className="flex items-start gap-3">
                  {control(
                    opt,
                    inputId,
                    isChecked,
                    <input
                      type="radio"
                      id={inputId}
                      name={groupName}
                      value={opt}
                      checked={isChecked}
                      disabled={disabled}
                      required={required}
                      onChange={(e) => pick(opt, e)}
                      className={cn("sr-only peer", className)}
                    />,
                  )}
                  {optionLabel(inputId, opt)}
                </div>
              );
            })}
          </div>
          {helper}
        </>
      );
    }

    // Single radio: internal checked state gives click feedback when uncontrolled.
    const isChecked = checked !== undefined ? !!checked : selected === (value ?? baseId);
    return (
      <>
        <div className="flex items-start gap-3">
          {control(
            baseId,
            baseId,
            isChecked,
            <input
              ref={ref}
              type="radio"
              id={baseId}
              checked={isChecked}
              disabled={disabled}
              onChange={(e) => pick(value ?? baseId, e)}
              className={cn("sr-only peer", className)}
              required={required}
              {...props}
              aria-invalid={hasError}
              aria-required={required ? true : undefined}
              aria-describedby={describedBy(props["aria-describedby"])}
            />,
          )}
          {label && optionLabel(baseId, label)}
        </div>
        {helper}
      </>
    );
  },
);

Radio.displayName = "Radio";
