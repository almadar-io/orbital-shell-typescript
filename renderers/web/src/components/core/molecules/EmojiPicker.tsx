'use client';
/**
 * EmojiPicker Molecule Component
 *
 * Emoji chooser for composers and reaction bars: a trigger icon button that
 * opens a popover holding a searchable, categorized grid of the full emojilib
 * set, built on GridPicker + Popover with a Button trigger. Picking an emoji
 * emits `UI:{pickEvent}` with `{ emoji }` on the event bus and closes the
 * panel — one declarative contract, mirroring TableView's `itemClickEvent`.
 */

import React, { useEffect, useState } from 'react';
import type { EventEmit, A11yProps } from '@almadar/core';
import type { EmojiPickPayload } from '@almadar/core/patterns';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { Button } from '../../../core';
import type { IconInput } from '../../../core';
import { GridPicker, type PickerItem } from './GridPicker';
import { Popover } from './Popover';

import { domPassthrough } from '../../../core';
let emojiItems: PickerItem[] | undefined;

function loadEmojiItems(): Promise<PickerItem[]> {
  if (emojiItems !== undefined) return Promise.resolve(emojiItems);
  return import('./emojiItems').then((m) => {
    emojiItems = m.EMOJI_ITEMS;
    return m.EMOJI_ITEMS;
  });
}

export type EmojiPickerPosition = 'top' | 'bottom';

export interface EmojiPickerProps extends A11yProps {
  /**
   * Declarative event name — picking an emoji emits UI:{pickEvent} with { emoji } via eventBus
   */
  pickEvent?: EventEmit<EmojiPickPayload>;

  /**
   * Which side of the trigger the panel opens on
   * @default 'top'
   */
  position?: EmojiPickerPosition;

  /**
   * Icon shown on the trigger button
   * @default 'smile'
   */
  triggerIcon?: IconInput;

  /**
   * Accessible label for the trigger button (the translated "Add emoji" when omitted)
   */
  triggerLabel?: string;

  /**
   * Additional CSS classes applied to the trigger button
   */
  className?: string;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({
  pickEvent,
  position = 'top',
  triggerIcon = 'smile',
  triggerLabel,
  className,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const label = triggerLabel ?? t('emojiPicker.addEmoji');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PickerItem[]>(emojiItems ?? []);

  useEffect(() => {
    if (!open || items.length > 0) return undefined;
    let live = true;
    void loadEmojiItems().then((loaded) => {
      if (live) setItems(loaded);
    });
    return () => {
      live = false;
    };
  }, [open, items.length]);

  const handlePick = (glyph: string) => {
    if (pickEvent !== undefined) {
      const payload: EmojiPickPayload = { emoji: glyph };
      eventBus.emit(`UI:${pickEvent}`, payload);
    }
    setOpen(false);
  };

  return (
    <Popover
      {...domPassthrough(rest)}
      position={position}
      trigger="click"
      showArrow={false}
      open={open}
      onOpenChange={setOpen}
      content={
        <GridPicker
          items={items}
          onChange={handlePick}
          searchPlaceholder={t('emojiPicker.search')}
          renderThumbnail={(item) => (
            <span className="text-xl leading-none" aria-hidden="true">
              {item.id}
            </span>
          )}
          cellSize={32}
          className="w-80"
        />
      }
    >
      <Button
        variant="ghost"
        icon={triggerIcon}
        aria-label={label}
        title={label}
        className={className}
        data-testid="emoji-picker-trigger"
      />
    </Popover>
  );
};

EmojiPicker.displayName = 'EmojiPicker';
