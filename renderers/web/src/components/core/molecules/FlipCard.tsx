'use client';
/**
 * FlipCard — two-sided card molecule with front/back faces (distinct from FlipContainer).
 * FlipContainer is the raw 3D-transform atom; FlipCard wraps it with card styling,
 * absolute face positioning, and `front`/`back` ReactNode props for lolo consumers.
 */
import React from 'react';
import type { A11yProps } from '@almadar/core';
import { cn } from '../../../core';
import { Box } from '../../../core';
import { FlipContainer } from '../../../core';
import { domPassthrough } from '../../../core';

/**
 * FlipCard — flip card that reveals a hidden back face on tap or click,
 * toggling between a front and back content slot.
 *
 * @capabilities flashcard, study deck, spaced-repetition review card, memorization drill, quiz reveal card, question/answer card, before/after reveal, term-and-definition card
 */
export interface FlipCardProps extends A11yProps {
  /** Content rendered on the front face */
  front: React.ReactNode;
  /** Content rendered on the back face */
  back: React.ReactNode;
  /** Controlled flip state */
  flipped?: boolean;
  /** Callback when the card is clicked to flip */
  onFlip?: () => void;
  /** Optional className for the outer container */
  className?: string;
  /** Card height as a Tailwind class (default: 'h-64') */
  height?: string;
}

export const FlipCard = ({
  front,
  back,
  flipped = false,
  onFlip,
  className,
  height = 'h-64',
  ...rest
}: FlipCardProps) => {
  return (
    <FlipContainer
      {...domPassthrough(rest)}
      flipped={flipped}
      className={cn(height, className)}
      onClick={onFlip}
    >
      {/* Front face */}
      <Box
        className="absolute inset-0 w-full h-full rounded-container shadow-elevation-dialog flex items-center justify-center p-6"
        style={{ backfaceVisibility: 'hidden', transform: 'rotateY(0deg)' }}
      >
        {front}
      </Box>

      {/* Back face */}
      <Box
        className="absolute inset-0 w-full h-full rounded-container shadow-elevation-dialog flex items-center justify-center p-6"
        style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
      >
        {back}
      </Box>
    </FlipContainer>
  );
};

FlipCard.displayName = 'FlipCard';
