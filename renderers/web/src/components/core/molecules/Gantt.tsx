'use client';
/**
 * Gantt Molecule
 *
 * View-only Gantt/timeline: task bars on a day-scale axis with group headers,
 * SVG dependency arrows, a today marker, and horizontal scroll. No drag-edit,
 * no zoom — placement comes entirely from the row fields.
 *
 * Field-mapping idiom matches CalendarGrid (`titleField`/`startField`/…): a
 * bound host names its own columns instead of renaming entity fields.
 * Uses atoms only internally: Box, VStack, HStack, Typography.
 */
import React, { useMemo } from 'react';
import type { EntityRow, EventEmit, FieldValue, A11yProps } from '@almadar/core';
import { cn } from '../../../core';
import { getNestedValue } from '../../../lib/getNestedValue';
import { useTranslate } from '../../../core';
import { useContentSurface } from '../../../core';
import type { SurfaceMode } from '@almadar/core';
import { Box } from '../../../core';
import { VStack, HStack } from '../../../core';
import { Typography } from '../../../core';
import { LoadingState } from './LoadingState';
import { EmptyState } from './EmptyState';
import type { UiError } from '../../../core';
import { badgeVariantFor } from "../../../lib/displayField";
import type { BadgeColor } from '../../../core';
import type { BadgeVariant } from '../../../core';

import { domPassthrough } from '../../../core';
/** A dependency between two task ids: `to` cannot start before `from` ends. */
export interface GanttLink {
  /** Id of the predecessor task row */
  from: string;
  /** Id of the dependent task row */
  to: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 44;
const LABEL_WIDTH = 192;

/** Bar treatment per declared colour; an unmapped status is a primary bar. */
const BAR_CLASS: Record<BadgeVariant, string> = {
  default: 'bg-primary/80 hover:bg-primary',
  primary: 'bg-primary/80 hover:bg-primary',
  secondary: 'bg-secondary/80 hover:bg-secondary',
  success: 'bg-success/80 hover:bg-success',
  warning: 'bg-warning/80 hover:bg-warning',
  danger: 'bg-error/80 hover:bg-error',
  error: 'bg-error/80 hover:bg-error',
  info: 'bg-info/80 hover:bg-info',
  neutral: 'bg-muted-foreground/50 hover:bg-muted-foreground/70',
};

/**
 * Gantt — view-only task schedule rendering rows as bars on a day axis.
 *
 * @capabilities gantt chart, project timeline, schedule view, task bars, dependency arrows, roadmap, milestone plan
 * @fieldsContract display
 */
export interface GanttProps extends A11yProps {
  /**
   * Schema entity data — the task rows to place on the axis. pattern-sync tags
   * it `kind:"entity", cardinality:"collection"` so consumers bind the domain
   * entity without name-matching the prop.
   */
  tasks?: readonly EntityRow[];
  /** Dependency arrows between task ids */
  links?: readonly GanttLink[];
  /** Row field holding the bar label. Defaults to `title`. */
  titleField?: string;
  /** Row field holding the start timestamp (ISO or epoch). Defaults to `start`. */
  startField?: string;
  /** Row field holding the end timestamp (ISO or epoch). Defaults to `end`.
   *  When absent, `durationField` (days) is used instead. */
  endField?: string;
  /** Row field holding the task length in days, used when the row has no end. */
  durationField?: string;
  /** Row field holding the bar status. Defaults to `status`. */
  statusField?: string;
  /** Bar colour per exact status value; unmapped statuses are primary bars. */
  statusColorMap?: Readonly<Record<string, BadgeColor>>;
  /** Row field rows are grouped under header rows by. Empty (default) = flat list. */
  groupField?: string;
  /** First visible day (ISO or Date). Defaults to 2 days before the earliest task. */
  rangeStart?: string | Date;
  /** Last visible day (ISO or Date). Defaults to 2 days after the latest task end. */
  rangeEnd?: string | Date;
  /** Paint the today marker line when today falls inside the range (default true). */
  showToday?: boolean;
  /** Pixels per day on the axis (default 28) */
  dayWidth?: number;
  /** Event emitted when a bar is clicked: UI:{barClickEvent} with { id } */
  barClickEvent?: EventEmit<{ id: string }>;
  /** Content surface: `auto` paints the theme's surface behind this block unless it already sits on one (a card, dialog or another block); `none` opts out. */
  surface?: SurfaceMode;
  /** Additional CSS classes */
  className?: string;
  /** Loading state */
  isLoading?: boolean;
  /** Error state */
  error?: UiError | null;
}

interface PlacedTask {
  row: EntityRow;
  id: string;
  label: string;
  status: string;
  group: string;
  start: Date;
  /** Exclusive: the day after the last covered day. */
  end: Date;
  /** The row's end is before its start; the bar spans the two dates it carries. */
  reversed: boolean;
}

function parseDay(value: FieldValue | Date | undefined): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value as string | number);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

type DisplayItem =
  | { kind: 'group'; label: string }
  | { kind: 'task'; task: PlacedTask };

