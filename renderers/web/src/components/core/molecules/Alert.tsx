'use client';
/**
 * Alert Molecule Component
 *
 * A component for displaying alert messages with different variants and actions.
 * Uses theme-aware CSS variables for styling.
 */

import React from "react";
import type { EventKey, A11yProps } from "@almadar/core";
import { cn } from '../../../core';
import { Box } from '../../../core';
import { Icon } from '../../../core';
import type { IconInput } from '../../../core';
import { Typography } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { HStack } from '../../../core';
import { Button } from '../../../core';

import { domPassthrough } from '../../../core';
export type AlertVariant = "info" | "success" | "warning" | "error";

export interface AlertProps extends A11yProps {
  /** Alert content (children or message) */
  children?: React.ReactNode;
  /** Alert message (alias for children) */
  message?: string;
  variant?: AlertVariant;
  title?: string;
  dismissible?: boolean;
  onDismiss?: () => void;
  onClose?: () => void;
  actions?: React.ReactNode;
  /** Icon shown instead of the variant's default (Lucide name or component) */
  icon?: IconInput;
  className?: string;
  /** Declarative dismiss event — emits UI:{dismissEvent} via eventBus when alert is dismissed */
  dismissEvent?: EventKey;
}

const variantBorderClasses: Record<AlertVariant, string> = {
  info: "border-info",
  success: "border-success",
  warning: "border-warning",
  error: "border-error",
};

const variantIconColors: Record<AlertVariant, string> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
};

const iconMap: Record<AlertVariant, string> = {
  info: "info",
  success: "check-circle",
  warning: "alert-triangle",
  error: "alert-circle",
};

export const Alert: React.FC<AlertProps> = ({
  children,
  message,
  variant = "info",
  title,
  dismissible = false,
  onDismiss,
  onClose,
  actions,
  icon,
  className,
  dismissEvent,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const handleDismissCallback = onDismiss || onClose;

  const handleDismiss = () => {
    if (dismissEvent) eventBus.emit(`UI:${dismissEvent}`, {});
    handleDismissCallback?.();
  };
  // Use message if provided, else children
  const content = children ?? message;

  const isUrgent = variant === "error" || variant === "warning";

  return (
    <Box
      {...domPassthrough(rest)}
      bg="surface"
      border
      padding="md"
      className={cn("rounded-container shadow-elevation-card", variantBorderClasses[variant], className)}
      role={isUrgent ? "alert" : "status"}
      data-pattern="alert"
    >
      <HStack gap="sm" align="start">
        <Box className="flex-shrink-0 mt-0.5">
          {icon && typeof icon !== "string" ? (
            <Icon icon={icon} size="md" className={variantIconColors[variant]} />
          ) : (
            <Icon name={icon ?? iconMap[variant]} size="md" className={variantIconColors[variant]} />
          )}
        </Box>

        <Box className="flex-1 min-w-0">
          {title && (
            <Typography variant="h6" className="mb-1">
              {title}
            </Typography>
          )}
          <Typography variant="body2">{content}</Typography>
          {actions && <HStack gap="sm" wrap className="mt-3">{actions}</HStack>}
        </Box>

        {(dismissible || dismissEvent || handleDismissCallback) && (
          <Button
            variant="ghost"
            size="sm"
            icon="x"
            onClick={handleDismiss}
            className="flex-shrink-0"
            aria-label={t('aria.closeAlert')}
          />
        )}
      </HStack>
    </Box>
  );
};

Alert.displayName = "Alert";