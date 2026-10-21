import React from "react";
import { X } from "lucide-react";
import { INLINE_TEXT_ATTR } from "../lib/inlineText";
import { cn } from "../lib/cn";
import { Icon, type IconInput } from "./Icon";
import { AtlasImage } from "./AtlasImage";
import { useTranslate } from "../hooks/useTranslate";
import type { A11yProps, Asset } from "@almadar/core";

export type BadgeVariant =
  | "default"
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger"
  | "error"
  | "info"
  | "neutral";
export type BadgeSize = "sm" | "md" | "lg";

export interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, keyof A11yProps>, A11yProps {
  /** Additional CSS classes applied to the root element. */
  className?: string;
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Numeric count or amount to display in badge */
  amount?: number;
  /** Badge label text (alternative to children for schema-driven rendering).
   *  Numeric values are auto-coerced to string for rendering — common case
   *  is unread counts, error counts, status codes, etc. */
  label?: string | number;
  /** Lucide icon component or canonical kebab-case icon name string */
  icon?: IconInput;
  /** Asset image rendered as the badge icon; takes precedence over icon when provided. */
  iconAsset?: Asset;
  /** When set, renders a small X button on the right of the badge that
   *  invokes this handler — turns the badge into a removable chip.
   *  Used by the TagInput molecule and other "list of removable values"
   *  surfaces.
   *  @offByDefault */
  onRemove?: () => void;
  /** Accessible label for the remove button. Defaults to "Remove". */
  removeLabel?: string;
}

// Using CSS variables for theme-aware styling
const variantStyles: Record<BadgeVariant, string> = {
  default: [
    "bg-muted text-foreground",
    "border-[length:var(--border-width-thin)] border-border",
  ].join(" "),
  primary: "bg-primary text-primary-foreground",
  secondary:
    "bg-secondary text-secondary-foreground",
  success: [
    "bg-success/10 text-foreground",
    "border-[length:var(--border-width)] border-success",
  ].join(" "),
  warning: [
    "bg-warning/10 text-foreground",
    "border-[length:var(--border-width)] border-warning",
  ].join(" "),
  danger: [
    "bg-error/10 text-foreground",
    "border-[length:var(--border-width)] border-error",
  ].join(" "),
  error: [
    "bg-error/10 text-foreground",
    "border-[length:var(--border-width)] border-error",
  ].join(" "),
  info: [
    "bg-info/10 text-foreground",
    "border-[length:var(--border-width)] border-info",
  ].join(" "),
  neutral: [
    "bg-muted text-muted-foreground",
    "border-[length:var(--border-width-thin)] border-border",
  ].join(" "),
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-sm",
  lg: "px-3 py-1.5 text-base",
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", size = "sm", amount, label, icon, iconAsset, children, onRemove, removeLabel, onClick, ...props }, ref) => {
    const { t } = useTranslate();
    const iconSizes: Record<BadgeSize, string> = {
      sm: "h-icon-default w-icon-default",
      md: "h-icon-default w-icon-default",
      lg: "h-icon-default w-icon-default",
    };
    const iconPx = size === 'lg' ? 20 : 16;
    const resolvedIcon = iconAsset?.url
      ? <AtlasImage asset={iconAsset} size={iconPx} alt={iconAsset.name ?? iconAsset.category ?? ''} className="flex-shrink-0" />
      : typeof icon === "string"
        ? <Icon name={icon} className={iconSizes[size]} />
        : icon ? <Icon icon={icon} className={iconSizes[size]} /> : null;
    // A badge bound to an absent value must render nothing, not an empty
    // colored pill (schema-driven trees bind label to optional fields).
    const hasText = Boolean(children) || amount != null || (label !== undefined && label !== null && label !== '');
    if (!hasText && !resolvedIcon && !onRemove) return null;
    const text = typeof children === "string" || typeof children === "number"
      ? String(children)
      : amount != null
        ? `${label ? `${label} ` : ""}${amount}`
        : label !== undefined && label !== null ? String(label) : "";
    const removeName = removeLabel ?? `${t("common.remove")}${text ? `: ${text}` : ""}`;
    const body = (
      <>
        {resolvedIcon}
        {children || (amount != null
          ? `${label ? `${label} ` : ''}${amount}`
          : label
            ? <span {...{ [INLINE_TEXT_ATTR]: 'label' }}>{label}</span>
            : label)}
      </>
    );
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1 font-bold rounded-pill",
          variantStyles[variant],
          sizeStyles[size],
          onRemove && "pr-1",
          className,
        )}
        {...props}
      >
        {onClick ? (
          <button
            type="button"
            onClick={onClick}
            className="inline-flex items-center gap-1 rounded-pill focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {body}
          </button>
        ) : body}
        {onRemove ? (
          <button
            type="button"
            aria-label={removeName}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className={cn(
              "inline-flex items-center justify-center rounded-pill",
              "hover:bg-foreground/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "transition-colors",
              size === "sm" ? "w-4 h-4 ml-0.5" : size === "md" ? "w-5 h-5 ml-1" : "w-6 h-6 ml-1",
            )}
          >
            <X className={iconSizes[size]} />
          </button>
        ) : null}
      </span>
    );
  },
);

Badge.displayName = "Badge";
