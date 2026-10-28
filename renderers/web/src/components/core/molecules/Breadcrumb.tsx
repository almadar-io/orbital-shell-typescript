'use client';
/**
 * Breadcrumb Molecule Component
 *
 * A breadcrumb navigation component with separators and icons.
 * Uses Button, Icon, and Typography atoms.
 */

import React from "react";
import type { EventKey, EventEmit, A11yProps } from "@almadar/core";
import { Icon } from '../../../core';
import type { IconInput } from '../../../core';
import { Typography } from '../../../core';
import { Box } from '../../../core';
import { Button } from '../../../core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { useNavStack } from '../../../core';

import { domPassthrough } from '../../../core';
export interface BreadcrumbItem {
  /**
   * Item label
   */
  label: string;

  /**
   * Item href (if provided, renders as link)
   */
  href?: string;

  /**
   * Item path (alias for href, for schema compatibility)
   */
  path?: string;

  /**
   * Item icon (canonical kebab-case name or LucideIcon component)
   */
  icon?: IconInput;

  /**
   * Click handler (if href not provided)
   */
  onClick?: () => void;

  /**
   * Is current page
   */
  isCurrent?: boolean;

  /** Event name to emit when clicked (for trait state machine integration) */
  event?: EventKey;
}

export interface BreadcrumbProps extends A11yProps {
  /**
   * Breadcrumb items. Omit together with `fromNavStack` to render the
   * orbital-scoped navigation stack instead of an authored trail.
   * @example [{"label": "Home", "href": "/"}, {"label": "Page"}]
   */
  items?: BreadcrumbItem[];

  /**
   * Render the current orbital's navigation stack (NavStackProvider) as the
   * trail: one crumb per visited/declared level, last entry current. The
   * stack is client-session state both execution paths maintain; outside a
   * provider this renders nothing.
   */
  fromNavStack?: boolean;

  /**
   * Event emitted when a non-current crumb is clicked, with payload
   * `{ label, href, index }` — the trait handles it with
   * `(navigate ?href)`. Without it, stack crumbs navigate directly.
   */
  itemEvent?: EventEmit<{ label: string; href?: string; index: number }>;

  /**
   * Separator icon (canonical kebab-case name or LucideIcon component)
   */
  separator?: IconInput;

  /**
   * Maximum items to show (truncates with ellipsis)
   */
  maxItems?: number;

  /**
   * Additional CSS classes
   */
  className?: string;
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({
  items,
  fromNavStack = false,
  itemEvent,
  separator = "chevron-right",
  maxItems,
  className,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const navStack = useNavStack();

  // Stack mode: derive the trail from the orbital-scoped navigation stack.
  // `path` carries the target href for the click payload / direct goTo;
  // deliberately NOT `href`, so crumbs render as buttons (SPA), never
  // full-reload anchors.
  const sourceItems: BreadcrumbItem[] = fromNavStack
    ? navStack.entries.map((entry, i) => ({
        label: entry.label,
        path: entry.href,
        isCurrent: i === navStack.entries.length - 1,
        event: itemEvent,
      }))
    : (items ?? []);

  if (fromNavStack && sourceItems.length === 0) return null;

  type Crumb = { kind: "item"; item: BreadcrumbItem; index: number } | { kind: "collapsed" };
  const allCrumbs: Crumb[] = sourceItems.map((item, index) => ({ kind: "item", item, index }));
  const crumbs: Crumb[] =
    maxItems && sourceItems.length > maxItems
      ? [allCrumbs[0], { kind: "collapsed" }, ...allCrumbs.slice(-maxItems + 1)]
      : allCrumbs;

  const activate = (item: BreadcrumbItem, index: number) => {
    const href = item.path ?? item.href;
    if (item.event) {
      eventBus.emit(`UI:${item.event}`, { label: item.label, ...(href !== undefined ? { href } : {}), index });
    } else if (fromNavStack && href) {
      // Stack crumbs without an event navigate directly through the provider.
      navStack.goTo(href);
    }
    item.onClick?.();
  };

  const separatorIcon = (
    <Box as="span" aria-hidden="true" data-breadcrumb-separator className="inline-flex text-muted-foreground rtl:-scale-x-100">
      {typeof separator === "string" ? <Icon name={separator} size="sm" /> : <Icon icon={separator} size="sm" />}
    </Box>
  );

  return (
    <Box {...domPassthrough(rest)} as="nav" aria-label={rest['aria-label'] ?? t('aria.breadcrumb')} className={cn("min-w-0", className)}>
      <Box as="ol" className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
        {crumbs.map((crumb, position) => {
          const isLast = position === crumbs.length - 1;
          if (crumb.kind === "collapsed") {
            return (
              <Box as="li" key="collapsed" className="flex items-center gap-2">
                <Typography variant="small" color="muted" aria-hidden="true">…</Typography>
                {separatorIcon}
              </Box>
            );
          }
          const { item, index } = crumb;
          const href = item.href || item.path;
          const icon = item.icon
            ? typeof item.icon === "string" ? <Icon name={item.icon} size="sm" /> : <Icon icon={item.icon} size="sm" />
            : null;
          const label = (
            <Typography variant="small" weight="medium" truncate className="max-w-[16rem]">
              {item.label}
            </Typography>
          );
          const tone = isLast ? "text-foreground" : "text-muted-foreground hover:text-foreground";
          return (
            <Box as="li" key={index} className="flex items-center gap-2 min-w-0">
              {isLast ? (
                <Box as="span" aria-current="page" className={cn("flex items-center gap-1.5 min-w-0", tone)}>
                  {icon}
                  {label}
                </Box>
              ) : href && !item.event && !fromNavStack ? (
                <Button variant="link" href={href} className={cn("h-auto gap-1.5 min-w-0 no-underline", tone)}>
                  {icon}
                  {label}
                </Button>
              ) : (
                <Button variant="link" onClick={() => activate(item, index)} className={cn("h-auto gap-1.5 min-w-0 no-underline", tone)}>
                  {icon}
                  {label}
                </Button>
              )}
              {!isLast && separatorIcon}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

Breadcrumb.displayName = "Breadcrumb";