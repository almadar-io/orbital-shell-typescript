/**
 * Navigation Organism Component
 * 
 * A navigation component with items, active indicators, icons, and badges.
 * Uses Menu, ButtonGroup molecules and Button, Icon, Badge, Typography, Divider atoms.
 */

import React from 'react';
import { Menu, MenuItem } from './Menu';
import { Button } from '../../../core';
import { Badge } from '../../../core';
import { Box } from '../../../core';
import type { IconInput } from '../../../core';
import type { A11yProps } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { cn } from '../../../core';
import type { UiError } from '../../../core';

export interface NavigationItem {
  /**
   * Item ID
   */
  id: string;
  
  /**
   * Item label
   */
  label: string;
  
  /**
   * Item icon
   */
  icon?: IconInput;
  
  /**
   * Item badge
   */
  badge?: string | number;
  
  /**
   * Item href
   */
  href?: string;
  
  /**
   * Item click handler
   */
  onClick?: () => void;
  
  /**
   * Is active
   */
  isActive?: boolean;
  
  /**
   * Disable item
   */
  disabled?: boolean;
  
  /**
   * Sub-menu items
   */
  subMenu?: NavigationItem[];
}

export interface NavigationProps extends A11yProps {
  /**
   * Navigation items
   */
  items: NavigationItem[];

  /**
   * Navigation orientation
   * @default 'horizontal'
   */
  orientation?: 'horizontal' | 'vertical';

  /**
   * Additional CSS classes
   */
  className?: string;

  /** Loading state indicator */
  isLoading?: boolean;

  /** Error state */
  error?: UiError | null;

}

export const Navigation: React.FC<NavigationProps> = ({
  items,
  orientation = 'horizontal',
  className,
  ...rest
}) => {
  const renderNavigationItem = (item: NavigationItem, hasSubMenu: boolean) => {
    if (hasSubMenu) {
      const menuItems: MenuItem[] = item.subMenu!.map((subItem) => ({
        id: subItem.id,
        label: subItem.label,
        icon: subItem.icon,
        badge: subItem.badge,
        disabled: subItem.disabled,
        onClick: subItem.onClick,
      }));

      return (
        <Menu
          key={item.id}
          trigger={
            <Button
              variant={item.isActive ? 'primary' : 'ghost'}
              size="sm"
              icon={item.icon}
              disabled={item.disabled}
              aria-current={item.isActive ? 'page' : undefined}
            >
              {item.label}
              {item.badge !== undefined && (
                <Badge variant="danger" size="sm">
                  {item.badge}
                </Badge>
              )}
            </Button>
          }
          items={menuItems}
          position={orientation === 'horizontal' ? 'bottom-left' : 'bottom-right'}
        />
      );
    }

    return (
      <Button
        key={item.id}
        variant={item.isActive ? 'primary' : 'ghost'}
        size="sm"
        icon={item.icon}
        href={item.href}
        onClick={item.onClick}
        disabled={item.disabled}
        aria-current={item.isActive ? 'page' : undefined}
        className="relative"
      >
        {item.label}
        {item.badge !== undefined && (
          <Badge variant="danger" size="sm" className="absolute -top-1 -right-1">
            {item.badge}
          </Badge>
        )}
      </Button>
    );
  };

  return (
    <Box
      as="nav"
      {...domPassthrough(rest)}
      className={cn(
        'flex',
        orientation === 'horizontal' ? 'flex-row items-center gap-1' : 'flex-col gap-1',
        className
      )}
    >
      {items.map((item) => {
        const hasSubMenu = !!(item.subMenu && item.subMenu.length > 0);
        return renderNavigationItem(item, hasSubMenu);
      })}
    </Box>
  );
};

Navigation.displayName = 'Navigation';
