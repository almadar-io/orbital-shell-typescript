'use client';
/**
 * RelationSelect Molecule Component
 *
 * A searchable select component for relation fields.
 * Allows users to search and select from related entities.
 *
 * Composed from: Box, HStack, VStack, Input, Button, Spinner, Typography atoms
 */

import type { A11yProps } from '@almadar/core';
import React, {
  useState,
  useId,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";
import { Search } from "lucide-react";
import { cn } from '../../../core';
import { Box } from '../../../core';
import { Icon } from '../../../core';
import { HStack, VStack } from '../../../core';
import { Input } from '../../../core';
import { Button } from '../../../core';
import { Spinner } from '../../../core';
import { Typography } from '../../../core';
import {
  debug,
  debugGroup,
  debugGroupEnd,
  isDebugEnabled,
} from "../../../lib/debug";
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
// Helper to check if specific debug category is enabled
const isRelationsDebugEnabled = () => isDebugEnabled();

/** Relation cardinality vocabulary — mirrors `@almadar/core`'s
 *  `RelationCardinality` (spelled inline: the pattern extractor resolves
 *  components-tree aliases to `enumValues`, but treats core imports as
 *  opaque). `many`/`one-to-many`/`many-to-many` drive multi-value pickers. */
export type RelationFieldCardinality =
  | "one"
  | "many"
  | "one-to-many"
  | "many-to-one"
  | "many-to-many";

/** The cardinality spellings that mean "this field holds MANY related rows". */
export const MANY_CARDINALITIES: readonly RelationFieldCardinality[] = [
  "many",
  "one-to-many",
  "many-to-many",
];

export interface RelationOption {
  /** The value to store (typically the ID) */
  value: string;
  /** The display label */
  label: string;
  /** Optional description */
  description?: string;
  /** Whether this option is disabled */
  disabled?: boolean;
}

export interface RelationSelectProps extends A11yProps {
  /** Current value (ID) */
  value?: string;
  /** Callback when value changes */
  onChange?: (value: string | undefined) => void;
  /** Available options - accepts readonly for compatibility with generated const arrays */
  options: readonly RelationOption[];
  /** Placeholder text */
  placeholder?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Error message */
  error?: string;
  /** Allow clearing the selection */
  clearable?: boolean;
  /** Name attribute for forms */
  name?: string;
  /** Additional CSS classes */
  className?: string;
  /** Search placeholder */
  searchPlaceholder?: string;
  /** Empty state message */
  emptyMessage?: string;
}

export const RelationSelect: React.FC<RelationSelectProps> = ({
  value,
  onChange,
  options = [],
  placeholder,
  required = false,
  disabled = false,
  isLoading = false,
  error,
  clearable = true,
  name,
  className,
  searchPlaceholder,
  emptyMessage,
  ...rest
}) => {
  const { t } = useTranslate();
  const resolvedPlaceholder = placeholder ?? t('relationSelect.selectPlaceholder');
  const resolvedSearchPlaceholder = searchPlaceholder ?? t('common.search');
  const resolvedEmptyMessage = emptyMessage ?? t('empty.noOptionsFound');
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debug: Log component initialization
  useEffect(() => {
    if (isRelationsDebugEnabled()) {
      debugGroup(`RelationSelect: ${name || "unnamed"}`);
      debug(`Options count: ${options.length}`);
      debug(`Current value: ${value || "none"}`);
      debug(`Is loading: ${isLoading}`);
      if (options.length > 0) {
        debug("Sample options:", options.slice(0, 3));
      } else {
        debug("⚠️ No options available!");
      }
      debugGroupEnd();
    }
  }, [name, options.length, value, isLoading]);

  // Find selected option
  const selectedOption = useMemo(() => {
    const found = options.find((opt) => opt.value === value);
    if (isRelationsDebugEnabled() && value && !found) {
      debug(`⚠️ Value "${value}" not found in options for ${name}`);
    }
    return found;
  }, [options, value, name]);

  // Filter options by search query
  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const query = searchQuery.toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(query) ||
        opt.description?.toLowerCase().includes(query),
    );
  }, [options, searchQuery]);

  // Handle outside click to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearchQuery("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const handleToggle = useCallback(() => {
    if (!disabled) {
      setIsOpen((prev) => !prev);
      if (!isOpen) {
        setSearchQuery("");
      }
    }
  }, [disabled, isOpen]);

  const handleSelect = useCallback(
    (option: RelationOption) => {
      if (option.disabled) return;
      onChange?.(option.value);
      setIsOpen(false);
      setSearchQuery("");
    },
    [onChange],
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange?.(undefined);
    },
    [onChange],
  );

  useEffect(() => {
    setActiveIndex(-1);
  }, [searchQuery, isOpen]);

  const stepActive = useCallback(
    (step: 1 | -1) => {
      const n = filteredOptions.length;
      for (let i = 1; i <= n; i++) {
        const next = (((activeIndex === -1 && step === -1 ? 0 : activeIndex) + step * i) % n + n) % n;
        if (!filteredOptions[next].disabled) {
          setActiveIndex(next);
          return;
        }
      }
    },
    [filteredOptions, activeIndex],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        setSearchQuery("");
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        stepActive(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter") {
        const active = filteredOptions[activeIndex];
        if (active) {
          e.preventDefault();
          handleSelect(active);
        } else if (filteredOptions.length === 1) {
          handleSelect(filteredOptions[0]);
        }
      }
    },
    [filteredOptions, activeIndex, handleSelect, stepActive],
  );

  const showClear = clearable && !!selectedOption && !disabled;
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  return (
    <Box {...domPassthrough(rest)} ref={containerRef} className={cn("relative", className)}>
      {/* Hidden input for form submission */}
      <Input type="hidden" name={name} value={value || ""} />

      {/* Trigger button */}
      <Button
        type="button"
        variant="secondary"
        onClick={handleToggle}
        disabled={disabled}
        className={cn(
          "w-full justify-between font-normal",
          error && "border-error/50 focus:border-error focus:ring-error",
          isOpen && "ring-2 ring-primary border-primary",
          showClear && "pe-12",
        )}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <Typography
          variant="body"
          className={cn(
            !selectedOption && "text-muted-foreground",
          )}
        >
          {isLoading ? (
            <HStack gap="xs" align="center">
              <Spinner size="sm" />
              <Typography as="span">{t('common.loading')}</Typography>
            </HStack>
          ) : selectedOption ? (
            selectedOption.label
          ) : (
            resolvedPlaceholder
          )}
        </Typography>
        <HStack gap="xs" align="center">
          <Icon
            name="chevron-down"
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              isOpen && "transform rotate-180",
            )}
          />
        </HStack>
      </Button>
      {showClear && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon="x"
          onClick={handleClear}
          aria-label={t('common.clear')}
          className="absolute top-1/2 -translate-y-1/2 end-8 h-6 w-6 p-0 text-muted-foreground"
        />
      )}

      {/* Dropdown */}
      {isOpen && (
        <Box
          position="absolute"
          bg="surface"
          border
          rounded="md"
          className="shadow-elevation-popover surface-material z-50 w-full mt-1"
        >
          {/* Search input */}
          <Box padding="sm" className="border-b border-border">
            <Input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              role="combobox"
              aria-expanded={isOpen}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
              aria-label={resolvedSearchPlaceholder}
              placeholder={resolvedSearchPlaceholder}
              icon={Search}
              className="text-sm"
            />
          </Box>

          {/* Options list */}
          <Box overflow="auto" className="max-h-60" id={listboxId} role="listbox">
            {isLoading ? (
              <Box padding="md" display="flex" className="justify-center">
                <Spinner size="md" color="primary" />
              </Box>
            ) : filteredOptions.length === 0 ? (
              <Box padding="md">
                <Typography
                  variant="body"
                  color="muted"
                  className="text-center"
                >
                  {resolvedEmptyMessage}
                </Typography>
              </Box>
            ) : (
              <VStack gap="none">
                {filteredOptions.map((option, index) => (
                  <Box
                    key={option.value}
                    id={optionId(index)}
                    role="option"
                    aria-selected={option.value === value}
                    aria-disabled={option.disabled || undefined}
                    fullWidth
                    paddingX="sm"
                    paddingY="sm"
                    className={cn(
                      "text-start text-sm cursor-pointer hover:bg-muted",
                      index === activeIndex && "bg-muted",
                      option.value === value &&
                        "bg-primary/10 text-foreground",
                      option.disabled && "opacity-50 cursor-not-allowed",
                    )}
                    onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                    onClick={() => handleSelect(option)}
                  >
                    <Typography variant="body" className="font-medium">
                      {option.label}
                    </Typography>
                    {option.description && (
                      <Typography variant="caption" color="muted">
                        {option.description}
                      </Typography>
                    )}
                  </Box>
                ))}
              </VStack>
            )}
          </Box>
        </Box>
      )}

      {/* Error message */}
      {error && (
        <Typography variant="caption" color="error" className="mt-1">
          {error}
        </Typography>
      )}
    </Box>
  );
};

RelationSelect.displayName = "RelationSelect";
