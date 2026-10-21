'use client';
/**
 * CommandPalette Molecule Component
 *
 * VS Code-style command palette overlay (⌘K / ⌘⇧P): search field + filtered,
 * keyboard-navigable command list. Composes existing primitives rather than
 * reinventing them — Modal supplies the portal/overlay/focus-trap/Escape
 * machinery (`centered-card` look already positions the dialog near the top
 * of the viewport), the Input atom is the search field (same choice DocSearch
 * makes for a keyboard-driven dropdown), and rows follow Menu's row styling.
 * Registering the global ⌘K/⌘⇧P keybinding is the consuming app's job — this
 * is a controlled component only.
 */

import React, { useCallback, useMemo, useState } from 'react';
import type { EventKey, EventPayload, A11yProps } from '@almadar/core';
import { Box } from '../../../core';
import { VStack } from '../../../core';
import { Typography } from '../../../core';
import { Icon, type IconInput } from '../../../core';
import { Input } from '../../../core';
import { Badge } from '../../../core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { Modal } from './Modal';

import { domPassthrough } from '../../../core';
export interface CommandPaletteCommand {
  /** Unique command identifier */
  id: string;
  /** Command label */
  label: string;
  /** Lucide icon component or canonical kebab-case icon name string */
  icon?: IconInput;
  /** Keyboard shortcut hint rendered on the row's trailing edge (e.g. "⌘K") */
  shortcut?: string;
  /** Extra search terms matched alongside the label */
  keywords?: string[];
  /** Group heading this command is listed under. Commands sharing a group
   *  are rendered together, in the order the group first appears. */
  group?: string;
  /** Disable selection — dims the row, blocks click/Enter */
  disabled?: boolean;
  /** Declarative event name — emits `UI:{event}` with `{ commandId: id }` on
   *  select (mirrors FloatingToolbarItem's `event` convention) */
  event?: EventKey;
  /** Declarative action name — emits `UI:{action}` with `actionPayload` on
   *  select (mirrors FloatingToolbarItem's `action` convention) */
  action?: EventKey;
  /** Payload included with the `action` event
   *  @payloadFor action */
  actionPayload?: EventPayload;
}

export interface CommandPaletteProps extends A11yProps {
  /** Whether the palette overlay is open */
  open: boolean;
  /** Called to open/close the overlay (Escape, overlay click, or a selection) */
  onOpenChange: (open: boolean) => void;
  /** Commands listed in the palette, filtered as the user types */
  commands: CommandPaletteCommand[];
  /** Called with the selected command (click, or Enter on the highlighted row) */
  onSelect?: (command: CommandPaletteCommand) => void;
  /** Search field placeholder. Defaults to the translated "Type a command...". */
  placeholder?: string;
  /** Label shown when no command matches the query. Defaults to the translated message. */
  emptyLabel?: string;
  /** Additional CSS classes on the overlay's dialog */
  className?: string;
}

/** Case-insensitive subsequence match — every character of `query`, in
 *  order, somewhere in `text`. No fuzzy-matching dependency: a contiguous
 *  substring match is a subsequence match too, so this covers both. */
