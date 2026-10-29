import { domPassthrough } from '../lib/domPassthrough';
import React from 'react';
import type { A11yProps, AssetUrl } from '@almadar/core';
import { cn } from '../lib/cn';

export type ImageFit = 'cover' | 'contain' | 'fill' | 'none';
export type ImageAspect = 'auto' | '1/1' | '4/3' | '3/2' | '16/9' | '21/9';
export type ImageRounded = 'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
export type ImagePosition = 'center' | 'top' | 'bottom' | 'left' | 'right';

/**
 * @accessibleName alt
 * @role img
 * @tokens --color-border
 * @motion none
 */
export interface ImageProps extends A11yProps {
  /** Image source URL */
  src: AssetUrl;
  /** Alternative text; empty string marks the image decorative */
  alt: string;
  /** How the image fills its box */
  fit?: ImageFit;
  /** Fixed aspect ratio of the box; "auto" keeps the image's own */
  aspect?: ImageAspect;
  /** Corner rounding */
  rounded?: ImageRounded;
  /** Draw a subtle border around the image */
  bordered?: boolean;
  /** "lazy" defers off-screen images; "eager" for above-the-fold media */
  loading?: 'lazy' | 'eager';
  /** Which part of the image stays visible when it is cropped */
  position?: ImagePosition;
  /** Candidate sources at different widths (the HTML `srcset`) */
  srcSet?: string;
  /** Rendered widths at each breakpoint (the HTML `sizes`) */
  sizes?: string;
  /** The page's main image: load it first */
  priority?: boolean;
  /** Additional class names */
  className?: string;
}

const fitClass: Record<ImageFit, string> = {
  cover: 'object-cover',
  contain: 'object-contain',
  fill: 'object-fill',
  none: 'object-none',
};

const aspectClass: Record<ImageAspect, string> = {
  auto: '',
  '1/1': 'aspect-square',
  '4/3': 'aspect-[4/3]',
  '3/2': 'aspect-[3/2]',
  '16/9': 'aspect-video',
  '21/9': 'aspect-[21/9]',
};

const roundedClass: Record<ImageRounded, string> = {
  none: '',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-[calc(var(--radius-xl)*1.5)]',
  full: 'rounded-full',
};

const positionClass: Record<ImagePosition, string> = {
  center: 'object-center',
  top: 'object-top',
  bottom: 'object-bottom',
  left: 'object-left',
  right: 'object-right',
};

export const Image: React.FC<ImageProps> = ({
  src,
  alt,
  fit = 'cover',
  aspect = 'auto',
  rounded = 'md',
  bordered = false,
  loading = 'lazy',
  position = 'center',
  srcSet,
  sizes,
  priority = false,
  className,
  ...rest
}) => {
  if (!src) return null;
  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      fetchPriority={priority ? 'high' : undefined}
      alt={alt}
      {...domPassthrough(rest)}
      role={alt === '' ? 'presentation' : rest.role}
      loading={priority ? 'eager' : loading}
      decoding="async"
      className={cn(
        'block w-full h-auto max-w-full',
        fitClass[fit],
        positionClass[position],
        aspectClass[aspect],
        roundedClass[rounded],
        bordered && 'border border-border',
        className,
      )}
    />
  );
};

Image.displayName = 'Image';
