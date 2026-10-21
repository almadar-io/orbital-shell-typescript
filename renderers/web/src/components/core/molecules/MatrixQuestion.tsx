'use client';

import React, { useCallback } from "react";
import type { EventEmit, A11yProps } from '@almadar/core';
import { cn } from '../../../core';
import { Typography } from '../../../core';
import { Box } from '../../../core';
import { Radio } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
export interface MatrixRow {
  id: string;
  label: string;
}

export interface MatrixColumn {
  value: number | string;
  label: string;
}

export interface MatrixQuestionProps extends A11yProps {
  /** Optional title rendered above the matrix */
  title?: string;
  /** Question rows */
  rows: MatrixRow[];
  /** Column definitions; defaults to 5-point Likert */
  columns?: MatrixColumn[];
  /** Selected value per row, keyed by rowId */
  values?: Record<string, number | string>;
  /** Change handler invoked with rowId and selected column value */
  onChange?: (rowId: string, value: number | string) => void;
  /** Event name dispatched via event bus when a row's value changes. Payload: { rowId, value } */
  changeEvent?: EventEmit<{ rowId: string; value: number | string }>;
  /** Disable all inputs */
  disabled?: boolean;
  /** Visual size */
  size?: 'sm' | 'md';
  /** Additional CSS classes */
  className?: string;
}

export const DEFAULT_MATRIX_COLUMN_KEYS: ReadonlyArray<{ value: number | string; labelKey: string }> = [
  { value: 1, labelKey: "likert.stronglyDisagree" },
  { value: 2, labelKey: "likert.disagree" },
  { value: 3, labelKey: "likert.neutral" },
  { value: 4, labelKey: "likert.agree" },
  { value: 5, labelKey: "likert.stronglyAgree" },
];

const sizeStyles = {
  sm: {
    cell: "px-2 py-1.5 text-xs",
    radio: "sm" as const,
    label: "text-xs",
  },
  md: {
    cell: "px-3 py-2 text-sm",
    radio: "md" as const,
    label: "text-sm",
  },
} as const;

export const MatrixQuestion: React.FC<MatrixQuestionProps> = ({
  title,
  rows,
  columns: columnsProp,
  values,
  onChange,
  changeEvent,
  disabled = false,
  size = "md",
  className,
  ...rest
}) => {
  const styles = sizeStyles[size];
  const safeRows = rows ?? [];
  const safeValues = values ?? {};
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const columns: MatrixColumn[] =
    columnsProp ?? DEFAULT_MATRIX_COLUMN_KEYS.map((c) => ({ value: c.value, label: t(c.labelKey) }));

  const handleChange = useCallback(
    (rowId: string, value: number | string) => {
      if (disabled) return;
      onChange?.(rowId, value);
      if (changeEvent) {
        eventBus.emit(`UI:${changeEvent}`, { rowId, value });
      }
    },
    [onChange, changeEvent, eventBus, disabled],
  );

  return (
    <Box {...domPassthrough(rest)} className={cn("w-full", className)}>
      {title && (
        <Typography variant="h4" className="mb-3">
          {title}
        </Typography>
      )}
      <Box overflow="auto" className="overflow-x-auto">
        <Box as="table" className="w-full border-collapse">
          <Box as="thead">
            <Box as="tr" className="border-b border-border">
              <Box
                as="th"
                role="columnheader"
                className={cn("text-left font-medium text-muted-foreground", styles.cell)}
              />
              {columns.map((col) => (
                <Box
                  as="th"
                  key={String(col.value)}
                  role="columnheader"
                  className={cn(
                    "text-center font-medium text-muted-foreground",
                    styles.cell,
                  )}
                >
                  {col.label}
                </Box>
              ))}
            </Box>
          </Box>
          <Box as="tbody">
            {safeRows.map((row, idx) => {
              const groupName = `matrix-${row.id}`;
              const selected = safeValues[row.id];
              return (
                <Box
                  as="tr"
                  key={row.id}
                  className={cn(
                    "border-b border-border",
                    idx % 2 === 1 && "bg-muted/30",
                  )}
                >
                  <Box
                    as="th"
                    role="rowheader"
                    className={cn(
                      "text-left font-normal text-foreground",
                      styles.cell,
                      styles.label,
                    )}
                  >
                    {row.label}
                  </Box>
                  {columns.map((col) => {
                    const isChecked = selected !== undefined && selected === col.value;
                    const inputId = `${groupName}-${String(col.value)}`;
                    return (
                      <Box
                        as="td"
                        key={String(col.value)}
                        className={cn("text-center", styles.cell)}
                      >
                        <Box
                          display="inline-flex"
                          className={cn(
                            "items-center justify-center",
                            disabled && "opacity-60",
                          )}
                        >
                          <Radio
                            id={inputId}
                            name={groupName}
                            value={String(col.value)}
                            checked={isChecked}
                            disabled={disabled}
                            size={styles.radio}
                            onChange={() => handleChange(row.id, col.value)}
                            aria-label={`${row.label}: ${col.label}`}
                          />
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

MatrixQuestion.displayName = "MatrixQuestion";