function matchesQuery(query: string, text: string): boolean {
  if (!query) return true;
  let qi = 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function commandMatches(command: CommandPaletteCommand, query: string): boolean {
  if (!query) return true;
  if (matchesQuery(query, command.label)) return true;
  return (command.keywords ?? []).some((keyword) => matchesQuery(query, keyword));
}

const UNGROUPED = Symbol('command-palette-ungrouped');

export interface DispatchCommandPaletteCommandDeps {
  emit: (type: string, payload?: EventPayload) => void;
  onSelect?: (command: CommandPaletteCommand) => void;
}

/** Turns a selected `CommandPaletteCommand` into bus emits + the `onSelect`
 *  callback. Extracted from `handleSelect` so a host can drive the same
 *  dispatch for a `COMMAND {id}` bus request without duplicating it. */
export function dispatchCommandPaletteCommand(
  command: CommandPaletteCommand,
  deps: DispatchCommandPaletteCommandDeps,
): void {
  if (command.disabled) return;
  if (command.event) deps.emit(`UI:${command.event}`, { commandId: command.id });
  if (command.action) deps.emit(`UI:${command.action}`, command.actionPayload ?? {});
  deps.onSelect?.(command);
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onOpenChange,
  commands,
  onSelect,
  placeholder: placeholderProp,
  emptyLabel: emptyLabelProp,
  className,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const placeholder = placeholderProp ?? t('commandPalette.placeholder');
  const emptyLabel = emptyLabelProp ?? t('commandPalette.noMatches');
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);

  const filtered = useMemo(
    () => commands.filter((command) => commandMatches(command, query)),
    [commands, query],
  );

  // Preserve first-seen group order; ungrouped commands render under no header.
  const groups = useMemo(() => {
    const order: (string | typeof UNGROUPED)[] = [];
    const byGroup = new Map<string | typeof UNGROUPED, CommandPaletteCommand[]>();
    for (const command of filtered) {
      const key = command.group ?? UNGROUPED;
      if (!byGroup.has(key)) {
        byGroup.set(key, []);
        order.push(key);
      }
      byGroup.get(key)!.push(command);
    }
    return order.map((key) => ({ group: key === UNGROUPED ? undefined : key, items: byGroup.get(key)! }));
  }, [filtered]);

  const resetQuery = useCallback(() => {
    setQuery('');
    setHighlightIndex(0);
  }, []);

  const handleClose = useCallback(() => {
    resetQuery();
    onOpenChange(false);
  }, [onOpenChange, resetQuery]);

  const handleSelect = useCallback(
    (command: CommandPaletteCommand) => {
      if (command.disabled) return;
      dispatchCommandPaletteCommand(command, { emit: eventBus.emit, onSelect });
      handleClose();
    },
    [eventBus, onSelect, handleClose],
  );

  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setQuery(e.target.value);
    setHighlightIndex(0);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (filtered.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const command = filtered[highlightIndex];
        if (command) handleSelect(command);
      }
    },
    [filtered, highlightIndex, handleSelect],
  );

  return (
    <Modal
      {...domPassthrough(rest)}
      isOpen={open}
      onClose={handleClose}
      onExited={resetQuery}
      showCloseButton={false}
      size="md"
      className={className}
    >
      <Box data-testid="command-palette">
        <VStack gap="sm">
          <Input
            inputType="search"
            placeholder={placeholder}
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            leftIcon="search"
            clearable={query.length > 0}
            onClear={resetQuery}
            autoFocus
            data-testid="command-palette-input"
          />

          {filtered.length === 0 ? (
            <Box className="px-2 py-6 text-center" data-testid="command-palette-empty">
              <Typography variant="body" color="muted">
                {emptyLabel}
              </Typography>
            </Box>
          ) : (
            <Box
              className="max-h-80 overflow-y-auto"
              role="listbox"
              aria-label={placeholder}
            >
              <VStack gap="none">
                {groups.map(({ group, items }) => (
                  <Box key={String(group ?? '__ungrouped__')}>
                    {group ? (
                      <Typography
                        variant="caption"
                        color="muted"
                        className="px-3 pt-2 pb-1 block"
                      >
                        {group}
                      </Typography>
                    ) : null}
                    {items.map((command) => {
                      const index = filtered.indexOf(command);
                      const isHighlighted = index === highlightIndex;
                      return (
                        <Box
                          key={command.id}
                          as="button"
                          role="option"
                          aria-selected={isHighlighted}
                          aria-disabled={command.disabled || undefined}
                          data-testid={`command-palette-item-${command.id}`}
                          onMouseEnter={() => !command.disabled && setHighlightIndex(index)}
                          onClick={() => handleSelect(command)}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2 text-start rounded-interactive',
                            'text-sm transition-colors',
                            'focus:outline-none',
                            'focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-ring focus-visible:ring-inset',
                            isHighlighted && 'bg-muted',
                            command.disabled && 'opacity-50 cursor-not-allowed',
                          )}
                        >
                          {command.icon ? (
                            <Icon icon={command.icon} size="sm" className="flex-shrink-0" />
                          ) : null}
                          <Typography variant="small" className="flex-1 truncate">
                            {command.label}
                          </Typography>
                          {command.shortcut ? (
                            <Badge variant="neutral" size="sm">
                              {command.shortcut}
                            </Badge>
                          ) : null}
                        </Box>
                      );
                    })}
                  </Box>
                ))}
              </VStack>
            </Box>
          )}
        </VStack>
      </Box>
    </Modal>
  );
};

CommandPalette.displayName = 'CommandPalette';

export default CommandPalette;
