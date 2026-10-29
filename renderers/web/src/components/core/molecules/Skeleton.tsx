'use client';

import { LOADING_STATE_MARKER, type A11yProps, type SkeletonNode, type SkeletonShape, type SkeletonSpec, type SkeletonVariant } from '@almadar/core';
import React from 'react';
import { cn } from '../../../core';
import { useTranslate } from '../../../core';
import { Box } from '../../../core';
import { VStack } from '../../../core';
import { HStack } from '../../../core';
import { SimpleGrid } from './SimpleGrid';

import { domPassthrough } from '../../../core';
/**
 * Each variant mirrors the geometry of the component that replaces it, so the
 * swap from placeholder to content does not move the layout: `table` → TableView,
 * `list` → DataList, `grid` → DataGrid cards, `detail` → DetailPanel, `stats` →
 * stat tiles, `form` → Form, `card` / `header` / `text` for the rest.
 */
export type { SkeletonVariant };

/**
 * @role status
 * @tokens --color-muted --color-border
 * @motion css
 */
export interface SkeletonProps extends A11yProps {
  /** The skeleton variant to render */
  variant?: SkeletonVariant;
  /** A declared `skeleton` prop value (shape name, sized shape or `none`); overrides variant/rows/columns/fields */
  spec?: SkeletonSpec;
  /** Rows for table/list/text, cards for grid, field pairs for detail */
  rows?: number;
  /** Columns for table, tiles for stats */
  columns?: number;
  /** Number of fields for form variant */
  fields?: number;
  /** Additional CSS classes */
  className?: string;
}

const pulseClass = 'almadar-shimmer animate-shimmer rounded-container';

function SkeletonLine({ className }: { className?: string }) {
  return <Box className={cn(pulseClass, 'h-4', className)} />;
}

function SkeletonBlock({ className }: { className?: string }) {
  return <Box className={cn(pulseClass, className)} />;
}

function HeaderSkeleton({ className }: { className?: string }) {
  return (
    <HStack className={cn('items-center justify-between px-6 py-5', className)}>
      <VStack gap="sm" className="flex-1">
        <SkeletonBlock className="h-7 w-48" />
        <SkeletonLine className="w-64" />
      </VStack>
      <HStack gap="sm">
        <SkeletonBlock className="h-9 w-24 rounded-interactive" />
        <SkeletonBlock className="h-9 w-32 rounded-interactive" />
      </HStack>
    </HStack>
  );
}

function TableSkeleton({ rows = 5, columns = 4, className }: { rows?: number; columns?: number; className?: string }) {
  return (
    <VStack gap="none" className={cn('border border-border rounded-container overflow-hidden', className)}>
      {/* Table header */}
      <HStack className="px-4 py-3 bg-muted/30 border-b border-border">
        {Array.from({ length: columns }).map((_, i) => (
          <SkeletonBlock key={i} className="h-4 flex-1 mx-2" />
        ))}
      </HStack>
      {/* Table rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <HStack
          key={rowIdx}
          className={cn(
            'px-4 py-3',
            rowIdx < rows - 1 && 'border-b border-border',
          )}
        >
          {Array.from({ length: columns }).map((_, colIdx) => (
            <SkeletonLine key={colIdx} className="flex-1 mx-2" />
          ))}
        </HStack>
      ))}
    </VStack>
  );
}

function FormSkeleton({ fields = 4, className }: { fields?: number; className?: string }) {
  return (
    <VStack gap="lg" className={cn('p-6', className)}>
      {/* Form title */}
      <SkeletonBlock className="h-6 w-40" />
      {/* Form fields */}
      {Array.from({ length: fields }).map((_, i) => (
        <VStack key={i} gap="sm">
          <SkeletonBlock className="h-4 w-24" />
          <SkeletonBlock className="h-10 w-full rounded-interactive" />
        </VStack>
      ))}
      {/* Form actions */}
      <HStack gap="md" className="justify-end pt-2">
        <SkeletonBlock className="h-10 w-20 rounded-interactive" />
        <SkeletonBlock className="h-10 w-24 rounded-interactive" />
      </HStack>
    </VStack>
  );
}

function CardSkeleton({ className }: { className?: string }) {
  return (
    <VStack
      gap="md"
      className={cn(
        'p-5 border border-border rounded-container',
        className,
      )}
    >
      <HStack className="items-center" gap="md">
        <SkeletonBlock className="h-10 w-10 rounded-full" />
        <VStack gap="xs" className="flex-1">
          <SkeletonBlock className="h-5 w-32" />
          <SkeletonLine className="w-48" />
        </VStack>
      </HStack>
      <SkeletonLine className="w-full" />
      <SkeletonLine className="w-3/4" />
      <HStack gap="sm" className="pt-2">
        <SkeletonBlock className="h-6 w-16 rounded-full" />
        <SkeletonBlock className="h-6 w-20 rounded-full" />
      </HStack>
    </VStack>
  );
}

function TextSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <VStack gap="sm" className={className}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonLine
          key={i}
          className={i === rows - 1 ? 'w-2/3' : 'w-full'}
        />
      ))}
    </VStack>
  );
}

function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <VStack gap="none" className={cn('border border-border rounded-container overflow-hidden', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <HStack key={i} gap="md" className={cn('items-center px-4 py-3', i < rows - 1 && 'border-b border-border')}>
          <SkeletonBlock className="h-10 w-10 rounded-full shrink-0" />
          <VStack gap="xs" className="flex-1 min-w-0">
            <SkeletonBlock className="h-4 w-1/3" />
            <SkeletonLine className="w-2/3 h-3" />
          </VStack>
          <SkeletonBlock className="h-6 w-16 rounded-full" />
        </HStack>
      ))}
    </VStack>
  );
}

function GridSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  // minChildWidth = Tailwind w-64 (was 260px)
  return (
    <SimpleGrid minChildWidth="256px" gap="md" className={className}>
      {Array.from({ length: rows }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </SimpleGrid>
  );
}

function StatsSkeleton({ columns = 4, className }: { columns?: number; className?: string }) {
  // minChildWidth = Tailwind w-44 (was 180px)
  return (
    <SimpleGrid minChildWidth="176px" gap="md" className={className}>
      {Array.from({ length: columns }).map((_, i) => (
        <VStack key={i} gap="sm" className="p-4 border border-border rounded-container">
          <SkeletonLine className="w-1/2 h-3" />
          <SkeletonBlock className="h-7 w-2/3" />
        </VStack>
      ))}
    </SimpleGrid>
  );
}

function DetailSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <VStack gap="lg" className={cn('p-6 border border-border rounded-container', className)}>
      <HStack className="items-start justify-between" gap="md">
        <HStack gap="sm" className="items-center">
          <SkeletonBlock className="h-8 w-56" />
          <SkeletonBlock className="h-6 w-20 rounded-full" />
        </HStack>
        <HStack gap="sm">
          <SkeletonBlock className="h-9 w-24 rounded-interactive" />
          <SkeletonBlock className="h-9 w-9 rounded-interactive" />
        </HStack>
      </HStack>
      <HStack gap="md">
        <SkeletonBlock className="h-20 flex-1" />
        <SkeletonBlock className="h-20 flex-1" />
        <SkeletonBlock className="h-20 flex-1" />
      </HStack>
      {/* minChildWidth = Tailwind w-48 (was 200px) */}
      <SimpleGrid minChildWidth="192px" maxCols={3} gap="md">
        {Array.from({ length: rows }).map((_, i) => (
          <VStack key={i} gap="xs">
            <SkeletonLine className="w-1/3 h-3" />
            <SkeletonBlock className="h-5 w-2/3" />
          </VStack>
        ))}
      </SimpleGrid>
      <TextSkeleton rows={3} />
    </VStack>
  );
}

/**
 * Skeleton — the loading placeholder. A loading state renders the variant shaped
 * like the content it gives way to; announced as a busy status region.
 *
 * @example
 * ```tsx
 * <Suspense fallback={<Skeleton variant="table" rows={8} columns={5} />}>
 *   <DataTable entity="Task" />
 * </Suspense>
 *
 * <Suspense fallback={<Skeleton variant="form" fields={6} />}>
 *   <Form entity="Task" />
 * </Suspense>
 * ```
 */
export function Skeleton({
  variant = 'text',
  spec,
  rows,
  columns,
  fields,
  className,
  ...rest
}: SkeletonProps): React.ReactElement | null {
  const { t } = useTranslate();
  const shape = spec !== undefined ? shapeOfSpec(spec) : { variant, rows, columns, fields };
  if (shape === null) return null;
  return (
    <Box
      {...domPassthrough(rest)}
      role="status"
      aria-busy="true"
      aria-label={rest['aria-label'] ?? t('common.loading')}
      data-skeleton={shape.variant}
      {...{ [LOADING_STATE_MARKER]: '' }}
      className="w-full"
    >
      {renderVariant(shape.variant, shape.rows, shape.columns, shape.fields, className)}
    </Box>
  );
}

/** A declared `skeleton` value as a sized shape; `none` draws nothing. */
export function shapeOfSpec(spec: SkeletonSpec): SkeletonShape | null {
  if (spec === 'none') return null;
  return typeof spec === 'string' ? { variant: spec } : spec;
}

function renderNode(node: SkeletonNode, key?: number): React.ReactElement {
  if ('stack' in node) {
    return (
      <VStack key={key} gap="lg">
        {node.stack.map((child, i) => renderNode(child, i))}
      </VStack>
    );
  }
  const { variant, rows, columns, fields } = node.shape;
  return <React.Fragment key={key}>{renderVariant(variant, rows, columns, fields, undefined)}</React.Fragment>;
}

/**
 * A predicted skeleton (what a server-backed trait will render while it awaits
 * its round trip), drawn as one busy status region.
 */
export function SkeletonTree({ node, className }: { node: SkeletonNode; className?: string }): React.ReactElement {
  const { t } = useTranslate();
  return (
    <Box
      role="status"
      aria-busy="true"
      aria-label={t('common.loading')}
      data-skeleton="tree"
      {...{ [LOADING_STATE_MARKER]: '' }}
      className={cn('w-full almadar-awaiting-skeleton', className)}
    >
      {renderNode(node)}
    </Box>
  );
}

function renderVariant(
  variant: SkeletonVariant,
  rows: number | undefined,
  columns: number | undefined,
  fields: number | undefined,
  className: string | undefined,
): React.ReactElement {
  switch (variant) {
    case 'header':
      return <HeaderSkeleton className={className} />;
    case 'table':
      return <TableSkeleton rows={rows} columns={columns} className={className} />;
    case 'list':
      return <ListSkeleton rows={rows} className={className} />;
    case 'grid':
      return <GridSkeleton rows={rows} className={className} />;
    case 'detail':
      return <DetailSkeleton rows={rows} className={className} />;
    case 'stats':
      return <StatsSkeleton columns={columns} className={className} />;
    case 'form':
      return <FormSkeleton fields={fields} className={className} />;
    case 'card':
      return <CardSkeleton className={className} />;
    case 'text':
      return <TextSkeleton rows={rows} className={className} />;
  }
}

Skeleton.displayName = 'Skeleton';
