'use client';
/**
 * Stack Component
 *
 * A layout primitive for arranging children in a vertical or horizontal stack with consistent spacing.
 * Includes convenience exports VStack and HStack for common use cases.
 */
import React from "react";
import type { A11yProps, EventKey, EventPayload } from "@almadar/core";
import { cn } from "../lib/cn";
import { useEventBus } from "../hooks/useEventBus";
import { domPassthrough } from "../lib/domPassthrough";

export type StackDirection = "horizontal" | "vertical";
export type StackGap = "none" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
export type StackAlign = "start" | "center" | "end" | "stretch" | "baseline";
export type StackJustify =
  | "start"
  | "center"
  | "end"
  | "between"
  | "around"
  | "evenly";

export interface StackProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Stack direction */
  direction?: StackDirection;
  /** Gap between children */
  gap?: StackGap;
  /** Align items on the cross axis */
  align?: StackAlign;
  /** Justify items on the main axis */
  justify?: StackJustify;
  /** Allow items to wrap */
  wrap?: boolean;
  /** Reverse the order of children */
  reverse?: boolean;
  /** Fill available space (flex: 1) */
  flex?: boolean;
  /** Custom class name */
  className?: string;
  /** Inline styles */
  style?: React.CSSProperties;
  /** Children elements */
  children?: React.ReactNode;
  /** HTML element to render as */
  as?: React.ElementType;
  /** Click handler */
  onClick?: (e: React.MouseEvent) => void;
  /**
   * Keyboard handler
   * @notification
   */
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** Element id */
  id?: string;
  /** Declarative event name — emits UI:{action} via eventBus on click */
  action?: EventKey;
  /** Payload to include with the action event
   *  @payloadFor action
   */
  actionPayload?: EventPayload;
  /** When true, horizontal stacks flip to vertical below the md breakpoint (768px) */
  responsive?: boolean;
}

const gapStyles: Record<StackGap, string> = {
  none: "gap-0",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
  xl: "gap-8",
  "2xl": "gap-12",
};

const alignStyles: Record<StackAlign, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
  baseline: "items-baseline",
};

const justifyStyles: Record<StackJustify, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
  evenly: "justify-evenly",
};

/**
 * Stack - Flexible layout component for arranging children
 */
export const Stack: React.FC<StackProps> = ({
  direction = "vertical",
  gap = "md",
  align = "stretch",
  justify = "start",
  wrap = false,
  reverse = false,
  flex = false,
  className,
  style,
  children,
  as: Component = "div",
  onClick,
  onKeyDown,
  role,
  tabIndex,
  action,
  actionPayload,
  responsive = false,
  ...rest
}) => {
  const eventBus = useEventBus();

  const handleClick = (e: React.MouseEvent) => {
    if (action) {
      eventBus.emit(`UI:${action}`, actionPayload ?? {});
    }
    onClick?.(e);
  };

  // Responsive: horizontal stacks become vertical below md breakpoint
  const isHorizontal = direction === "horizontal";
  const directionClass =
    responsive && isHorizontal
      ? reverse
        ? "flex-col-reverse md:flex-row-reverse"
        : "flex-col md:flex-row"
      : isHorizontal
        ? reverse
          ? "flex-row-reverse"
          : "flex-row"
        : reverse
          ? "flex-col-reverse"
          : "flex-col";
  return React.createElement(
    Component,
    {
      ...domPassthrough(rest),
      className: cn(
        "flex",
        directionClass,
        gapStyles[gap],
        alignStyles[align],
        justifyStyles[justify],
        wrap && "flex-wrap",
        flex && "flex-1",
        className,
      ),
      style,
      onClick: (action || onClick) ? handleClick : undefined,
      onKeyDown,
      role,
      tabIndex,
    },
    children
  );
};

/**
 * VStack - Vertical stack shorthand
 */
export interface VStackProps extends Omit<StackProps, "direction"> {}

export const VStack: React.FC<VStackProps> = (props) => (
  <Stack direction="vertical" {...props} />
);

/**
 * HStack - Horizontal stack shorthand
 */
export interface HStackProps extends Omit<StackProps, "direction"> {}

export const HStack: React.FC<HStackProps> = (props) => (
  <Stack direction="horizontal" {...props} />
);

export default Stack;
