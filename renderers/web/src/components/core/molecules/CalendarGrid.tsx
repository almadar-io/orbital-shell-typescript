'use client';
/**
 * CalendarGrid
 *
 * Pure presentational weekly calendar grid molecule.
 * No entity binding, no event bus, no translations.
 * Composes DayCell and TimeSlotCell atoms into a 7-day grid.
 */
import React, { useMemo, useCallback, useEffect, useRef, useState } from "react";
import type { EventEmit, EventPayload, EntityRow, EntityWith, A11yProps } from "@almadar/core";
import { cn } from '../../../core';
import { useContentSurface } from '../../../core';
import type { SurfaceMode } from '@almadar/core';
import { pressableProps } from '../../../core';
import { getNestedValue } from "../../../lib/getNestedValue";
import { Box } from '../../../core';
import { Button } from '../../../core';
import { HStack, VStack } from '../../../core';
import { Typography } from '../../../core';
import { Badge } from '../../../core';
import { DayCell } from '../../../core';
import { TimeSlotCell } from '../../../core';
import { useEventBus } from '../../../core';
import { useSwipeGesture } from "../../../hooks/useSwipeGesture";
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
/**
 * Number of day columns rendered at once. Matches the responsiveness-
 * audit tiers exactly: 1 day on mobile (≤640), 3 on tablet (641–1024),
 * 7 on laptop+ (≥1025).
 */
export type CalendarDayWindow = 1 | 3 | 7;

/** The per-event entity fields this grid reads. `startTime`/`endTime` are ISO
 *  strings; `color` is a Tailwind class string applied to the event chip. */
export interface CalendarEventRow {
  title: string;
  startTime: string;
  endTime?: string;
  color?: string;
}

export interface CalendarGridProps extends A11yProps {
  /** Start of the week (defaults to current week's Monday) */
  weekStart?: Date;
  /** Time slot labels (defaults to 09:00-17:00) */
  timeSlots?: string[];
  /** Events to display on the grid */
  events?: readonly EntityWith<CalendarEventRow>[];
  /** Called when a time slot is clicked */
  onSlotClick?: (day: Date, time: string) => void;
  /** Called when a day header is clicked */
  onDayClick?: (day: Date) => void;
  /** Called when an event is clicked
   *  @entityRow event */
  onEventClick?: (event: EntityRow) => void;
  /** Additional CSS classes */
  className?: string;
  /** Content surface: `auto` paints the theme's surface behind this block unless it already sits on one (a card, dialog or another block); `none` opts out. */
  surface?: SurfaceMode;
  /** Event emitted on long-press of a time slot: UI:{longPressEvent} with { date, time, ...longPressPayload } */
  longPressEvent?: EventEmit<{ date: string; time?: string }>;
  /** Additional payload for long-press events
   *  @payloadFor longPressEvent
   */
  longPressPayload?: EventPayload;
  /** Event emitted on swipe left (next week): UI:{swipeLeftEvent} */
  swipeLeftEvent?: EventEmit<Record<string, never>>;
  /** Event emitted on swipe right (prev week): UI:{swipeRightEvent} */
  swipeRightEvent?: EventEmit<Record<string, never>>;
  /**
   * Override the viewport-driven day window. `'auto'` (default) tracks
   * `window.innerWidth` — 1 day on mobile, 3 on tablet, 7 on laptop+.
   * Pass an explicit number to force a fixed window (useful for print
   * layouts or screenshot tests).
   */
  dayWindow?: CalendarDayWindow | 'auto';
  /**
   * Row field holding the chip label. Defaults to `title`. Lets a host bound
   * to its own entity name the column instead of being forced to rename its
   * fields to this grid's contract (same accessor idiom as `DataList`'s
   * `senderField` / `DataGrid`'s `imageField`).
   */
  titleField?: string;
  /** Row field holding the start timestamp (ISO or epoch). Defaults to `startTime`. */
  startField?: string;
  /** Row field holding the end timestamp (ISO or epoch). Defaults to `endTime`.
   *  When a row carries an end, the event's chip renders in its start slot and
   *  every further slot it covers shows a subdued continuation bar — without
   *  this, multi-hour events silently collapsed to their first hour. */
  endField?: string;
  /** Row field holding the chip's Tailwind colour class. Defaults to `color`. */
  colorField?: string;
  /**
   * Render function for one event chip's content. Receives the row and its
   * index in the materialised events array. The grid keeps ownership of
   * placement, colour and the click target; this replaces only what is drawn
   * INSIDE the chip, so a host can show a time + instructor + badge stack
   * instead of the default single label.
   */
  children?: (item: EntityRow, index: number) => React.ReactNode;
  /**
   * Per-event render function (schema-level alias for the children render
   * prop). In `.orb`: `["fn", "item", { pattern tree with @item.field bindings }]`.
   * In `.lolo`: `renderItem: (fn item <Component …={@item.field}/>)` — the same
   * contract `data-list` / `data-grid` / `carousel` already use.
   */
  renderItem?: (item: EntityRow, index: number) => React.ReactNode;
}

