'use client';
/**
 * Modal Molecule Component
 *
 * A modal dialog component with overlay, header, content, and footer.
 * Uses theme-aware CSS variables for styling.
 */

import { actionTestId } from '@almadar/core';
import React, { useEffect, useId, useRef, useState } from "react";
import type { EventEmit, A11yProps } from "@almadar/core";
import { Box } from '../../../core';
import { Button } from '../../../core';
import { Dialog } from '../../../core';
import { Typography } from '../../../core';
import { cn } from '../../../core';
import { SurfaceBoundary } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { useDialogBehavior } from '../../../core';
import { useMediaQuery, MOBILE_MEDIA_QUERY } from '../../../core';
import { usePresence } from '../../../core';
import { useVisibleBand } from '../../../core';
import { ThemedPortal } from "../../../lib/ThemedPortal";

import { domPassthrough } from '../../../core';
export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

/**
 * Layer 2 visual treatment for the modal pattern — orthogonal to the semantic
 * `size` (which conveys content scale).
 */
export type ModalLook =
  | "centered-card"
  | "top-sheet"
  | "side-drawer"
  | "full-screen";

export interface ModalProps extends A11yProps {
  /** Whether the modal is open (defaults to true when rendered by slot wrapper) */
  isOpen?: boolean;
  /** Callback when modal should close (injected by slot wrapper) */
  onClose?: () => void;
  /**
   * Fires after the exit animation completes (the modal is about to unmount).
   * @notification
   */
  onExited?: () => void;
  title?: string;
  /** Modal content (can be empty if using slot content) */
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: ModalSize;
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  className?: string;
  /** Declarative close event — emits UI:{closeEvent} via eventBus when modal should close */
  closeEvent?: EventEmit<Record<string, never>>;
  /** Enable swipe-down-to-close on mobile bottom sheet (default: true) */
  swipeDownToClose?: boolean;
  /** Layer 2 visual treatment — orthogonal to the semantic variant. */
  look?: ModalLook;
  /**
   * Render inside the nearest positioned ancestor (a preview frame) instead of
   * portaling over the whole window; page scroll is left alone.
   */
  contained?: boolean;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
  full: "max-w-full mx-4",
};

// `minWidthClasses` floors the dialog above mobile, capped at 100% so a
// contained modal never overflows a preview narrower than the floor. On phones (`max-sm:`)
// the floor drops to 0 so the full-screen variant shrinks to viewport
// width without the modal-* floors fighting it. Kept as
// Tailwind classes (not inline style) so media-query overrides can win.
const minWidthClasses: Record<ModalSize, string> = {
  sm: "min-w-[min(theme(minWidth.modal-sm),100%)] max-sm:min-w-0",
  md: "min-w-[min(theme(minWidth.modal-md),100%)] max-sm:min-w-0",
  lg: "min-w-[min(theme(minWidth.modal-lg),100%)] max-sm:min-w-0",
  xl: "min-w-[min(theme(minWidth.modal-xl),100%)] max-sm:min-w-0",
  full: "min-w-0",
};

// Layer 2 look styles — applied AFTER sizeClasses/minWidthClasses so they
// override positioning, radius, and width caps. Empty string for
// `centered-card` since the default already produces that treatment. Each
// non-default look is a delta on the baseline.
const lookStyles: Record<ModalLook, string> = {
  "centered-card": "",
  "top-sheet": "top-0 rounded-t-none rounded-b-container max-w-full w-full",
  "side-drawer":
    "right-0 top-0 bottom-0 h-full rounded-l-container rounded-r-none w-[400px] max-w-full",
  "full-screen": "inset-0 rounded-none w-full h-full max-w-full",
};

