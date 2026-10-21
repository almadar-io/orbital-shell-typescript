'use client';
/**
 * Tabs Molecule Component
 *
 * A tabbed interface component with keyboard navigation and badge support.
 * Uses theme-aware CSS variables for styling.
 */

import React, { useState, useRef, useId, useLayoutEffect, useCallback } from 'react';
import type { EventKey, Asset, EventEmit, A11yProps } from '@almadar/core';
import { Icon } from '../../../core';
import type { IconInput } from '../../../core';
import { Badge } from '../../../core';
import { Typography } from '../../../core';
import { Box } from '../../../core';
import { Button } from '../../../core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
export interface TabItem {
  /**
   * Tab ID. Optional — schema-driven callers may pass `value` instead;
   * it gets normalized to `id` at the call boundary.
   */
  id?: string;
  /**
   * Alternative key when `id` isn't set. Used by `.orb` schema-driven
   * call sites that emit `{ value, label }` for tab items.
   */
  value?: string;
  /** Tab label */
  label: string;
  /** Tab content - optional for event-driven tabs */
  content?: React.ReactNode;
  /** Tab icon — pass either a Lucide component or its registry name (e.g. "file-text") */
  icon?: IconInput;
  /** Asset image rendered as the tab icon; takes precedence over icon when provided. */
  iconAsset?: Asset;
  /** Tab badge */
  badge?: string | number;
  /** Disable tab */
  disabled?: boolean;
  /** Event to emit when tab is clicked (for trait state machine integration) */
  event?: EventKey;
  /** Whether this tab is currently active (for controlled tabs) */
  active?: boolean;
}

/**
 * `TabItem` after `id`/`value` normalization. `id` is guaranteed
 * present so downstream rendering + keyboard nav don't have to defend
 * against `undefined`.
 */
interface NormalizedTabItem extends Omit<TabItem, 'id' | 'value'> {
  id: string;
}

