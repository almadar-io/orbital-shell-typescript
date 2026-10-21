'use client';
/**
 * DocSidebar — collapsible documentation navigation sidebar.
 * Renders a nested item tree with expand/collapse per category and active-item
 * highlighting. Not a generic nav; it owns doc-site-specific UX (uppercase
 * category headers, indented children, active highlight).
 */

import React, { useState } from 'react';
import type { A11yProps } from '@almadar/core';
import { cn } from '../../../core';
import { domPassthrough } from '../../../core';
import { Box } from '../../../core';
import { Button } from '../../../core';
import { VStack } from '../../../core';
import { HStack } from '../../../core';
import { Typography } from '../../../core';
import { Icon } from '../../../core';
import { useTranslate } from '../../../core';
import { DOC_NAV_ROW_ACTIVE, DOC_NAV_ROW_HOVER, DOC_NAV_ROW_IDLE } from '../../../lib/doc-nav-classes';

export interface DocSidebarItem {
  /** Display label */
  label: string;
  /** Navigation href */
  href?: string;
  /** Nested child items (makes this a collapsible category) */
  items?: DocSidebarItem[];
  /** Whether this item is currently active */
  active?: boolean;
}

export interface DocSidebarProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Sidebar navigation items */
  items: DocSidebarItem[];
  /** Additional CSS classes */
  className?: string;
}

interface DocSidebarCategoryProps {
  item: DocSidebarItem;
  depth: number;
}

const DocSidebarCategory: React.FC<DocSidebarCategoryProps> = ({ item, depth }) => {
  const [expanded, setExpanded] = useState(
    () => item.items?.some(function hasActive(child: DocSidebarItem): boolean {
      if (child.active) return true;
      return child.items?.some(hasActive) ?? false;
    }) ?? false
  );

  if (item.items && item.items.length > 0) {
    return (
      <VStack gap="none">
        <Button
          variant="ghost"
          aria-expanded={expanded}
          className={cn(
            'h-auto w-full justify-start gap-2 rounded-interactive px-2 py-1.5 font-normal',
            DOC_NAV_ROW_HOVER,
            depth > 0 && 'pl-4',
          )}
          onClick={() => setExpanded((prev) => !prev)}
        >
          <Icon
            name={expanded ? 'chevron-down' : 'chevron-right'}
            size="xs"
            className="text-muted-foreground shrink-0"
          />
          <Typography
            variant="caption"
            className="text-xs uppercase tracking-wider text-muted-foreground font-semibold"
            as="span"
          >
            {item.label}
          </Typography>
        </Button>

        {expanded && (
          <VStack gap="none" className="pl-4">
            {item.items.map((child, idx) => (
              <DocSidebarCategory key={idx} item={child} depth={depth + 1} />
            ))}
          </VStack>
        )}
      </VStack>
    );
  }

  const label = (
    <Typography variant="body2" color="inherit" weight={item.active ? 'semibold' : 'normal'} as="span">
      {item.label}
    </Typography>
  );

  if (!item.href) {
    return (
      <Box className={cn('rounded-interactive px-3 py-1.5 text-sm', DOC_NAV_ROW_IDLE, depth > 0 && 'ml-2')}>
        {label}
      </Box>
    );
  }

  return (
    <Button
      variant="ghost"
      href={item.href}
      aria-current={item.active ? 'page' : undefined}
      className={cn(
        'h-auto w-full justify-start rounded-interactive px-3 py-1.5 text-sm font-normal',
        depth > 0 && 'ml-2',
        item.active ? DOC_NAV_ROW_ACTIVE : cn(DOC_NAV_ROW_IDLE, DOC_NAV_ROW_HOVER),
      )}
    >
      {label}
    </Button>
  );
};

export const DocSidebar: React.FC<DocSidebarProps> = ({
  items,
  className,
  ...rest
}) => {
  const { t } = useTranslate();
  return (
    <Box
      className={cn('w-full', className)}
      role="navigation"
      aria-label={t('aria.docsSidebar')}
      {...domPassthrough(rest)}
    >
      <VStack gap="xs">
        {items.map((item, idx) => (
          <DocSidebarCategory key={idx} item={item} depth={0} />
        ))}
      </VStack>
    </Box>
  );
};

DocSidebar.displayName = 'DocSidebar';