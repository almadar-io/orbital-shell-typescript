'use client';
/**
 * ImportProgress Molecule
 *
 * Step indicator for the import job lifecycle
 * (fetching → mapping → reviewing → committing → done | failed) with
 * staged/committed/failed counts. Pure render — props in, events out.
 * Follows atomic design: composes Box, Badge, Icon, Typography atoms.
 */

import React from 'react';
import type { A11yProps } from '@almadar/core';
import { Box } from '../../../../core';
import { Badge } from '../../../../core';
import { Icon } from '../../../../core';
import { Typography } from '../../../../core';
import { cn } from '../../../../core';
import { domPassthrough } from '../../../../core';
import { useTranslate } from '../../../../core';

export type ImportProgressStep =
  | 'fetching'
  | 'mapping'
  | 'reviewing'
  | 'committing'
  | 'done'
  | 'failed';

export interface ImportProgressCounts {
  staged?: number;
  committed?: number;
  failed?: number;
}

export interface ImportProgressProps extends A11yProps {
  /** Current lifecycle step */
  step: ImportProgressStep;
  /** Unit counts */
  counts?: ImportProgressCounts;
  /** Step label overrides */
  labels?: Partial<Record<ImportProgressStep, string>>;
  /** Additional CSS classes */
  className?: string;
}

const PIPELINE: Exclude<ImportProgressStep, 'done' | 'failed'>[] = [
  'fetching',
  'mapping',
  'reviewing',
  'committing',
];

const DEFAULT_LABEL_KEYS: Record<ImportProgressStep, string> = {
  fetching: 'import.phase.fetching',
  mapping: 'import.phase.mapping',
  reviewing: 'import.phase.reviewing',
  committing: 'import.phase.committing',
  done: 'import.phase.done',
  failed: 'import.phase.failed',
};

export const ImportProgress: React.FC<ImportProgressProps> = ({
  step,
  counts,
  labels,
  className,
  ...rest
}) => {
  const { t } = useTranslate();
  const label = (key: ImportProgressStep) => labels?.[key] ?? t(DEFAULT_LABEL_KEYS[key]);
  const currentIndex = step === 'done' || step === 'failed' ? PIPELINE.length : PIPELINE.indexOf(step);

  return (
    <Box className={cn('flex flex-col gap-3', className)} {...domPassthrough(rest)}>
      <Box className="flex items-center gap-2">
        {PIPELINE.map((key, index) => {
          const isComplete = index < currentIndex;
          const isActive = index === currentIndex;
          return (
            <React.Fragment key={key}>
              {index > 0 ? <Box className="h-px w-4 bg-border" /> : null}
              <Box
                className="flex items-center gap-1"
                data-testid={`import-progress-step-${key}`}
                aria-current={isActive ? 'step' : undefined}
              >
                <Icon
                  icon={isComplete ? 'check' : isActive ? 'loader' : 'circle'}
                  size="sm"
                  className={cn(
                    isComplete ? 'text-success' : isActive ? 'text-primary' : 'text-muted-foreground',
                  )}
                />
                <Typography
                  variant="caption"
                  className={cn(isActive ? 'text-foreground' : 'text-muted-foreground')}
                >
                  {label(key)}
                </Typography>
              </Box>
            </React.Fragment>
          );
        })}
        {step === 'done' || step === 'failed' ? (
          <>
            <Box className="h-px w-4 bg-border" />
            <Box className="flex items-center gap-1" data-testid={`import-progress-step-${step}`}>
              <Icon
                icon={step === 'done' ? 'check' : 'x'}
                size="sm"
                className={step === 'done' ? 'text-success' : 'text-error'}
              />
              <Typography
                variant="caption"
                className={step === 'done' ? 'text-success' : 'text-error'}
              >
                {label(step)}
              </Typography>
            </Box>
          </>
        ) : null}
      </Box>
      {counts ? (
        <Box className="flex items-center gap-2">
          {counts.staged !== undefined ? (
            <Badge label={t('import.staged', { count: counts.staged })} />
          ) : null}
          {counts.committed !== undefined ? (
            <Badge variant="success" label={t('import.committed', { count: counts.committed })} />
          ) : null}
          {counts.failed !== undefined ? (
            <Badge variant="danger" label={t('import.failedCount', { count: counts.failed })} />
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
};

export default ImportProgress;
