'use client';
import { domPassthrough } from '../lib/domPassthrough';
import * as React from 'react';
import type { A11yProps, Asset } from '@almadar/core';
import { cn } from '../lib/cn';
import { type IconInput } from './Icon';
import { resolveIconForFamily, useIconFamily } from '../lib/iconFamily';
import { AtlasImage } from './AtlasImage';

const sizeMap = {
  sm: 16,
  md: 24,
  lg: 32,
};

/** @accessibleName alt */
export interface GameIconProps extends A11yProps {
  /** Asset — when url is present, renders an img (Asset-primary). */
  assetUrl?: Asset;
  /** Lucide component or kebab-case icon name (fallback when no assetUrl). */
  icon: IconInput;
  /** Pixel size or named variant. */
  size?: number | 'sm' | 'md' | 'lg';
  /** Alt text for the img (defaults to assetUrl.category). */
  alt?: string;
  /** Additional CSS classes. */
  className?: string;
}

export function GameIcon({ assetUrl, icon, size = 'md', alt, className, ...rest }: GameIconProps) {
  const px = typeof size === 'number' ? size : sizeMap[size];
  const family = useIconFamily();

  if (assetUrl?.url) {
    return (
      <AtlasImage
        asset={assetUrl}
        size={px}
        alt={alt ?? assetUrl.category ?? ''}
        className={cn('flex-shrink-0', className)}
        {...domPassthrough(rest)}
      />
    );
  }

  const I = typeof icon === 'string' ? resolveIconForFamily(icon, family) : icon;

  return <I width={px} height={px} className={cn('flex-shrink-0', className)} {...domPassthrough(rest)} />;
}

GameIcon.displayName = 'GameIcon';
