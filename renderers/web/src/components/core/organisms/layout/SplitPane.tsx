'use client';
/**
 * SplitPane Component
 *
 * Two-pane resizable split layout for master-detail views,
 * dual-pane editors, and code + preview layouts.
 *
 * Uses wireframe theme styling (high contrast, sharp edges).
 */
import React, { useState, useRef, useCallback } from "react";
import type { A11yProps } from "@almadar/core";
import { cn } from '../../../../core';
import { domPassthrough } from '../../../../core';

export interface SplitPaneProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  /** Direction of the split */
  direction?: "horizontal" | "vertical";
  /** Initial ratio (0-100, percentage of first pane) */
  ratio?: number;
  /** Minimum size of either pane in pixels */
  minSize?: number;
  /** Allow user resizing */
  resizable?: boolean;
  /** Content for the left/top pane */
  left: React.ReactNode;
  /** Content for the right/bottom pane */
  right: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Class for left/top pane */
  leftClassName?: string;
  /** Class for right/bottom pane */
  rightClassName?: string;
  /** Called with the new ratio while dragging. Providing this makes `ratio`
   *  controlled — the rendered split always tracks the prop instead of
   *  internal state, mirroring a controlled input. Omit for uncontrolled
   * @notification
   *  (self-tracked) behavior. */
  onRatioChange?: (ratio: number) => void;
}

/**
 * SplitPane - Two-pane resizable layout
 */
export const SplitPane: React.FC<SplitPaneProps> = ({
  direction = "horizontal",
  ratio: ratioProp = 50,
  minSize = 100,
  resizable = true,
  left,
  right,
  className,
  leftClassName,
  rightClassName,
  onRatioChange,
  ...rest
}) => {
  const [uncontrolledRatio, setUncontrolledRatio] = useState(ratioProp);
  // Controlled when `onRatioChange` is passed — `ratio` always tracks the
  // prop, so a parent update re-syncs the split on the next render for free.
  const ratio = onRatioChange ? ratioProp : uncontrolledRatio;
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!resizable) return;
      e.preventDefault();
      isDragging.current = true;
      // Pointer Events unify mouse/touch/pen; capture keeps the drag tracking
      // off the handle even when the pointer leaves it.
      e.currentTarget.setPointerCapture(e.pointerId);

      const handlePointerMove = (ev: PointerEvent) => {
        if (!isDragging.current || !containerRef.current) return;

        const rect = containerRef.current.getBoundingClientRect();
        let newRatio: number;

        if (direction === "horizontal") {
          const x = ev.clientX - rect.left;
          newRatio = (x / rect.width) * 100;
        } else {
          const y = ev.clientY - rect.top;
          newRatio = (y / rect.height) * 100;
        }

        // Clamp to min/max based on minSize
        const minRatio =
          (minSize / (direction === "horizontal" ? rect.width : rect.height)) *
          100;
        const maxRatio = 100 - minRatio;
        newRatio = Math.max(minRatio, Math.min(maxRatio, newRatio));

        if (onRatioChange) {
          onRatioChange(newRatio);
        } else {
          setUncontrolledRatio(newRatio);
        }
      };

      const handlePointerUp = () => {
        isDragging.current = false;
        document.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("pointerup", handlePointerUp);
        document.removeEventListener("pointercancel", handlePointerUp);
      };

      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
      document.addEventListener("pointercancel", handlePointerUp);
    },
    [direction, minSize, resizable, onRatioChange],
  );

  const isHorizontal = direction === "horizontal";

  return (
    <div
      ref={containerRef}
      {...domPassthrough(rest)}
      className={cn(
        "flex w-full h-full",
        isHorizontal ? "flex-row" : "flex-col",
        className,
      )}
    >
      {/* Panes are flex columns so a lone child fills them whether it is
          h-full-styled or a flex item (flex-1) — a block wrapper gives
          flex-item children height:auto and they collapse to content. */}
      <div
        className={cn("flex flex-col overflow-auto", leftClassName)}
        style={{
          [isHorizontal ? "width" : "height"]: `${ratio}%`,
          flexShrink: 0,
        }}
      >
        {left}
      </div>

      {/* Resize handle */}
      {resizable && (
        <div
          onPointerDown={handlePointerDown}
          className={cn(
            "flex-shrink-0 bg-border transition-colors touch-none",
            isHorizontal
              ? "w-1 cursor-col-resize hover:w-1.5 hover:bg-muted-foreground"
              : "h-1 cursor-row-resize hover:h-1.5 hover:bg-muted-foreground",
          )}
        />
      )}

      {/* Right/Bottom pane */}
      <div className={cn("flex flex-col flex-1 min-h-0 min-w-0 overflow-auto", rightClassName)}>{right}</div>
    </div>
  );
};

SplitPane.displayName = "SplitPane";

export default SplitPane;
