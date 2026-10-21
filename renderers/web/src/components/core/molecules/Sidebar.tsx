'use client';
/**
 * Sidebar Organism Component
 *
 * A sidebar component with logo, navigation items, user section, and collapse/expand.
 * Styled to match the main Layout component with theme-aware CSS variables.
 *
 * Events:
 * - collapseChangeEvent — emitted when sidebar collapse state changes, payload: { collapsed: boolean }
 * - closeEvent — emitted when close button clicked (mobile)
 * - logoClickEvent — emitted when logo/brand area clicked
 */

import React, { useState, useCallback } from 'react';
import type { A11yProps, AssetUrl, EventEmit } from '@almadar/core';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Badge } from '../../../core';
import { Button } from '../../../core';
import { Box } from '../../../core';
import { Icon } from '../../../core';
import type { IconInput } from '../../../core';
import { Typography } from '../../../core';
import { cn } from '../../../core';
import { pressableProps } from '../../../core';
import { domPassthrough } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import type { UiError } from '../../../core';
// Sidebar is a pure UI navigation primitive, not a schema-entity display
// organism. SidebarItem carries React nodes (icons) and callbacks (onClick)
// that don't fit EntityRow's primitive-field constraint, so Sidebar does
// not extend EntityDisplayProps.

export interface SidebarItem {
  /** Item ID */
  id: string;
  /** Item label */
  label: string;
  /** Item icon — Lucide icon name or component */
  icon?: IconInput;
  /** Item badge */
  badge?: string | number;
  /** Item href */
  href?: string;
  /** Item click handler */
  onClick?: () => void;
  /** Is active */
  active?: boolean;
  /** @deprecated Use `active` instead */
  isActive?: boolean;
  /** Sub-items (for nested navigation) */
  subItems?: SidebarItem[];
}

export interface SidebarProps extends A11yProps {
  /** Additional CSS classes */
  className?: string;
  /** Loading state indicator */
  isLoading?: boolean;
  /** Error state */
  error?: UiError | null;
  /** Logo/Brand content - can be a ReactNode or logo config */
  logo?: React.ReactNode;
  /** Logo image source */
  logoSrc?: AssetUrl;
  /** Brand/App name */
  brandName?: string;
  /** Navigation items */
  items: SidebarItem[];
  /** User section content */
  userSection?: React.ReactNode;
  /** Footer content (e.g., theme toggle) */
  footerContent?: React.ReactNode;
  /** Collapsed state (controlled) */
  collapsed?: boolean;
  /** Default collapsed state */
  defaultCollapsed?: boolean;
  /**
   * Event emitted when collapse state changes, payload: { collapsed: boolean }
   * @notification
   */
  collapseChangeEvent?: EventEmit<{ collapsed: boolean }>;
  /** Hide the collapse/expand button */
  hideCollapseButton?: boolean;
  /** Show a close button (for mobile) */
  showCloseButton?: boolean;
  /** Event emitted when close button is clicked */
  closeEvent?: EventEmit<Record<string, never>>;
  /** Event emitted when logo/brand is clicked */
  logoClickEvent?: EventEmit<Record<string, never>>;
}

/**
 * Single navigation item component
 */
