'use client';
/**
 * ThemeToggle Atom Component
 *
 * A button that toggles between light and dark themes.
 * Uses Sun and Moon icons to indicate current/target theme.
 *
 * @packageDocumentation
 */

import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../lib/domPassthrough';
import React from "react";
import { Icon } from "./Icon";
import { cn } from "../lib/cn";
import { useTheme } from "../providers/ThemeContext";
import { useTranslate } from "../hooks/useTranslate";

export interface ThemeToggleProps extends A11yProps {
  /** Additional CSS classes */
  className?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Show label text */
  showLabel?: boolean;
}

const sizeClasses = {
  sm: "p-1.5",
  md: "p-2",
  lg: "p-2.5",
};

const iconSizes = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

/**
 * ThemeToggle component for switching between light and dark modes
 *
 * @example
 * ```tsx
 * // Basic usage
 * <ThemeToggle />
 *
 * // With label
 * <ThemeToggle showLabel />
 *
 * // Custom size
 * <ThemeToggle size="lg" />
 * ```
 */
export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  className,
  size = "md",
  showLabel = false,
  ...rest
}) => {
  const { resolvedMode, toggleMode } = useTheme();
  const { t } = useTranslate();
  const isDark = resolvedMode === "dark";
  const switchLabel = isDark ? t("themeToggle.switchToLight") : t("themeToggle.switchToDark");

  return (
    <button
      type="button"
      onClick={toggleMode}
      className={cn(
        "inline-flex items-center justify-center gap-2",
        "text-foreground",
        "hover:bg-muted border-[length:var(--border-width)] border-transparent hover:border-border",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "transition-colors duration-fast",
        sizeClasses[size],
        className,
      )}
      {...domPassthrough(rest)}
      aria-label={rest['aria-label'] ?? switchLabel}
      title={switchLabel}
    >
      {isDark ? (
        <Icon
          name="sun"
          className={cn(iconSizes[size], "text-foreground")}
        />
      ) : (
        <Icon
          name="moon"
          className={cn(iconSizes[size], "text-foreground")}
        />
      )}
      {showLabel && (
        <span className="text-sm font-medium">{isDark ? t("themeToggle.light") : t("themeToggle.dark")}</span>
      )}
    </button>
  );
};

ThemeToggle.displayName = "ThemeToggle";