/**
 * Map a viewport width to a `CalendarDayWindow`. Edges match the
 * responsiveness-audit breakpoints (640 / 1024).
 */
function dayWindowForViewport(width: number): CalendarDayWindow {
  if (width <= 640) return 1;
  if (width <= 1024) return 3;
  return 7;
}

/**
 * React hook that returns the currently-applicable day window. Tracks
 * window resize until the consumer passes an explicit `dayWindow` prop
 * (in which case the hook is skipped and the prop value is used
 * verbatim).
 */
function useDayWindow(override: CalendarDayWindow | 'auto'): CalendarDayWindow {
  const [w, setW] = useState<CalendarDayWindow>(() => {
    if (override !== 'auto') return override;
    if (typeof window === 'undefined') return 7;
    return dayWindowForViewport(window.innerWidth);
  });
  useEffect(() => {
    if (override !== 'auto') {
      setW(override);
      return undefined;
    }
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setW(dayWindowForViewport(window.innerWidth));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [override]);
  return w;
}

const SHORT_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
function formatDateRange(start: Date, end: Date, locale: string): string {
  const startStr = start.toLocaleDateString(locale, SHORT_DATE);
  const endStr = end.toLocaleDateString(locale, SHORT_DATE);
  return start.toDateString() === end.toDateString() ? startStr : `${startStr} – ${endStr}`;
}

/** Get the Monday of the week containing the given date */
function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Get an array of 7 consecutive days starting from the given date */
function getWeekDays(start: Date): Date[] {
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    days.push(day);
  }
  return days;
}

/** Business-hours band shown when the events themselves need no wider window. */
const DEFAULT_FIRST_HOUR = 9;
const DEFAULT_LAST_HOUR = 17;

const slotLabel = (hour: number): string => `${hour.toString().padStart(2, '0')}:00`;

/**
 * Read a row's start timestamp through the caller's field accessor. A row whose
 * accessor resolves to nothing yields an Invalid Date, which every caller here
 * already guards — so a mis-named field means "renders nowhere", never a throw.
 */
function eventStartDate(event: EntityRow, startField: string): Date {
  const raw = getNestedValue(event, startField);
  return new Date((raw ?? '') as string | number);
}

/** Event end, or null when the row has no (valid) end value. */
function eventEndDate(event: EntityRow, endField: string): Date | null {
  const raw = getNestedValue(event, endField);
  if (raw === undefined || raw === null || raw === '') return null;
  const end = new Date(raw as string | number);
  return Number.isNaN(end.getTime()) ? null : end;
}

/**
 * Check whether an event STARTED EARLIER still covers this slot — the
 * continuation half of span rendering. The start slot itself is excluded
 * (that's where the chip renders via `eventInSlot`).
 */
function eventContinuesInSlot(
  event: EntityRow,
  day: Date,
  slotTime: string,
  startField: string,
  endField: string,
): boolean {
  const eventStart = eventStartDate(event, startField);
  const eventEnd = eventEndDate(event, endField);
  if (eventEnd === null || Number.isNaN(eventStart.getTime())) return false;
  const [slotHour] = slotTime.split(":").map(Number);
  const slotStart = new Date(day);
  slotStart.setHours(slotHour, 0, 0, 0);
  return slotStart.getTime() > eventStart.getTime() && slotStart.getTime() < eventEnd.getTime();
}

