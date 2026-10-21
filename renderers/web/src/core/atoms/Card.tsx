import React from "react";
import type { A11yProps, EventKey } from "@almadar/core";
import { cn } from "../lib/cn";
import { SurfaceBoundary } from "../providers/SurfaceContext";
import { useEventBus } from "../hooks/useEventBus";
import { Spinner } from "./Spinner";
import { pressableProps } from "../lib/pressable";

export type CardShadow = "none" | "sm" | "md" | "lg";

/**
 * Layer 2 visual treatment for the card pattern — orthogonal to the semantic
 * `variant` (which conveys role / state).
 */
export type CardLook =
  | "elevated"
  | "flat-bordered"
  | "borderless-divider"
  | "ticket"
  | "invoice"
  | "chip"
  | "tile-image-first";

export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, keyof A11yProps>, A11yProps {
  /** Additional CSS classes applied to the root element. */
  className?: string;
  variant?: "default" | "bordered" | "elevated" | "interactive";
  padding?: "none" | "sm" | "md" | "lg";
  /** Card title - renders in header if provided */
  title?: string;
  /** Card subtitle - renders below title */
  subtitle?: string;
  /** Shadow size override */
  shadow?: CardShadow;
  /** Layer 2 visual treatment — orthogonal to the semantic variant. */
  look?: CardLook;
  /** Card content */
  children?: React.ReactNode;
  /** Declarative event key emitted on click for trait dispatch */
  action?: EventKey;
  /** Shows a skeleton/spinner overlay while true. */
  loading?: boolean;
}

// Using CSS variables for theme-aware styling
const variantStyles = {
  default: [
    "surface-content",
    "transition-all duration-normal",
    "hover:shadow-elevation-dialog hover:translate-y-[var(--hover-translate-y)]",
  ].join(" "),
  bordered: [
    "surface-content",
    "transition-all duration-normal",
    "hover:shadow-elevation-dialog hover:translate-y-[var(--hover-translate-y)]",
  ].join(" "),
  elevated: [
    "bg-card surface-material",
    "border-[length:var(--border-width)] border-border",
    "shadow",
    "transition-all duration-normal",
    "hover:shadow-elevation-dialog hover:translate-y-[var(--hover-translate-y)]",
  ].join(" "),
  // Interactive variant with theme-specific hover effects
  interactive: [
    "bg-card surface-material",
    "border-[length:var(--border-width)] border-border",
    "shadow",
    "cursor-pointer",
    "transition-all duration-normal",
    "hover:shadow-elevation-dialog",
  ].join(" "),
};

const paddingStyles = {
  none: "",
  sm: "p-card-sm",
  md: "p-card-md",
  lg: "p-card-lg",
};

const shadowStyles: Record<CardShadow, string> = {
  none: "shadow-none",
  sm: "shadow-elevation-card",
  md: "shadow",
  lg: "shadow-elevation-dialog",
};

// Layer 2 look styles — applied AFTER variantStyles so they override
// shadow/border/radius/padding-intent. Empty string for `elevated` since the
// default variant already produces the elevated treatment. Each non-default
// look is a delta on the baseline.
const lookStyles: Record<CardLook, string> = {
  elevated: "",
  "flat-bordered": "shadow-none border-[length:var(--border-width)] border-border",
  "borderless-divider":
    "shadow-none border-0 border-b border-border rounded-none",
  ticket:
    "shadow-none border-dashed border-[length:var(--border-width)] border-border",
  invoice:
    "shadow-none border-[length:var(--border-width-thick)] border-border rounded-sm",
  chip:
    "shadow-none rounded-pill border-[length:var(--border-width)] border-border",
  "tile-image-first": "p-0 overflow-hidden",
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className,
      variant = "bordered",
      padding = "md",
      title,
      subtitle,
      shadow,
      look = "elevated",
      children,
      action,
      loading,
      onClick,
      ...props
    },
    ref,
  ) => {
    const eventBus = useEventBus();

    const handleClick = action
      ? (e: React.MouseEvent<HTMLDivElement>) => {
          eventBus.emit(`UI:${action}`, {});
          onClick?.(e);
        }
      : onClick;
    const press = pressableProps(handleClick);

    return (
      <div
        ref={ref}
        className={cn(
          "rounded-container relative",
          "transition-all duration-normal",
          "chrome-panel",
          variantStyles[variant],
          paddingStyles[padding],
          lookStyles[look],
          shadow && shadowStyles[shadow],
          className,
        )}
        {...press}
        {...props}
      >
        {loading && <Spinner overlay size="md" />}
        {(title || subtitle) && (
          <div className="mb-4">
            {title && (
              <h3 className="text-lg text-card-foreground heading-voice">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-sm text-muted-foreground mt-1">
                {subtitle}
              </p>
            )}
          </div>
        )}
        <SurfaceBoundary>{children}</SurfaceBoundary>
      </div>
    );
  },
);

Card.displayName = "Card";

// Card subcomponents
export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("mb-4", className)} {...props} />
));
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-lg text-card-foreground",
      "heading-voice",
      className,
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("", className)} {...props} />
));
CardContent.displayName = "CardContent";

// Alias for CardBody (used by shared component-types)
export const CardBody = CardContent;
CardBody.displayName = "CardBody";

export const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("mt-4 flex items-center", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";
