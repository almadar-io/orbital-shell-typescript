'use client';
/**
 * SearchInput Molecule Component
 *
 * A search input component with icon, clear button, and loading state.
 * Uses Input, Icon, Button, and Spinner atoms.
 *
 * Supports Query Singleton pattern via `query` prop for std/Search behavior.
 */

import React, { useState, useCallback, useEffect, useId } from 'react';
import type { A11yProps, EventEmit } from '@almadar/core';
import { Search } from 'lucide-react';
import { Input } from '../../../core';
import { Spinner } from '../../../core';
import { Box } from '../../../core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useQuerySingleton } from '../../../hooks/useQuerySingleton';
import { useTranslate } from '../../../core';
import { Typography } from '../../../core';

/** One suggestion a search box offers while the viewer types. */
export interface SearchSuggestion {
  /** What the viewer reads. */
  label: string;
  /** What a pick carries to the program. */
  value: string;
  /** A quieter second line. */
  description?: string;
}

/**
 * @minWidth 160
 */
export interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | keyof A11yProps>, A11yProps {
  /**
   * Search value (controlled mode)
   */
  value?: string;

  /**
   * Callback when search value changes
   */
  onSearch?: (value: string) => void;

  /**
   * Debounce delay in milliseconds
   * @default 300
   */
  debounceMs?: number;

  /**
   * Show loading state
   * @default false
   */
  isLoading?: boolean;

  /**
   * Placeholder text (the translated "Search" when omitted)
   */
  placeholder?: string;

  /**
   * Show clear button
   * @default true
   */
  clearable?: boolean;

  /**
   * Additional CSS classes
   */
  className?: string;

  /** Declarative search event — emits UI:{event} via eventBus on query submit (alongside canonical UI:SEARCH) */
  event?: EventEmit<{ searchTerm: string; entity?: string }>;

  /**
   * Entity type for context-aware search.
   * When provided, search events include entity context.
   */
  entity?: string;

  /**
   * Query singleton binding for state management.
   * When provided, syncs search state with the query singleton.
   * Example: "@TaskQuery"
   */
  query?: string;

  /**
   * Suggestions to offer while the viewer types; the program narrows them to the text in the box. When given,
   * the box is a combobox: arrows move through the list, Enter or a click picks, Escape closes.
   */
  suggestions?: readonly SearchSuggestion[];

  /** Emitted as UI:{suggestionEvent} with `{ value, label }` when the viewer picks a suggestion. */
  suggestionEvent?: EventEmit<{ value: string; label: string }>;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onSearch,
  debounceMs = 300,
  isLoading = false,
  placeholder,
  clearable = true,
  className,
  event,
  entity,
  query,
  suggestions,
  suggestionEvent,
  ...props
}) => {
  const listId = useId();
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const resolvedPlaceholder = placeholder ?? t('common.search');
  const queryState = useQuerySingleton(query);

  // Initialize from query singleton or controlled value
  const initialValue = queryState?.search ?? value ?? '';
  const [searchValue, setSearchValue] = useState(initialValue);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  // Sync with query singleton changes
  useEffect(() => {
    if (queryState && queryState.search !== searchValue) {
      setSearchValue(queryState.search);
    }
  }, [queryState?.search]);

  const submit = useCallback((term: string) => {
    if (queryState) {
      queryState.setSearch(term);
    }
    onSearch?.(term);
    // A knob left at the canonical default emits once via the generic UI:SEARCH below, not twice.
    if (event && event !== 'SEARCH') {
      eventBus.emit(`UI:${event}`, { searchTerm: term, ...(entity !== undefined ? { entity } : {}) });
    }
    // The generic UI:SEARCH for entity lists, tables and grids when entity, event or query is configured.
    if (event || entity || query) {
      eventBus.emit('UI:SEARCH', { searchTerm: term, ...(entity !== undefined ? { entity } : {}), ...(query !== undefined ? { query } : {}) });
    }
  }, [onSearch, event, entity, query, eventBus, queryState]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setSearchValue(newValue);

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    setListOpen(true);
    setActive(-1);
    const timer = setTimeout(() => submit(newValue), debounceMs);

    setDebounceTimer(timer);
  }, [submit, debounceMs, debounceTimer]);

  const handleClear = useCallback(() => {
    setSearchValue('');

    // Update query singleton if connected
    if (queryState) {
      queryState.setSearch('');
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    setListOpen(false);
    setActive(-1);
    // A cleared box searches for nothing, so a list the search narrowed shows everything again.
    submit('');

    if (event || query) {
      eventBus.emit('UI:CLEAR_SEARCH', { searchTerm: '', ...(entity !== undefined ? { entity } : {}), ...(query !== undefined ? { query } : {}) });
    }
  }, [submit, debounceTimer, event, query, entity, eventBus]);

  const shown = suggestions ?? [];
  const listVisible = listOpen && shown.length > 0 && searchValue.trim() !== '';

  const pick = useCallback((suggestion: SearchSuggestion) => {
    setListOpen(false);
    setActive(-1);
    if (suggestionEvent) {
      eventBus.emit(`UI:${suggestionEvent}`, { value: suggestion.value, label: suggestion.label });
    }
  }, [suggestionEvent, eventBus]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (listVisible && e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % shown.length);
    } else if (listVisible && e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? shown.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setListOpen(false);
      setActive(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (listVisible && active >= 0 && shown[active]) {
        pick(shown[active]);
        return;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      setListOpen(false);
      submit(searchValue);
    }
  }, [listVisible, shown, active, pick, debounceTimer, submit, searchValue]);

  // Sync with controlled value prop
  useEffect(() => {
    if (value !== undefined && value !== searchValue && !query) {
      setSearchValue(value);
    }
  }, [value, query]);

  useEffect(() => {
    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [debounceTimer]);

  return (
    <Box className={cn('relative', className)}>
      <Input
        type="search"
        value={searchValue}
        onChange={handleChange}
        placeholder={resolvedPlaceholder}
        icon={Search}
        clearable={clearable && !isLoading}
        onClear={handleClear}
        aria-busy={isLoading || undefined}
        className="pr-10 [&::-webkit-search-cancel-button]:appearance-none"
        {...props}
        {...(suggestions !== undefined
          ? {
              role: 'combobox',
              'aria-autocomplete': 'list' as const,
              'aria-expanded': listVisible,
              'aria-controls': listId,
              ...(listVisible && active >= 0 ? { 'aria-activedescendant': `${listId}-${active}` } : {}),
            }
          : {})}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          handleKeyDown(e);
          props.onKeyDown?.(e);
        }}
        onFocus={(e: React.FocusEvent<HTMLInputElement>) => {
          setListOpen(true);
          props.onFocus?.(e);
        }}
        onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
          setListOpen(false);
          props.onBlur?.(e);
        }}
      />
      {listVisible && (
        <Box
          as="ul"
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full mt-1 z-30 max-h-72 overflow-y-auto rounded-container border-[length:var(--border-width)] border-border bg-card shadow-elevation-popover py-1"
        >
          {shown.map((suggestion, index) => (
            <Box
              as="li"
              key={suggestion.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(e: React.MouseEvent) => {
                e.preventDefault();
                pick(suggestion);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn('cursor-pointer px-3 py-2', index === active ? 'bg-muted' : undefined)}
            >
              <Typography variant="small" weight="medium">{suggestion.label}</Typography>
              {suggestion.description ? (
                <Typography variant="caption" color="muted" className="line-clamp-1">{suggestion.description}</Typography>
              ) : null}
            </Box>
          ))}
        </Box>
      )}
      {isLoading && (
        <Box className="absolute right-3 top-1/2 -translate-y-1/2">
          <Spinner size="sm" color="primary" />
        </Box>
      )}
    </Box>
  );
};

SearchInput.displayName = 'SearchInput';

