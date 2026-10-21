'use client';
/**
 * TagInput Molecule Component
 *
 * Free-form chip editor for `string[]` values. The user types into an
 * `Input` and presses Enter to commit; each committed value renders as
 * a removable `Badge` (`onRemove` X-chip). Backspace on an empty input
 * deletes the most recently added chip. Optional `unique` flag
 * (default true) suppresses duplicate entries.
 *
 * **Atomic Design**: Composed using `Input`, `Badge`, `Typography`,
 * `HStack`, `VStack` atoms — no raw HTML. Generic primitive; no entity
 * binding.
 *
 * Event contract (mirrors DataList / FilterGroup):
 * - Emits `UI:{addEvent}` with `{ tag, value }` when a chip is added.
 * - Emits `UI:{removeEvent}` with `{ tag, index, value }` when a chip
 *   is removed.
 * - `onChange` callback stays as the direct / Storybook contract.
 *
 * Used by the studio Questionnaire for the `tagList` input type
 * (`[string]` config knobs without `enumValues`).
 */

import React, { useCallback, useState } from 'react';
import type { EventEmit, A11yProps } from '@almadar/core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { Input } from '../../../core';
import { Badge, type BadgeVariant } from '../../../core';
import { HStack, VStack } from '../../../core';
import { Typography } from '../../../core';

import { domPassthrough } from '../../../core';
export interface TagInputProps extends A11yProps {
  /** Current list of tags. */
  value: ReadonlyArray<string>;
  /** Direct callback emitted on every change. Stays as the
   *  Storybook / non-trait contract; trait-driven schemas should prefer
   *  the bus events below. */
  onChange?: (next: ReadonlyArray<string>) => void;
  /** Placeholder for the entry input. Default: `"Type and press Enter…"`. */
  placeholder?: string;
  /** Disable add + remove interactions. */
  disabled?: boolean;
  /** Variant applied to each chip Badge. Default: `'default'`. */
  variant?: BadgeVariant;
  /** Suppress duplicate entries. Default: `true`. */
  unique?: boolean;
  /** Helper text rendered under the input. */
  helperText?: string;
  /** Additional CSS classes applied to the outer container. */
  className?: string;
  /** Event emitted when a tag is added: `UI:{addEvent}` with payload
   *  `{ tag: string, value: string[] }`. */
  addEvent?: EventEmit<{ tag: string; value: string[] }>;
  /** Event emitted when a tag is removed: `UI:{removeEvent}` with
   *  payload `{ tag: string, index: number, value: string[] }`. */
  removeEvent?: EventEmit<{ tag: string; index: number; value: string[] }>;
}

export const TagInput: React.FC<TagInputProps> = ({
  value,
  onChange,
  placeholder,
  disabled = false,
  variant = 'default',
  unique = true,
  helperText,
  className,
  addEvent,
  removeEvent,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const [draft, setDraft] = useState('');

  const commit = useCallback(() => {
    const tag = draft.trim();
    if (!tag) return;
    if (unique && value.includes(tag)) {
      setDraft('');
      return;
    }
    const next = [...value, tag];
    onChange?.(next);
    if (addEvent) {
      eventBus.emit(`UI:${addEvent}`, { tag, value: next });
    }
    setDraft('');
  }, [draft, value, onChange, unique, addEvent, eventBus]);

  const removeAt = useCallback(
    (index: number) => {
      if (disabled) return;
      const tag = value[index];
      const next = value.slice();
      next.splice(index, 1);
      onChange?.(next);
      if (removeEvent) {
        eventBus.emit(`UI:${removeEvent}`, { tag, index, value: next });
      }
    },
    [value, onChange, disabled, removeEvent, eventBus],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (
        e.key === 'Backspace' &&
        draft.length === 0 &&
        value.length > 0
      ) {
        e.preventDefault();
        removeAt(value.length - 1);
      }
    },
    [commit, draft.length, value, removeAt, disabled],
  );

  return (
    <VStack {...domPassthrough(rest)} gap="xs" className={cn('w-full', className)}>
      {value.length > 0 ? (
        <HStack gap="xs" className="flex-wrap">
          {value.map((tag, index) => (
            <Badge
              key={`${tag}-${index}`}
              variant={variant}
              size="sm"
              onRemove={disabled ? undefined : () => removeAt(index)}
              removeLabel={t('tagInput.removeTag', { tag })}
            >
              {tag}
            </Badge>
          ))}
        </HStack>
      ) : null}
      <Input
        value={draft}
        placeholder={placeholder ?? t('tagInput.placeholder')}
        disabled={disabled}
        onChange={(e) =>
          setDraft((e.target as HTMLInputElement).value)
        }
        onKeyDown={handleKeyDown}
      />
      {helperText ? (
        <Typography variant="caption" color="muted">
          {helperText}
        </Typography>
      ) : null}
    </VStack>
  );
};

TagInput.displayName = 'TagInput';
