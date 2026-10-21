'use client';
/**
 * ConfirmDialog Component
 *
 * Confirmation dialog for destructive or important actions.
 * Composes Modal molecule with Button atoms.
 *
 * Uses wireframe theme styling (high contrast, sharp edges).
 */
import type { A11yProps } from '@almadar/core';
import React from "react";
import { AlertTriangle, Trash2, Check } from "lucide-react";
import { Modal, type ModalSize } from "./Modal";
import { Button } from '../../../core';
import { Icon } from '../../../core';
import { Typography } from '../../../core';
import { Box } from '../../../core';
import { HStack } from '../../../core';
import { cn } from '../../../core';
import { useTranslate } from '../../../core';
import type { UiError } from '../../../core';

import { domPassthrough } from '../../../core';
export type ConfirmDialogVariant = "danger" | "warning" | "info" | "default";

export interface ConfirmDialogProps extends A11yProps {
  /** Whether the dialog is open (defaults to true when rendered by slot wrapper) */
  isOpen?: boolean;
  /** Callback when dialog is closed (injected by slot wrapper) */
  onClose?: () => void;
  /**
   * Fires after the exit animation completes (the dialog is about to unmount).
   * @notification
   */
  onExited?: () => void;
  /** Callback when action is confirmed (injected by slot wrapper) */
  onConfirm?: () => void;
  /** Dialog title */
  title: string;
  /** Dialog message/description */
  message?: string | React.ReactNode;
  /** Alias for message (schema compatibility) */
  description?: string | React.ReactNode;
  /** Confirm button text */
  confirmText?: string;
  /** Alias for confirmText (schema compatibility) */
  confirmLabel?: string;
  /** Cancel button text */
  cancelText?: string;
  /** Alias for cancelText (schema compatibility) */
  cancelLabel?: string;
  /** Dialog variant */
  variant?: ConfirmDialogVariant;
  /** Dialog size */
  size?: ModalSize;
  /** Loading state for confirm button */
  isLoading?: boolean;
  /** Error state */
  error?: UiError | null;
  /** Additional CSS classes */
  className?: string;
}

const variantConfig = {
  danger: {
    icon: Trash2,
    iconBg: "bg-error",
    iconColor: "text-error-foreground",
    confirmVariant: "danger" as const,
  },
  warning: {
    icon: AlertTriangle,
    iconBg: "bg-warning",
    iconColor: "text-warning-foreground",
    confirmVariant: "warning" as const,
  },
  info: {
    icon: Check,
    iconBg: "bg-info",
    iconColor: "text-info-foreground",
    confirmVariant: "primary" as const,
  },
  default: {
    icon: Check,
    iconBg: "bg-primary",
    iconColor: "text-primary-foreground",
    confirmVariant: "primary" as const,
  },
};

/**
 * ConfirmDialog - Confirmation dialog for important actions
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen = true,
  onClose = () => {},
  onExited,
  onConfirm = () => {},
  title,
  message,
  description,
  confirmText,
  confirmLabel,
  cancelText,
  cancelLabel,
  variant = "danger",
  size = "sm",
  isLoading = false,
  error,
  className,
  ...rest
}) => {
  const config = variantConfig[variant];
  const { t } = useTranslate();

  // Resolve aliases
  const resolvedMessage = message ?? description ?? "";
  const resolvedConfirmText = confirmText ?? confirmLabel ?? t('dialog.confirm');
  const resolvedCancelText = cancelText ?? cancelLabel ?? t('dialog.cancel');

  const handleConfirm = () => {
    onConfirm();
  };

  return (
    <Modal
      {...domPassthrough(rest)}
      isOpen={isOpen}
      onExited={onExited}
      onClose={onClose}
      size={size}
      showCloseButton={false}
      closeOnOverlayClick={!isLoading}
      closeOnEscape={!isLoading}
      className={className}
      footer={
        <HStack className="justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            {resolvedCancelText}
          </Button>
          <Button
            variant={config.confirmVariant}
            onClick={handleConfirm}
            isLoading={isLoading}
          >
            {isLoading ? t('common.loading') : resolvedConfirmText}
          </Button>
        </HStack>
      }
    >
      <HStack className="gap-4">
        {/* Icon */}
        <Box
          className={cn(
            "flex-shrink-0 w-12 h-12 flex items-center justify-center",
            config.iconBg,
          )}
        >
          <Icon icon={config.icon} size="lg" className={config.iconColor} />
        </Box>

        {/* Content */}
        <Box className="flex-1">
          <Typography variant="h5" className="mb-2">
            {title}
          </Typography>
          {typeof resolvedMessage === "string" ? (
            <Typography
              variant="body2"
              className="text-muted-foreground"
            >
              {resolvedMessage}
            </Typography>
          ) : (
            resolvedMessage
          )}
          {error && (
            <Typography variant="body2" color="error" role="alert" className="mt-2">
              {error.message}
            </Typography>
          )}
        </Box>
      </HStack>
    </Modal>
  );
};

ConfirmDialog.displayName = "ConfirmDialog";

export default ConfirmDialog;
