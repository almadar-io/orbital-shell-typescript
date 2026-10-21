'use client';
/**
 * FeatureCard Molecule Component
 *
 * A card highlighting a feature with icon, title, description, and optional link.
 * Composes Card, VStack, Icon, Typography, and Button atoms.
 */

import type { A11yProps } from '@almadar/core';
import React from 'react';
import { cn } from '../../../core';
import { useTranslate } from '../../../core';
import { pressableProps } from '../../../core';
import { Card } from '../../../core';
import { VStack } from '../../../core';
import { Icon, type IconInput } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';

import { domPassthrough } from '../../../core';
/**
 * FeatureCard — an icon-led card pairing a title and description to call out a
 * single product feature.
 *
 * @capabilities feature highlight, benefit callout, product capability card, feature-grid tile
 */
export interface FeatureCardProps extends A11yProps {
  icon?: IconInput;
  /** Feature title */
  title: string;
  /** Feature description */
  description: string;
  /** Optional link URL */
  href?: string;
  /** Label for the link button */
  linkLabel?: string;
  /** Card visual variant */
  variant?: 'default' | 'bordered' | 'elevated' | 'interactive';
  /** Card size affecting icon and spacing */
  size?: 'sm' | 'md' | 'lg';
  /** Additional class names */
  className?: string;
}

const iconSizeMap: Record<string, 'sm' | 'md' | 'lg' | 'xl'> = {
  sm: 'lg',
  md: 'xl',
  lg: 'xl',
};

const gapMap: Record<string, 'sm' | 'md' | 'lg'> = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
};

export const FeatureCard: React.FC<FeatureCardProps> = ({
  icon,
  title,
  description,
  href,
  linkLabel,
  variant = 'bordered',
  size = 'md',
  className,
  ...rest
}) => {
  const { t } = useTranslate();
  const renderIcon = () => {
    if (!icon) return null;
    return (
      <Icon
        icon={typeof icon === 'string' ? undefined : icon}
        name={typeof icon === 'string' ? icon : undefined}
        size={iconSizeMap[size]}
        className="text-accent"
      />
    );
  };

  const handleLinkClick = () => {
    if (href) {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <Card
      {...domPassthrough(rest)}
      variant={variant}
      padding={size}
      className={cn(
        variant === 'interactive' && 'hover:border-primary',
        className,
      )}
      {...pressableProps(variant === 'interactive' && href ? handleLinkClick : undefined)}
    >
      <VStack gap={gapMap[size]} align="start">
        {renderIcon()}
        <Typography variant="h4" className={size === 'sm' ? 'text-base' : undefined}>
          {title}
        </Typography>
        <Typography variant="body2" color="muted">
          {description}
        </Typography>
        {href && variant !== 'interactive' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLinkClick}
            className="text-primary -ml-2"
          >
            {linkLabel ?? t('featureCard.learnMore')}
          </Button>
        )}
      </VStack>
    </Card>
  );
};

FeatureCard.displayName = 'FeatureCard';
