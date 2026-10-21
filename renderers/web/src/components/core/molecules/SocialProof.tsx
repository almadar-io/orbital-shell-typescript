'use client';
/**
 * SocialProof Molecule Component
 *
 * Displays social proof in three variants: company logos, customer quotes,
 * or technology badges. Composes HStack, SimpleGrid, Card, Badge,
 * Box, and Typography atoms.
 */

import type { A11yProps } from '@almadar/core';
import React from 'react';
import { cn } from '../../../core';
import { Box } from '../../../core';
import { HStack } from '../../../core';
import { VStack } from '../../../core';
import { Card } from '../../../core';
import { Badge } from '../../../core';
import { Typography } from '../../../core';
import { SimpleGrid } from './SimpleGrid';

import { domPassthrough } from '../../../core';
export interface SocialProofItem {
  /** Optional logo URL */
  logo?: string;
  /** Company or person name */
  name: string;
  /** Optional quote or testimonial text */
  quote?: string;
}

export interface SocialProofProps extends A11yProps {
  /** List of social proof items */
  items: SocialProofItem[];
  /** Display variant */
  variant?: 'logos' | 'quotes' | 'badges';
  /** Additional class names */
  className?: string;
}

const LogosVariant: React.FC<{ items: SocialProofItem[] }> = ({ items }) => (
  <HStack gap="xl" justify="center" className="flex-wrap">
    {items.map((item) => (
      <Box
        key={item.name}
        className="opacity-60 hover:opacity-100 transition-opacity cursor-default"
      >
        <VStack gap="xs" align="center">
          {item.logo && (
            <Box
              className="w-12 h-12 bg-contain bg-center bg-no-repeat"
              style={{ backgroundImage: `url(${item.logo})` }}
            />
          )}
          <Typography variant="caption" color="muted">
            {item.name}
          </Typography>
        </VStack>
      </Box>
    ))}
  </HStack>
);

LogosVariant.displayName = 'SocialProof.LogosVariant';

const QuotesVariant: React.FC<{ items: SocialProofItem[] }> = ({ items }) => {
  const cols = items.length >= 3 ? 3 : items.length >= 2 ? 2 : 1;
  return (
    <SimpleGrid cols={cols as 1 | 2 | 3} gap="md">
      {items.map((item) => (
        <Card key={item.name} variant="bordered" padding="md">
          <VStack gap="sm" align="start">
            {item.quote && (
              <Typography variant="body" className="italic">
                &ldquo;{item.quote}&rdquo;
              </Typography>
            )}
            <Typography variant="caption" color="muted">
              {item.name}
            </Typography>
          </VStack>
        </Card>
      ))}
    </SimpleGrid>
  );
};

QuotesVariant.displayName = 'SocialProof.QuotesVariant';

const BadgesVariant: React.FC<{ items: SocialProofItem[] }> = ({ items }) => (
  <HStack gap="sm" justify="center" className="flex-wrap">
    {items.map((item) => (
      <Badge key={item.name} size="md">
        {item.name}
      </Badge>
    ))}
  </HStack>
);

BadgesVariant.displayName = 'SocialProof.BadgesVariant';

export const SocialProof: React.FC<SocialProofProps> = ({
  items,
  variant = 'logos',
  className,
  ...rest
}) => {
  return (
    <Box {...domPassthrough(rest)} className={cn(className)}>
      {variant === 'logos' && <LogosVariant items={items} />}
      {variant === 'quotes' && <QuotesVariant items={items} />}
      {variant === 'badges' && <BadgesVariant items={items} />}
    </Box>
  );
};

SocialProof.displayName = 'SocialProof';
