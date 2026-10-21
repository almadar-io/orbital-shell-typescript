'use client';
/**
 * Popover Molecule Component
 *
 * A popover component with position variants and click/hover triggers.
 * Uses Button, Typography, and Icon atoms.
 */

import type { A11yProps } from '@almadar/core';
import React, { useState, useRef, useEffect, useLayoutEffect, useId } from "react";
import { Typography } from '../../../core';
import { usePresence } from '../../../core';
import { cn } from '../../../core';
import { SurfaceBoundary } from '../../../core';
import { useTapReveal } from '../../../core';
import { ThemedPortal } from "../../../lib/ThemedPortal";
import { useDialogBehavior } from '../../../core';

import { domPassthrough } from '../../../core';
export type PopoverPosition = "top" | "bottom" | "left" | "right";

const INTERACTIVE_SELECTOR = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
export type PopoverTrigger = "click" | "hover";

/** How long a hover popover waits after the pointer leaves before closing, so it can be crossed into. */
export const HOVER_CLOSE_DELAY_MS = 150;

export interface PopoverProps extends A11yProps {
  /**
   * Popover content
   */
  content: React.ReactNode;

  /**
   * Popover trigger element (ReactElement or ReactNode that will be wrapped in span)
   */
  children: React.ReactNode;

  /**
   * Popover position
   * @default 'bottom'
   */
  position?: PopoverPosition;

  /**
   * Trigger type
   * @default 'click'
   */
  trigger?: PopoverTrigger;

  /**
   * Show arrow
   * @default true
   */
  showArrow?: boolean;

  /**
   * Controlled open state. When set, the host owns visibility and the popover
   * reports intent through onOpenChange instead of toggling itself.
   */
  open?: boolean;

  /**
   * Fired when the popover wants to change visibility (trigger click, outside click)
   */
  onOpenChange?: (open: boolean) => void;

  /**
   * Additional CSS classes
   */
  className?: string;
}

const arrowClasses: Record<PopoverPosition, string> = {
  top: "top-full left-1/2 -translate-x-1/2 border-t-white border-l-transparent border-r-transparent border-b-transparent",
  bottom:
    "bottom-full left-1/2 -translate-x-1/2 border-b-white border-l-transparent border-r-transparent border-t-transparent",
  left: "left-full top-1/2 -translate-y-1/2 border-l-white border-t-transparent border-b-transparent border-r-transparent",
  right:
    "right-full top-1/2 -translate-y-1/2 border-r-white border-t-transparent border-b-transparent border-l-transparent",
};

const VIEWPORT_EDGE_PADDING = 8;
const TRIGGER_GAP = 8;

interface Box2 { left: number; top: number; right: number; bottom: number; width: number; height: number }

/**
 * Where the portaled `fixed` panel goes, in viewport pixels: on the asked
 * side of the trigger, flipped to the opposite side when the asked one has
 * no room, and clamped so it never leaves the viewport. All offsets are baked
 * into `left`/`top` so the panel needs no positioning classes (those resolve
 * against the viewport on a `fixed` element and yank it off its trigger).
 */
export function placePopover(
  position: PopoverPosition,
  trigger: Box2,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
): { side: PopoverPosition; left: number; top: number } {
  const clamp = (value: number, size: number, extent: number) =>
    Math.max(VIEWPORT_EDGE_PADDING, Math.min(value, Math.max(VIEWPORT_EDGE_PADDING, extent - size - VIEWPORT_EDGE_PADDING)));
  if (position === "left" || position === "right") {
    const rightLeft = trigger.right + TRIGGER_GAP;
    const leftLeft = trigger.left - panel.width - TRIGGER_GAP;
    const fitsRight = rightLeft + panel.width <= viewport.width - VIEWPORT_EDGE_PADDING;
    const fitsLeft = leftLeft >= VIEWPORT_EDGE_PADDING;
    const side: PopoverPosition = position === "right" ? (fitsRight || !fitsLeft ? "right" : "left") : fitsLeft || !fitsRight ? "left" : "right";
    const left = clamp(side === "right" ? rightLeft : leftLeft, panel.width, viewport.width);
    const top = clamp(trigger.top + trigger.height / 2 - panel.height / 2, panel.height, viewport.height);
    return { side, left, top };
  }
  const aboveTop = trigger.top - TRIGGER_GAP - panel.height;
  const belowTop = trigger.bottom + TRIGGER_GAP;
  const fitsAbove = aboveTop >= VIEWPORT_EDGE_PADDING;
  const fitsBelow = belowTop + panel.height <= viewport.height - VIEWPORT_EDGE_PADDING;
  const side: PopoverPosition = position === "top" ? (fitsAbove || !fitsBelow ? "top" : "bottom") : fitsBelow || !fitsAbove ? "bottom" : "top";
  const left = clamp(trigger.left + trigger.width / 2 - panel.width / 2, panel.width, viewport.width);
  const top = clamp(side === "top" ? aboveTop : belowTop, panel.height, viewport.height);
  return { side, left, top };
}

