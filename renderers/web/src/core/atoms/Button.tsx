'use client';
import { actionTestId } from '@almadar/core';
import React from "react";
import type { A11yProps, Asset, EventKey, EventPayload } from "@almadar/core";
import { cn } from "../lib/cn";
import { Loader2, type LucideIcon } from "lucide-react";
import { usePendingAction } from "../lib/pendingDispatch";
import { useEventBus } from "../hooks/useEventBus";
import { Icon, type IconInput } from "./Icon";
import { AtlasImage } from "./AtlasImage";
import { INLINE_TEXT_ATTR } from "../lib/inlineText";
import { followHref } from "../lib/followHref";
import { useNavStack, isInertNavStack } from "../providers/NavStackContext";
import { domPassthrough } from "../lib/domPassthrough";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "success"
  | "warning"
  | "default"
  | "link";
export type ButtonSize = "sm" | "md" | "lg";

/** @accessibleName label */
export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof A11yProps | 'onClick'>, A11yProps {
  /** Additional CSS classes applied to the root element. */
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  /** Left icon: a Lucide component or a canonical icon name string (e.g. "plus", "trash"). */
  leftIcon?: IconInput;
  /** Right icon: a Lucide component or a canonical icon name string. */
  rightIcon?: IconInput;
  /** Alias for leftIcon */
  icon?: IconInput;
  /** Alias for rightIcon */
  iconRight?: IconInput;
  /** Asset image rendered as the leading icon; takes precedence over icon/leftIcon when provided. */
  iconAsset?: Asset;
  /** Declarative event name — emits UI:{action} via eventBus on click */
  action?: EventKey;
  /** Payload to include with the action event
   *  @payloadFor action
   */
  actionPayload?: EventPayload;
  /**
   * Button label text (alternative to children for schema-driven rendering)
   * @example Button
   */
  label?: string;
  /** Disable the button (greys out, blocks click events) */
  disabled?: boolean;
  /** Makes the button a link: `#anchor` scrolls, an absolute URL loads, a path navigates in-app */
  href?: string;
  /**
   * Runs on activation, on the button or, with `href`, on the link; calling
   * `preventDefault()` there keeps a link from following its `href`.
   */
  onClick?: (event: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => void;
  /** Test identifier for automated tests */
  'data-testid'?: string;
}

// Using CSS variables for theme-aware styling with hover/active effects
const variantStyles = {
  primary: [
    "bg-primary text-primary-foreground",
    "border-none",
    "shadow-elevation-interactive",
    "hover:bg-primary-hover hover:shadow-elevation-popover",
    "active:scale-[var(--active-scale)] active:shadow-elevation-pressed",
  ].join(" "),
  secondary: [
    // The accent is often a signature bright that fails as text on a light page.
    "bg-transparent text-foreground",
    "border border-accent",
    "hover:bg-accent hover:text-accent-foreground hover:border-accent",
    "active:scale-[var(--active-scale)]",
  ].join(" "),
  ghost: [
    "bg-transparent text-muted-foreground",
    "border border-transparent",
    "hover:text-primary-foreground hover:bg-primary hover:border-primary",
    "active:scale-[var(--active-scale)]",
  ].join(" "),
  danger: [
    "bg-surface text-foreground",
    "border-[length:var(--border-width)] border-error",
    "shadow-elevation-interactive",
    "hover:bg-error hover:text-error-foreground hover:shadow-elevation-popover",
    "active:scale-[var(--active-scale)] active:shadow-elevation-pressed",
  ].join(" "),
  success: [
    "bg-surface text-foreground",
    "border-[length:var(--border-width)] border-success",
    "shadow-elevation-interactive",
    "hover:bg-success hover:text-success-foreground hover:shadow-elevation-popover",
    "active:scale-[var(--active-scale)] active:shadow-elevation-pressed",
  ].join(" "),
  warning: [
    "bg-surface text-foreground",
    "border-[length:var(--border-width)] border-warning",
    "shadow-elevation-interactive",
    "hover:bg-warning hover:text-warning-foreground hover:shadow-elevation-popover",
    "active:scale-[var(--active-scale)] active:shadow-elevation-pressed",
  ].join(" "),
  // "default" is an alias for secondary
  default: [
    "bg-secondary text-secondary-foreground",
    "border-[length:var(--border-width-thin)] border-border",
    "hover:bg-secondary-hover",
    "active:scale-[var(--active-scale)]",
  ].join(" "),
  link: [
    "bg-transparent text-muted-foreground",
    "border-none shadow-none",
    "underline-offset-4 hover:text-foreground hover:underline",
  ].join(" "),
} as Record<string, string>;

// Alias "destructive" to "danger" for schema/compiler compatibility
variantStyles.destructive = variantStyles.danger;

const sizeStyles = {
  sm: "h-button-sm px-3 text-sm",
  md: "h-button-md px-4 text-sm",
  lg: "h-button-lg px-6 text-base",
};

const iconSizeStyles = {
  sm: "h-icon-default w-icon-default",
  md: "h-icon-default w-icon-default",
  lg: "h-icon-default w-icon-default",
};

type IconLike = React.ComponentType<{ className?: string }>;

function isIconLike(v: object): v is IconLike {
  return typeof (v as { render?: (...args: never[]) => React.ReactNode }).render === 'function';
}

/** Resolve an icon prop that can be a string name, LucideIcon component, or ReactNode */
function resolveIconProp(
  value: React.ReactNode | LucideIcon | string | undefined,
  sizeClass: string,
): React.ReactNode | null {
  if (!value) return null;
  if (typeof value === 'string') {
    // String name routes through <Icon> so it picks up the active icon family.
    return <Icon name={value} className={sizeClass} />;
  }
  if (typeof value === 'function') {
    const IconComp = value as LucideIcon;
    return <IconComp className={sizeClass} />;
  }
  // Already a rendered React element (e.g., <Plus className="w-4 h-4" />)
  if (React.isValidElement(value)) {
    return value;
  }
  // Handle React.forwardRef components (e.g., Lucide icons passed as component references)
  if (typeof value === 'object' && value !== null && isIconLike(value)) {
    const IconComp = value;
    return <IconComp className={sizeClass} />;
  }
  // Fallback: treat as ReactNode
  return value;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      isLoading = false,
      disabled,
      leftIcon,
      rightIcon,
      icon: iconProp,
      iconRight: iconRightProp,
      iconAsset,
      action,
      actionPayload,
      label,
      href,
      children,
      onClick,
      onFocus,
      onBlur,
      'data-testid': dataTestId,
      ...props
    },
    ref,
  ) => {
    const eventBus = useEventBus();
    const navStack = useNavStack();
    // The button's own action shows busy until the dispatches it started settle.
    const { pending, activate } = usePendingAction();
    const busy = isLoading || pending;
    // A focused control never leaves the tab order: while focused, `disabled`
    // is aria-disabled (activation ignored); native `disabled` once focus leaves.
    const [focused, setFocused] = React.useState(false);
    const inert = Boolean(disabled) || busy;
    const emitAction = (): void => {
      if (!action) return;
      activate((pendingKey) => eventBus.emit(`UI:${action}`, actionPayload ?? {}, { pendingKey }));
    };

    // Merge icon/leftIcon and iconRight/rightIcon (icon and iconRight are aliases)
    const leftIconValue = leftIcon || iconProp;
    const rightIconValue = rightIcon || iconRightProp;

    const px = size === 'sm' ? 16 : size === 'lg' ? 20 : 16;
    const resolvedLeftIcon = iconAsset?.url
      ? <AtlasImage asset={iconAsset} size={px} alt={iconAsset.name ?? iconAsset.category ?? ''} className="flex-shrink-0" />
      : resolveIconProp(leftIconValue, iconSizeStyles[size]);
    const resolvedRightIcon = resolveIconProp(rightIconValue, iconSizeStyles[size]);

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      // Busy ignores activation but stays focusable (aria-disabled, never native
      // `disabled`, which would blur the focused button and lose the user's place).
      if (inert) {
        e.preventDefault();
        return;
      }
      emitAction();
      onClick?.(e);
    };
    const handleFocus = (e: React.FocusEvent<HTMLButtonElement>) => {
      setFocused(true);
      onFocus?.(e);
    };
    const handleBlur = (e: React.FocusEvent<HTMLButtonElement>) => {
      setFocused(false);
      onBlur?.(e);
    };

    const classes = cn(
      "relative inline-flex items-center justify-center gap-2",
      "font-medium",
      "rounded-interactive interactive-border",
      "cursor-pointer",
      variant !== "link" && "chrome-button",
      "transition-all duration-normal",
      "focus:outline-none focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-ring focus-visible:ring-offset-[length:var(--focus-ring-offset)]",
      "disabled:opacity-50 disabled:cursor-not-allowed",
      variantStyles[variant],
      variant === "link" ? "h-auto px-0 text-sm" : sizeStyles[size],
      busy && "cursor-progress",
      disabled && focused && "opacity-50 cursor-not-allowed",
      className,
    );
    const testId = dataTestId ?? (action ? actionTestId(action) : undefined);

    // Busy keeps the button's size: the label holds its space (invisible) and the
    // spinner overlays the centre — a state never changes outer dimensions.
    const content = (
      <>
        {busy && (
          <span className="almadar-busy-indicator absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <Loader2 className="h-icon-default w-icon-default animate-spin" />
          </span>
        )}
        {/* Fills the button and takes its justify-content, so a caller's alignment reaches the content. */}
        <span className={cn("inline-flex flex-1 min-w-0 items-center [justify-content:inherit] gap-2", busy && "almadar-busy-content")}>
        {resolvedLeftIcon && (
          <span className="flex-shrink-0">{resolvedLeftIcon}</span>
        )}
        {/* Runtime slot projection passes children as an (often empty) array —
            an empty array is truthy, so a bare `children || label` eats the
            label on every projected icon+label button. */}
        {(Array.isArray(children) ? children.length > 0 : Boolean(children))
          ? children
          : label
            ? <span {...{ [INLINE_TEXT_ATTR]: 'label' }}>{label}</span>
            : label}
        {resolvedRightIcon && (
          <span className="flex-shrink-0">{resolvedRightIcon}</span>
        )}
        </span>
      </>
    );

    if (href !== undefined && href !== '') {
      const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (disabled || busy) {
          e.preventDefault();
          return;
        }
        emitAction();
        onClick?.(e);
        if (e.defaultPrevented) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        if (!href.startsWith("#") && isInertNavStack(navStack)) return;
        e.preventDefault();
        followHref(href, navStack);
      };
      return (
        <a
          {...domPassthrough(props)}
          href={href}
          id={props.id}
          title={props.title}
          style={props.style}
          aria-label={props['aria-label']}
          aria-disabled={disabled || busy || undefined}
          aria-busy={busy || undefined}
          className={classes}
          onClick={handleLinkClick}
          data-testid={testId}
        >
          {content}
        </a>
      );
    }

    return (
      <button
        ref={ref}
        type="button"
        disabled={Boolean(disabled) && !focused}
        aria-disabled={inert || undefined}
        aria-busy={busy || undefined}
        className={classes}
        onClick={handleClick}
        onFocus={handleFocus}
        onBlur={handleBlur}
        {...props}
        data-testid={testId}
      >
        {content}
      </button>
    );
  },
);

Button.displayName = "Button";
