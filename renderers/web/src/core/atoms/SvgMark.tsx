/**
 * SvgMark Atom
 *
 * A small decorative mark drawn from SVG markup, never inserted as HTML: the markup becomes a data URI painted as a
 * contained background, or, when it paints in `currentColor`, as a mask filled with the surrounding text colour, so a
 * monochrome brand mark follows the theme the way the SVG itself asks.
 */
import React from 'react';
import { Box } from './Box';
import { cn } from '../lib/cn';

export type SvgMarkSize = 'sm' | 'md' | 'lg';

export interface SvgMarkProps {
  /** The SVG markup to draw. */
  svg: string;
  /** @default 'md' */
  size?: SvgMarkSize;
  className?: string;
}

const SIZE: Record<SvgMarkSize, string> = { sm: 'w-5 h-5', md: 'w-8 h-8', lg: 'w-10 h-10' };

export const SvgMark: React.FC<SvgMarkProps> = ({ svg, size = 'md', className }) => {
  const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  const tinted = /currentcolor/i.test(svg);
  const style: React.CSSProperties = tinted
    ? { WebkitMaskImage: url, maskImage: url, WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskSize: 'contain', maskSize: 'contain', WebkitMaskPosition: 'center', maskPosition: 'center' }
    : { backgroundImage: url, backgroundRepeat: 'no-repeat', backgroundSize: 'contain', backgroundPosition: 'center' };
  return (
    <Box
      as="span"
      aria-hidden="true"
      data-svg-mark={tinted ? 'tinted' : 'image'}
      className={cn('inline-block flex-shrink-0', SIZE[size], tinted && 'bg-current', className)}
      style={style}
    />
  );
};

SvgMark.displayName = 'SvgMark';
