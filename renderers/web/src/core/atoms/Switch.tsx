'use client';
import * as React from "react";
import type { A11yProps, EventKey, EventPayload } from "@almadar/core";
import { cn } from "../lib/cn";
import { domPassthrough } from "../lib/domPassthrough";
import { useEventBus } from "../hooks/useEventBus";

/** @accessibleName label */
export interface SwitchProps extends A11yProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  /** Declarative event name — emits UI:{action} with `actionPayload` and the new `checked` value on toggle */
  action?: EventKey;
  /** Payload to include with the action event (the new `checked` is added to it)
   *  @payloadFor action
   */
  actionPayload?: EventPayload;
  disabled?: boolean;
  label?: string;
  id?: string;
  name?: string;
  className?: string;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      checked,
      defaultChecked = false,
      onChange,
      action,
      actionPayload,
      disabled = false,
      label,
      id,
      name,
      className,
      ...rest
    },
    ref,
  ) => {
    const eventBus = useEventBus();
    const generatedId = React.useId();
    const switchId = id ?? generatedId;
    const [isChecked, setIsChecked] = React.useState(
      checked !== undefined ? checked : defaultChecked,
    );

    React.useEffect(() => {
      if (checked !== undefined) {
        setIsChecked(checked);
      }
    }, [checked]);

    const handleClick = () => {
      if (disabled) return;
      const newValue = !isChecked;
      if (checked === undefined) {
        setIsChecked(newValue);
      }
      onChange?.(newValue);
      if (action) eventBus.emit(`UI:${action}`, { ...(actionPayload ?? {}), checked: newValue });
    };

    return (
      <div className={cn("inline-flex items-center gap-2", className)}>
        <button
          {...domPassthrough(rest)}
          ref={ref}
          type="button"
          role="switch"
          aria-checked={isChecked}
          id={switchId}
          name={name}
          disabled={disabled}
          onClick={handleClick}
          className={cn(
            // Fixed rem sizes instead of spacing tokens: themes like atelier
            // redefine --space-11 to 68px, which makes w-11 enormous and leaves
            // the thumb stuck near the left edge. The switch geometry must stay
            // proportional regardless of a theme's density scale.
            "relative inline-flex h-[1.5rem] w-[2.75rem] shrink-0 cursor-pointer items-center rounded-full border-heavy border-transparent transition-colors duration-fast",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            isChecked ? "bg-primary" : "bg-muted",
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          <span
            className={cn(
              "pointer-events-none block h-[1.25rem] w-[1.25rem] rounded-full bg-background shadow-elevation-interactive ring-0 transition-transform duration-fast",
              isChecked ? "translate-x-[1.25rem]" : "translate-x-0",
            )}
          />
        </button>
        {label && (
          <label
            htmlFor={switchId}
            className={cn(
              "text-sm font-medium leading-none cursor-pointer",
              disabled && "cursor-not-allowed opacity-70",
            )}
          >
            {label}
          </label>
        )}
      </div>
    );
  },
);

Switch.displayName = "Switch";
