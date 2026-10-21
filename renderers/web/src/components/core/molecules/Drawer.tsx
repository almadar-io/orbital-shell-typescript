'use client';
/**
 * Drawer Molecule Component
 *
 * A slide-in drawer component for displaying secondary content.
 * Used by the UI Slot system for render_ui effects targeting the drawer slot.
 *
 * Features:
 * - Left/right positioning
 * - Configurable width
 * - Overlay backdrop
 * - Click-outside to dismiss
 * - Slide animation
 * - Escape key to close
 *
 * @packageDocumentation
 */

import { actionTestId } from '@almadar/core';
import React, { useEffect, useId, useRef } from "react";
import type { EventKey, A11yProps } from "@almadar/core";
import { Box } from '../../../core';
import { Button } from '../../../core';
import { Typography } from '../../../core';
import { Overlay } from '../../../core';
import { usePresence } from '../../../core';
import { cn } from '../../../core';
import { SurfaceBoundary } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { useDialogBehavior } from '../../../core';

import { domPassthrough } from '../../../core';
// ============================================================================
// Types
// ============================================================================

export type DrawerPosition = "left" | "right";
export type DrawerSize = "sm" | "md" | "lg" | "xl" | "full";

export interface DrawerProps extends A11yProps {
  /** Whether the drawer is open (defaults to true when rendered by slot wrapper) */
  isOpen?: boolean;
  /**
   * Fires after the exit animation completes (the drawer is about to unmount).
   * @notification
   */
  onExited?: () => void;
  /** Render inside the nearest positioned ancestor (a preview frame) instead of over the window. */
  contained?: boolean;
  /** Callback when drawer should close (injected by slot wrapper) */
  onClose?: () => void;
  /** Drawer title (text or any node, e.g. a brand logo + name). */
  title?: React.ReactNode;
  /** Drawer content (can be empty if using slot content) */
  children?: React.ReactNode;
  /** Footer content */
  footer?: React.ReactNode;
  /** Position (left or right) */
  position?: DrawerPosition;
  /** Width (CSS value or preset size) */
  width?: string | DrawerSize;
  /** Show close button */
  showCloseButton?: boolean;
  /** Close on overlay click */
  closeOnOverlayClick?: boolean;
  /** Close on escape key */
  closeOnEscape?: boolean;
  /** Additional class name */
  className?: string;
  /** Declarative close event — emits UI:{closeEvent} via eventBus when drawer should close */
  closeEvent?: EventKey;
}

// ============================================================================
// Size Presets
// ============================================================================

// Width presets: fill the viewport on mobile (w-full); revert to the
// preset at `sm:` and above so the drawer behaves like a bottom-sheet-
// adjacent panel on phones and a true side-drawer on tablet+. Matches
// the responsiveness-audit's mobile-fill expectation.
const sizeWidths: Record<DrawerSize, string> = {
  sm: "w-full sm:w-80", // 320px
  md: "w-full sm:w-96", // 384px
  lg: "w-full sm:max-w-lg", // 512px (was 480px, +32)
  xl: "w-full sm:max-w-2xl", // 672px (was 640px, +32)
  full: "w-screen",
};

// ============================================================================
// Component
// ============================================================================

export const Drawer: React.FC<DrawerProps> = ({
  isOpen = true,
  onExited,
  contained = false,
  onClose = () => {},
  title,
  children = null,
  footer,
  position = "right",
  width = "md",
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  className,
  closeEvent,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const drawerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const emitClose = () => {
    if (closeEvent) eventBus.emit(`UI:${closeEvent}`, {});
    onClose();
  };
  useDialogBehavior({ open: isOpen, containerRef: drawerRef, onEscape: emitClose, closeOnEscape });

  // Enter/exit motion (token-driven). The slide direction is flipped per
  // side via the --motion-drawer-sign CSS var consumed by the drawer keyframes.
  const { mounted, className: drawerAnim, onAnimationEnd } = usePresence(isOpen, { animation: "drawer", onExited });

  // Prevent body scroll when open
  useEffect(() => {
    if (contained) return;
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen, contained]);

  if (!mounted) return null;

  const handleClose = emitClose;

  // Handle overlay click
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (closeOnOverlayClick && e.target === e.currentTarget) {
      handleClose();
    }
  };

  // Resolve width
  const widthClass = width in sizeWidths ? sizeWidths[width as DrawerSize] : "";
  const widthStyle = width in sizeWidths ? undefined : { width };

  // Position classes
  const positionClasses =
    position === "right" ? "right-0 border-l" : "left-0 border-r";

  // Drawer slide sign: right drawer enters from +100%, left from -100%.
  const drawerSign = position === "right" ? 1 : -1;
  // Literal slide transforms per side. Set inline so the keyframe's
  // var(--motion-drawer-enter/exit-*-transform) resolves against THIS element —
  // a sign var declared on :root does not re-substitute per element.
  const slideTransform = position === "right" ? "translateX(100%)" : "translateX(-100%)";

  return (
    <>
      {/* Overlay */}
      <Overlay
        isVisible={isOpen}
        onClick={handleOverlayClick}
        className={contained ? "absolute z-50" : "z-[60]"}
      />

      {/* Drawer */}
      <Box
        ref={drawerRef}
        bg="surface"
        border
        className={cn("shadow-elevation-dialog", 
          // Above the page's floating chrome (tool strips, chat pills: z-50), like SidePanel.
          contained ? "absolute top-0 bottom-0 z-50 surface-material" : "fixed top-0 bottom-0 z-[60] surface-material",
          "flex flex-col",
          contained ? "max-h-full" : "max-h-screen",
          positionClasses,
          widthClass,
          drawerAnim,
          className,
        )}
        style={{ ...widthStyle, "--motion-drawer-sign": drawerSign, "--motion-drawer-enter-from-transform": slideTransform, "--motion-drawer-exit-to-transform": slideTransform } as React.CSSProperties}
        {...domPassthrough(rest)}
        role="dialog"
        aria-modal="true"
        onAnimationEnd={onAnimationEnd}
        {...(title && !rest['aria-labelledby'] && { "aria-labelledby": titleId })}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <Box
            className={cn(
              "px-6 py-4 flex items-center justify-between shrink-0",
              "border-b-[length:var(--border-width)] border-border",
            )}
          >
            {title && (
              <Typography variant="h4" as="h2" id={titleId}>
                {title}
              </Typography>
            )}
            {showCloseButton && (
              <Button
                variant="ghost"
                size="sm"
                icon="x"
                onClick={handleClose}
                data-event="CLOSE"
                data-testid={actionTestId("CLOSE")}
                aria-label={t('aria.closeDrawer')}
                className={cn(!title && "ml-auto")}
              />
            )}
          </Box>
        )}

        {/* Content */}
        <Box className="flex-1 overflow-y-auto p-6"><SurfaceBoundary>{children}</SurfaceBoundary></Box>

        {/* Footer */}
        {footer && (
          <Box
            className={cn(
              "px-6 py-4 shrink-0 bg-muted",
              "border-t-[length:var(--border-width)] border-border",
            )}
          >
            {footer}
          </Box>
        )}
      </Box>

    </>
  );
};

Drawer.displayName = "Drawer";