export function Gantt({
  tasks = [],
  links = [],
  titleField = 'title',
  startField = 'start',
  endField = 'end',
  durationField,
  statusField = 'status',
  statusColorMap,
  groupField = '',
  rangeStart,
  rangeEnd,
  showToday = true,
  dayWidth = 28,
  barClickEvent,
  className,
  isLoading = false,
  error = null,
  surface = 'auto',
  ...rest
}: GanttProps): React.JSX.Element {
  const contentSurface = useContentSurface(surface);
  const { t } = useTranslate();

  const placed = useMemo<PlacedTask[]>(() => {
    const rows = Array.isArray(tasks) ? tasks : tasks ? [tasks] : [];
    const out: PlacedTask[] = [];
    rows.forEach((row, idx) => {
      const declaredEnd = parseDay(getNestedValue(row, endField));
      // A row with only an end is a milestone on its end day.
      const declaredStart = parseDay(getNestedValue(row, startField)) ?? declaredEnd;
      if (!declaredStart) return;
      let start = declaredStart;
      let end: Date;
      let reversed = false;
      if (declaredEnd) {
        reversed = declaredEnd.getTime() < declaredStart.getTime();
        if (reversed) start = declaredEnd;
        // The axis is in days, so a bar covers its last day too.
        end = new Date((reversed ? declaredStart : declaredEnd).getTime() + DAY_MS);
      } else {
        const days = durationField ? Number(getNestedValue(row, durationField)) : NaN;
        end = new Date(start.getTime() + (Number.isFinite(days) && days > 0 ? days : 1) * DAY_MS);
      }
      out.push({
        row,
        id: String(row.id ?? idx),
        label: String(getNestedValue(row, titleField) ?? ''),
        status: String(getNestedValue(row, statusField) ?? ''),
        group: groupField ? String(getNestedValue(row, groupField) ?? '') : '',
        start,
        end,
        reversed,
      });
    });
    return out;
  }, [tasks, titleField, startField, endField, durationField, statusField, groupField]);

  const [axisStart, axisEnd] = useMemo<[Date, Date]>(() => {
    const lo = parseDay(rangeStart) ?? (placed.length
      ? new Date(Math.min(...placed.map((p) => p.start.getTime())) - 2 * DAY_MS)
      : new Date(new Date().setHours(0, 0, 0, 0)));
    const hi = parseDay(rangeEnd) ?? (placed.length
      ? new Date(Math.max(...placed.map((p) => p.end.getTime())) + 2 * DAY_MS)
      : new Date(lo.getTime() + 30 * DAY_MS));
    return hi.getTime() > lo.getTime() ? [lo, hi] : [lo, new Date(lo.getTime() + DAY_MS)];
  }, [rangeStart, rangeEnd, placed]);

  const totalDays = Math.round((axisEnd.getTime() - axisStart.getTime()) / DAY_MS);
  const chartWidth = totalDays * dayWidth;

  const dayOffset = (d: Date): number =>
    ((d.getTime() - axisStart.getTime()) / DAY_MS) * dayWidth;

  const displayItems = useMemo<DisplayItem[]>(() => {
    if (!groupField) return placed.map((task) => ({ kind: 'task' as const, task }));
    const items: DisplayItem[] = [];
    const seen = new Set<string>();
    for (const task of placed) {
      if (!seen.has(task.group)) {
        seen.add(task.group);
        items.push({ kind: 'group', label: task.group || '—' });
      }
      items.push({ kind: 'task', task });
    }
    return items;
  }, [placed, groupField]);

  // Bar geometry per task id, for the dependency-arrow overlay.
  const barGeometry = useMemo(() => {
    const offset = (d: Date): number => ((d.getTime() - axisStart.getTime()) / DAY_MS) * dayWidth;
    const map = new Map<string, { x0: number; x1: number; y: number }>();
    displayItems.forEach((item, idx) => {
      if (item.kind !== 'task') return;
      const x0 = offset(item.task.start);
      const x1 = Math.max(offset(item.task.end), x0 + dayWidth / 2);
      map.set(item.task.id, { x0, x1, y: HEADER_HEIGHT + idx * ROW_HEIGHT + ROW_HEIGHT / 2 });
    });
    return map;
  }, [displayItems, axisStart, dayWidth]);

  const days = useMemo<Date[]>(() => {
    const out: Date[] = [];
    for (let i = 0; i < totalDays; i++) out.push(new Date(axisStart.getTime() + i * DAY_MS));
    return out;
  }, [axisStart, totalDays]);

  const todayOffset = useMemo(() => {
    const today = parseDay(new Date());
    if (!today || today < axisStart || today > axisEnd) return null;
    return ((today.getTime() - axisStart.getTime()) / DAY_MS) * dayWidth;
  }, [axisStart, axisEnd, dayWidth]);

  if (isLoading) {
    return <LoadingState {...domPassthrough(rest)} message={t('common.loading')} className={className} />;
  }

  if (error) {
    return (
      <Box {...domPassthrough(rest)} className={cn('p-4', className)}>
        <Typography variant="body" color="error">
          {error.message}
        </Typography>
      </Box>
    );
  }

  if (placed.length === 0) {
    return (
      <EmptyState
        {...domPassthrough(rest)}
        title={t('empty.noData')}
        className={className}
      />
    );
  }

  return contentSurface.provide(
    <Box
      {...domPassthrough(rest)}
      className={cn('w-full overflow-auto', contentSurface.className, className)}
    >
      <Box className="relative" style={{ width: LABEL_WIDTH + chartWidth, minWidth: '100%' }}>
        {/* Day header */}
        <HStack gap="none" className="sticky top-0 z-20 bg-card border-b border-border" style={{ height: HEADER_HEIGHT }}>
          <Box className="sticky left-0 z-10 shrink-0 bg-card border-r border-border" style={{ width: LABEL_WIDTH, height: HEADER_HEIGHT }} />
          <Box className="relative" style={{ width: chartWidth, height: HEADER_HEIGHT }}>
            {days.map((day, i) => (
              <Box
                key={i}
                className={cn(
                  'absolute top-0 bottom-0 border-l border-border/50 flex items-end justify-center pb-1',
                  day.getDay() === 0 || day.getDay() === 6 ? 'bg-muted/40' : undefined,
                )}
                style={{ left: i * dayWidth, width: dayWidth }}
              >
                {dayWidth >= 20 && (
                  <Typography variant="caption" color="secondary">
                    {day.getDate()}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        </HStack>

        {/* Rows */}
        <VStack gap="none" className="relative">
          {displayItems.map((item, idx) =>
            item.kind === 'group' ? (
              <HStack
                key={`g-${idx}`}
                gap="none"
                className="border-b border-border bg-muted/30"
                style={{ height: ROW_HEIGHT }}
              >
                <Box className="sticky left-0 z-10 shrink-0 bg-muted/30 px-3 flex items-center border-r border-border" style={{ width: LABEL_WIDTH, height: ROW_HEIGHT }}>
                  <Typography variant="caption" weight="semibold">
                    {item.label}
                  </Typography>
                </Box>
                <Box style={{ width: chartWidth, height: ROW_HEIGHT }} />
              </HStack>
            ) : (
              <HStack
                key={item.task.id}
                gap="none"
                className="border-b border-border/50"
                style={{ height: ROW_HEIGHT }}
              >
                <Box className="sticky left-0 z-10 shrink-0 bg-card px-3 flex items-center border-r border-border" style={{ width: LABEL_WIDTH, height: ROW_HEIGHT }}>
                  <Typography variant="small" className="truncate">
                    {item.task.label}
                  </Typography>
                </Box>
                <Box className="relative" style={{ width: chartWidth, height: ROW_HEIGHT }}>
                  <Box
                    className={cn(
                      'absolute top-1/2 -translate-y-1/2 h-4 rounded-sm transition-colors',
                      item.task.reversed
                        ? 'bg-error/30 border border-dashed border-error'
                        : BAR_CLASS[badgeVariantFor(item.task.status, statusColorMap)],
                      barClickEvent ? 'cursor-pointer' : undefined,
                    )}
                    style={{
                      left: dayOffset(item.task.start),
                      width: dayOffset(item.task.end) - dayOffset(item.task.start),
                    }}
                    data-gantt-bar={item.task.id}
                    data-dates-reversed={item.task.reversed ? 'true' : undefined}
                    title={item.task.reversed ? t('gantt.datesReversed') : undefined}
                    action={barClickEvent}
                    actionPayload={{ id: item.task.id }}
                  />
                </Box>
              </HStack>
            ),
          )}

          {/* Dependency arrows */}
          {links.length > 0 && (
            <svg
              className="absolute pointer-events-none"
              style={{ left: LABEL_WIDTH, top: 0 }}
              width={chartWidth}
              height={HEADER_HEIGHT + displayItems.length * ROW_HEIGHT}
            >
              <defs>
                <marker id="gantt-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill="var(--muted-foreground, currentColor)" />
                </marker>
              </defs>
              {links.map((link, i) => {
                const from = barGeometry.get(link.from);
                const to = barGeometry.get(link.to);
                if (!from || !to) return null;
                const midX = from.x1 + Math.max(8, (to.x0 - from.x1) / 2);
                return (
                  <path
                    key={i}
                    d={`M ${from.x1} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x0} ${to.y}`}
                    fill="none"
                    stroke="var(--muted-foreground, currentColor)"
                    strokeWidth={1.5}
                    markerEnd="url(#gantt-arrow)"
                  />
                );
              })}
            </svg>
          )}

          {/* Today marker */}
          {showToday && todayOffset !== null && (
            <Box
              className="absolute top-0 bottom-0 w-0.5 bg-error/70 pointer-events-none"
              style={{ left: LABEL_WIDTH + todayOffset }}
            />
          )}
        </VStack>
      </Box>
    </Box>,
  );
}

Gantt.displayName = 'Gantt';
