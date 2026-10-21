'use client';

/**
 * AvlGlyph — one AVL notation symbol, standalone: the atom drawn in its own
 * svg, framed to its measured bounds, with a caption. The single render-ui
 * surface for every AVL atom (a symbol legend, a docs callout, a key).
 */

import type { A11yProps } from '@almadar/core';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { useTranslate } from '../../../core';
import { domPassthrough } from '../../../core';
import { AvlApplication } from '../atoms/AvlApplication';
import { AvlOrbital } from '../atoms/AvlOrbital';
import { AvlEntity } from '../atoms/AvlEntity';
import { AvlTrait } from '../atoms/AvlTrait';
import { AvlPage } from '../atoms/AvlPage';
import { AvlState } from '../atoms/AvlState';
import { AvlTransition } from '../atoms/AvlTransition';
import { AvlEvent } from '../atoms/AvlEvent';
import { AvlGuard } from '../atoms/AvlGuard';
import { AvlEffect } from '../atoms/AvlEffect';
import { AvlField } from '../atoms/AvlField';
import { AvlFieldType } from '../atoms/AvlFieldType';
import { AvlBinding } from '../atoms/AvlBinding';
import { AvlBindingRef } from '../atoms/AvlBindingRef';
import { AvlPersistence } from '../atoms/AvlPersistence';
import { AvlOperator } from '../atoms/AvlOperator';
import { AvlSExpr } from '../atoms/AvlSExpr';
import { AvlLiteral } from '../atoms/AvlLiteral';
import { type FieldType, type EntityPersistence } from '@almadar/core';
import { type OperatorCategory } from '@almadar/std';

export const AVL_GLYPH_KINDS = [
  'application', 'orbital', 'entity', 'trait', 'page',
  'state', 'transition', 'event', 'guard', 'effect',
  'field', 'fieldType', 'binding', 'bindingRef', 'persistence',
  'operator', 'sexpr', 'literal',
] as const;

export type AvlGlyphKind = (typeof AVL_GLYPH_KINDS)[number];

export interface AvlGlyphProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Which notation symbol to draw.
   * @example "state"
   */
  kind: AvlGlyphKind;
  /** Caption, and the drawn text for operator / literal / bindingRef symbols. */
  label?: string;
  /** Effect symbol variant. @default 'set' */
  effectType?: string;
  /** Field-type symbol variant. @default 'string' */
  fieldType?: FieldType;
  /** Persistence symbol variant (also the entity's ring). @default 'persistent' */
  persistence?: EntityPersistence;
  /** Operator category tint. @default 'arithmetic' */
  namespace?: OperatorCategory;
  /** Symbol height. @default 'md' */
  size?: 'sm' | 'md' | 'lg';
  /** Show the caption under the symbol. @default true */
  showCaption?: boolean;
  className?: string;
}

const HEIGHT = { sm: 32, md: 56, lg: 88 } as const;
const PAD = 6;

function Symbol({ kind, label, effectType, fieldType, persistence, namespace }: Pick<AvlGlyphProps, 'kind' | 'label' | 'effectType' | 'fieldType' | 'persistence' | 'namespace'>): React.ReactElement {
  switch (kind) {
    case 'application': return <AvlApplication width={120} height={80} />;
    case 'orbital': return <AvlOrbital r={36} />;
    case 'entity': return <AvlEntity r={18} fieldCount={4} persistence={persistence ?? 'persistent'} />;
    case 'trait': return <AvlTrait rx={44} ry={22} />;
    case 'page': return <AvlPage size={20} />;
    case 'state': return <AvlState width={96} height={34} />;
    case 'transition': return <AvlTransition x1={-40} y1={0} x2={40} y2={0} />;
    case 'event': return <AvlEvent size={20} />;
    case 'guard': return <AvlGuard size={28} />;
    case 'effect': return <AvlEffect effectType={effectType ?? 'set'} size={14} />;
    case 'field': return <AvlField length={40} />;
    case 'fieldType': return <AvlFieldType kind={fieldType ?? 'string'} size={9} />;
    case 'binding': return <AvlBinding x1={-40} y1={0} x2={40} y2={0} />;
    case 'bindingRef': return <AvlBindingRef path={label ?? 'entity.id'} size={14} />;
    case 'persistence': return <AvlPersistence kind={persistence ?? 'persistent'} size={24} />;
    case 'operator': return <AvlOperator name={label ?? '+'} namespace={namespace ?? 'arithmetic'} size={20} />;
    case 'sexpr': return <AvlSExpr width={110} height={60} />;
    case 'literal': return <AvlLiteral value={label ?? '42'} size={14} />;
  }
}

export const AvlGlyph: React.FC<AvlGlyphProps> = ({ kind, label, size = 'md', showCaption = true, className, effectType, fieldType, persistence, namespace, ...rest }) => {
  const variant = { effectType, fieldType, persistence, namespace };
  const { t } = useTranslate();
  const groupRef = useRef<SVGGElement>(null);
  const [box, setBox] = useState({ x: -50, y: -50, w: 100, h: 100 });

  useLayoutEffect(() => {
    const g = groupRef.current;
    if (!g || typeof g.getBBox !== 'function') return;
    const b = g.getBBox();
    if (b.width > 0 && b.height > 0) setBox({ x: b.x - PAD, y: b.y - PAD, w: b.width + 2 * PAD, h: b.height + 2 * PAD });
  }, [kind, label, variant.effectType, variant.fieldType, variant.persistence, variant.namespace]);

  const height = HEIGHT[size];
  return (
    <Box {...domPassthrough(rest)} data-testid="avl-glyph" data-kind={kind} className={`inline-flex flex-col items-center gap-1 ${className ?? ''}`}>
      <svg height={height} width={(height * box.w) / box.h} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} role="img" aria-label={label ?? t(`avl.glyph.${kind}`)}>
        <g ref={groupRef}>
          <Symbol kind={kind} label={label} {...variant} />
        </g>
      </svg>
      {showCaption ? (
        <Box data-testid="avl-glyph-caption">
          <Typography variant="caption" color="muted">{label ?? t(`avl.glyph.${kind}`)}</Typography>
        </Box>
      ) : null}
    </Box>
  );
};

AvlGlyph.displayName = 'AvlGlyph';
