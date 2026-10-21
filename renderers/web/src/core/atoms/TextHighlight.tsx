'use client';
/**
 * TextHighlight Atom Component
 *
 * A styled span component for highlighting text with annotations (questions or notes).
 * Uses different colors for different annotation types:
 * - Questions: Blue highlight
 * - Notes: Yellow highlight
 */

import React from "react";
import type { A11yProps, EventEmit } from "@almadar/core";
import { domPassthrough } from "../lib/domPassthrough";
import { cn } from "../lib/cn";
import { useEventBus } from "../hooks/useEventBus";

export type HighlightType = "question" | "note";

export interface TextHighlightProps extends A11yProps {
  /**
   * Type of highlight (determines color)
   */
  highlightType: HighlightType;

  /**
   * Whether the highlight is currently active/focused
   * @default false
   */
  isActive?: boolean;

  /**
   * Callback when highlight is clicked
   */
  onClick?: () => void;

  /**
   * Callback when highlight is hovered
   * @notification
   */
  onMouseEnter?: () => void;

  /**
   * Callback when hover ends
   * @notification
   */
  onMouseLeave?: () => void;

  /**
   * Unique ID for the annotation
   */
  annotationId?: string;

  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Highlighted text content
   */
  children: React.ReactNode;

  /** Declarative event name — emits UI:{action} via eventBus on click */
  action?: EventEmit<{ annotationId?: string }>;

  /**
   * Declarative hover event — emits UI:{hoverEvent} with { hovered, annotationId }
   * @notification
   */
  hoverEvent?: EventEmit<{ hovered: boolean; annotationId?: string }>;
}

/**
 * TextHighlight component for rendering highlighted text annotations
 */
export const TextHighlight: React.FC<TextHighlightProps> = ({
  highlightType,
  isActive = false,
  onClick,
  onMouseEnter,
  onMouseLeave,
  annotationId,
  className,
  children,
  action,
  hoverEvent,
  ...rest
}) => {
  const eventBus = useEventBus();
  const baseStyles = "cursor-pointer transition-all duration-fast";

  const typeStyles = {
    question: cn(
      // Blue border for questions
      "bg-card border-b-heavy border-primary",
      "hover:bg-muted",
      isActive && "bg-primary/10 ring-2 ring-primary",
    ),
    note: cn(
      // Yellow border for notes
      "bg-card border-b-heavy border-warning",
      "hover:bg-muted",
      isActive && "bg-warning/10 ring-2 ring-warning",
    ),
  };

  return (
    <span
      data-highlight="true"
      data-highlight-type={highlightType}
      data-annotation-id={annotationId}
      className={cn(baseStyles, typeStyles[highlightType], className)}
      onClick={() => {
        if (action) eventBus.emit(`UI:${action}`, { annotationId });
        onClick?.();
      }}
      onMouseEnter={() => {
        if (hoverEvent) eventBus.emit(`UI:${hoverEvent}`, { hovered: true, annotationId });
        onMouseEnter?.();
      }}
      onMouseLeave={() => {
        if (hoverEvent) eventBus.emit(`UI:${hoverEvent}`, { hovered: false, annotationId });
        onMouseLeave?.();
      }}
      onPointerDown={(e) => {
        // Touch/pen has no hover: a tap emits the SAME hover event the mouse-enter path fires.
        if (e.pointerType === "mouse") return;
        if (hoverEvent) eventBus.emit(`UI:${hoverEvent}`, { hovered: true, annotationId });
        onMouseEnter?.();
      }}
      role="button"
      tabIndex={0}
      aria-pressed={isActive}
      {...domPassthrough(rest)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (action) eventBus.emit(`UI:${action}`, { annotationId });
          onClick?.();
        }
      }}
    >
      {children}
    </span>
  );
};

TextHighlight.displayName = "TextHighlight";
