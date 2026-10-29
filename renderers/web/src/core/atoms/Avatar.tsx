'use client';
/**
 * Avatar Atom Component
 *
 * A versatile avatar component supporting images, initials, icons, and status indicators.
 */

import { domPassthrough } from '../lib/domPassthrough';
import React from "react";
import type { A11yProps, AssetUrl, EventKey, EventPayload } from "@almadar/core";
import { Icon, resolveIcon, type IconInput } from "./Icon";
import { cn } from "../lib/cn";
import { useEventBus } from "../hooks/useEventBus";
import { pressableProps } from "../lib/pressable";
import { useTranslate } from "../hooks/useTranslate";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
export type AvatarStatus = "online" | "offline" | "away" | "busy";

/**
 * @accessibleName alt name
 * @role img
 * @tokens --color-muted --color-border --color-foreground
 * @contrast foreground muted
 * @motion css
 */
export interface AvatarProps extends A11yProps {
  /**
   * Image source URL
   */
  src?: AssetUrl;

  /**
   * Alt text for the image
   */
  alt?: string;

  /**
   * Full name - initials will be generated automatically
   */
  name?: string;

  /**
   * Initials to display (e.g., "JD" for John Doe)
   * If not provided but name is, initials will be auto-generated
   */
  initials?: string;

  /**
   * Icon to display when no image or initials. Accepts a Lucide component
   * directly, or a canonical kebab-case icon name string (resolved via
   * `resolveIcon`) so trait/factory authors can pass an icon by name.
   */
  icon?: IconInput;

  /**
   * Size of the avatar
   * @default 'md'
   */
  size?: AvatarSize;

  /**
   * Status indicator
   */
  status?: AvatarStatus;

  /**
   * Badge content (e.g., notification count)
   */
  badge?: string | number;

  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Click handler
   */
  onClick?: () => void;

  /** Declarative event name — emits UI:{action} via eventBus on click */
  action?: EventKey;

  /** Payload to include with the action event
   *  @payloadFor action
   */
  actionPayload?: EventPayload;
}

const sizeClasses: Record<AvatarSize, string> = {
  xs: "w-6 h-6 text-xs",
  sm: "w-8 h-8 text-sm",
  md: "w-10 h-10 text-base",
  lg: "w-12 h-12 text-lg",
  xl: "w-16 h-16 text-xl",
};

const iconSizeClasses: Record<AvatarSize, string> = {
  xs: "w-3 h-3",
  sm: "w-4 h-4",
  md: "w-5 h-5",
  lg: "w-6 h-6",
  xl: "w-8 h-8",
};

const statusSizeClasses: Record<AvatarSize, string> = {
  xs: "w-1.5 h-1.5",
  sm: "w-2 h-2",
  md: "w-2.5 h-2.5",
  lg: "w-3 h-3",
  xl: "w-4 h-4",
};

const statusClasses: Record<AvatarStatus, string> = {
  online: "bg-success",
  offline: "bg-muted-foreground",
  away: "bg-warning",
  busy: "bg-error",
};

const badgeSizeClasses: Record<AvatarSize, string> = {
  xs: "w-3 h-3 text-xs",
  sm: "w-4 h-4 text-xs",
  md: "w-5 h-5 text-xs",
  lg: "w-6 h-6 text-sm",
  xl: "w-7 h-7 text-base",
};

/**
 * Generate initials from a full name
 */
function generateInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const Avatar: React.FC<AvatarProps> = ({
  src,
  alt,
  name,
  initials: providedInitials,
  icon: iconProp,
  size = "md",
  status,
  badge,
  className,
  onClick,
  action,
  actionPayload,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  // A broken `src` (onError) falls through to the initials → icon → default ladder.
  const [imgFailed, setImgFailed] = React.useState(false);
  React.useEffect(() => {
    setImgFailed(false);
  }, [src]);
  // Auto-generate initials from name if not provided
  const initials =
    providedInitials ?? (name ? generateInitials(name) : undefined);

  const IconComponent =
    typeof iconProp === "string" ? resolveIcon(iconProp) : iconProp;
  const hasImage = !!src && !imgFailed;
  // Precedence: src image → explicit initials → icon → name-derived initials → default.
  // An explicitly-passed `icon` outranks name-derived initials so `icon` is
  // never silently dropped when a `name` is also provided.
  const hasIcon = !!IconComponent;
  // Name-derived initials are suppressed when an icon prop is present.
  const hasInitials = !!initials && !(hasIcon && !providedInitials);

  // Generate background based on initials
  const getInitialsBackground = () =>
    "bg-primary text-primary-foreground";

  const isClickable = action || onClick;

  const handleClick = () => {
    if (action) {
      eventBus.emit(`UI:${action}`, actionPayload ?? {});
    }
    onClick?.();
  };
  const press = pressableProps(isClickable ? handleClick : undefined);

  return (
    <div className="relative inline-block" {...domPassthrough(rest)}>
      <div
        className={cn(
          "relative inline-flex items-center justify-center",
          "bg-muted border-[length:var(--border-width)] border-border",
          "overflow-hidden",
          sizeClasses[size],
          isClickable &&
            "cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors",
          className,
        )}
        {...press}
        aria-label={isClickable ? alt || name || initials : undefined}
      >
        {src && !imgFailed ? (
          <img
            src={src}
            alt={alt || t("avatar.alt")}
            className="w-full h-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : hasInitials ? (
          <div
            className={cn(
              "w-full h-full flex items-center justify-center font-bold",
              getInitialsBackground(),
            )}
          >
            {initials.substring(0, 2).toUpperCase()}
          </div>
        ) : hasIcon && IconComponent ? (
          <IconComponent
            className={cn(
              "text-foreground",
              iconSizeClasses[size],
            )}
          />
        ) : (
          <Icon
            name="user"
            className={cn(
              "text-foreground",
              iconSizeClasses[size],
            )}
          />
        )}
      </div>

      {/* Status indicator */}
      {status && (
        <div
          className={cn(
            "absolute bottom-0 right-0 border-heavy border-card",
            statusClasses[status],
            statusSizeClasses[size],
          )}
          role="img"
          aria-label={t("avatar.status", { status: t(`avatar.status.${status}`) })}
        />
      )}

      {/* Badge */}
      {badge !== undefined && (
        <div
          className={cn(
            "absolute -top-1 -right-1 flex items-center justify-center",
            "bg-primary text-primary-foreground font-bold",
            "border-heavy border-card",
            badgeSizeClasses[size],
          )}
          aria-label={t("avatar.badge", { badge })}
        >
          {typeof badge === "number" && badge > 99 ? "99+" : badge}
        </div>
      )}
    </div>
  );
};

Avatar.displayName = "Avatar";
