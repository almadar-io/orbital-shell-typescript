/**
 * GenericAppTemplate
 *
 * A simple, generic template for any application.
 * Includes a header with title and actions, and a main content area.
 * **Atomic Design**: Composed using Box, Typography, and Button atoms.
 */

import React from "react";
import type { A11yProps } from "@almadar/core";
import { cn } from '../../../core';
import { domPassthrough } from '../../../core';
import { Box } from '../../../core';
import { HStack } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';
import type { TemplateProps } from "./types";

// Entity data flows in as the canonical `EntityRow` (the compiler binds the
// generic `EntityRow[]`). This template doesn't read entity fields, so it uses
// the default `TemplateProps` entity type rather than a narrow local shape.
export interface GenericAppTemplateProps extends TemplateProps, Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Page title */
  title: string;
  /** Subtitle or description */
  subtitle?: string;
  /** Main content */
  children: React.ReactNode;
  /** Header actions (buttons, links) */
  headerActions?: React.ReactNode;
  /** Footer content */
  footer?: React.ReactNode;
  /** Additional class name */
  className?: string;
}

export const GenericAppTemplate: React.FC<GenericAppTemplateProps> = ({
  entity,
  title,
  subtitle,
  children,
  headerActions,
  footer,
  className,
  ...rest
}) => {
  return (
    <Box display="flex" fullHeight {...domPassthrough(rest)} className={cn("flex-col", className)}>
      {/* Header */}
      <Box
        padding="md"
        border
        className="border-b-heavy border-x-0 border-t-0 border-border flex items-center justify-between flex-shrink-0"
      >
        <Box>
          <Typography variant="h3">{title}</Typography>
          {subtitle && (
            <Typography variant="body2" color="secondary" className="mt-1">
              {subtitle}
            </Typography>
          )}
        </Box>
        {headerActions && (
          <HStack gap="sm" align="center">{headerActions}</HStack>
        )}
      </Box>

      {/* Main Content */}
      <Box fullWidth overflow="auto" className="flex-1">
        <Box padding="lg">{children}</Box>
      </Box>

      {/* Footer */}
      {footer && (
        <Box
          padding="md"
          border
          bg="muted"
          className="border-t-heavy border-x-0 border-b-0 border-border flex-shrink-0"
        >
          {footer}
        </Box>
      )}
    </Box>
  );
};

GenericAppTemplate.displayName = "GenericAppTemplate";
