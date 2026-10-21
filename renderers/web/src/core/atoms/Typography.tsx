/**
 * Typography Atom Component
 *
 * Text elements following the KFlow design system with theme-aware styling.
 */

import React from "react";
import type { A11yProps } from "@almadar/core";
import { cn } from "../lib/cn";
import { formatValue } from "../lib/format";
import { INLINE_TEXT_ATTR } from "../lib/inlineText";
import { domPassthrough } from "../lib/domPassthrough";
import { useFormatContext } from "../hooks/useTranslate";

export type TypographyVariant =
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "heading"
  | "subheading"
  | "body1"
  | "body2"
  | "body"
  | "caption"
  | "overline"
  | "small"
  | "large"
  | "label";

/** `none` = no size override — the variant's baked size applies. */
export type TypographySize = "none" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

export interface TypographyProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Typography variant */
  variant?: TypographyVariant;
  /** Heading level (1-6) - alternative to variant for headings */
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Text color */
  color?:
  | "primary"
  | "secondary"
  | "muted"
  | "error"
  | "success"
  | "warning"
  | "inherit";
  /** Text alignment */
  align?: "left" | "center" | "right";
  /** Font weight override — `none` = no override, the variant's baked weight applies */
  weight?: "none" | "light" | "normal" | "medium" | "semibold" | "bold";
  /** Font size override */
  size?: TypographySize;
  /** Truncate with ellipsis (single line) */
  truncate?: boolean;
  /** Overflow handling mode */
  overflow?: "visible" | "hidden" | "wrap" | "clamp-2" | "clamp-3";
  /** Custom HTML element */
  as?: keyof React.JSX.IntrinsicElements;
  /** HTML id attribute */
  id?: string;
  /** Additional class names */
  className?: string;
  /** Inline style */
  style?: React.CSSProperties;
  /**
   * Value formatting applied to string/number/Date content — `none` (the
   * default) renders content as-is. Covers the raw-ISO-date class: a bound
   * datetime renders human-readable via `format="date"|"time"|"datetime"`.
   */
  format?: "none" | "date" | "time" | "datetime" | "number" | "currency" | "percent";
  /** Text content (alternative to children) */
  content?: React.ReactNode;
  /** Children elements */
  children?: React.ReactNode;
}

// Using CSS variables for theme-aware styling
const variantStyles: Record<TypographyVariant, string> = {
  h1: "text-4xl heading-voice text-foreground",
  h2: "text-3xl heading-voice text-foreground",
  h3: "text-2xl heading-voice text-foreground",
  h4: "text-xl heading-voice text-foreground",
  h5: "text-lg heading-voice text-foreground",
  h6: "text-base heading-voice text-foreground",
  heading: "text-2xl heading-voice text-foreground",
  subheading: "text-lg heading-voice text-foreground",
  body1: "text-base font-normal text-foreground",
  body2: "text-sm font-normal text-foreground",
  body: "text-base font-normal text-foreground",
  caption: "text-xs font-normal text-muted-foreground",
  overline:
    "text-xs uppercase tracking-wide font-bold text-muted-foreground",
  small: "text-sm font-normal text-foreground",
  large: "text-lg font-medium text-foreground",
  label: "text-sm font-medium text-foreground",
};

const colorStyles = {
  primary: "text-foreground",
  secondary: "text-muted-foreground",
  muted: "text-muted-foreground",
  error: "text-error",
  success: "text-success",
  warning: "text-warning",
  inherit: "text-inherit",
};

const weightStyles = {
  // Neutral: an atom default of "none" must not override the variant's baked
  // weight (C-PATTERN-ENUM-BLOCKS-NEUTRAL-OVERRIDE — `variant={h2}` rendered
  // tiny because the ui-typography atom's `weight: light`/`size: xs` defaults
  // clobbered every variant).
  none: "",
  light: "font-light",
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
};

const defaultElements: Record<TypographyVariant, keyof React.JSX.IntrinsicElements> =
{
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  heading: "h2",
  subheading: "h3",
  body1: "p",
  body2: "p",
  body: "p",
  caption: "span",
  overline: "span",
  small: "span",
  large: "p",
  label: "span",
};

const typographySizeStyles: Record<TypographySize, string> = {
  none: "",
  xs: "text-xs",
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
  "3xl": "text-3xl",
};

const overflowStyles: Record<string, string> = {
  visible: "overflow-visible",
  hidden: "overflow-hidden",
  wrap: "break-words overflow-hidden",
  "clamp-2": "overflow-hidden line-clamp-2",
  "clamp-3": "overflow-hidden line-clamp-3",
};

export const Typography: React.FC<TypographyProps> = ({
  variant: variantProp,
  level,
  color = "primary",
  align,
  weight,
  size,
  truncate = false,
  overflow,
  as,
  id,
  className,
  style,
  format,
  content,
  children,
  ...rest
}) => {
  // Determine variant: explicit variant takes precedence, then level, then default
  const fmt = useFormatContext();
  const variant: TypographyVariant =
    variantProp ?? (level ? (`h${level}` as TypographyVariant) : "body1");
  const Component = as || defaultElements[variant];

  // Formatting applies only to formattable scalars; element children pass through.
  let body = children ?? content;
  if (format !== undefined && format !== "none" && (typeof body === "string" || typeof body === "number" || body instanceof Date)) {
    body = formatValue(body, format, fmt);
  }

  return React.createElement(
    Component,
    {
      ...domPassthrough(rest),
      id,
      className: cn(
        variantStyles[variant],
        colorStyles[color],
        weight && weightStyles[weight],
        size && typographySizeStyles[size],
        align && `text-${align}`,
        // `min-w-0` rides along with truncate/wrap/clamp: a flex or grid
        // item's default `min-width: auto` refuses to shrink below its
        // content's intrinsic width, so ellipsis/wrap silently does nothing
        // in the single most common placement (a row next to a fixed-width
        // control) unless the item can also shrink to zero. (Spelled out as
        // just "truncate", not "truncate overflow-hidden text-ellipsis" —
        // tailwind-merge treats those as the same conflict group and drops
        // "truncate" as the earlier-declared class, silently losing its
        // `white-space: nowrap`.)
        truncate && "truncate min-w-0",
        // Overflow never clips an inline element: a truncated span is a block.
        truncate && Component === "span" && "block",
        overflow && cn(overflowStyles[overflow], overflow !== "visible" && "min-w-0"),
        className,
      ),
      style,
      // Text that comes from the `content` prop can be edited in place.
      ...(children == null && typeof content === "string" ? { [INLINE_TEXT_ATTR]: "content" } : {}),
    },
    body,
  );
};

Typography.displayName = "Typography";
