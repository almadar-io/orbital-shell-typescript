'use client';
/**
 * ActivityRail — a workspace's far-left rail. On desktop an icon column (each
 * item an `IconButton`: named, with a tooltip); inside `DockLayout`'s compact
 * variant (phones, tablets) the same items as labelled menu rows — picking one
 * shows its panel in the drawer, or closes the menu when the item opens no
 * panel (e.g. a tab or a dialog).
 *
 * - Emits: UI:{onChange} { id }
 */
import React from 'react';
import type { EventEmit } from '@almadar/core';
import { Box } from '../../../core';
import { Button } from '../../../core';
import { Icon, type IconInput } from '../../../core';
import { VStack } from '../../../core';
import { IconButton } from './IconButton';
import { useDockLayout } from '../organisms/layout/DockLayout';
import { useEventBus } from '../../../core';
import { cn } from '../../../core';

export interface ActivityRailItem {
  id: string;
  icon: IconInput;
  label: string;
  /** False for an item that opens no side panel (a tab, a dialog). @default true */
  opensPanel?: boolean;
}

export interface ActivityRailProps {
  /** The rail's items, top to bottom.
   * @example [{"id":"explorer","icon":"folder","label":"Explorer"},{"id":"cosmic","icon":"orbit","label":"Cosmic","opensPanel":false}]
   */
  items: readonly ActivityRailItem[];
  /** The id of the item whose panel is showing. */
  active: string;
  /** Emits UI:{onChange} with { id } when an item is picked. */
  onChange?: EventEmit<{ id: string }>;
  /** React hosts: called with the picked item's id. */
  onSelect?: (id: string) => void;
  /** Pinned to the bottom of the desktop column. */
  footer?: React.ReactNode;
  testId?: string;
  itemTestId?: (id: string) => string;
  className?: string;
}

export function ActivityRail({ items, active, onChange, onSelect, footer, testId, itemTestId, className }: ActivityRailProps): React.ReactElement {
  const { compact, showPanel, closeMenu } = useDockLayout();
  const eventBus = useEventBus();
  const pick = (id: string): void => {
    if (onChange) eventBus.emit(`UI:${onChange}`, { id });
    onSelect?.(id);
  };

  if (compact) {
    return (
      <VStack gap="xs" data-testid={testId} className={cn('w-full p-2', className)}>
        {items.map((item) => (
          <Button
            key={item.id}
            variant={active === item.id ? 'primary' : 'ghost'}
            aria-pressed={active === item.id}
            data-testid={itemTestId?.(item.id)}
            className="w-full h-12 justify-start gap-3"
            onClick={() => {
              pick(item.id);
              if (item.opensPanel === false) closeMenu();
              else showPanel();
            }}
          >
            <Icon icon={item.icon} size="sm" />
            {item.label}
          </Button>
        ))}
        {footer}
      </VStack>
    );
  }

  return (
    <Box bg="surface" data-testid={testId} className={cn('w-12 h-full flex flex-col items-center justify-between py-2', className)}>
      <VStack gap="xs" className="items-center">
        {items.map((item) => (
          <IconButton
            key={item.id}
            variant={active === item.id ? 'primary' : 'ghost'}
            icon={item.icon}
            label={item.label}
            aria-pressed={active === item.id}
            data-testid={itemTestId?.(item.id)}
            className="w-9 h-9"
            onClick={() => pick(item.id)}
          />
        ))}
      </VStack>
      {footer}
    </Box>
  );
}

ActivityRail.displayName = 'ActivityRail';

export default ActivityRail;
