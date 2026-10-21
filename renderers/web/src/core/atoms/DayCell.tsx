'use client';
/**
 * DayCell
 *
 * Calendar day header atom. Renders day abbreviation and date number
 * with optional today highlight.
 */
import { domPassthrough } from '../lib/domPassthrough';
import type { A11yProps } from '@almadar/core';
import React, { useCallback } from "react";
import { cn } from "../lib/cn";
import { Box } from "./Box";
import { Typography } from "./Typography";
import { pressableProps } from "../lib/pressable";
import { useTranslate } from "../hooks/useTranslate";

export interface DayCellProps extends A11yProps {
  /** The date this cell represents. Optional at the dynamic render edge: an
   *  unbound `@config.date` arrives as `undefined`, so the cell falls back to today. */
  date?: Date;
  /** Whether this date is today */
  isToday?: boolean;
  /** Called when the day is clicked */
  onClick?: (date: Date) => void;
  /** Additional CSS classes */
  className?: string;
}

export function DayCell({
  date,
  isToday = false,
  onClick,
  className,
  ...rest
}: DayCellProps): React.JSX.Element {
  const { locale } = useTranslate();
  const safeDate =
    date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const handleClick = useCallback(() => {
    onClick?.(safeDate);
  }, [onClick, safeDate]);

  const dayAbbr = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(safeDate);
  const press = pressableProps(onClick ? handleClick : undefined);

  return (
    <Box
      className={cn(
        "p-2 text-center cursor-pointer hover:bg-muted transition-colors",
        isToday && "bg-primary/10",
        className,
      )}
      {...domPassthrough(rest)}
      {...press}
      aria-label={rest['aria-label'] ?? (onClick ? new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(safeDate) : undefined)}
    >
      <Typography
        variant="small"
        className={cn(
          "font-medium",
          isToday
            ? "text-primary"
            : "text-muted-foreground",
        )}
      >
        {dayAbbr}
      </Typography>
      <Box
        display="flex"
        rounded="full"
        className={cn(
          "h-8 w-8 mx-auto items-center justify-center",
          isToday && "bg-primary text-primary-foreground",
        )}
      >
        <Typography variant="body" className="font-semibold">
          {safeDate.getDate()}
        </Typography>
      </Box>
    </Box>
  );
}

DayCell.displayName = "DayCell";
