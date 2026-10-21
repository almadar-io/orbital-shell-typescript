'use client';
/**
 * Box Component
 *
 * A versatile layout primitive that provides spacing, background, border, and shadow controls.
 * Think of it as a styled div with consistent design tokens.
 */
import React, { useCallback, useRef } from "react";
import type { A11yProps, EventKey, EventPayload, EventEmit } from "@almadar/core";
import { cn } from "../lib/cn";
import { bandEdgeLayerStyle, bandPadding } from "../lib/bandShapes";
import type { BandEdge, BandEdgeColor } from "../lib/bandShapes";
import { useEventBus } from "../hooks/useEventBus";
import { useTapReveal } from "../hooks/useTapReveal";
import { keyInViewerMode, useTheme, useThemeScope } from "../providers/ThemeContext";
import { pressableProps } from "../lib/pressable";
import { useAnimateChanges } from "../lib/animate-changes";

export type BoxPadding = "none" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
export type BoxMargin =
  | "none"
  | "xs"
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "2xl"
  | "auto";
export type BoxBg =
  | "transparent"
  | "primary"
  | "secondary"
  | "muted"
  | "accent"
  | "surface"
  | "overlay"
  | "gradient"
  | "inverse";
export type BoxRounded = "none" | "sm" | "md" | "lg" | "xl" | "2xl" | "full";
export type BoxShadow = "none" | "sm" | "md" | "lg" | "xl";

export interface BoxProps extends Omit<React.HTMLAttributes<HTMLDivElement>, keyof A11yProps>, A11yProps {
  /** Additional CSS classes applied to the root element. */
  className?: string;
  /** Data-theme attribute applied to the root element for CSS theme scoping (e.g. almadar-website-dark). */
  'data-theme'?: string;
  /**
   * Padding on all sides
   * @example md
   */
  padding?: BoxPadding;
  /** Horizontal padding (overrides padding for x-axis) */
  paddingX?: BoxPadding;
  /** Vertical padding (overrides padding for y-axis) */
  paddingY?: BoxPadding;
  /** Margin on all sides */
  margin?: BoxMargin;
  /** Horizontal margin */
  marginX?: BoxMargin;
  /** Vertical margin */
  marginY?: BoxMargin;
  /** Background color */
  bg?: BoxBg;
  /**
   * Show border
   * @example true
   */
  border?: boolean;
  /** Border radius */
  rounded?: BoxRounded;
  /** Box shadow */
  shadow?: BoxShadow;
  /** Display type */
  display?:
    | "block"
    | "inline"
    | "inline-block"
    | "flex"
    | "inline-flex"
    | "grid";
  /** Fill available width */
  fullWidth?: boolean;
  /** Fill available height */
  fullHeight?: boolean;
  /** Overflow behavior */
  overflow?: "auto" | "hidden" | "visible" | "scroll";
  /** Position */
  position?: "relative" | "absolute" | "fixed" | "sticky";
  /** HTML element to render as */
  as?: React.ElementType;
  /** Declarative event name — emits UI:{action} via eventBus on click */
  action?: EventKey;
  /** Payload to include with the action event
   *  @payloadFor action
   */
  actionPayload?: EventPayload;
  /**
   * Declarative hover event — emits UI:{hoverEvent} with { hovered: true/false } on mouseEnter/mouseLeave
   * @notification
   */
  hoverEvent?: EventEmit<{ hovered: boolean }>;
  /** When true (default), a touch/pen tap also fires `hoverEvent` (toggling hovered) so hover-only reveals work on touch. */
  tapReveal?: boolean;
  /** Maximum width (CSS value, e.g., "550px", "80rem") */
  maxWidth?: string;
  /** Shape cut into the top edge of a full-width band; "curve" uses the theme's shape */
  edgeTop?: BandEdge;
  /** Shape cut into the bottom edge of a full-width band; "curve" uses the theme's shape */
  edgeBottom?: BandEdge;
  /** Surface of the neighbouring band, which fills the cut */
  edgeColor?: BandEdgeColor;
  /** Mirror the edge shapes horizontally */
  edgeFlip?: boolean;
  /** Lay the theme's texture over the band */
  texture?: boolean;
  /** Content that appears or changes inside the box eases in instead of switching in one frame (new rows, swapped views, changed text), played in presentation motion (the theme's dramatic duration, standard easing) so it can be watched. Off under reduced motion. */
  animateChanges?: boolean;
  /** Scene behind the band's content (photo, illustration, pattern); never takes clicks */
  backdrop?: React.ReactNode;
  /** Children elements */
  children?: React.ReactNode;
}

const paddingStyles: Record<BoxPadding, string> = {
  none: "p-0",
  xs: "p-1",
  sm: "p-2",
  md: "p-4",
  lg: "p-6",
  xl: "p-8",
  "2xl": "p-12",
};

