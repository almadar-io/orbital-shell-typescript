'use client';
/**
 * DocTOC Molecule Component
 *
 * A table of contents component with active section highlighting.
 * Composes from Box, VStack, and Typography atoms.
 */

import React from 'react';
import { cn } from '../../../core';
import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { Box } from '../../../core';
import { Button } from '../../../core';
import { VStack } from '../../../core';
import { Typography } from '../../../core';
import { useTranslate } from '../../../core';
import { DOC_NAV_RULE_HOVER } from '../../../lib/doc-nav-classes';

export interface DocTOCItem {
  /** Heading element id to link to */
  id: string;
  /** Display label */
  label: string;
  /** Heading level: 2 for h2, 3 for h3, etc. */
  level: number;
}

/**
 * @role navigation
 * @tokens --color-foreground --color-muted-foreground
 * @contrast muted-foreground background
 * @motion css
 */
export interface DocTOCProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Table of contents items */
  items: DocTOCItem[];
  /** Currently active section id */
  activeId?: string;
  /** Additional CSS classes */
  className?: string;
}

export const DocTOC: React.FC<DocTOCProps> = ({
  items,
  activeId,
  className,
  ...rest
}) => {
  const { t } = useTranslate();
  return (
    <Box
      className={cn('w-full', className)}
      role="navigation"
      aria-label={t('aria.tableOfContents')}
      {...domPassthrough(rest)}
    >
      <VStack gap="none">
        {items.map((item) => {
          const isActive = item.id === activeId;
          const indent = item.level >= 3 ? 'pl-4' : 'pl-0';

          return (
            <Button
              key={item.id}
              variant="ghost"
              href={`#${item.id}`}
              aria-current={isActive ? 'location' : undefined}
              className={cn(
                'h-auto w-full justify-start rounded-none py-1.5 pr-0 font-normal border-l-heavy',
                'pl-3',
                indent,
                DOC_NAV_RULE_HOVER,
                isActive
                  ? 'border-l-accent text-foreground hover:text-foreground'
                  : 'border-l-transparent text-muted-foreground hover:border-l-border',
              )}
            >
              <Typography variant="caption" color="inherit" weight={isActive ? 'medium' : 'normal'} className="transition-colors" as="span">
                {item.label}
              </Typography>
            </Button>
          );
        })}
      </VStack>
    </Box>
  );
};

DocTOC.displayName = 'DocTOC';