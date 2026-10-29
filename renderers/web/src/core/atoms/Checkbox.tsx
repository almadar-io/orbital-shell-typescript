import React from "react";
import type { A11yProps, EventEmit } from "@almadar/core";
import { cn } from "../lib/cn";
import { useEventBus } from "../hooks/useEventBus";
import { Typography } from "./Typography";

/**
 * @accessibleName label
 * @role checkbox
 * @tokens --color-primary --color-border --color-card --color-foreground
 * @contrast foreground card
 * @motion none
 */
export interface CheckboxProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "onChange" | keyof A11yProps
>, A11yProps {
  /** Additional CSS classes applied to the root element. */
  className?: string;
  /** Whether the checkbox is checked */
  checked?: boolean;
  /** Default checked state (uncontrolled) */
  defaultChecked?: boolean;
  label?: string;
  /** Error message */
  error?: string;
  /** onChange handler or declarative event key for trait dispatch */
  onChange?: React.ChangeEventHandler<HTMLInputElement> | EventEmit<{ checked: boolean }>;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, id, error, required, onChange, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy = [props["aria-describedby"], errorId].filter(Boolean).join(" ") || undefined;
    const eventBus = useEventBus();

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (typeof onChange === 'string') {
        eventBus.emit(`UI:${onChange}`, { checked: e.target.checked });
      } else {
        onChange?.(e);
      }
    };

    return (
      <div className="flex flex-col">
        <div className="flex items-center">
          <div className="relative flex items-center">
            <input
              ref={ref}
              type="checkbox"
              onChange={handleChange}
              className={cn(
                "peer h-4 w-4 border-[length:var(--border-width)] border-border",
                "accent-primary focus:ring-ring focus:ring-offset-0",
                "bg-card checked:bg-primary",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                className,
              )}
              {...props}
              id={inputId}
              required={required}
              aria-required={required ? true : undefined}
              aria-invalid={error ? true : props["aria-invalid"]}
              aria-describedby={describedBy}
            />
          </div>
          {label && (
            <label
              htmlFor={inputId}
              className="ml-2 text-sm text-foreground font-medium cursor-pointer select-none"
            >
              {label}
              {required && <span aria-hidden="true" className="text-error ml-1">*</span>}
            </label>
          )}
        </div>
        {error && (
          <Typography id={errorId} variant="caption" color="error" className="mt-1">
            {error}
          </Typography>
        )}
      </div>
    );
  },
);

Checkbox.displayName = "Checkbox";
