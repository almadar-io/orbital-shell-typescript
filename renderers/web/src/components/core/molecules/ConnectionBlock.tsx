'use client';
/**
 * ConnectionBlock Molecule Component
 *
 * Surfaces prior-knowledge connections before new content.
 * Renders arbitrary markdown via MarkdownContent.
 *
 * Event Contract:
 * - No events emitted (display-only)
 * - entityAware: false
 */

import type { A11yProps } from '@almadar/core';
import React from 'react';
import { Link2 } from 'lucide-react';
import { MarkdownContent } from './markdown/MarkdownContent';
import { cn } from '../../../core';
import { Box } from '../../../core';
import { HStack } from '../../../core';
import { Typography } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
export interface ConnectionBlockProps extends A11yProps {
  /** Markdown content summarising what the learner already knows */
  content: string;
  /** Additional CSS classes */
  className?: string;
}

export const ConnectionBlock: React.FC<ConnectionBlockProps> = ({ content, className, ...rest }) => {
  const { t } = useTranslate();
  return (
    <Box {...domPassthrough(rest)} className={cn('bg-success/10 border-s-heavy border-success rounded-e-container p-5 mb-6', className)}>
      <HStack gap="sm" align="start">
        <Link2 className="text-success flex-shrink-0 mt-1" size={20} />
        <Box className="flex-1">
          <Typography variant="h6" as="h4" className="mb-2">
            {t('connection.title')}
          </Typography>
          <MarkdownContent content={content} className="text-sm" />
        </Box>
      </HStack>
    </Box>
  );
};

ConnectionBlock.displayName = 'ConnectionBlock';
