/**
 * Divider Atom Component
 *
 * A divider component for separating content sections.
 */

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../lib/domPassthrough';
import React from "react";
import { cn } from "../lib/cn";

export type DividerOrientation = "horizontal" | "vertical";
export type DividerVariant = "solid" | "dashed" | "dotted";

export interface DividerProps extends A11yProps {
  /**
   * Orientation of the divider
   * @default 'horizontal'
   */
  orientation?: DividerOrientation;

  /**
   * Text label to display in the divider
   */
  label?: string;

  /**
   * Line style variant
   * @default 'solid'
   */
  variant?: DividerVariant;

  /**
   * Additional CSS classes
   */
  className?: string;
}

const variantStyles: Record<DividerVariant, string> = {
  solid: "border-solid",
  dashed: "border-dashed",
  dotted: "border-dotted",
};

export const Divider: React.FC<DividerProps> = ({
  orientation = "horizontal",
  label,
  variant = "solid",
  className,
  ...rest
}) => {
  if (orientation === "vertical") {
    return (
      <div
        className={cn(
          "w-0 h-full border-l border-border",
          variantStyles[variant],
          className,
        )}
        {...domPassthrough(rest)}
        role="separator"
        aria-orientation="vertical"
      />
    );
  }

  if (label) {
    return (
      <div
        className={cn("flex items-center gap-3 my-4", className)}
        {...domPassthrough(rest)}
        role="separator"
        aria-label={rest['aria-label'] ?? label}
      >
        <div
          className={cn(
            "flex-1 h-0 border-t border-border",
            variantStyles[variant],
          )}
        />
        <span className="text-sm text-foreground font-bold uppercase tracking-wide">
          {label}
        </span>
        <div
          className={cn(
            "flex-1 h-0 border-t border-border",
            variantStyles[variant],
          )}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-full h-0 border-t border-border my-4",
        variantStyles[variant],
        className,
      )}
      {...domPassthrough(rest)}
      role="separator"
      aria-orientation="horizontal"
    />
  );
};

Divider.displayName = "Divider";
