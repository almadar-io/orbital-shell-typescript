'use client';
/**
 * SearchInput Molecule Component
 *
 * A search input component with icon, clear button, and loading state.
 * Uses Input, Icon, Button, and Spinner atoms.
 *
 * Supports Query Singleton pattern via `query` prop for std/Search behavior.
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { A11yProps, EventEmit } from '@almadar/core';
import { Search } from 'lucide-react';
import { Input } from '../../../core';
import { Spinner } from '../../../core';
import { Box } from '../../../core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useQuerySingleton } from '../../../hooks/useQuerySingleton';
import { useTranslate } from '../../../core';

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
  ...props
}) => {
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

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setSearchValue(newValue);

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    const timer = setTimeout(() => {
      // Update query singleton if connected
      if (queryState) {
        queryState.setSearch(newValue);
      }

      // Call callback if provided
      onSearch?.(newValue);

      // Emit event if event name is provided (schema-driven). A knob left at
      // the canonical default emits once via the generic UI:SEARCH below, not
      // twice.
      if (event && event !== 'SEARCH') {
        eventBus.emit(`UI:${event}`, { searchTerm: newValue, entity });
      }

      // Emit generic UI:SEARCH for entity lists/tables/grids when entity, event, or query is configured
      if (event || entity || query) {
        eventBus.emit('UI:SEARCH', { searchTerm: newValue, entity, query });
      }
    }, debounceMs);

    setDebounceTimer(timer);
  }, [onSearch, debounceMs, debounceTimer, event, entity, query, eventBus, queryState]);

  const handleClear = useCallback(() => {
    setSearchValue('');

    // Update query singleton if connected
    if (queryState) {
      queryState.setSearch('');
    }

    onSearch?.('');

    // Emit clear search event
    if (event || query) {
      eventBus.emit('UI:CLEAR_SEARCH', { searchTerm: '', entity, query });
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
  }, [onSearch, debounceTimer, event, query, entity, eventBus, queryState]);

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
        className="pr-10"
        {...props}
      />
      {isLoading && (
        <Box className="absolute right-3 top-1/2 -translate-y-1/2">
          <Spinner size="sm" color="primary" />
        </Box>
      )}
    </Box>
  );
};

SearchInput.displayName = 'SearchInput';

