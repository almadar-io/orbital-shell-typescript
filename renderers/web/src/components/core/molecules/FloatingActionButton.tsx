'use client';
/**
 * FloatingActionButton Molecule Component
 *
 * A floating action button that can expand into multiple actions vertically.
 * Uses Button atom.
 *
 * Props mirror Button's `action`/`actionPayload` convention so a schema can
 * declare `{ type: "floating-action-button", action: "INIT", icon: "plus" }`
 * and have the FAB emit `UI:INIT` via the event bus on click — same shape
 * any other clickable surface uses.
 */

import React, { useState, useRef, useEffect } from "react";
import type { EventKey, EventPayload, A11yProps } from "@almadar/core";
import { Button } from '../../../core';
import { Box } from '../../../core';
import type { IconInput } from '../../../core';
import { HStack, VStack } from '../../../core';
import { Typography } from '../../../core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
export interface FloatingAction {
  /**
   * Action ID
   */
  id: string;

  /**
   * Action label
   */
  label: string;

  /**
   * Action icon — Lucide icon name or component
   */
  icon: IconInput;

  /**
   * Action click handler
   */
  onClick?: () => void;

  /** Event name to emit when clicked (for trait state machine integration) */
  event?: EventKey;

  /**
   * Action variant
   */
  variant?: "primary" | "secondary" | "success" | "danger" | "warning";
}

/** @accessibleName label */
export interface FloatingActionButtonProps extends A11yProps {
  /**
   * Declarative event name. When set, clicking the FAB emits `UI:{action}`
   * via the event bus and (if also provided) calls `onClick`. Mirrors the
   * Button atom's `action` prop so schemas can write
   * `{ type: "floating-action-button", action: "INIT" }` uniformly.
   */
  action?: EventKey;

  /**
   * Payload to include with the dispatched action event.
   *  @payloadFor action
   */
  actionPayload?: EventPayload;

  /**
   * Multiple actions. When provided, the button expands to show all of them.
   */
  actions?: FloatingAction[];

  /**
   * Icon: a canonical icon name string (resolved by Button) or a Lucide component.
   */
  icon?: IconInput;

  /**
   * Optional direct click handler. Runs after the action emit when both are
   * present.
   */
  onClick?: () => void;

  /**
   * Visual variant.
   */
  variant?: "primary" | "secondary" | "success" | "danger" | "warning";

  /**
   * Optional label shown via `aria-label` (visually hidden in single-action
   * mode; rendered as a tooltip beside expanded actions in multi-action mode).
   */
  label?: string;

  /**
   * Button position
   * @default 'bottom-right'
   */
  position?:
    | "bottom-right"
    | "bottom-left"
    | "bottom-center"
    | "top-right"
    | "top-left"
    | "top-center"
    | string; // Allow string for generated code compatibility

  /**
   * Additional CSS classes
   */
  className?: string;
}

export const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({
  action,
  actionPayload,
  actions,
  icon,
  onClick,
  variant,
  label,
  position = "bottom-right",
  className,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  // Build the single-action descriptor from the simplified props. Click
  // handler emits `UI:{action}` first (when action is set), then runs the
  // direct onClick — same order Button uses.
  const resolvedAction: { icon: IconInput; onClick: () => void; label?: string; variant?: FloatingActionButtonProps["variant"] } | undefined = icon
    ? {
        icon,
        onClick: () => {
          if (action) eventBus.emit(`UI:${action}`, actionPayload ?? {});
          onClick?.();
        },
        label,
        variant,
      }
    : undefined;
  const [isExpanded, setIsExpanded] = useState(false);
  const fabRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isExpanded || !actions || actions.length <= 1) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (fabRef.current && !fabRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isExpanded, actions]);

  const positionClasses: Record<string, string> = {
    "bottom-right": "bottom-6 right-6",
    "bottom-left": "bottom-6 left-6",
    "bottom-center": "bottom-6 left-1/2 -translate-x-1/2",
    "top-right": "top-6 right-6",
    "top-left": "top-6 left-6",
    "top-center": "top-6 left-1/2 -translate-x-1/2",
  };

  // Single action - direct onClick
  if (resolvedAction && (!actions || actions.length === 0)) {
    return (
      <Box className={cn("fixed z-50", positionClasses[position], className)}>
        <Button
          {...domPassthrough(rest)}
          variant={resolvedAction.variant || "primary"}
          size="lg"
          icon={resolvedAction.icon}
          onClick={resolvedAction.onClick}
          className="rounded-full shadow-elevation-popover"
          aria-label={rest['aria-label'] ?? (resolvedAction.label || t('fab.action'))}
        >
          {resolvedAction.label && (
            <Typography as="span" className="sr-only">{resolvedAction.label}</Typography>
          )}
        </Button>
      </Box>
    );
  }

  // Multiple actions - expandable
  if (actions && actions.length > 0) {
    const handleMainClick = () => {
      if (actions.length === 1) {
        if (actions[0].event) eventBus.emit(`UI:${actions[0].event}`, { actionId: actions[0].id });
        actions[0].onClick?.();
      } else {
        setIsExpanded(!isExpanded);
      }
    };

    return (
      <Box
        ref={fabRef}
        className={cn(
          "fixed z-50 flex flex-col items-end gap-3",
          positionClasses[position],
          position.includes("left") && "items-start",
          className,
        )}
      >
        {/* Expanded Action Buttons */}
        {isExpanded && actions.length > 1 && (
          <VStack
            className={cn(
              "gap-3",
              position.includes("left") ? "items-start" : "items-end",
            )}
          >
            {actions.map((actionItem, index) => (
              <HStack
                key={actionItem.id}
                align="center"
                gap="sm"
                className="transition-all duration-fast"
                style={{
                  opacity: isExpanded ? 1 : 0,
                  transform: isExpanded ? "translateY(0)" : "translateY(10px)",
                  transitionDelay: `${index * 50}ms`,
                }}
              >
                {position.includes("right") && (
                  <Typography variant="small" className="text-foreground bg-card px-2 py-1 rounded-interactive shadow-elevation-card whitespace-nowrap">
                    {actionItem.label}
                  </Typography>
                )}
                <Button
                  variant={actionItem.variant || "primary"}
                  size="lg"
                  icon={actionItem.icon}
                  onClick={() => {
                    setIsExpanded(false);
                    if (actionItem.event) eventBus.emit(`UI:${actionItem.event}`, { actionId: actionItem.id });
                    actionItem.onClick?.();
                  }}
                  className="rounded-full shadow-elevation-popover"
                  aria-label={actionItem.label}
                >
                  <Typography as="span" className="sr-only">{actionItem.label}</Typography>
                </Button>
                {position.includes("left") && (
                  <Typography variant="small" className="text-foreground bg-card px-2 py-1 rounded-interactive shadow-elevation-card whitespace-nowrap">
                    {actionItem.label}
                  </Typography>
                )}
              </HStack>
            ))}
          </VStack>
        )}

        {/* Main FAB Button */}
        <Button
          {...domPassthrough(rest)}
          variant={isExpanded ? "secondary" : "primary"}
          size="lg"
          icon={isExpanded ? "x" : "plus"}
          onClick={handleMainClick}
          className="rounded-full shadow-elevation-popover transition-all duration-normal"
          aria-label={rest['aria-label'] ?? (isExpanded ? t('fab.closeActions') : t('fab.openActions'))}
          aria-expanded={isExpanded}
        >
          <Typography as="span" className="sr-only">{isExpanded ? t('common.close') : t('common.open')}</Typography>
        </Button>
      </Box>
    );
  }

  return null;
};

FloatingActionButton.displayName = "FloatingActionButton";
