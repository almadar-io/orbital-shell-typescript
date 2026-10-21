'use client';
import { actionTestId } from '@almadar/core';
import React from "react";
import type { EventKey, EventEmit, A11yProps, SkeletonSpec } from "@almadar/core";
import { cn } from '../../../core';
import { Button } from '../../../core';
import { Box } from '../../../core';
import { Icon } from '../../../core';
import type { IconInput } from '../../../core';
import { Typography } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { Menu } from "./Menu";
import type { UiError } from '../../../core';
import { Breadcrumb } from "./Breadcrumb";
import { Tabs } from "./Tabs";
import { Badge } from '../../../core';

import { domPassthrough } from '../../../core';
export interface PageBreadcrumb {
  label: string;
  href?: string;
}

/**
 * Schema-based action definition
 */
export interface SchemaAction {
  label: string;
  /** Navigate to URL when clicked */
  navigatesTo?: string;
  /** Custom click handler */
  onClick?: () => void;
  /** Event to dispatch via event bus (for trait state machine integration) */
  event?: EventKey;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: IconInput;
  loading?: boolean;
  disabled?: boolean;
}

export interface PageHeaderStatus {
  label: string;
  variant?: "default" | "success" | "warning" | "danger" | "info";
}

export interface PageHeaderProps extends A11yProps {
  /** The shape an empty slot shows while this header's server render is in flight (`none` opts out). @default 'header' */
  skeleton?: SkeletonSpec;
  /** Page title - accepts string or number from generated code accessing dynamic entity data */
  title?: string | number;
  /** Icon shown before the title. */
  icon?: IconInput;
  /** Optional subtitle/description */
  subtitle?: string | number;
  /** Show back button */
  showBack?: boolean;
  /** Event to emit when back is clicked (default: BACK) */
  backEvent?: EventEmit<Record<string, never>>;
  /** Breadcrumbs */
  breadcrumbs?: readonly PageBreadcrumb[];
  /** Status badge — a bare string (an entity's status field bound directly,
   * e.g. `status: @entity.status`) renders as a default-variant badge */
  status?: PageHeaderStatus | string;
  /** Actions array - first action with variant='primary' (or first action) is the main action */
  actions?: readonly Readonly<SchemaAction>[];
  /** Loading state indicator */
  isLoading?: boolean;
  /** Error state */
  error?: UiError | null;
  /** Tabs for sub-navigation */
  tabs?: ReadonlyArray<{
    label: string;
    value: string;
    count?: number;
  }>;
  activeTab?: string;
  onTabChange?: (value: string) => void;
  /** Custom content in the header */
  children?: React.ReactNode;
  className?: string;
}

/** Almadar_UX.md §2.1: no more than 2 primary actions visible. */
const MAX_VISIBLE_ACTIONS = 2;

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  icon,
  subtitle,
  showBack = false,
  backEvent = "BACK",
  breadcrumbs,
  status,
  actions,
  isLoading,
  tabs,
  activeTab,
  onTabChange,
  children,
  className,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const statusBadge: PageHeaderStatus | undefined =
    typeof status === "string" ? (status ? { label: status } : undefined) : status;

  const handleBack = () => {
    // Emit event for trait state machine to handle
    // The trait can transition state and/or trigger navigate effect
    eventBus.emit(`UI:${backEvent}`);
  };

  // Create click handler for schema actions
  const createActionHandler = (action: SchemaAction) => () => {
    // Emit event via event bus if defined (for trait state machine integration)
    if (action.event) {
      eventBus.emit(`UI:${action.event}`);
    }
    if (action.navigatesTo) {
      eventBus.emit('UI:NAVIGATE', { url: action.navigatesTo });
    }
    if (action.onClick) {
      action.onClick();
    }
  };

  return (
    <Box {...domPassthrough(rest)} className={cn("w-full min-w-0", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb items={breadcrumbs.map((crumb) => ({ label: crumb.label, href: crumb.href }))} className="mb-4" />
      )}

      {/* Main header row */}
      <Box className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <Box className="flex items-start gap-4 min-w-0">
          {showBack && (
            <Button
              variant="ghost"
              onClick={handleBack}
              icon="arrow-left"
              aria-label={t('common.back')}
              className="mt-1 p-2 rtl:-scale-x-100"
            />
          )}
          <Box className="min-w-0">
            <Box className="flex items-center gap-3">
              {icon && (
                typeof icon === "string"
                  ? <Icon name={icon} size="lg" className="shrink-0 text-muted-foreground" />
                  : <Icon icon={icon} size="lg" className="shrink-0 text-muted-foreground" />
              )}
              <Typography variant="h1" className="text-2xl text-foreground">
                {title != null ? String(title) : ""}
              </Typography>
              {statusBadge && (
                <Badge variant={statusBadge.variant || "default"} size="sm">
                  {statusBadge.label}
                </Badge>
              )}
            </Box>
            {subtitle != null && subtitle !== "" && (
              <Typography variant="body" color="muted" className="mt-1 text-sm">
                {String(subtitle)}
              </Typography>
            )}
          </Box>
        </Box>

        {/* Actions: up to MAX_VISIBLE_ACTIONS inline, the rest in an overflow
            menu; a narrow header keeps only the first inline. */}
        {actions && actions.length > 0 && (
          <Box className="flex items-center gap-2 shrink-0">
            {actions.slice(0, MAX_VISIBLE_ACTIONS).map((action, idx) => (
              <Button
                key={`action-${idx}`}
                data-event={action.event}
                data-testid={action.event ? actionTestId(action.event) : undefined}
                variant={action.variant || (idx === 0 ? "primary" : "secondary")}
                leftIcon={action.icon || undefined}
                onClick={createActionHandler(action)}
                isLoading={action.loading || isLoading}
                disabled={action.disabled}
                className={idx > 0 ? "hidden sm:inline-flex" : undefined}
              >
                {action.label}
              </Button>
            ))}
            {actions.length > 1 && (
              <Box className="sm:hidden">
                <Menu
                  position="bottom-end"
                  trigger={
                    <Button variant="ghost" size="sm" aria-label={t('common.actions')} data-testid="page-header-overflow-compact">
                      <Icon name="more-horizontal" size="sm" />
                    </Button>
                  }
                  items={actions.slice(1).map((action) => ({
                    label: action.label,
                    icon: action.icon,
                    disabled: action.disabled || isLoading,
                    variant: action.variant === "danger" ? "danger" : "default",
                    onClick: createActionHandler(action),
                  }))}
                />
              </Box>
            )}
            {actions.length > MAX_VISIBLE_ACTIONS && (
              <Box className="hidden sm:block">
                <Menu
                  position="bottom-end"
                  trigger={
                    <Button variant="ghost" size="sm" aria-label={t('common.actions')} data-testid="page-header-overflow">
                      <Icon name="more-horizontal" size="sm" />
                    </Button>
                  }
                  items={actions.slice(MAX_VISIBLE_ACTIONS).map((action) => ({
                    label: action.label,
                    icon: action.icon,
                    disabled: action.disabled || isLoading,
                    variant: action.variant === "danger" ? "danger" : "default",
                    onClick: createActionHandler(action),
                  }))}
                />
              </Box>
            )}
          </Box>
        )}
      </Box>

      {tabs && tabs.length > 0 && (
        <Tabs
          items={tabs.map((tab) => ({ id: tab.value, label: tab.label, badge: tab.count }))}
          activeTab={activeTab}
          onTabChange={onTabChange}
          variant="underline"
          className="mt-6"
        />
      )}

      {/* Custom content */}
      {children}
    </Box>
  );
};

PageHeader.displayName = "PageHeader";