const paddingXStyles: Record<BoxPadding, string> = {
  none: "px-0",
  xs: "px-1",
  sm: "px-2",
  md: "px-4",
  lg: "px-6",
  xl: "px-8",
  "2xl": "px-12",
};

const paddingYStyles: Record<BoxPadding, string> = {
  none: "py-0",
  xs: "py-1",
  sm: "py-2",
  md: "py-4",
  lg: "py-6",
  xl: "py-8",
  "2xl": "py-12",
};

const marginStyles: Record<BoxMargin, string> = {
  none: "m-0",
  xs: "m-1",
  sm: "m-2",
  md: "m-4",
  lg: "m-6",
  xl: "m-8",
  "2xl": "m-12",
  auto: "m-auto",
};

const marginXStyles: Record<BoxMargin, string> = {
  none: "mx-0",
  xs: "mx-1",
  sm: "mx-2",
  md: "mx-4",
  lg: "mx-6",
  xl: "mx-8",
  "2xl": "mx-12",
  auto: "mx-auto",
};

const marginYStyles: Record<BoxMargin, string> = {
  none: "my-0",
  xs: "my-1",
  sm: "my-2",
  md: "my-4",
  lg: "my-6",
  xl: "my-8",
  "2xl": "my-12",
  auto: "my-auto",
};

// Using CSS variables for theme-aware styling
const bgStyles: Record<BoxBg, string> = {
  transparent: "bg-transparent",
  primary: "bg-primary text-primary-foreground",
  secondary:
    "bg-secondary text-secondary-foreground",
  muted: "bg-muted text-foreground",
  accent: "bg-accent text-accent-foreground",
  surface: "bg-card",
  overlay: "bg-card/80 backdrop-blur-sm",
  gradient: "band-gradient",
  inverse: "band-inverse",
};

const paddingRem: Record<BoxPadding, string> = {
  none: "0rem",
  xs: "0.25rem",
  sm: "0.5rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
  "2xl": "3rem",
};

const roundedStyles: Record<BoxRounded, string> = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-xl",
  full: "rounded-full",
};

const shadowStyles: Record<BoxShadow, string> = {
  none: "shadow-none",
  sm: "shadow-sm",
  md: "shadow",
  lg: "shadow-lg",
  xl: "shadow-lg",
};

const displayStyles = {
  block: "block",
  inline: "inline",
  "inline-block": "inline-block",
  flex: "flex",
  "inline-flex": "inline-flex",
  grid: "grid",
};

const overflowStyles = {
  auto: "overflow-auto",
  hidden: "overflow-hidden",
  visible: "overflow-visible",
  scroll: "overflow-scroll",
};

const positionStyles = {
  relative: "relative",
  absolute: "absolute",
  fixed: "fixed",
  sticky: "sticky",
};

/**
 * Box - Versatile container component with design tokens
 */
