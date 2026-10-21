'use client';
/**
 * ImportPreviewTree Molecule
 *
 * Staged import preview: generic units grouped by targetEntity, nested by
 * parentRef, with per-unit field summaries, a skipped-elements section, and
 * confirm/cancel actions. Pure render — props in, events out.
 * Follows atomic design: composes Box, Badge, Button, Icon, Typography atoms.
 */

import React from 'react';
import type { FieldValue, A11yProps } from '@almadar/core';
import { Box } from '../../../../core';
import { Badge } from '../../../../core';
import { Button } from '../../../../core';
import { Icon } from '../../../../core';
import { Typography } from '../../../../core';
import { cn } from '../../../../core';
import { useTranslate } from '../../../../core';
import { useContentSurface } from '../../../../core';
import type { SurfaceMode } from '@almadar/core';

import { domPassthrough } from '../../../../core';
export interface ImportPreviewUnit {
  /** Staging ref, provenance-linked to a source span */
  ref: string;
  /** Target entity name */
  targetEntity: string;
  /** Heading shown for the unit (defaults to its `ref`) */
  title?: string;
  /** Mapped field values */
  fields: Record<string, FieldValue>;
  /** Staging ref of the unit this nests under */
  parentRef?: string;
}

export interface ImportSkippedElement {
  ref: string;
  reason: string;
}

export interface ImportEntityDisplay {
  singular: string;
  plural: string;
}

export interface ImportPreviewTreeProps extends A11yProps {
  /** Content surface: `auto` paints the theme's surface behind each group tile unless it already sits on one (a card, dialog or another block); `none` opts out. */
  surface?: SurfaceMode;
  /** Staged units to preview */
  units: ImportPreviewUnit[];
  /** Elements skipped during extraction, with reasons */
  skipped?: ImportSkippedElement[];
  /** Entity name → display labels; falls back to the entity name */
  entityDisplay: Record<string, ImportEntityDisplay>;
  /** Called when the user confirms the staged import */
  onConfirm?: () => void;
  /** Called when the user cancels the staged import */
  onCancel?: () => void;
  /** Confirm button label */
  confirmLabel?: string;
  /** Cancel button label */
  cancelLabel?: string;
  /** Indent per tree depth in px (default: 16) */
  indent?: number;
  /** Additional CSS classes */
  className?: string;
}

function formatFieldValue(value: FieldValue): string {
  if (value === null) return '—';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(formatFieldValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function unitTitle(unit: ImportPreviewUnit): string {
  return unit.title || unit.ref;
}

function fieldSummary(unit: ImportPreviewUnit): string {
  return Object.entries(unit.fields)
    .map(([key, value]) => `${key}: ${formatFieldValue(value)}`)
    .join(' · ');
}

export const ImportPreviewTree: React.FC<ImportPreviewTreeProps> = ({
  units,
  skipped = [],
  entityDisplay,
  onConfirm,
  onCancel,
  confirmLabel,
  cancelLabel,
  indent = 16,
  className,
  surface = 'auto',
  ...rest
}) => {
  const contentSurface = useContentSurface(surface);
  const tileClass = cn(contentSurface.className ?? 'rounded-container border border-border', 'p-3');
  const { t } = useTranslate();
  const groups = new Map<string, ImportPreviewUnit[]>();
  for (const unit of units) {
    const group = groups.get(unit.targetEntity);
    if (group) group.push(unit);
    else groups.set(unit.targetEntity, [unit]);
  }

  const renderUnit = (unit: ImportPreviewUnit, childrenByParent: Map<string, ImportPreviewUnit[]>, depth: number) => {
    const summary = fieldSummary(unit);
    const children = childrenByParent.get(unit.ref) ?? [];
    return (
      <React.Fragment key={unit.ref}>
        <Box
          className="flex flex-col py-1"
          style={{ paddingLeft: depth * indent }}
          data-testid={`import-preview-unit-${unit.ref}`}
        >
          <Box className="flex items-center gap-2">
            <Icon icon="file-text" size="xs" className="text-muted-foreground" />
            <Typography variant="body2">{unitTitle(unit)}</Typography>
          </Box>
          {summary ? (
            <Typography variant="caption" className="text-muted-foreground">
              {summary}
            </Typography>
          ) : null}
        </Box>
        {children.map((child) => renderUnit(child, childrenByParent, depth + 1))}
      </React.Fragment>
    );
  };

  return contentSurface.provide(
    <Box {...domPassthrough(rest)} className={cn('flex flex-col gap-4', className)}>
      {units.length === 0 ? (
        <Typography variant="body2" className="text-muted-foreground">
          {t('import.noUnitsStaged')}
        </Typography>
      ) : null}
      {Array.from(groups.entries()).map(([entity, groupUnits]) => {
        const refs = new Set(groupUnits.map((unit) => unit.ref));
        const childrenByParent = new Map<string, ImportPreviewUnit[]>();
        const roots: ImportPreviewUnit[] = [];
        for (const unit of groupUnits) {
          if (unit.parentRef && refs.has(unit.parentRef)) {
            const siblings = childrenByParent.get(unit.parentRef);
            if (siblings) siblings.push(unit);
            else childrenByParent.set(unit.parentRef, [unit]);
          } else {
            roots.push(unit);
          }
        }
        const label = entityDisplay[entity]?.plural ?? entity;
        return (
          <Box key={entity} className={tileClass}>
            <Box className="flex items-center gap-2 pb-2">
              <Typography variant="label">{label}</Typography>
              <Badge amount={groupUnits.length} />
            </Box>
            {roots.map((unit) => renderUnit(unit, childrenByParent, 0))}
          </Box>
        );
      })}
      {skipped.length > 0 ? (
        <Box className={tileClass}>
          <Box className="flex items-center gap-2 pb-2">
            <Typography variant="label">{t('import.skipped')}</Typography>
            <Badge amount={skipped.length} />
          </Box>
          {skipped.map((element) => (
            <Box key={element.ref} className="flex items-baseline gap-2 py-1">
              <Typography variant="body2">{element.ref}</Typography>
              <Typography variant="caption" className="text-muted-foreground">
                {element.reason}
              </Typography>
            </Box>
          ))}
        </Box>
      ) : null}
      {onConfirm || onCancel ? (
        <Box className="flex items-center justify-end gap-2">
          {onCancel ? (
            <Button variant="default" label={cancelLabel ?? t('common.cancel')} onClick={onCancel} />
          ) : null}
          {onConfirm ? (
            <Button variant="primary" label={confirmLabel ?? t('import.confirmImport')} onClick={onConfirm} />
          ) : null}
        </Box>
      ) : null}
    </Box>,
  );
};

export default ImportPreviewTree;