/**
 * Hourly slot labels covering the business-hours band WIDENED to include every
 * hour the given events actually start in. A fixed 09:00–17:00 band silently
 * dropped every early-morning or evening event: the day-header count badge
 * still counted it (that filter is date-only) while no chip could ever render
 * in any slot. Passing an explicit `timeSlots` keeps full author control.
 */
function generateDefaultTimeSlots(
  events: readonly EntityRow[],
  startField: string,
  endField: string,
): string[] {
  let first = DEFAULT_FIRST_HOUR;
  let last = DEFAULT_LAST_HOUR;
  for (const ev of events) {
    const start = eventStartDate(ev, startField);
    if (Number.isNaN(start.getTime())) continue;
    const hour = start.getHours();
    if (hour < first) first = hour;
    if (hour > last) last = hour;
    const end = eventEndDate(ev, endField);
    if (end && end.toDateString() === start.toDateString()) {
      // Cover the event's span: its last occupied hour bucket ends at the
      // hour BEFORE a clean on-the-hour end (a 13:00 end occupies ..–13:00).
      const endHour = end.getMinutes() === 0 && end.getSeconds() === 0
        ? end.getHours() - 1
        : end.getHours();
      if (endHour > last) last = endHour;
    }
  }
  const slots: string[] = [];
  for (let hour = first; hour <= last; hour++) {
    slots.push(slotLabel(hour));
  }
  return slots;
}

/**
 * Check whether an event falls within a specific day and time slot.
 *
 * Slots are hour BUCKETS: an event at 09:30 belongs to the 09:00 row. The
 * previous exact-minute equality meant only events landing precisely on the
 * hour ever rendered — every :15/:30/:45 appointment vanished from the grid
 * while still being counted in the day header.
 */
function eventInSlot(
  event: EntityRow,
  day: Date,
  slotTime: string,
  startField: string,
): boolean {
  const eventStart = eventStartDate(event, startField);
  if (Number.isNaN(eventStart.getTime())) return false;
  const [slotHour] = slotTime.split(":").map(Number);

  return (
    eventStart.toDateString() === day.toDateString() &&
    eventStart.getHours() === slotHour
  );
}

