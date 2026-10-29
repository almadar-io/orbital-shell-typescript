import React, { useCallback } from "react";
import type { A11yProps, EventEmit } from "@almadar/core";
import { cn } from "../lib/cn";
import { pressableProps } from "../lib/pressable";
import { useEventBus } from "../hooks/useEventBus";
import { useTranslate } from "../hooks/useTranslate";
import { Icon, type IconInput } from "./Icon";

export type FilterPillVariant =
  | "default"
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral";
export type FilterPillSize = "sm" | "md" | "lg";

export interface FilterPillProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "onClick" | keyof A11yProps>, A11yProps {
  /** Additional CSS classes applied to the root element. */
  className?: string;
  variant?: FilterPillVariant;
  size?: FilterPillSize;
  /** Pill label text (alternative to children for schema-driven rendering). */
  label?: string | number;
  /** Lucide icon component or canonical kebab-case icon name string */
  icon?: IconInput;
  /** Called when the user clicks the remove (×) button
   *  @offByDefault */
  onRemove?: () => void;
  /** Disable the remove button (renders without × control) */
  removable?: boolean;
  /** Pressed state of the pill body (filter toggle), exposed as aria-pressed */
  selected?: boolean;
  /** Click handler for the body of the pill (filter toggle) */
  onClick?: () => void;
  /** Event name dispatched via event bus when the pill body is clicked. Payload: { label } */
  clickEvent?: EventEmit<{ label: string | number | undefined }>;
  /** Event name dispatched via event bus when the remove (×) button is clicked. Payload: { label }
   *  @offByDefault */
  removeEvent?: EventEmit<{ label: string | number | undefined }>;
}

const variantStyles: Record<FilterPillVariant, string> = {
  default: [
    "bg-muted text-foreground",
    "border-[length:var(--border-width-thin)] border-border",
  ].join(" "),
  primary: "bg-primary/10 text-foreground border-[length:var(--border-width)] border-primary",
  secondary: "bg-secondary/10 text-foreground border-[length:var(--border-width)] border-secondary",
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
  info: [
    "bg-info/10 text-foreground",
    "border-[length:var(--border-width)] border-info",
  ].join(" "),
  neutral: [
    "bg-muted text-muted-foreground",
    "border-[length:var(--border-width-thin)] border-border",
  ].join(" "),
};

const sizeStyles: Record<FilterPillSize, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-sm",
  lg: "px-3 py-1.5 text-base",
};

const iconSizes: Record<FilterPillSize, string> = {
  sm: "w-3 h-3",
  md: "w-3.5 h-3.5",
  lg: "w-4 h-4",
};

export const FilterPill = React.forwardRef<HTMLSpanElement, FilterPillProps>(
  (
    {
      className,
      variant = "default",
      size = "sm",
      label,
      icon,
      onRemove,
      removable = true,
      onClick,
      clickEvent,
      removeEvent,
      children,
      selected,
      'aria-pressed': ariaPressed,
      ...props
    },
    ref,
  ) => {
    const eventBus = useEventBus();
  const { t } = useTranslate();
    const payloadLabel =
      typeof children === "string" || typeof children === "number" ? children : label;

    const handleClick = useCallback(() => {
      onClick?.();
      if (clickEvent) eventBus.emit(`UI:${clickEvent}`, { ...(payloadLabel !== undefined ? { label: payloadLabel } : {}) });
    }, [onClick, clickEvent, eventBus, payloadLabel]);

    const handleRemove = useCallback(() => {
      onRemove?.();
      if (removeEvent) eventBus.emit(`UI:${removeEvent}`, { ...(payloadLabel !== undefined ? { label: payloadLabel } : {}) });
    }, [onRemove, removeEvent, eventBus, payloadLabel]);

    const resolvedIcon =
      typeof icon === "string"
        ? <Icon name={icon} className={iconSizes[size]} />
        : icon ? <Icon icon={icon} className={iconSizes[size]} /> : null;

    const pressable = onClick || clickEvent ? handleClick : undefined;

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1 font-bold rounded-pill",
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...props}
      >
        <span
          className={cn("inline-flex items-center gap-1", pressable && "cursor-pointer")}
          {...pressableProps<HTMLSpanElement>(pressable)}
          aria-pressed={pressable ? (ariaPressed ?? selected) : undefined}
        >
          {resolvedIcon}
          <span>{children ?? label}</span>
        </span>
        {removable && (onRemove || removeEvent) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRemove();
            }}
            aria-label={t('aria.removeFilter')}
            className={cn(
              "ml-0.5 rounded-full hover:bg-foreground/10 transition-colors flex items-center justify-center",
            )}
          >
            <Icon name="x" className={iconSizes[size]} />
          </button>
        )}
      </span>
    );
  },
);

FilterPill.displayName = "FilterPill";