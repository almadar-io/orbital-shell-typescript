'use client';
/**
 * FloatingToolbar Molecule Component
 *
 * Floating bottom-center horizontal tool strip (Figma UI3-style pill), built
 * from the Button/ButtonGroup/Divider atoms — no new positioning system.
 *
 * Items mirror FloatingActionButton's declarative-action convention: `action`
 * (+ `actionPayload`) pass straight through to the Button atom's own
 * `UI:{action}` emit, and `event` mirrors FloatingActionButton's multi-action
 * `event` field (emits `UI:{event}` with `{ actionId }` on click) — both are
 * optional and independent, same as FloatingActionButton's `FloatingAction`.
 */

import React from "react";
import type { EventKey, EventPayload, A11yProps } from "@almadar/core";
import { Button } from '../../../core';
import { Box } from '../../../core';
import { Divider } from '../../../core';
import type { IconInput } from '../../../core';
import { Typography } from '../../../core';
import { ButtonGroup } from "./ButtonGroup";
import { cn } from '../../../core';
import { useEventBus } from '../../../core';

import { domPassthrough } from '../../../core';
export interface FloatingToolbarItem {
  /** Item identifier */
  id: string;
  /** Icon — Lucide icon name or component */
  icon: IconInput;
  /** Item label. Used as the default `aria-label` (consumers own i18n). */
  label: string;
  /** Event name to emit as `UI:{event}` with `{ actionId: id }` on click */
  event?: EventKey;
  /** Declarative action name — passed to the Button atom, which emits `UI:{action}` on click */
  action?: EventKey;
  /** Payload to include with the action event
   *  @payloadFor action
   */
  actionPayload?: EventPayload;
  /** Whether the item renders in its pressed/active visual state */
  active?: boolean;
  /** Disable the item (greys out, blocks click events) */
  disabled?: boolean;
  /**
   * Overrides the default `floating-toolbar-item-{id}` test id. Use when a
   * consumer needs the item to carry the SAME test id its underlying
   * declarative `action` already stamps elsewhere in the app (e.g. `action:
   * 'SAVE'` → `action-SAVE`, matching the raw `<Button action="SAVE">`
   * other toolbars use) so shared test helpers/specs keep working
   * regardless of which chrome renders the button.
   */
  testId?: string;
}

export type FloatingToolbarPosition =
  | "bottom-center"
  | "bottom-left"
  | "bottom-right"
  | "top-center"
  | "top-left"
  | "top-right";

export interface FloatingToolbarProps extends A11yProps {
  /** Tool items rendered as icon buttons */
  items: FloatingToolbarItem[];
  /**
   * Strip position within the app frame.
   * @default 'bottom-center'
   */
  position?: FloatingToolbarPosition;
  /** Custom cells appended after the items, separated by a divider */
  children?: React.ReactNode;
  /** Additional CSS classes on the positioned root */
  className?: string;
}

const positionClasses: Record<FloatingToolbarPosition, string> = {
  "bottom-center": "bottom-6 left-1/2 -translate-x-1/2",
  "bottom-left": "bottom-6 left-6",
  "bottom-right": "bottom-6 right-6",
  "top-center": "top-6 left-1/2 -translate-x-1/2",
  "top-left": "top-6 left-6",
  "top-right": "top-6 right-6",
};

export const FloatingToolbar: React.FC<FloatingToolbarProps> = ({
  items,
  position = "bottom-center",
  children,
  className,
  ...rest
}) => {
  const eventBus = useEventBus();

  return (
    <Box {...domPassthrough(rest)} className={cn("fixed z-50", positionClasses[position])}>
      <ButtonGroup
        variant="default"
        orientation="horizontal"
        className={cn(
          "items-center gap-1 rounded-full border border-border",
          "bg-card/95 backdrop-blur-sm shadow-elevation-popover p-1",
          className,
        )}
      >
        {items.map((item) => (
          <Button
            key={item.id}
            variant={item.active ? "primary" : "ghost"}
            size="sm"
            icon={item.icon}
            action={item.action}
            actionPayload={item.actionPayload}
            disabled={item.disabled}
            aria-pressed={item.active}
            aria-label={item.label}
            className="rounded-full"
            data-testid={item.testId ?? `floating-toolbar-item-${item.id}`}
            onClick={() => {
              if (item.event) eventBus.emit(`UI:${item.event}`, { actionId: item.id });
            }}
          >
            <Typography as="span" className="sr-only">
              {item.label}
            </Typography>
          </Button>
        ))}
        {children && items.length > 0 && <Divider orientation="vertical" className="h-6 mx-1" />}
        {children}
      </ButtonGroup>
    </Box>
  );
};

FloatingToolbar.displayName = "FloatingToolbar";

export default FloatingToolbar;
