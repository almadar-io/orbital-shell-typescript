/**
 * ViolationAlert — domain-specific compliance violation display (distinct from Alert).
 * Alert is a generic dismissible message. ViolationAlert owns structured
 * `ViolationRecord` (law/article/actionType/adminAction/penaltyAction) and
 * an optional "navigate to field" action — use it in inspection/compliance forms only.
 */

import type { A11yProps } from '@almadar/core';
import React from "react";
import { cn } from '../../../core';
import { useTranslate } from '../../../core';
import { VStack, HStack } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';
import { Alert } from "./Alert";

import { domPassthrough } from '../../../core';
export type ViolationRecord = {
  /** Unique violation identifier */
  id: string;
  /** Law reference (e.g., "ZVPOT-1") */
  law: string;
  /** Article reference (e.g., "14/1") */
  article: string;
  /** Violation message */
  message: string;
  /** Action type determines severity */
  actionType: "measure" | "admin" | "penalty";
  /** Administrative action reference (e.g., "ZVPOT-1 234/1-4") */
  adminAction?: string;
  /** Penalty action reference (e.g., "ZVPOT-1 240/1-9") */
  penaltyAction?: string;
  /** Field that triggered this violation */
  fieldId?: string;
  /** Tab/form where violation occurred */
  tabId?: string;
};

export interface ViolationAlertProps extends A11yProps {
  /** Violation data */
  violation: ViolationRecord;
  /** Visual severity (derived from actionType if not specified) */
  severity?: "warning" | "error";
  /** Dismissible alert */
  dismissible?: boolean;
  /** Dismiss handler */
  onDismiss?: () => void;
  /** Navigate to the field that caused violation */
  onNavigateToField?: (fieldId: string) => void;
  /** Compact display mode */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Fallback message from playground render-ui */
  message?: string;
}

const actionTypeLabelKeys: Record<string, string> = {
  measure: "violationAlert.actionType.measure",
  admin: "violationAlert.actionType.admin",
  penalty: "violationAlert.actionType.penalty",
};

const actionTypeIcons: Record<string, string> = {
  measure: "alert-triangle",
  admin: "alert-circle",
  penalty: "shield-alert",
};

export const ViolationAlert: React.FC<ViolationAlertProps> = ({
  violation,
  severity,
  dismissible = false,
  onDismiss,
  onNavigateToField,
  compact = false,
  className,
  message,
  ...rest
}) => {
  const { t } = useTranslate();
  // Support fallback message from playground render-ui
  const fallbackMessage = message ?? t('violationAlert.fallbackMessage');
  const resolvedViolation: ViolationRecord = violation ?? {
    id: "unknown",
    law: "",
    article: "",
    message: fallbackMessage,
    actionType: "measure",
  };

  // Derive severity from actionType if not explicitly set
  const effectiveSeverity =
    severity ?? (resolvedViolation.actionType === "measure" ? "warning" : "error");

  const citation = t('violationAlert.citation', { law: resolvedViolation.law, article: resolvedViolation.article });
  const icon = actionTypeIcons[resolvedViolation.actionType];
  const dismiss = dismissible && onDismiss ? { dismissible: true, onDismiss } : {};

  if (compact) {
    return (
      <Alert {...domPassthrough(rest)} variant={effectiveSeverity} icon={icon} title={citation} className={cn("px-3 py-2", className)} {...dismiss}>
        {resolvedViolation.message}
      </Alert>
    );
  }

  const navigate = resolvedViolation.fieldId && onNavigateToField ? resolvedViolation.fieldId : undefined;

  return (
    <Alert
      {...domPassthrough(rest)}
      variant={effectiveSeverity}
      icon={icon}
      title={citation}
      className={className}
      {...dismiss}
      actions={
        navigate ? (
          <Button variant="ghost" size="sm" icon="arrow-right" onClick={() => onNavigateToField?.(navigate)}>
            {t('violationAlert.goToField')}
          </Button>
        ) : undefined
      }
    >
      <VStack gap="xs">
        <Typography variant="caption" color="muted">
          {t(actionTypeLabelKeys[resolvedViolation.actionType])}
        </Typography>
        <Typography variant="body2">{resolvedViolation.message}</Typography>
        {resolvedViolation.adminAction && (
          <HStack gap="xs" align="center" wrap>
            <Typography variant="caption" color="muted">{t('violationAlert.adminLabel')}</Typography>
            <Typography variant="caption" weight="semibold">{resolvedViolation.adminAction}</Typography>
          </HStack>
        )}
        {resolvedViolation.penaltyAction && (
          <HStack gap="xs" align="center" wrap>
            <Typography variant="caption" color="muted">{t('violationAlert.penaltyLabel')}</Typography>
            <Typography variant="caption" weight="semibold">{resolvedViolation.penaltyAction}</Typography>
          </HStack>
        )}
      </VStack>
    </Alert>
  );
};

ViolationAlert.displayName = "ViolationAlert";
