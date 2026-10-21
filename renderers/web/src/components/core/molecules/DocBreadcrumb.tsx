'use client';
/**
 * DocBreadcrumb Molecule Component
 *
 * A breadcrumb navigation component for documentation pages.
 * Composes from HStack, Typography, and Icon atoms.
 */

import type { A11yProps } from '@almadar/core';
import React from 'react';
import { cn } from '../../../core';
import { Box } from '../../../core';
import { Button } from '../../../core';
import { HStack } from '../../../core';
import { Typography } from '../../../core';
import { Icon } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
export interface DocBreadcrumbItem {
  /** Display label */
  label: string;
  /** Navigation href (omit for the current/last item) */
  href?: string;
}

export interface DocBreadcrumbProps extends A11yProps {
  /** Breadcrumb path items, last item is treated as current page */
  items: DocBreadcrumbItem[];
  /** Additional CSS classes */
  className?: string;
}

export const DocBreadcrumb: React.FC<DocBreadcrumbProps> = ({
  items,
  className,
  ...rest
}) => {
  const { t } = useTranslate();
  return (
    <Box
      {...domPassthrough(rest)}
      className={cn('w-full', className)}
      role="navigation"
      aria-label={rest['aria-label'] ?? t('aria.breadcrumb')}
    >
      <HStack gap="xs" align="center" wrap>
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;

          return (
            <React.Fragment key={idx}>
              {idx > 0 && (
                <Icon
                  name="chevron-right"
                  size="xs"
                  className="text-muted-foreground shrink-0"
                />
              )}

              {isLast || !item.href ? (
                <Typography
                  variant="caption"
                  className={cn(
                    isLast
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground',
                  )}
                  as="span"
                >
                  {item.label}
                </Typography>
              ) : (
                <Button
                  variant="link"
                  href={item.href}
                  className="h-auto px-0 text-xs font-normal text-muted-foreground hover:text-primary"
                >
                  {item.label}
                </Button>
              )}
            </React.Fragment>
          );
        })}
      </HStack>
    </Box>
  );
};

DocBreadcrumb.displayName = 'DocBreadcrumb';