export const Popover: React.FC<PopoverProps> = ({
  content,
  children,
  position = "bottom",
  trigger = "click",
  showArrow = true,
  open,
  onOpenChange,
  className,
  ...rest
}) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open !== undefined ? open : uncontrolledOpen;
  const setIsOpen = (next: boolean) => {
    if (open === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const [panelSize, setPanelSize] = useState({ width: 0, height: 0 });
  const popoverWidth = panelSize.width;
  const triggerRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Enter/exit motion. Panel stays mounted through the exit animation.
  const { mounted, className: panelAnim, onAnimationEnd } = usePresence(isOpen, { animation: "popover" });

  const updatePosition = () => {
    if (triggerRef.current) {
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    }
    if (popoverRef.current) {
      setPanelSize({ width: popoverRef.current.offsetWidth, height: popoverRef.current.offsetHeight });
    }
  };

  const handleOpen = () => {
    updatePosition();
    setIsOpen(true);
  };

  const handleClose = () => {
    cancelHoverClose();
    setIsOpen(false);
  };

  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHoverClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleHoverClose = () => {
    cancelHoverClose();
    closeTimer.current = setTimeout(handleClose, HOVER_CLOSE_DELAY_MS);
  };
  const hoverOpen = () => {
    cancelHoverClose();
    if (!isOpen) handleOpen();
  };
  useEffect(() => cancelHoverClose, []);

  const panelId = useId();
  const focusReturnRef = useRef<HTMLElement | null>(null);
  // A hover popover never takes focus, so it hands none back (that refocus would reopen it).
  useDialogBehavior({ open: isOpen, containerRef: popoverRef, onEscape: handleClose, modal: false, ...(trigger === "click" ? { returnFocusRef: focusReturnRef } : {}) });

  const handleToggle = () => {
    if (isOpen) {
      handleClose();
    } else {
      handleOpen();
    }
  };

  useEffect(() => {
    if (isOpen) {
      updatePosition();
    }
  }, [isOpen]);

  // The panel is positioned from the trigger's rect at open time, but the
  // trigger can keep moving afterwards (async content settling inside a
  // fixed-height shell, scrolls, resizes — none of which resize <body>).
  // While open, follow the trigger's actual rect frame-by-frame so the
  // panel stays glued to it; the loop only lives for the open duration.
  useEffect(() => {
    if (!isOpen) return;
    let raf = 0;
    let lastTop = Number.NaN;
    let lastLeft = Number.NaN;
    const track = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect && (rect.top !== lastTop || rect.left !== lastLeft)) {
        lastTop = rect.top;
        lastLeft = rect.left;
        updatePosition();
      }
      raf = requestAnimationFrame(track);
    };
    raf = requestAnimationFrame(track);
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  // Reset the measured width only once the panel has fully unmounted (not
  // at the start of the exit animation, which would flash it hidden).
  useEffect(() => {
    if (!mounted) setPanelSize({ width: 0, height: 0 });
  }, [mounted]);

  useLayoutEffect(() => {
    if (isOpen && popoverRef.current) {
      const width = popoverRef.current.offsetWidth;
      const height = popoverRef.current.offsetHeight;
      if (width !== panelSize.width || height !== panelSize.height) {
        setPanelSize({ width, height });
      }
    }
  });

  useEffect(() => {
    if (trigger !== "click") {
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (
        isOpen &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, trigger]);

  // Hover popovers are unreachable on touch (no hover). A tap opens through the
  // SAME open/close path; an outside tap dismisses. Click/controlled modes are
  // already touch-friendly, so the hook is disabled there.
  const { triggerProps: tapTriggerProps } = useTapReveal({
    enabled: trigger === "hover",
    onReveal: handleOpen,
    onDismiss: handleClose,
    refs: [triggerRef, popoverRef],
  });

  const handlerProps =
    trigger === "click"
      ? {
          onClick: handleToggle,
        }
      : {
          onMouseEnter: hoverOpen,
          onMouseLeave: scheduleHoverClose,
          onFocus: hoverOpen,
          onBlur: scheduleHoverClose,
          onPointerDown: tapTriggerProps.onPointerDown,
          "data-popover-open": String(isOpen),
        };

  // Non-element children are wrapped in a span. A click trigger's dialog semantics
  // belong on the control the user operates: the wrapped content's own control when
  // it has one (a rendered `button` pattern), else the span itself as a button.
  const wrapsContent = !React.isValidElement(children);
  const [innerControl, setInnerControl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!wrapsContent || trigger !== "click") return;
    setInnerControl(triggerRef.current?.querySelector<HTMLElement>(INTERACTIVE_SELECTOR) ?? null);
  }, [wrapsContent, trigger, children]);
  useLayoutEffect(() => {
    focusReturnRef.current = innerControl ?? triggerRef.current;
  });
  useLayoutEffect(() => {
    if (innerControl === null) return;
    innerControl.setAttribute("aria-expanded", String(isOpen));
    innerControl.setAttribute("aria-haspopup", "dialog");
    if (mounted) innerControl.setAttribute("aria-controls", panelId);
    else innerControl.removeAttribute("aria-controls");
  }, [innerControl, isOpen, mounted, panelId]);
  const triggerIsWrapper = innerControl === null;

  const childElement = !wrapsContent ? (
    children
  ) : trigger === "click" && triggerIsWrapper ? (
    <span
      role="button"
      tabIndex={0}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleToggle();
        }
      }}
    >
      {children}
    </span>
  ) : (
    <span>{children}</span>
  );

  const childPointerDown = (
    childElement as React.ReactElement<{ onPointerDown?: (e: React.PointerEvent) => void }>
  ).props.onPointerDown;

  const triggerElement = React.cloneElement(
    childElement as React.ReactElement<any>,
    {
      ref: triggerRef,
      ...handlerProps,
      // Dialog semantics belong to a click-opened panel; a hover popover is a tooltip.
      ...(trigger === "click" && triggerIsWrapper
        ? {
            "aria-expanded": isOpen,
            "aria-haspopup": "dialog",
            ...(mounted ? { "aria-controls": panelId } : undefined),
          }
        : undefined),
      ...(trigger === "hover"
        ? {
            onPointerDown: (e: React.PointerEvent) => {
              tapTriggerProps.onPointerDown(e);
              childPointerDown?.(e);
            },
          }
        : undefined),
    },
  );

  // Portal the panel into the theme-synced portal root so `position: fixed`
  // resolves against the viewport. Without this, any ancestor with a non-`none`
  // `transform` (ReactFlow's `.react-flow__viewport`, PreviewFrame's
  // `translate3d(0,0,0)` chrome-scoping trick, etc.) becomes the
  // containing block for the fixed panel and shifts it off the trigger.
  const placement = triggerRect
    ? placePopover(position, triggerRect, panelSize, {
        width: typeof window !== "undefined" ? window.innerWidth : 1024,
        height: typeof window !== "undefined" ? window.innerHeight : 768,
      })
    : null;
  const panel = mounted && placement ? (
    <div
      ref={popoverRef}
      className={cn(
        "fixed z-50 p-4",
        "bg-card surface-material rounded-container border-heavy border-border shadow-elevation-popover",
        panelAnim,
        className,
      )}
      style={{
        left: placement.left,
        top: placement.top,
        ...(popoverWidth === 0 ? { visibility: 'hidden' as const } : undefined),
      }}
      {...domPassthrough(rest)}
      id={panelId}
      role="dialog"
      aria-label={rest['aria-label'] ?? (typeof content === "string" ? content : undefined)}
      onAnimationEnd={onAnimationEnd}
      onMouseEnter={trigger === "hover" ? hoverOpen : undefined}
      onMouseLeave={trigger === "hover" ? scheduleHoverClose : undefined}
    >
      {typeof content === "string" ? (
        <Typography variant="body">{content}</Typography>
      ) : (
        <SurfaceBoundary>{content}</SurfaceBoundary>
      )}
      {showArrow && (
        <div
          className={cn(
            "absolute w-0 h-0 border-heavy",
            arrowClasses[placement.side],
          )}
        />
      )}
    </div>
  ) : null;

  return (
    <>
      {triggerElement}
      {panel && typeof document !== "undefined"
        ? (<ThemedPortal>{panel}</ThemedPortal>)
        : panel}
    </>
  );
};

Popover.displayName = "Popover";