export function CalendarGrid({
  weekStart,
  timeSlots,
  events = [],
  onSlotClick,
  onDayClick,
  onEventClick,
  className,
  surface = 'auto',
  longPressEvent,
  longPressPayload,
  swipeLeftEvent,
  swipeRightEvent,
  dayWindow = 'auto',
  titleField = 'title',
  startField = 'startTime',
  endField = 'endTime',
  colorField = 'color',
  children,
  renderItem,
  ...rest
}: CalendarGridProps): React.JSX.Element {
  const evs = Array.isArray(events) ? events : events ? [events] : [];
  const eventBus = useEventBus();
  const contentSurface = useContentSurface(surface);
  const { t, locale } = useTranslate();
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const resolvedWeekStart = useMemo(
    () => (weekStart ? getStartOfWeek(weekStart) : getStartOfWeek(new Date())),
    [weekStart],
  );

  const weekDays = useMemo(
    () => getWeekDays(resolvedWeekStart),
    [resolvedWeekStart],
  );

  const resolvedTimeSlots = useMemo(
    () => timeSlots ?? generateDefaultTimeSlots(evs, startField, endField),
    [timeSlots, evs, startField, endField],
  );

  // Viewport-driven number of day columns shown at once. Mobile shows 1
  // day with a pager, tablet 3, laptop+ the full 7-day week.
  const visibleCount = useDayWindow(dayWindow);
  const [dayOffset, setDayOffset] = useState(0);

  // Clamp `dayOffset` when the visibleCount grows past the available
  // remaining days (e.g. user resized from mobile @offset=5 → laptop;
  // offset=5 + 7 = 12 > 7 so snap back to 0 so the whole week fits).
  useEffect(() => {
    if (dayOffset + visibleCount > 7) {
      setDayOffset(Math.max(0, 7 - visibleCount));
    }
  }, [visibleCount, dayOffset]);

  const visibleDays = useMemo(
    () => weekDays.slice(dayOffset, dayOffset + visibleCount),
    [weekDays, dayOffset, visibleCount],
  );

  const canPrev = dayOffset > 0;
  const canNext = dayOffset + visibleCount < 7;
  const stepPrev = useCallback(() => {
    setDayOffset((d) => Math.max(0, d - visibleCount));
  }, [visibleCount]);
  const stepNext = useCallback(() => {
    setDayOffset((d) => Math.min(7 - visibleCount, d + visibleCount));
  }, [visibleCount]);

  // The grid has `visibleCount + 1` columns (one time-label column +
  // one column per visible day). Tailwind needs the class as a literal
  // string so its JIT can see it.
  const gridColsClass =
    visibleCount === 1 ? 'grid-cols-2'
    : visibleCount === 3 ? 'grid-cols-4'
    : 'grid-cols-8';

  const handleSlotClick = useCallback(
    (day: Date, time: string) => {
      if (longPressFired.current) {
        longPressFired.current = false;
        return;
      }
      onSlotClick?.(day, time);
    },
    [onSlotClick],
  );

  const handleEventClick = useCallback(
    (event: EntityRow, e: React.MouseEvent) => {
      e.stopPropagation();
      onEventClick?.(event);
    },
    [onEventClick],
  );

  const eventPressProps = (event: EntityRow) =>
    onEventClick
      ? pressableProps<HTMLElement>((e) => handleEventClick(event, e))
      : { onClick: (e: React.MouseEvent) => e.stopPropagation() };

  const eventsForDayCount = useCallback(
    (day: Date): number =>
      evs.filter(
        (ev) => eventStartDate(ev, startField).toDateString() === day.toDateString(),
      ).length,
    [events, startField],
  );

  const swipeCallbacks = useMemo(() => ({
    onSwipeLeft: swipeLeftEvent ? () => eventBus.emit(`UI:${swipeLeftEvent}`, {}) : undefined,
    onSwipeRight: swipeRightEvent ? () => eventBus.emit(`UI:${swipeRightEvent}`, {}) : undefined,
  }), [swipeLeftEvent, swipeRightEvent, eventBus]);

  const swipe = useSwipeGesture(swipeCallbacks);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const startLongPress = useCallback((day: Date, time: string) => {
    if (!longPressEvent) return;
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      longPressFired.current = true;
      eventBus.emit(`UI:${longPressEvent}`, { date: day.toISOString(), time, ...longPressPayload });
    }, 500);
  }, [longPressEvent, longPressPayload, eventBus]);

  // `renderItem` is the schema-level alias the lambda converter also mirrors
  // onto `children`; either arrives as a compiled `(item, index) => node`.
  const renderChip = children ?? renderItem;

  const renderEvent = (event: EntityRow) => {
    const color = getNestedValue(event, colorField) as string | undefined;
    const label = String(getNestedValue(event, titleField) ?? '');
    // Index into the full events array, not the slot's own list, so `@index`
    // inside an authored lambda numbers rows consistently across days.
    const eventIndex = evs.indexOf(event as EntityWith<CalendarEventRow>);
    return (
    <Box
      key={event.id as string}
      rounded="md"
      padding="xs"
      border
      className={cn(
        "cursor-pointer hover:shadow-elevation-card transition-shadow text-xs truncate",
        color
          ? color
          : "bg-primary/10 border-primary/30 text-foreground",
      )}
      {...eventPressProps(event)}
    >
      {renderChip ? renderChip(event, eventIndex) : (
        <Typography variant="small" className="truncate font-medium">
          {label}
        </Typography>
      )}
    </Box>
    );
  };

  return contentSurface.provide(
    <Box
      {...domPassthrough(rest)}
      className={cn(contentSurface.className && cn(contentSurface.className, 'p-card-sm'), className)}
      {...(swipeLeftEvent || swipeRightEvent ? {
        onPointerDown: swipe.onPointerDown,
        onPointerMove: swipe.onPointerMove,
        onPointerUp: swipe.onPointerUp,
        onPointerCancel: swipe.onPointerCancel,
      } : {})}
    >
      {/* Day-pager nav. Hidden when the full week fits (laptop+), shown
          on mobile + tablet so users can scan all 7 days without the
          grid ever needing a horizontal scrollbar. */}
      {visibleCount < 7 && (
        <HStack align="center" justify="between" className="mb-2 px-2">
          <Button
            variant="ghost"
            size="sm"
            icon="chevron-left"
            onClick={stepPrev}
            aria-disabled={!canPrev || undefined}
            aria-label={t('aria.previousDays')}
          >
            {t('nav.previous')}
          </Button>
          <Typography variant="small" className="text-muted-foreground">
            {formatDateRange(visibleDays[0], visibleDays[visibleDays.length - 1], locale)}
          </Typography>
          <Button
            variant="ghost"
            size="sm"
            iconRight="chevron-right"
            onClick={stepNext}
            aria-disabled={!canNext || undefined}
            aria-label={t('aria.nextDays')}
          >
            {t('nav.next')}
          </Button>
        </HStack>
      )}

      <Box>
        {/* Day Headers */}
        <Box className={cn('grid border-b border-border', gridColsClass)}>
          {/* Empty top-left corner for time column */}
          <Box className="p-2" />
          {visibleDays.map((day) => {
            const isToday = day.toDateString() === new Date().toDateString();
            const count = eventsForDayCount(day);

            return (
              <Box
                key={day.toISOString()}
                className="border-l border-border"
              >
                <DayCell
                  date={day}
                  isToday={isToday}
                  onClick={onDayClick}
                />
                {count > 0 && (
                  <Box className="text-center pb-1">
                    <Badge variant="default" size="sm">
                      {count}
                    </Badge>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>

        {/* Time Slots */}
        <Box className="max-h-[500px] overflow-y-auto">
          {resolvedTimeSlots.map((time) => (
            <Box
              key={time}
              className={cn('grid border-b border-border', gridColsClass)}
            >
              {/* Time label */}
              <Box className="p-2 text-right pr-3">
                <Typography
                  variant="small"
                  className="text-muted-foreground"
                >
                  {time}
                </Typography>
              </Box>

              {/* Day cells */}
              {visibleDays.map((day) => {
                const slotEvents = evs.filter((ev) =>
                  eventInSlot(ev, day, time, startField),
                );
                const continuingEvents = evs.filter((ev) =>
                  eventContinuesInSlot(ev, day, time, startField, endField),
                );
                const isToday =
                  day.toDateString() === new Date().toDateString();

                return (
                  <TimeSlotCell
                    key={`${day.toISOString()}-${time}`}
                    time={time}
                    data-testid={`time-slot-${time}`}
                    isOccupied={slotEvents.length > 0 || continuingEvents.length > 0}
                    onClick={() => handleSlotClick(day, time)}
                    className={cn(
                      "border-l border-border",
                      isToday && "bg-primary/10",
                    )}
                    {...(longPressEvent ? {
                      onPointerDown: () => startLongPress(day, time),
                      onPointerUp: clearLongPress,
                      onPointerCancel: clearLongPress,
                      onPointerLeave: clearLongPress,
                    } : {})}
                  >
                    <VStack gap="xs">
                      {slotEvents.map(renderEvent)}
                      {continuingEvents.map((event) => {
                        const color = getNestedValue(event, colorField) as string | undefined;
                        return (
                          <Box
                            key={`${event.id as string}-cont`}
                            rounded="sm"
                            border
                            className={cn(
                              "cursor-pointer h-2",
                              color ? cn(color, "opacity-50") : "bg-primary/10 border-primary/20",
                            )}
                            {...eventPressProps(event)}
                            aria-label={onEventClick ? String(getNestedValue(event, titleField) ?? '') : undefined}
                          />
                        );
                      })}
                    </VStack>
                  </TimeSlotCell>
                );
              })}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

CalendarGrid.displayName = "CalendarGrid";