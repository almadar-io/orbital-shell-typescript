'use client';
/**
 * DocPagination Molecule
 *
 * Previous/Next navigation links for documentation pages.
 * Composed from HStack, Box, VStack, Icon, and Typography atoms.
 */
import React from 'react';
import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { cn } from '../../../core';
import { Box } from '../../../core';
import { Button } from '../../../core';
import { HStack } from '../../../core';
import { VStack } from '../../../core';
import { Icon } from '../../../core';
import { Typography } from '../../../core';
import { useTranslate } from '../../../core';
import { DOC_NAV_CARD_HOVER } from '../../../lib/doc-nav-classes';

export interface DocPaginationLink {
  label: string;
  href: string;
  category?: string;
}

/**
 * @role navigation
 * @tokens --color-border --color-accent --color-muted-foreground
 * @contrast muted-foreground background
 * @motion css
 */
export interface DocPaginationProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Previous page link */
  prev?: DocPaginationLink;
  /** Next page link */
  next?: DocPaginationLink;
  /** Additional class names */
  className?: string;
}

const linkCardStyles = [
  'border border-border',
  'rounded-container',
  'p-4',
  'transition-all',
  'hover:shadow-elevation-dialog',
  'no-underline',
  'flex-1',
  'min-w-0',
  'cursor-pointer',
  DOC_NAV_CARD_HOVER,
].join(' ');

export function DocPagination({ prev, next, className, ...rest }: DocPaginationProps) {
  const { t } = useTranslate();
  if (!prev && !next) return null;

  return (
    <HStack
      role="navigation"
      aria-label={rest['aria-label'] ?? t('aria.pageNavigation')}
      {...domPassthrough(rest)}
      justify="between"
      align="stretch"
      gap="md"
      className={cn('w-full', className)}
    >
      {/* Previous link */}
      {prev ? (
        <Button
          variant="ghost"
          href={prev.href}
          className={cn(linkCardStyles, 'group', 'h-auto justify-start whitespace-normal font-normal')}
        >
          <HStack align="center" gap="sm">
            <Icon name="arrow-left" size="md" className="text-muted-foreground group-hover:text-accent transition-colors flex-shrink-0" />
            <VStack gap="none" align="start">
              {prev.category ? (
                <Typography variant="caption" color="muted">
                  {prev.category}
                </Typography>
              ) : null}
              <Typography
                variant="body"
                className="group-hover:text-accent transition-colors"
              >
                {prev.label}
              </Typography>
            </VStack>
          </HStack>
        </Button>
      ) : (
        <Box className="flex-1" />
      )}

      {/* Next link */}
      {next ? (
        <Button
          variant="ghost"
          href={next.href}
          className={cn(linkCardStyles, 'group text-right', 'h-auto justify-end whitespace-normal font-normal')}
        >
          <HStack align="center" justify="end" gap="sm">
            <VStack gap="none" align="end">
              {next.category ? (
                <Typography variant="caption" color="muted">
                  {next.category}
                </Typography>
              ) : null}
              <Typography
                variant="body"
                className="group-hover:text-accent transition-colors"
              >
                {next.label}
              </Typography>
            </VStack>
            <Icon name="arrow-right" size="md" className="text-muted-foreground group-hover:text-accent transition-colors flex-shrink-0" />
          </HStack>
        </Button>
      ) : (
        <Box className="flex-1" />
      )}
    </HStack>
  );
}
