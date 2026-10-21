'use client';
/**
 * Overlay Atom Component
 *
 * A fixed backdrop for modals and drawers.
 */
import { domPassthrough } from '../lib/domPassthrough';
import React from "react";
import type { A11yProps, EventKey } from "@almadar/core";
import { cn } from "../lib/cn";
import { useEventBus } from "../hooks/useEventBus";
import { usePresence } from "./Presence";

export interface OverlayProps extends A11yProps {
  isVisible?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  blur?: boolean;
  /** Declarative event name — emits UI:{action} via eventBus on click */
  action?: EventKey;
}

export const Overlay: React.FC<OverlayProps> = ({
  isVisible = true,
  onClick,
  className,
  blur = false,
  action,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { mounted, className: animClass, onAnimationEnd } = usePresence(isVisible, { animation: "overlay" });

  if (!mounted) return null;

  const handleClick = (e: React.MouseEvent) => {
    if (action) {
      eventBus.emit(`UI:${action}`, {});
    }
    onClick?.(e);
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 bg-scrim",
        blur && "backdrop-blur-sm",
        animClass,
        className,
      )}
      onClick={(action || onClick) ? handleClick : undefined}
      onAnimationEnd={onAnimationEnd}
      {...domPassthrough(rest)}
      aria-hidden="true"
    />
  );
};

export default Overlay;