export interface TabsProps extends A11yProps {
  /** Tab items */
  items?: TabItem[];
  /** Tab items (alias for items - used by generated code) */
  tabs?: TabItem[];
  /** Default active tab ID */
  defaultActiveTab?: string;
  /** Controlled active tab ID */
  activeTab?: string;
  /** Callback when tab changes */
  onTabChange?: (tabId: string) => void;
  /** Declarative tab change event — emits UI:{tabChangeEvent} with { tabId } */
  tabChangeEvent?: EventEmit<{ tabId: string }>;
  /** Tab variant */
  variant?: 'default' | 'pills' | 'underline';
  /** Tab orientation */
  orientation?: 'horizontal' | 'vertical';
  /** Additional CSS classes */
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({
  items,
  tabs,
  defaultActiveTab,
  activeTab: controlledActiveTab,
  onTabChange,
  tabChangeEvent,
  variant = 'default',
  orientation = 'horizontal',
  className,
  ...rest
}) => {
  // Guard against undefined or empty items - support both 'items' and 'tabs' props.
  // Normalize {value, label} format from schema to {id, label}; result carries a
  // guaranteed `id: string` so downstream code (keyboard nav, refs) is total.
  const rawItems = items ?? tabs ?? [];
  const safeItems: NormalizedTabItem[] = rawItems.map(({ id, value, ...rest }) => ({
    ...rest,
    id: id || value || '',
  }));
  const eventBus = useEventBus();
  const { t } = useTranslate();

  // Find initially active tab (check for active: true in items)
  const initialActive = safeItems.find(item => item.active)?.id;

  const [internalActiveTab, setInternalActiveTab] = useState(
    defaultActiveTab || initialActive || safeItems[0]?.id || ''
  );
  const activeTab = controlledActiveTab !== undefined ? controlledActiveTab : internalActiveTab;
  const tabRefs = useRef<Record<string, HTMLElement | null>>({});
  const uid = useId();
  const tabId = (id: string) => `${uid}-tab-${id}`;
  const panelId = (id: string) => `${uid}-panel-${id}`;

  // A horizontal lane wider than its container scrolls; which edges hide tabs
  // drives the chevrons + fades (G-UI-060 — the scrollbar is hidden).
  const laneRef = useRef<HTMLDivElement | null>(null);
  const [hidden, setHidden] = useState<{ start: boolean; end: boolean }>({ start: false, end: false });
  const measure = useCallback(() => {
    const lane = laneRef.current;
    if (!lane || orientation !== 'horizontal') return;
    const max = lane.scrollWidth - lane.clientWidth;
    const start = max > 1 && lane.scrollLeft > 1;
    const end = max > 1 && lane.scrollLeft < max - 1;
    setHidden((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [orientation]);
  useLayoutEffect(() => {
    measure();
    const lane = laneRef.current;
    if (!lane || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(lane);
    return () => observer.disconnect();
  }, [measure, rawItems.length]);
  const scrollLane = (direction: 1 | -1) => {
    const lane = laneRef.current;
    if (lane) lane.scrollBy({ left: direction * lane.clientWidth * 0.8, behavior: 'smooth' });
  };

  const handleTabChange = (tabId: string, tabEvent?: string) => {
    if (controlledActiveTab === undefined) {
      setInternalActiveTab(tabId);
    }
    onTabChange?.(tabId);

    if (tabChangeEvent) {
      eventBus.emit(`UI:${tabChangeEvent}`, { tabId });
    }
    if (tabEvent) {
      eventBus.emit(`UI:${tabEvent}`, { tabId });
    }
  };

  const focusTab = (target: NormalizedTabItem | undefined) => {
    if (!target) return;
    handleTabChange(target.id);
    tabRefs.current[target.id]?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    // Vertical tab strips navigate with Up/Down; Left/Right are ignored so
    // they don't fight the page's own horizontal scrolling/focus.
    const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    const enabled = safeItems.filter((item) => !item.disabled);
    if (e.key === prevKey || e.key === nextKey) {
      e.preventDefault();
      const step = e.key === prevKey ? -1 : 1;
      for (let i = 1; i <= safeItems.length; i++) {
        const candidate = safeItems[(index + step * i + safeItems.length * i) % safeItems.length];
        if (!candidate.disabled) {
          focusTab(candidate);
          return;
        }
      }
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      focusTab(e.key === 'Home' ? enabled[0] : enabled[enabled.length - 1]);
    }
  };

  const activeTabContent = safeItems.find(item => item.id === activeTab)?.content;
  const rendersPanel = activeTabContent !== undefined && activeTabContent !== null;

  // Graceful handling for empty tabs
  if (safeItems.length === 0) {
    return (
      <Box {...domPassthrough(rest)} className={cn('w-full', className)}>
        <Typography variant="small" color="muted" className="py-4">
          {t('empty.noItems')}
        </Typography>
      </Box>
    );
  }

  // Theme-aware variant styles
  const variantClasses = {
    default: [
      'border-b-[length:var(--border-width)] border-transparent',
      'hover:border-muted-foreground',
      'data-[active=true]:border-primary',
    ].join(' '),
    pills: [
      'rounded-interactive',
      'data-[active=true]:bg-primary',
      'data-[active=true]:text-primary-foreground',
    ].join(' '),
    underline: [
      'border-b-[length:var(--border-width)] border-transparent',
      'data-[active=true]:border-primary',
    ].join(' '),
  };

  const tablist = (
    <Box
      ref={laneRef}
      role="tablist"
      aria-orientation={orientation}
      onScroll={measure}
      data-scroll-affordance={hidden.start || hidden.end ? 'true' : undefined}
      className={cn(
        'flex',
        // Horizontal tab strip becomes a horizontally-scrollable lane
        // below its container width — phones with many tabs scroll
        // instead of clipping. `snap-x` snaps to each tab; the
        // scrollbar is hidden — the edge chevrons are the affordance.
        orientation === 'horizontal'
          ? 'flex-row border-b-[length:var(--border-width)] border-border overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden'
          : 'flex-col border-r-[length:var(--border-width)] border-border',
        variant === 'pills' && 'gap-1 p-1 bg-muted border-0 rounded-interactive',
        variant === 'underline' && orientation === 'vertical' && 'border-b-0'
      )}
    >
      {safeItems.map((item, index) => {
        const isActive = item.id === activeTab;
        const isDisabled = item.disabled;

        return (
          <Box
            key={item.id}
            as="button"
            ref={(el: HTMLDivElement | null) => {
              tabRefs.current[item.id] = el;
            }}
            id={tabId(item.id)}
            role="tab"
            aria-selected={isActive}
            aria-controls={isActive && rendersPanel ? panelId(item.id) : undefined}
            aria-disabled={isDisabled}
            tabIndex={isActive ? 0 : -1}
            onClick={() => !isDisabled && handleTabChange(item.id, item.event)}
            onKeyDown={(e: React.KeyboardEvent) => handleKeyDown(e, index)}
            data-active={isActive}
            data-testid={`tab-${item.id}`}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap',
              orientation === 'horizontal' && 'snap-start shrink-0',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              isDisabled && 'opacity-50 cursor-not-allowed',
              variantClasses[variant],
              isActive
                ? variant === 'pills'
                  ? 'text-primary-foreground'
                  : 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {item.iconAsset?.url
              ? <img src={item.iconAsset.url} alt={item.iconAsset.name ?? item.iconAsset.category ?? ''} width={16} height={16} style={{ imageRendering: 'pixelated', objectFit: 'contain', width: 16, height: 16 }} className="flex-shrink-0" />
              : item.icon && (typeof item.icon === 'string'
                  ? <Icon name={item.icon} size="sm" />
                  : <Icon icon={item.icon} size="sm" />
                )
            }
            <Typography variant="small" weight="medium" className="!text-inherit">
              {item.label}
            </Typography>
            {item.badge !== undefined && (
              <Badge variant="default" size="sm">
                {item.badge}
              </Badge>
            )}
          </Box>
        );
      })}
    </Box>
  );

  return (
    <Box {...domPassthrough(rest)} className={cn('w-full', orientation === 'vertical' && 'flex flex-row', className)}>
      {orientation === 'horizontal' ? (
        <Box className="relative">
          {tablist}
          {hidden.start && (
            <>
              <Box className="pointer-events-none absolute inset-y-0 start-0 w-10 bg-gradient-to-r from-[var(--color-background)] to-transparent rtl:bg-gradient-to-l" />
              <Button
                variant="ghost"
                size="sm"
                leftIcon="chevron-left"
                aria-label={t('tabs.scrollStart')}
                data-testid="tabs-scroll-start"
                className="absolute start-0 top-1/2 -translate-y-1/2 px-1 rtl:rotate-180"
                onClick={() => scrollLane(-1)}
              />
            </>
          )}
          {hidden.end && (
            <>
              <Box className="pointer-events-none absolute inset-y-0 end-0 w-10 bg-gradient-to-l from-[var(--color-background)] to-transparent rtl:bg-gradient-to-r" />
              <Button
                variant="ghost"
                size="sm"
                leftIcon="chevron-right"
                aria-label={t('tabs.scrollEnd')}
                data-testid="tabs-scroll-end"
                className="absolute end-0 top-1/2 -translate-y-1/2 px-1 rtl:rotate-180"
                onClick={() => scrollLane(1)}
              />
            </>
          )}
        </Box>
      ) : tablist}

      {rendersPanel && (
        <Box
          role="tabpanel"
          id={panelId(activeTab)}
          aria-labelledby={tabId(activeTab)}
          tabIndex={0}
          className={orientation === 'vertical' ? 'flex-1 min-w-0 ps-4' : 'mt-4'}
        >
          {activeTabContent}
        </Box>
      )}
    </Box>
  );
};

Tabs.displayName = 'Tabs';
