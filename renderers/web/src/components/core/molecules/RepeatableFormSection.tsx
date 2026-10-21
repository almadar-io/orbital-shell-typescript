'use client';
/**
 * RepeatableFormSection
 *
 * A form section that can be repeated multiple times.
 * Used for collecting multiple entries (participants, findings, etc.)
 *
 * Enhanced with trackAddedInState for inspection audit trails.
 *
 * Event Contract:
 * - Emits: UI:SECTION_ADDED { sectionType, index, addedInState? }
 * - Emits: UI:SECTION_REMOVED { sectionType, index, itemId }
 */

import React, { useCallback } from "react";
import type { EventPayload, JsonValue, A11yProps } from "@almadar/core";
import { cn } from '../../../core';
import { Box } from '../../../core';
import { VStack, HStack } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';
import { Card } from '../../../core';
import { Icon } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
export type RepeatableItem = {
  id: string;
  /** State in which this item was added (for audit trails). Optional — only
   *  consumers using `trackAddedInState`/`showAuditInfo` populate it. */
  addedInState?: string | null;
  /** Timestamp when item was added. Optional — see `addedInState`. */
  addedAt?: string | null;
  // Dynamic per-item fields (the consumer's spread payload). `| undefined`
  // admits the optional audit fields above and reflects that arbitrary-key
  // access may be absent.
  [key: string]: JsonValue | undefined;
};

/**
 * RepeatableFormSection — a form section that repeats a fixed group of fields,
 * letting the user add or remove entries.
 *
 * @capabilities dynamic line items, repeatable field group, add/remove entry rows, multi-entry form block
 */
export interface RepeatableFormSectionProps extends A11yProps {
  /** Section type identifier */
  sectionType: string;
  /** Section title */
  title: string;
  /** Items in the section */
  items: RepeatableItem[];
  /** Render function for each item. In .lolo: renderItem: (fn item <Component …={@item.field}/>), binding per-item fields via @item.field. */
  renderItem: (item: RepeatableItem, index: number) => React.ReactNode;
  /** Minimum items required */
  minItems?: number;
  /** Maximum items allowed */
  maxItems?: number;
  /** Allow reordering */
  allowReorder?: boolean;
  /** Add button label */
  addLabel?: string;
  /** Empty state message */
  emptyMessage?: string;
  /** Read-only mode */
  readOnly?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Add handler */
  onAdd?: () => void;
  /** Remove handler */
  onRemove?: (itemId: string, index: number) => void;
  /** Reorder handler */
  onReorder?: (fromIndex: number, toIndex: number) => void;

  // Inspection-specific enhancements
  /** Track the state in which items are added (for inspection audit) */
  trackAddedInState?: boolean;
  /** Current inspection state (used when trackAddedInState is true) */
  currentState?: string;
  /** Show audit metadata (addedInState, addedAt) */
  showAuditInfo?: boolean;
}

