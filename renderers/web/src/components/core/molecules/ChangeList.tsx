'use client';
/**
 * ChangeList Molecule
 *
 * What changed in a version, in plain language: one card per added,
 * modified or removed thing, with before/after for a modification.
 */
import React from 'react';
import type { EventEmit, EventPayloadValue, A11yProps } from '@almadar/core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { Box } from '../../../core';
import { Button } from '../../../core';
import { Badge } from '../../../core';
import { Card } from '../../../core';
import { Icon } from '../../../core';
import { Typography } from '../../../core';
import { VStack, HStack } from '../../../core';

import { domPassthrough } from '../../../core';
export type ChangeType = 'added' | 'modified' | 'removed';

export interface ChangeListItem {
  type: ChangeType;
  title: string;
  description?: string;
  before?: string;
  after?: string;
}

/**
 * The plain-language changes in one version (added / modified / removed).
 *
 * @capabilities change summary, what changed, version changes, diff summary, release notes list, modification list
 */
export interface ChangeListProps extends A11yProps {
  /** The changes. Accepts a typed list or a render-ui payload binding. */
  changes: readonly ChangeListItem[] | EventPayloadValue;
  /** Emitted by a change's Inspect button. Payload: { title, type }. */
  inspectEvent?: EventEmit<{ title: string; type: ChangeType }>;
  className?: string;
}

const TYPE_STYLE: Record<ChangeType, { icon: string; badge: 'success' | 'warning' | 'error'; text: string }> = {
  added: { icon: 'plus-circle', badge: 'success', text: 'text-success' },
  modified: { icon: 'edit-3', badge: 'warning', text: 'text-warning' },
  removed: { icon: 'minus-circle', badge: 'error', text: 'text-error' },
};

function isChangeListItem(value: ChangeListItem | EventPayloadValue): value is ChangeListItem {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) &&
    'title' in value && typeof value.title === 'string' &&
    'type' in value && (value.type === 'added' || value.type === 'modified' || value.type === 'removed')
  );
}

function toItems(value: readonly ChangeListItem[] | EventPayloadValue): readonly ChangeListItem[] {
  if (!Array.isArray(value)) return [];
  const out: ChangeListItem[] = [];
  for (const item of value) if (isChangeListItem(item)) out.push(item);
  return out;
}

export const ChangeList: React.FC<ChangeListProps> = ({ changes, inspectEvent, className, ...rest }) => {
  const { t } = useTranslate();
  const eventBus = useEventBus();
  const items = toItems(changes);

  if (items.length === 0) {
    return (
      <Box {...domPassthrough(rest)} className={cn('py-6', className)} data-testid="change-list-empty">
        <Typography variant="body2" color="muted" align="center">{t('changeList.empty')}</Typography>
      </Box>
    );
  }

  return (
    <VStack {...domPassthrough(rest)} gap="sm" className={className}>
      {items.map((change, idx) => {
        const style = TYPE_STYLE[change.type];
        return (
          <Card key={`${change.title}-${idx}`} data-testid="change-list-item" data-change-type={change.type}>
            <VStack gap="xs" className="p-3">
              <HStack gap="sm" align="center" className="min-w-0">
                <Icon name={style.icon} size="sm" className={style.text} />
                <Typography variant="body2" weight="semibold" className="truncate">{change.title}</Typography>
                <Badge variant={style.badge} size="sm">{t(`changeList.${change.type}`)}</Badge>
              </HStack>
              {change.description && <Typography variant="caption" color="muted">{change.description}</Typography>}
              {change.type === 'modified' && (change.before || change.after) && (
                <HStack gap="sm" align="stretch">
                  {change.before && (
                    <Box className="flex-1 rounded-container border border-error/20 bg-error/5 p-2">
                      <Typography variant="caption" color="muted" weight="semibold">{t('changeList.before')}</Typography>
                      <Typography variant="caption" className="block font-mono whitespace-pre-wrap">{change.before}</Typography>
                    </Box>
                  )}
                  {change.after && (
                    <Box className="flex-1 rounded-container border border-success/20 bg-success/5 p-2">
                      <Typography variant="caption" color="muted" weight="semibold">{t('changeList.after')}</Typography>
                      <Typography variant="caption" className="block font-mono whitespace-pre-wrap">{change.after}</Typography>
                    </Box>
                  )}
                </HStack>
              )}
              {inspectEvent && (
                <Box>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="external-link"
                    onClick={() => eventBus.emit(`UI:${inspectEvent}`, { title: change.title, type: change.type })}
                  >
                    {t('changeList.inspect')}
                  </Button>
                </Box>
              )}
            </VStack>
          </Card>
        );
      })}
    </VStack>
  );
};

ChangeList.displayName = 'ChangeList';
