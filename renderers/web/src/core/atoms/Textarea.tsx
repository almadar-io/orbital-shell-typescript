import React from "react";
import type { A11yProps, EventEmit } from "@almadar/core";
import { cn } from "../lib/cn";
import { useEventBus } from "../hooks/useEventBus";
import { Label } from "./Label";
import { Typography } from "./Typography";

/**
 * @accessibleName label
 * @role textbox
 * @tokens --color-card --color-border --color-foreground --color-muted-foreground
 * @contrast foreground card
 * @motion none
 */
export interface TextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | keyof A11yProps>, A11yProps {
  /** Additional CSS classes applied to the root element. */
  className?: string;
  /** Visible label naming the field. */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Number of visible rows */
  rows?: number;
  /** Controlled value, for a field the program fills or clears. */
  value?: string;
  /** Declarative event: fires on ⌘/Ctrl+Enter with `{ value }`. */
  action?: EventEmit<{ value: string }>;
  /** Helper text describing the field. */
  helperText?: string;
  /** Error message */
  error?: string;
  /** onChange handler or declarative event key for trait dispatch */
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement> | EventEmit<{ value: string }>;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, helperText, error, onChange, action, onKeyDown, id, required, ...props }, ref) => {
    const eventBus = useEventBus();
    const generatedId = React.useId();
    const fieldId = id ?? generatedId;
    const descriptionId = error || helperText ? `${fieldId}-description` : undefined;
    const describedBy = [props['aria-describedby'], descriptionId].filter(Boolean).join(' ') || undefined;

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (typeof onChange === 'string') {
        eventBus.emit(`UI:${onChange}`, { value: e.target.value });
      } else {
        onChange?.(e);
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown?.(e);
      if (!action || e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      eventBus.emit(`UI:${action}`, { value: e.currentTarget.value });
    };

    const field = (
      <textarea
        ref={ref}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className={cn(
          "block w-full rounded-interactive border-[length:var(--border-width)] shadow-elevation-interactive interactive-border",
          "px-3 py-2 text-sm text-foreground",
          "bg-card",
          "placeholder:text-[var(--color-placeholder)]",
          "focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-ring",
          "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
          "resize-y min-h-20",
          error
            ? "border-error focus:border-error"
            : "border-border focus:border-primary",
          className,
        )}
        {...props}
        id={fieldId}
        required={required}
        aria-required={required ? true : undefined}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy}
      />
    );

    if (!label && !descriptionId) return field;

    return (
      <div className="w-full">
        {label && <Label htmlFor={fieldId} className="mb-1">{label}</Label>}
        {field}
        {descriptionId && (
          <Typography id={descriptionId} variant="caption" color={error ? "error" : "muted"} className="mt-1">
            {error ?? helperText}
          </Typography>
        )}
      </div>
    );
  },
);

Textarea.displayName = "Textarea";
