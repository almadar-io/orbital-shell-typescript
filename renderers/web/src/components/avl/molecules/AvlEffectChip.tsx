'use client';

/**
 * AvlEffectChip — one effect glyph that names itself: its operator, the
 * plain-language category, and the std registry description, on hover/focus.
 */

import React from 'react';
import { getStdOperatorMeta } from '@almadar/std/registry';
import { Box } from '../../../core';
import { AvlEffect } from '../atoms/AvlEffect';
import { AvlExplain } from './AvlExplain';
import { useTranslate } from '../../../core';
import { effectCategoryOf } from '../../../lib/avl-theme';
import type { AvlNote } from '../../../lib/avl-annotations';

export interface AvlEffectChipProps {
  effectType: string;
  /** Glyph box in px. @default 16 */
  size?: number;
  note?: AvlNote;
  /** The effect's code (`(set @entity.status "paid")`), shown under its explanation. */
  code?: string;
}

/** The built-in explanation lines for an effect: name, category, registry description. */
export function useEffectLines(effectType: string): string[] {
  const { t } = useTranslate();
  const category = effectCategoryOf(effectType);
  const description = getStdOperatorMeta(effectType)?.description;
  return [effectType, ...(category ? [t(`avl.effectCategory.${category}`)] : []), ...(description ? [description] : [])];
}

export const AvlEffectChip: React.FC<AvlEffectChipProps> = ({ effectType, size = 16, note, code }) => {
  const lines = useEffectLines(effectType);
  const half = size / 2;
  return (
    <AvlExplain lines={lines} note={note} code={code}>
      <Box as="span" role="img" tabIndex={0} aria-label={effectType} data-testid="avl-effect-chip" className="inline-flex shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <AvlEffect x={half} y={half} effectType={effectType} size={half / 1.2 - 0.5} showBackground />
        </svg>
      </Box>
    </AvlExplain>
  );
};

AvlEffectChip.displayName = 'AvlEffectChip';