export const Box = React.forwardRef<HTMLDivElement, BoxProps>(
  (
    {
      padding,
      paddingX,
      paddingY,
      margin,
      marginX,
      marginY,
      bg = "transparent",
      border = false,
      rounded = "none",
      shadow = "none",
      display,
      fullWidth = false,
      fullHeight = false,
      overflow,
      position,
      className,
      children,
      as: Component = "div",
      action,
      actionPayload,
      hoverEvent,
      tapReveal = true,
      maxWidth,
      edgeTop = "none",
      edgeBottom = "none",
      edgeColor = "background",
      edgeFlip = false,
      texture = false,
      animateChanges = false,
      backdrop,
      onClick,
      onMouseEnter,
      onMouseLeave,
      onPointerDown,
      ...rest
    },
    ref,
  ) => {
    const eventBus = useEventBus();
    const ownRef = useRef<HTMLDivElement | null>(null);
    useAnimateChanges(ownRef, animateChanges);
    const setRef = useCallback((node: HTMLDivElement | null) => {
      ownRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref !== null) ref.current = node;
    }, [ref]);
    // A host theme override replaces a declared data-theme (never adds one); otherwise it renders in the viewer's mode.
    const { override: themeOverride } = useThemeScope();
    const { resolvedMode, availableThemes } = useTheme();
    const declaredTheme = rest['data-theme'];
    const dataTheme = declaredTheme === undefined
      ? undefined
      : themeOverride || keyInViewerMode(declaredTheme, availableThemes, resolvedMode).key;

    const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      if (action) {
        e.stopPropagation();
        eventBus.emit(`UI:${action}`, actionPayload ?? {});
      }
      onClick?.(e);
    }, [action, actionPayload, eventBus, onClick]);

    const handleMouseEnter = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      if (hoverEvent) {
        eventBus.emit(`UI:${hoverEvent}`, { hovered: true });
      }
      onMouseEnter?.(e);
    }, [hoverEvent, eventBus, onMouseEnter]);

    const handleMouseLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      if (hoverEvent) {
        eventBus.emit(`UI:${hoverEvent}`, { hovered: false });
      }
      onMouseLeave?.(e);
    }, [hoverEvent, eventBus, onMouseLeave]);

    // On touch there is no hover, so a `hoverEvent`-bound reveal never fires.
    // A touch/pen tap emits the SAME UI:{hoverEvent} the mouse path emits.
    const { triggerProps } = useTapReveal({
      enabled: tapReveal && !!hoverEvent,
      onReveal: useCallback(() => {
        if (hoverEvent) eventBus.emit(`UI:${hoverEvent}`, { hovered: true });
      }, [hoverEvent, eventBus]),
      onDismiss: useCallback(() => {
        if (hoverEvent) eventBus.emit(`UI:${hoverEvent}`, { hovered: false });
      }, [hoverEvent, eventBus]),
    });

    const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
      if (hoverEvent && tapReveal) triggerProps.onPointerDown(e);
      onPointerDown?.(e);
    }, [hoverEvent, tapReveal, triggerProps, onPointerDown]);

    const isBand = backdrop != null || texture || edgeTop !== "none" || edgeBottom !== "none";
    // Only a declared padding prop is grown by the edge; padding set through className already clears it.
    const padKey = paddingY ?? padding;
    const bandStyle: React.CSSProperties = {};
    const padTop = padKey ? bandPadding(paddingRem[padKey], edgeTop) : undefined;
    const padBottom = padKey ? bandPadding(paddingRem[padKey], edgeBottom) : undefined;
    if (padTop) bandStyle.paddingTop = padTop;
    if (padBottom) bandStyle.paddingBottom = padBottom;
    const bandLayers = isBand ? (
      <>
        {backdrop != null && <Box as="span" data-band-layer="" aria-hidden className="band-backdrop">{backdrop}</Box>}
        {texture && <Box as="span" data-band-layer="" aria-hidden className="band-texture" />}
        {edgeTop !== "none" && (
          <Box as="span" data-band-layer="" aria-hidden className="band-edge band-edge-top" style={bandEdgeLayerStyle(edgeTop, "top", edgeFlip, edgeColor)} />
        )}
        {edgeBottom !== "none" && (
          <Box as="span" data-band-layer="" aria-hidden className="band-edge band-edge-bottom" style={bandEdgeLayerStyle(edgeBottom, "bottom", edgeFlip, edgeColor)} />
        )}
      </>
    ) : null;
    const isClickable = action || onClick;
    // A declared `action` makes the box a control: keyboard-operable, a button
    // unless the caller gives it its own role / tab stop.
    const actionControl = action && rest.role === undefined && rest.tabIndex === undefined
      ? pressableProps<HTMLDivElement>(handleClick)
      : {};
    // Polymorphic render via React.createElement — `as: React.ElementType`
    // collapses prop inference to `never` inside JSX, so the prior code
    // hid the issue with `as React.FC<Record<string, unknown>>`.
    // createElement's generic signature accepts the merged props verbatim
    // without that type lie.
    return React.createElement(
      Component,
      {
        ref: setRef,
        className: cn(
          padding && paddingStyles[padding],
          paddingX && paddingXStyles[paddingX],
          paddingY && paddingYStyles[paddingY],
          margin && marginStyles[margin],
          marginX && marginXStyles[marginX],
          marginY && marginYStyles[marginY],
          bgStyles[bg],
          border && "border-[length:var(--border-width)] border-border",
          roundedStyles[rounded],
          shadowStyles[shadow],
          display && displayStyles[display],
          fullWidth && "w-full",
          fullHeight && "h-full",
          overflow && overflowStyles[overflow],
          position && positionStyles[position],
          isClickable && "cursor-pointer",
          isBand && "band",
          className,
        ),
        onClick: isClickable ? handleClick : undefined,
        ...actionControl,
        onMouseEnter: (hoverEvent || onMouseEnter) ? handleMouseEnter : undefined,
        onMouseLeave: (hoverEvent || onMouseLeave) ? handleMouseLeave : undefined,
        onPointerDown: ((hoverEvent && tapReveal) || onPointerDown) ? handlePointerDown : undefined,
        style: (maxWidth || isBand) ? { ...(maxWidth ? { maxWidth } : {}), ...bandStyle, ...rest.style } : rest.style,
        ...rest,
        'data-theme': dataTheme,
        'data-motion': animateChanges ? 'presentation' : undefined,
      },
      isBand ? <>{bandLayers}{children}</> : children,
    );
  },
);

Box.displayName = "Box";

export default Box;
