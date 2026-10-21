'use client';
/**
 * AnimatedCounter Molecule Component
 *
 * Counts up to a target value once it scrolls into view, then eases between
 * later value changes. Optional label below the number.
 */

import type { A11yProps } from '@almadar/core';
import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../../../core';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { useFormatContext } from '../../../core';
import { formatValue, type FormatContext } from '../../../core';

import { domPassthrough } from '../../../core';
export interface AnimatedCounterProps extends A11yProps {
  /** Target value. Strings may carry display affixes (e.g. "500+", "99.9%", "$1.2M"). */
  value: string | number;
  /** Label displayed below the number */
  label?: string;
  /** Animation duration in ms */
  duration?: number;
  /** Text displayed before the number */
  prefix?: string;
  /** Text displayed after the number */
  suffix?: string;
  /** "number" (locale grouping), "currency" (locale currency), "percent" (rounded %). Unset keeps the value's own decimals. */
  format?: string;
  /** Additional class names */
  className?: string;
}

interface ParsedValue {
  num: number | null;
  prefix: string;
  suffix: string;
  decimals: number;
}

function parseValue(value: string | number): ParsedValue {
  if (typeof value === 'number') {
    const decimals = Number.isInteger(value) ? 0 : String(value).split('.')[1]?.length ?? 0;
    return { num: value, prefix: '', suffix: '', decimals };
  }
  const match = String(value ?? '').match(/^([^0-9-]*)(-?[0-9]+(?:\.[0-9]+)?)(.*)$/);
  if (!match) return { num: null, prefix: '', suffix: String(value ?? ''), decimals: 0 };
  const numStr = match[2];
  const dot = numStr.indexOf('.');
  return {
    prefix: match[1],
    num: parseFloat(numStr),
    suffix: match[3],
    decimals: dot >= 0 ? numStr.length - dot - 1 : 0,
  };
}

function formatNumber(value: number, format: string | undefined, decimals: number, fmt: FormatContext): string {
  switch (format) {
    case 'currency':
      return formatValue(value, 'currency', fmt);
    case 'percent':
      return formatValue(Math.round(value), 'percent', fmt);
    case 'number':
      return formatValue(Math.round(value), 'number', fmt);
    default:
      return new Intl.NumberFormat(fmt.locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: false,
      }).format(value);
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export const AnimatedCounter: React.FC<AnimatedCounterProps> = ({
  value,
  label,
  duration = 1500,
  prefix,
  suffix,
  format,
  className,
  ...rest
}) => {
  const fmt = useFormatContext();
  const ref = useRef<HTMLDivElement>(null);
  const parsed = parseValue(value);
  const target = parsed.num ?? 0;
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const [display, setDisplay] = useState(() => (typeof IntersectionObserver === 'undefined' ? target : 0));
  const shownRef = useRef(display);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const from = shownRef.current;
    if (from === target || prefersReducedMotion() || typeof requestAnimationFrame === 'undefined') {
      shownRef.current = target;
      setDisplay(target);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (target - from) * eased;
      shownRef.current = current;
      setDisplay(current);
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [visible, target, duration]);

  const text =
    parsed.num === null
      ? parsed.suffix
      : `${prefix ?? ''}${parsed.prefix}${formatNumber(display, format, parsed.decimals, fmt)}${parsed.suffix}${suffix ?? ''}`;

  return (
    <Box {...domPassthrough(rest)} ref={ref} className={cn('flex flex-col items-center gap-1', className)}>
      <Typography variant="h2" className="text-primary tabular-nums">
        {text}
      </Typography>
      {label ? (
        <Typography variant="body2" color="muted" className="text-center">
          {label}
        </Typography>
      ) : null}
    </Box>
  );
};

AnimatedCounter.displayName = 'AnimatedCounter';