const SidebarNavItem: React.FC<{
  item: SidebarItem;
  collapsed: boolean;
}> = ({ item, collapsed }) => {
  const isActive = item.active ?? item.isActive;

  return (
    <Button
      variant="ghost"
      href={item.href}
      onClick={item.onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2.5 transition-all duration-fast group relative',
        'rounded-interactive border-[length:var(--border-width-thin)] border-transparent',
        isActive
          ? [
            'bg-primary text-primary-foreground',
            'font-medium shadow-elevation-interactive',
            'border-primary translate-x-1 rtl:-translate-x-1 -translate-y-0.5',
          ].join(' ')
          : [
            'text-foreground',
            'hover:bg-muted hover:border-border',
            'active:bg-primary active:text-primary-foreground',
          ].join(' ')
      )}
      title={collapsed ? item.label : undefined}
      aria-current={isActive ? 'page' : undefined}
    >
      {item.icon && (
        typeof item.icon === 'string'
          ? <Icon name={item.icon} size="sm" className={cn('min-w-[20px] flex-shrink-0', isActive && 'text-primary-foreground')} />
          : <Icon icon={item.icon} size="sm" className={cn('min-w-[20px] flex-shrink-0', isActive && 'text-primary-foreground')} />
      )}

      {!collapsed && (
        <Typography variant="body" color={isActive ? 'inherit' : 'primary'} className="font-medium truncate flex-1 text-start">{item.label}</Typography>
      )}

      {!collapsed && item.badge !== undefined && (
        <Badge variant="danger" size="sm">{item.badge}</Badge>
      )}

      {/* Tooltip for collapsed state */}
      {collapsed && (
        <Box className={cn(
          'absolute start-full ms-2 px-2 py-1 text-xs opacity-0 group-hover:opacity-100',
          'pointer-events-none whitespace-nowrap z-50 transition-opacity',
          'bg-primary text-primary-foreground',
          'border-[length:var(--border-width-thin)] border-border',
          'rounded-interactive'
        )}>
          {item.label}
        </Box>
      )}
    </Button>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  logo,
  logoSrc,
  brandName = 'KFlow',
  items,
  userSection,
  footerContent,
  collapsed: controlledCollapsed,
  defaultCollapsed = false,
  collapseChangeEvent,
  hideCollapseButton = false,
  showCloseButton = false,
  closeEvent,
  logoClickEvent,
  className,
  ...rest
}) => {
  const { emit } = useEventBus();
  const { t } = useTranslate();
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);
  const collapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;

  const handleToggle = useCallback(() => {
    const newCollapsed = !collapsed;
    if (controlledCollapsed === undefined) {
      setInternalCollapsed(newCollapsed);
    }
    if (collapseChangeEvent) {
      emit(collapseChangeEvent, { collapsed: newCollapsed });
    }
  }, [collapsed, controlledCollapsed, collapseChangeEvent, emit]);

  const handleClose = useCallback(() => {
    if (closeEvent) {
      emit(closeEvent, {});
    }
  }, [closeEvent, emit]);

  const handleLogoClick = useCallback(() => {
    if (logoClickEvent) {
      emit(logoClickEvent, {});
    }
  }, [logoClickEvent, emit]);

  return (
    <Box
      as="aside"
      {...domPassthrough(rest)}
      className={cn(
        'flex flex-col h-full',
        'bg-card border-e border-border',
        'transition-all duration-normal ease-standard',
        collapsed ? 'w-20' : 'w-64',
        className
      )}
    >
      {/* Header with Logo */}
      <Box className="h-16 flex items-center justify-between px-4 border-b border-border flex-shrink-0">
        <Box
          className={cn(
            'flex items-center gap-3 cursor-pointer',
            collapsed && 'justify-center w-full'
          )}
          {...pressableProps(logoClickEvent ? handleLogoClick : undefined)}
          aria-label={logoClickEvent ? brandName : undefined}
        >
          {/* Logo image or custom logo */}
          {logo ? (
            typeof logo === 'string' ? (
               
              <img src={logo} alt={brandName} className="h-8 w-8" />
            ) : (
              logo
            )
          ) : logoSrc ? (
             
            <img src={logoSrc} alt={brandName} className="h-8 w-8" />
          ) : (
            <Box className="h-8 w-8 bg-primary flex items-center justify-center rounded-interactive">
              <Typography variant="small" className="text-primary-foreground font-bold text-sm">K</Typography>
            </Box>
          )}

          {/* Brand name */}
          {!collapsed && (
            <Typography variant="body" className="heading-voice text-xl text-foreground">
              {brandName}
            </Typography>
          )}
        </Box>

        {/* Collapse button */}
        {!hideCollapseButton && (
          <Button
            variant="ghost"
            onClick={handleToggle}
            className={cn(
              'p-1.5 hover:bg-muted text-foreground hidden lg:block',
              'rounded-interactive',
              collapsed && 'mx-auto'
            )}
            title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </Button>
        )}

        {/* Close button for mobile */}
        {showCloseButton && (
          <Button
            variant="ghost"
            onClick={handleClose}
            className="p-1.5 hover:bg-muted text-foreground lg:hidden rounded-interactive"
            aria-label={t('sidebar.close')}
          >
            <X size={18} />
          </Button>
        )}
      </Box>

      {/* Navigation */}
      <Box as="nav" className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
        {items.map((item) => (
          <SidebarNavItem
            key={item.id}
            item={item}
            collapsed={collapsed}
          />
        ))}
      </Box>

      {/* Footer with User Section and additional content */}
      {(footerContent || userSection) && (
        <Box className="p-3 border-t border-border space-y-1 flex-shrink-0">
          <Box className={cn(
            'flex items-center',
            collapsed ? 'justify-center flex-col gap-4' : 'justify-between px-2'
          )}>
            {footerContent && (
              <Box className="flex items-center">
                {footerContent}
              </Box>
            )}
            {userSection && (
              <Box className="flex items-center">
                {userSection}
              </Box>
            )}
          </Box>

          {collapsed && !hideCollapseButton && (
            <Button
              variant="ghost"
              onClick={handleToggle}
              className="w-full flex justify-center p-2 mt-2 text-muted-foreground hover:text-foreground lg:hidden"
            >
              <ChevronRight size={20} />
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
};

Sidebar.displayName = 'Sidebar';
