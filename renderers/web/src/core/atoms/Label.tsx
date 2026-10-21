import React from "react";
import type { A11yProps } from "@almadar/core";
import { cn } from "../lib/cn";

export interface LabelProps extends Omit<React.LabelHTMLAttributes<HTMLLabelElement>, keyof A11yProps>, A11yProps {
  /** Additional CSS classes applied to the root element. */
  className?: string;
  /** Label text content */
  text?: string;
  /** Associated input element ID */
  htmlFor?: string;
  /** Show required indicator (decorative; the field itself carries aria-required) */
  required?: boolean;
}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn(
          "block text-sm font-bold text-foreground",
          className,
        )}
        {...props}
      >
        {children}
        {required && <span aria-hidden="true" className="text-error ml-1">*</span>}
      </label>
    );
  },
);

Label.displayName = "Label";