export const Modal: React.FC<ModalProps> = ({
  isOpen = true,
  onClose = () => {},
  onExited,
  title,
  children = null,
  footer,
  size = "md",
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  className,
  closeEvent,
  swipeDownToClose = true,
  look = "centered-card",
  contained = false,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const sheet = useMediaQuery(MOBILE_MEDIA_QUERY) && look === "centered-card";
  const modalRef = useRef<HTMLDialogElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [dragY, setDragY] = useState(0);
  const dragStartY = useRef(0);
  const isDragging = useRef(false);
  // Presence keeps the dialog mounted through the entire exit animation
  // (mounted stays true while exiting), so the dialog is never
  // unmounted-then-remounted — only its className swaps modal-in→modal-out.
  const { mounted, exiting, className: presenceAnim, onAnimationEnd: handleAnimEnd } = usePresence(isOpen, {
    animation: "modal",
    onExited,
  });

  const emitClose = () => {
    if (closeEvent) eventBus.emit(`UI:${closeEvent}`, {});
    onClose();
  };
  useDialogBehavior({ open: isOpen, containerRef: modalRef, onEscape: emitClose, closeOnEscape });

  useEffect(() => {
    if (contained && !sheet) return;
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen, contained, sheet]);

  const band = useVisibleBand(layerRef, contained && mounted);

  if (typeof document === "undefined") return null;
  if (!mounted) return null;
  // Presence yields no class when motion is off (`--motion-enable`, reduced motion).
  const dialogAnim = presenceAnim
    ? (sheet ? (exiting ? "animate-sheet-out" : "animate-sheet-in") : (exiting ? "animate-modal-out" : "animate-modal-in"))
    : "";
  const overlayAnim = presenceAnim ? (exiting ? "animate-overlay-out" : "animate-overlay-in") : "";

  const handleClose = emitClose;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (closeOnOverlayClick && e.target === e.currentTarget) {
      handleClose();
    }
  };

  // Portal into the theme-synced portal root so the dialog escapes any
  // ancestor stacking/overflow context (sticky sidebars, transformed panes)
  // while still inheriting the app's data-theme.
  // Single div is both the dark backdrop AND the flex-centering container —
  // two sibling `fixed inset-0` layers cause a ghost compositor artifact.
  // No aria-hidden here: this div is also the open Dialog's ancestor, and
  // Dialog already declares its own role="dialog"/aria-modal="true".
  const placement = sheet
    ? "flex items-end justify-center p-0"
    : cn("flex items-start justify-center px-4 pb-4", contained ? "pt-[10%]" : "pt-[10vh]");
  const dialog = (
        <Dialog
          ref={modalRef}
          {...domPassthrough(rest)}
          open
          className={cn(
            // Reset browser-default dialog chrome — we own styling. `static`
            // overrides the user-agent `position: absolute` so the parent
            // flex container's `justify-center` actually centers the dialog
            // (without this, the dialog drops out of flex flow and `m-0`
            // kills the user-agent's `margin: auto` centering, pinning the
            // dialog to top-left).
            "static m-0 p-0 border-0 bg-transparent",
            // Pre-existing dialog frame
            "pointer-events-auto w-full flex flex-col bg-surface surface-material border shadow-elevation-dialog rounded-container",
            // Desktop sizing + viewport-aware floor.
            sizeClasses[size],
            minWidthClasses[size],
            contained ? "max-h-[80%]" : "max-h-[80vh]",
            // Phones: a bottom sheet anchored to the bottom edge — full
            // width, capped at 90vh (content scrolls inside), round top
            // corners, clear of the home indicator.
            sheet && cn("max-w-none min-w-0 w-full rounded-t-container rounded-b-none pb-[env(safe-area-inset-bottom)]", contained ? "max-h-[90%]" : "max-h-[90vh] max-h-[90dvh]"),
            lookStyles[look],
            className,
            dialogAnim,
          )}
          onAnimationEnd={handleAnimEnd}
          style={dragY > 0 ? {
            transform: `translateY(${dragY}px)`,
            transition: isDragging.current ? 'none' : 'transform 200ms ease-out',
          } : undefined}
          {...(title && !rest['aria-labelledby'] && { "aria-labelledby": titleId })}
        >
          {/* Drag handle (mobile bottom sheet) */}
          <Box
            className={cn("justify-center py-2 cursor-grab active:cursor-grabbing touch-none shrink-0", sheet ? "flex" : "hidden")}
            data-sheet-handle=""
            onPointerDown={(e) => {
              if (!swipeDownToClose) return;
              dragStartY.current = e.clientY;
              isDragging.current = true;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!isDragging.current) return;
              const dy = Math.max(0, e.clientY - dragStartY.current);
              setDragY(dy);
            }}
            onPointerUp={() => {
              if (!isDragging.current) return;
              isDragging.current = false;
              if (dragY > 100) {
                handleClose();
              }
              setDragY(0);
            }}
            onPointerCancel={() => {
              isDragging.current = false;
              setDragY(0);
            }}
          >
            <Box className="w-10 h-1 rounded-full bg-border" />
          </Box>

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
                  aria-label={t('aria.closeModal')}
                />
              )}
            </Box>
          )}

          {/* Content */}
          <Box className="flex-1 min-h-0 overflow-y-auto p-6"><SurfaceBoundary>{children}</SurfaceBoundary></Box>

          {/* Footer */}
          {footer && (
            <Box
              className={cn(
                "px-6 py-4 bg-muted shrink-0",
                "border-t-[length:var(--border-width)] border-border",
              )}
            >
              {footer}
            </Box>
          )}
        </Dialog>
  );
  // A contained frame can be taller than what is on screen; the dialog sits in the visible band.
  const layer = (
    <div
      ref={layerRef}
      className={cn(
        contained ? "absolute inset-0 z-50" : "fixed inset-0 z-[1000]",
        "bg-scrim",
        !contained && placement,
        overlayAnim,
      )}
      onClick={handleOverlayClick}
    >
      {contained ? (
      <div
        className={cn("absolute inset-x-0", placement)}
        style={band ? { top: band.top, height: band.height } : { top: 0, bottom: 0 }}
        data-modal-band=""
        onClick={handleOverlayClick}
      >
          {dialog}
        </div>
      ) : dialog}
    </div>
  );
  return contained ? layer : <ThemedPortal>{layer}</ThemedPortal>;
};

Modal.displayName = "Modal";
