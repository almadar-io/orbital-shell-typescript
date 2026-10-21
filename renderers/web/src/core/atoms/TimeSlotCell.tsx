'use client';
/**
 * TimeSlotCell
 *
 * Calendar time slot atom. Renders a clickable container for a single
 * time slot that can hold event content via children.
 */
import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../lib/domPassthrough';
import React, { useCallback } from "react";
import { cn } from "../lib/cn";
import { Box } from "./Box";
import { pressableProps } from "../lib/pressable";

export interface TimeSlotCellProps extends A11yProps {
  /** Time label for this slot (e.g. "09:00") */
  time: string;
  /** Called when the slot is clicked */
  onClick?: (time: string) => void;
  /** Additional CSS classes */
  className?: string;
  /** Event content placed inside the slot */
  children?: React.ReactNode;
  /** Whether this slot contains an event */
  isOccupied?: boolean;
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>;
  onPointerCancel?: React.PointerEventHandler<HTMLDivElement>;
  /** @notification */
  onPointerLeave?: React.PointerEventHandler<HTMLDivElement>;
  "data-testid"?: string;
}

export function TimeSlotCell({
  time,
  onClick,
  className,
  children,
  isOccupied = false,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  "data-testid": testId,
  ...rest
}: TimeSlotCellProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onClick?.(time);
  }, [onClick, time]);
  const press = pressableProps(onClick ? handleClick : undefined);

  return (
    <Box
      className={cn(
        "p-1 min-h-[60px] cursor-pointer hover:bg-muted transition-colors",
        isOccupied && "bg-muted/30",
        className,
      )}
      {...domPassthrough(rest)}
      {...press}
      aria-label={rest['aria-label'] ?? (onClick ? time : undefined)}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
      data-testid={testId}
    >
      {children}
    </Box>
  );
}

TimeSlotCell.displayName = "TimeSlotCell";
