'use client';
/**
 * SidePanel — fixed side panel for contextual detail on top of the page layout.
 * Distinct from Drawer: Drawer is driven by the UI Slot system (render_ui drawer)
 * and is generic. SidePanel is a direct-render component with its own close event
 * API, used where the panel is always present in the component tree.
 */

import React from "react";
import type { EventEmit, A11yProps } from "@almadar/core";
import { Aside } from '../../../core';
import { Box } from '../../../core';
import { Button } from '../../../core';
import { Typography } from '../../../core';
import { Presence, usePresence } from '../../../core';
import { cn } from '../../../core';
import { SurfaceBoundary } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
export interface SidePanelProps extends A11yProps {
  /**
   * Panel title
   */
  title: string;

  /**
   * Panel content
   */
  children: React.ReactNode;

  /**
   * Is panel open
   */
  isOpen: boolean;

  /**
   * On close handler
   */
  onClose: () => void;

  /**
   * Panel width as Tailwind class string. Default fills the viewport on
   * mobile and snaps to `w-96` (384 px) at `sm:` and above so phones
   * don't lose content to a fixed 384 px column. Consumers passing a
   * custom value should include a `w-full` mobile fallback in the same
   * string (e.g. `"w-full sm:w-[480px]"`) — Tailwind's JIT can't see
   * dynamically-concatenated class names.
   * @default 'w-full sm:w-96'
   */
  width?: string;

  /**
   * Panel position
   * @default 'right'
   */
  position?: "left" | "right";

  /**
   * Show overlay on mobile
   * @default true
   */
  showOverlay?: boolean;

  /**
   * Additional CSS classes
   */
  className?: string;

  /** Declarative close event — emits UI:{closeEvent} via eventBus when panel should close */
  closeEvent?: EventEmit<Record<string, never>>;
}

export const SidePanel: React.FC<SidePanelProps> = ({
  title,
  children,
  isOpen,
  onClose,
  width = "w-full sm:w-96",
  position = "right",
  showOverlay = true,
  className,
  closeEvent,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();

  const handleClose = () => {
    if (closeEvent) eventBus.emit(`UI:${closeEvent}`, {});
    onClose();
  };

  // Enter/exit slide. Direction flips per side via --motion-drawer-sign.
  const { mounted, className: panelAnim, onAnimationEnd } = usePresence(isOpen, { animation: "drawer" });
  const drawerSign = position === "right" ? 1 : -1;

  if (!mounted) return null;

  return (
    <>
      {/* Overlay */}
      {showOverlay && (
        <Presence show={isOpen} animation="overlay">
          <Box
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
            onClick={handleClose}
          />
        </Presence>
      )}

      {/* Side Panel — fills the viewport on mobile, uses the `width` prop
          (default `w-96`) at `sm:` and above so phones don't lose content
          to a fixed 384 px column. */}
      <Aside
        {...domPassthrough(rest)}
        className={cn(
          "fixed top-16 lg:top-0 bottom-0 z-[60]",
          "bg-card surface-material",
          "border-l-heavy border-border",
          position === "left" && "border-l-0 border-r-heavy",
          "flex flex-col",
          panelAnim,
          width,
          position === "right" ? "right-0" : "left-0",
          className,
        )}
        style={{ "--motion-drawer-sign": drawerSign } as React.CSSProperties}
        onAnimationEnd={onAnimationEnd}
      >
        {/* Header */}
        <Box className="flex items-center justify-between p-4 border-b-heavy border-border sticky top-0 bg-card z-10">
          <Typography variant="h6">{title}</Typography>
          <Button
            variant="ghost"
            size="sm"
            icon="x"
            onClick={handleClose}
            aria-label={t('aria.closePanel')}
          >
            <Typography variant="small" as="span" className="sr-only">{t('aria.closePanel')}</Typography>
          </Button>
        </Box>

        {/* Content */}
        <Box className="p-4 flex-1 overflow-y-auto"><SurfaceBoundary>{children}</SurfaceBoundary></Box>
      </Aside>
    </>
  );
};

SidePanel.displayName = "SidePanel";