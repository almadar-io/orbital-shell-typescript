'use client';
import type { A11yProps } from '@almadar/core';
import React from "react";
import { cn } from '../../../core';
import { Card } from '../../../core';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';
import { VStack, HStack } from '../../../core';
import { Icon } from '../../../core';
import { ChevronDown } from "lucide-react";
import { useTranslate } from '../../../core';
import { useEventBus } from '../../../core';
import type { DisplayStateProps } from "../organisms/types";

import { domPassthrough } from '../../../core';
export interface FormSectionProps extends Omit<DisplayStateProps, keyof A11yProps>, A11yProps {
  /** Section title */
  title?: string;
  /** Section description */
  description?: string;
  /** Form fields */
  children: React.ReactNode;
  /** Collapsible */
  collapsible?: boolean;
  /** Default collapsed state */
  defaultCollapsed?: boolean;
  /** Use card wrapper */
  card?: boolean;
  /** Grid columns for fields */
  columns?: 1 | 2 | 3;
}

export const FormSection: React.FC<FormSectionProps> = ({
  title,
  description,
  children,
  collapsible = false,
  defaultCollapsed = false,
  card = false,
  columns = 1,
  className,
  ...rest
}) => {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const { t } = useTranslate();
  const eventBus = useEventBus();

  const gridClass = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
  }[columns];

  const handleToggleCollapse = React.useCallback(() => {
    if (collapsible) {
      setCollapsed((prev) => !prev);
      eventBus.emit("UI:TOGGLE_COLLAPSE", { collapsed: !collapsed });
    }
  }, [collapsible, collapsed, eventBus]);

  const content = (
    <>
      {(title || description) && (
        <VStack gap="xs" className="mb-4">
          {title && (
            <HStack
              justify="between"
              align="center"
              className={cn(collapsible && "cursor-pointer")}
              action={collapsible ? "TOGGLE_COLLAPSE" : undefined}
            >
              <Typography variant="h3">
                {title}
              </Typography>
              {collapsible && (
                <Button
                  variant="ghost"
                  size="sm"
                  action="TOGGLE_COLLAPSE"
                >
                  <Icon
                    icon={ChevronDown}
                    size="sm"
                    className={cn(
                      "text-muted-foreground transition-transform",
                      collapsed && "rotate-180",
                    )}
                  />
                </Button>
              )}
            </HStack>
          )}
          {description && (
            <Typography variant="small" color="secondary">
              {description}
            </Typography>
          )}
        </VStack>
      )}
      {(!collapsible || !collapsed) && (
        <Box className={cn("grid gap-4", gridClass)}>{children}</Box>
      )}
    </>
  );

  if (card) {
    return <Card {...domPassthrough(rest)} className={cn("p-6", className)}>{content}</Card>;
  }

  return <Box {...domPassthrough(rest)} className={className}>{content}</Box>;
};

FormSection.displayName = "FormSection";

/**
 * Form layout with multiple sections
 */
export interface FormLayoutProps extends Omit<DisplayStateProps, keyof A11yProps>, A11yProps {
  children: React.ReactNode;
  /** Show section dividers */
  dividers?: boolean;
}

export const FormLayout: React.FC<FormLayoutProps> = ({
  children,
  dividers = true,
  className,
  ...rest
}) => {
  return (
    <VStack
      {...domPassthrough(rest)}
      gap="lg"
      className={cn(
        dividers &&
          "[&>*+*]:pt-8 [&>*+*]:border-t [&>*+*]:border-border",
        className,
      )}
    >
      {children}
    </VStack>
  );
};

FormLayout.displayName = "FormLayout";

/**
 * Form actions bar (submit/cancel buttons)
 */
export interface FormActionsProps extends Omit<DisplayStateProps, keyof A11yProps>, A11yProps {
  children: React.ReactNode;
  /** Sticky at bottom */
  sticky?: boolean;
  /** Alignment */
  align?: "left" | "right" | "between" | "center";
}

export const FormActions: React.FC<FormActionsProps> = ({
  children,
  sticky = false,
  align = "right",
  className,
  ...rest
}) => {
  const alignClass = {
    left: "justify-start",
    right: "justify-end",
    between: "justify-between",
    center: "justify-center",
  }[align];

  return (
    <HStack
      {...domPassthrough(rest)}
      gap="sm"
      align="center"
      className={cn(
        "pt-6 border-t border-border",
        alignClass,
        sticky &&
          "sticky bottom-0 bg-card py-4 -mx-6 px-6 shadow-[0_-4px_6px_-1px_rgb(0,0,0,0.05)]",
        className,
      )}
    >
      {children}
    </HStack>
  );
};

FormActions.displayName = "FormActions";
