'use client';
/**
 * CommitRow Molecule
 *
 * One entry of a version history: message, short sha, author, time, what
 * made it (a user save, an agent turn, a restore, an undo) and line stats.
 * Selecting the row and restoring to it are separate controls.
 */
import React, { useCallback } from 'react';
import type { EventEmit, A11yProps } from '@almadar/core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { Box } from '../../../core';
import { Button } from '../../../core';
import { Badge } from '../../../core';
import { Icon } from '../../../core';
import { Typography } from '../../../core';
import { VStack, HStack } from '../../../core';

import { domPassthrough } from '../../../core';
export type CommitKind = 'user' | 'agent' | 'restore' | 'undo' | 'redo' | 'snapshot' | 'merge';

const KIND_ICONS: Record<CommitKind, string> = {
  user: 'user',
  agent: 'sparkles',
  restore: 'rotate-ccw',
  undo: 'undo-2',
  redo: 'redo-2',
  snapshot: 'camera',
  merge: 'git-merge',
};

/**
 * One version in a history list — a commit row with select and restore.
 *
 * @capabilities version history row, commit entry, revision list item, change log entry, restore point, undo history item
 */
export interface CommitRowProps extends A11yProps {
  /** Commit id; the first 7 characters are shown, the whole id on hover. */
  sha: string;
  /** Commit message. */
  message: string;
  author?: string;
  /** Display time (already formatted, e.g. "2 min ago"). */
  timestamp?: string;
  /** What made this version (a user save, an agent turn, a restore, an undo/redo, a snapshot, a merge of a teammate's work). */
  kind?: CommitKind;
  additions?: number;
  deletions?: number;
  /** The row the user picked (shows its detail). */
  selected?: boolean;
  /** The version the app is at now — it cannot be restored to. */
  current?: boolean;
  /** Emitted when the row is picked. Payload: { sha }. */
  selectEvent?: EventEmit<{ sha: string }>;
  /** Emitted by the Restore button. Payload: { sha }. */
  restoreEvent?: EventEmit<{ sha: string }>;
  className?: string;
}

export const CommitRow: React.FC<CommitRowProps> = ({
  sha,
  message,
  author,
  timestamp,
  kind,
  additions,
  deletions,
  selected = false,
  current = false,
  selectEvent,
  restoreEvent,
  className,
  ...rest
}) => {
  const { t } = useTranslate();
  const eventBus = useEventBus();
  const shortSha = sha.length > 7 ? sha.substring(0, 7) : sha;

  const select = useCallback(() => {
    if (selectEvent) eventBus.emit(`UI:${selectEvent}`, { sha });
  }, [eventBus, selectEvent, sha]);

  return (
    <HStack {...domPassthrough(rest)} gap="sm" align="start" className={cn('rounded-interactive px-2 py-1.5', selected ? 'bg-muted' : 'hover:bg-muted', className)}>
      <Box
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        data-testid="commit-row"
        className="flex-1 min-w-0 cursor-pointer"
        onClick={select}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            select();
          }
        }}
      >
        <VStack gap="none" className="min-w-0">
          <HStack gap="xs" align="center" className="min-w-0">
            {kind && (
              <Box data-testid="commit-row-kind" data-kind={kind} className="flex-shrink-0" title={t(`commitRow.kind.${kind}`)}>
                <Icon name={KIND_ICONS[kind]} size="xs" className="text-muted-foreground" />
              </Box>
            )}
            <Typography variant="caption" className="truncate">{message}</Typography>
          </HStack>
          <HStack gap="xs" align="center" className="flex-wrap">
            <Box as="span" title={sha}>
              <Typography variant="caption" color="muted" className="font-mono text-[0.65rem]">{shortSha}</Typography>
            </Box>
            {author && <Typography variant="caption" color="muted">{author}</Typography>}
            {timestamp && <Typography variant="caption" color="muted">{timestamp}</Typography>}
            {additions !== undefined && <Badge variant="success" size="sm">+{additions}</Badge>}
            {deletions !== undefined && <Badge variant="error" size="sm">-{deletions}</Badge>}
            {current && (
              <Badge variant="default" size="sm" data-testid="commit-row-current">{t('commitRow.current')}</Badge>
            )}
          </HStack>
        </VStack>
      </Box>
      {restoreEvent && !current && (
        <Button
          variant="ghost"
          size="sm"
          icon="rotate-ccw"
          onClick={() => eventBus.emit(`UI:${restoreEvent}`, { sha })}
        >
          {t('commitRow.restore')}
        </Button>
      )}
    </HStack>
  );
};

CommitRow.displayName = 'CommitRow';