export const RepeatableFormSection: React.FC<RepeatableFormSectionProps> = ({
  sectionType,
  title,
  items,
  renderItem,
  minItems = 0,
  maxItems = Infinity,
  allowReorder = false,
  addLabel,
  emptyMessage,
  readOnly = false,
  className,
  onAdd,
  onRemove,
  onReorder,
  trackAddedInState = false,
  currentState,
  showAuditInfo = false,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t, locale } = useTranslate();
  const resolvedAddLabel = addLabel ?? t('common.add');
  const resolvedEmptyMessage = emptyMessage ?? t('empty.noItemsAdded');

  const safeItems = items ?? [];
  const canAdd = !readOnly && safeItems.length < maxItems;
  const canRemove = !readOnly && safeItems.length > minItems;

  const handleAdd = useCallback(() => {
    onAdd?.();

    const eventPayload: EventPayload = {
      sectionType,
      index: safeItems.length,
    };

    // Include state tracking info if enabled
    if (trackAddedInState && currentState) {
      eventPayload.addedInState = currentState;
      eventPayload.addedAt = new Date().toISOString();
    }

    eventBus.emit("UI:SECTION_ADDED", eventPayload);
  }, [
    sectionType,
    safeItems.length,
    onAdd,
    eventBus,
    trackAddedInState,
    currentState,
  ]);

  const handleRemove = useCallback(
    (itemId: string, index: number) => {
      onRemove?.(itemId, index);
      eventBus.emit("UI:SECTION_REMOVED", { sectionType, index, itemId });
    },
    [sectionType, onRemove, eventBus],
  );

  const canReorder = allowReorder && !readOnly;
  const handleMove = useCallback(
    (fromIndex: number, toIndex: number) => onReorder?.(fromIndex, toIndex),
    [onReorder],
  );

  return (
    <VStack {...domPassthrough(rest)} gap="md" className={cn("w-full", className)}>
      {/* Header */}
      <HStack justify="between" align="center">
        <HStack gap="sm" align="center">
          <Typography variant="h4">{title}</Typography>
          <Typography variant="caption" color="muted">
            ({safeItems.length}
            {maxItems !== Infinity ? `/${maxItems}` : ""})
          </Typography>
        </HStack>

        {canAdd && (
          <Button variant="secondary" size="sm" onClick={handleAdd}>
            <Icon name="plus" size="sm" className="mr-1" />
            {resolvedAddLabel}
          </Button>
        )}
      </HStack>

      {/* Items */}
      {safeItems.length === 0 ? (
        <Card className="p-6">
          <VStack align="center" gap="sm">
            <Typography variant="body" color="muted">
              {resolvedEmptyMessage}
            </Typography>
            {canAdd && (
              <Button variant="primary" size="sm" onClick={handleAdd}>
                <Icon name="plus" size="sm" className="mr-1" />
                {resolvedAddLabel}
              </Button>
            )}
          </VStack>
        </Card>
      ) : (
        <VStack gap="sm">
          {safeItems.map((item, index) => (
            <Card key={item.id} className="p-4">
              <VStack gap="sm">
                {/* Audit info header */}
                {showAuditInfo && (item.addedInState || item.addedAt) && (
                  <HStack
                    justify="between"
                    align="center"
                    className="pb-2 border-b border-border"
                  >
                    <HStack gap="sm" align="center">
                      {item.addedInState && (
                        <Typography variant="caption" color="muted">
                          {t('repeatable.addedIn')}{" "}
                          <Typography
                            as="span"
                            variant="caption"
                            weight="semibold"
                          >
                            {item.addedInState}
                          </Typography>
                        </Typography>
                      )}
                    </HStack>
                    {item.addedAt && (
                      <Typography variant="caption" color="muted">
                        {new Date(item.addedAt).toLocaleString(locale)}
                      </Typography>
                    )}
                  </HStack>
                )}

                <HStack gap="sm" align="start">
                  {canReorder && (
                    <VStack gap="none">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="chevron-up"
                        aria-label={t('common.moveUp')}
                        disabled={index === 0}
                        onClick={() => handleMove(index, index - 1)}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="chevron-down"
                        aria-label={t('common.moveDown')}
                        disabled={index === safeItems.length - 1}
                        onClick={() => handleMove(index, index + 1)}
                      />
                    </VStack>
                  )}

                  {/* Item content */}
                  <Box className="flex-1">{renderItem(item, index)}</Box>

                  {/* Remove button */}
                  {canRemove && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemove(item.id, index)}
                      aria-label={t('common.remove')}
                      className="text-foreground hover:bg-error/10"
                    >
                      <Icon name="trash-2" size="sm" />
                    </Button>
                  )}
                </HStack>
              </VStack>
            </Card>
          ))}
        </VStack>
      )}

      {/* Min items warning */}
      {safeItems.length < minItems && (
        <Typography variant="caption" color="warning">
          {minItems === 1
            ? t('repeatable.minItemsOne')
            : t('repeatable.minItems', { count: minItems })}
        </Typography>
      )}
    </VStack>
  );
};

RepeatableFormSection.displayName = "RepeatableFormSection";
