/**
 * FormSectionHeader
 *
 * Header component for collapsible form sections.
 * Provides consistent styling and interaction for section headers.
 */

import type { A11yProps } from '@almadar/core';
import React from "react";
import { cn } from '../../../core';
import { Box } from '../../../core';
import { HStack } from '../../../core';
import { Typography } from '../../../core';
import { Badge } from '../../../core';
import { Icon } from '../../../core';
import type { IconInput } from '../../../core';
import { pressableProps } from '../../../core';

import { domPassthrough } from '../../../core';
export interface FormSectionHeaderProps extends A11yProps {
  /** Section title */
  title: string;
  /** Section subtitle */
  subtitle?: string;
  /** Whether section is collapsed */
  isCollapsed?: boolean;
  /** Toggle collapse handler (makes header clickable) */
  onToggle?: () => void;
  /** Badge text (e.g., "3 fields", "Required", "Complete") */
  badge?: string;
  /** Badge variant */
  badgeVariant?: "default" | "primary" | "success" | "warning" | "danger";
  /** Lucide icon name or component to show before title */
  icon?: IconInput;
  /** Whether section has validation errors */
  hasErrors?: boolean;
  /** Whether section is complete */
  isComplete?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export const FormSectionHeader: React.FC<FormSectionHeaderProps> = ({
  title,
  subtitle,
  isCollapsed = false,
  onToggle,
  badge,
  badgeVariant = "default",
  icon,
  hasErrors = false,
  isComplete = false,
  className,
  ...rest
}) => {
  const isClickable = !!onToggle;

  // Determine effective badge variant based on state
  const effectiveBadgeVariant = hasErrors
    ? "danger"
    : isComplete
      ? "success"
      : badgeVariant;

  // Determine status icon
  const statusIcon = hasErrors
    ? "alert-circle"
    : isComplete
      ? "check-circle"
      : null;

  return (
    <Box
      {...domPassthrough(rest)}
      className={cn(
        "px-5 py-4 bg-muted/60 rounded-container",
        "border border-border border-s-heavy border-s-primary",
        isClickable &&
          "cursor-pointer hover:bg-muted transition-colors",
        className,
      )}
      {...pressableProps(onToggle)}
      aria-expanded={isClickable ? !isCollapsed : rest['aria-expanded']}
    >
      <HStack justify="between" align="center">
        <HStack gap="sm" align="center">
          {icon && (
            typeof icon === 'string'
              ? <Icon name={icon} size="md" className="text-primary shrink-0" />
              : <Icon icon={icon} size="md" className="text-primary shrink-0" />
          )}

          {statusIcon && (
            <Icon
              name={statusIcon}
              size="md"
              className={cn(
                "shrink-0",
                hasErrors ? "text-error" : "text-success",
              )}
            />
          )}

          <Box className="space-y-0.5">
            <Typography variant="subheading" weight="semibold" className="text-foreground">
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="muted" className="leading-snug">
                {subtitle}
              </Typography>
            )}
          </Box>
        </HStack>

        <HStack gap="sm" align="center">
          {badge && (
            <Badge variant={effectiveBadgeVariant} size="sm">
              {badge}
            </Badge>
          )}

          {isClickable && (
            <Icon
              name="chevron-down"
              size="sm"
              className={cn(
                "text-muted-foreground transition-transform duration-fast shrink-0",
                isCollapsed && "-rotate-90",
              )}
            />
          )}
        </HStack>
      </HStack>
    </Box>
  );
};

FormSectionHeader.displayName = "FormSectionHeader";
