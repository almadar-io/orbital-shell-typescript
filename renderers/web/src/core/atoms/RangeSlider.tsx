'use client';

import React, { useCallback, useRef, useState } from "react";
import type { A11yProps, EventPayload, EventEmit } from "@almadar/core";
import { cn } from "../lib/cn";
import { useEventBus } from "../hooks/useEventBus";
import { useTranslate } from "../hooks/useTranslate";

function useSafeEventBus() {
  try {
    return useEventBus();
  } catch {
    return { emit: () => {}, on: () => () => {}, once: () => {} };
  }
}

export type RangeSliderSize = "sm" | "md" | "lg";

export interface RangeSliderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | keyof A11yProps>, A11yProps {
  /** Additional CSS classes applied to the root element. */
  className?: string;
  /** Minimum value */
  min?: number;
  /** Maximum value */
  max?: number;
  /** Current value */
  value?: number;
  /** Step increment */
  step?: number;
  /** Show tooltip with current value on drag */
  showTooltip?: boolean;
  /** Show tick marks at step intervals */
  showTicks?: boolean;
  /** Buffered range (0-100), for media seek bars */
  buffered?: number;
  /** Slider size */
  size?: RangeSliderSize;
  /** Disabled state */
  disabled?: boolean;
  /** Declarative event name for value changes */
  action?: EventEmit<{ value: number }>;
  /** Payload to include with the action event
   *  @payloadFor action
   */
  actionPayload?: EventPayload;
  /** Direct onChange callback */
  onChange?: (value: number) => void;
  /** Format function for tooltip display */
  formatValue?: (value: number) => string;
}

const trackSizes: Record<RangeSliderSize, string> = {
  sm: "h-1",
  md: "h-1.5",
  lg: "h-2",
};

const thumbSizes: Record<RangeSliderSize, string> = {
  sm: "w-3 h-3",
  md: "w-4 h-4",
  lg: "w-5 h-5",
};

export const RangeSlider = React.forwardRef<HTMLDivElement, RangeSliderProps>(
  (
    {
      className,
      min = 0,
      max = 100,
      value = 0,
      step = 1,
      showTooltip = false,
      showTicks = false,
      buffered,
      size = "md",
      disabled = false,
      action,
      actionPayload,
      onChange,
      formatValue,
      ...props
    },
    ref,
  ) => {
    const { t } = useTranslate();
    const [isDragging, setIsDragging] = useState(false);
    const [showTip, setShowTip] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const eventBus = useSafeEventBus();

    const percentage = max !== min ? ((value - min) / (max - min)) * 100 : 0;
    const bufferedPercentage = buffered !== undefined ? Math.min(buffered, 100) : undefined;

    const displayValue = formatValue ? formatValue(value) : String(value);

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = Number(e.target.value);
        onChange?.(newValue);
        if (action) {
          eventBus.emit(`UI:${action}`, { ...actionPayload, value: newValue });
        }
      },
      [onChange, action, actionPayload, eventBus],
    );

    const tickCount = showTicks ? Math.min(Math.floor((max - min) / step), 20) : 0;

    return (
      <div
        ref={ref}
        className={cn(
          "relative w-full",
          disabled && "opacity-50 cursor-not-allowed",
          className,
        )}
        {...props}
      >
        {/* Track container */}
        <div className="relative w-full py-2">
          {/* Background track */}
          <div
            className={cn(
              "absolute inset-x-0 rounded-full bg-muted",
              trackSizes[size],
            )}
            style={{ top: "50%", transform: "translateY(-50%)" }}
          />

          {/* Buffered range (media seek bar) */}
          {bufferedPercentage !== undefined && (
            <div
              className={cn(
                "absolute rounded-full bg-muted-foreground opacity-30",
                trackSizes[size],
              )}
              style={{
                top: "50%",
                transform: "translateY(-50%)",
                left: 0,
                width: `${bufferedPercentage}%`,
              }}
            />
          )}

          {/* Filled track */}
          <div
            className={cn(
              "absolute rounded-full bg-primary",
              trackSizes[size],
            )}
            style={{
              top: "50%",
              transform: "translateY(-50%)",
              left: 0,
              width: `${percentage}%`,
            }}
          />

          {/* Native range input (invisible, handles all interaction) */}
          <input
            ref={inputRef}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onChange={handleChange}
            onMouseDown={() => { setIsDragging(true); setShowTip(true); }}
            onMouseUp={() => { setIsDragging(false); setShowTip(false); }}
            onTouchStart={() => { setIsDragging(true); setShowTip(true); }}
            onTouchEnd={() => { setIsDragging(false); setShowTip(false); }}
            onFocus={() => setShowTip(true)}
            onBlur={() => { if (!isDragging) setShowTip(false); }}
            className={cn(
              "absolute inset-0 w-full opacity-0 cursor-pointer",
              disabled && "cursor-not-allowed",
              // Thumb sizing via pseudo-element
              "[&::-webkit-slider-thumb]:appearance-none",
              "[&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5",
              "[&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5",
            )}
            style={{ height: "100%", margin: 0 }}
            aria-label={props["aria-label"] ?? t("rangeSlider.ariaLabel")}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-valuetext={displayValue}
          />

          {/* Visual thumb */}
          <div
            className={cn(
              "absolute rounded-full bg-primary-foreground",
              "border-heavy border-primary",
              "shadow-elevation-interactive",
              "pointer-events-none",
              "transition-transform duration-instant",
              isDragging && "scale-[var(--hover-scale)]",
              thumbSizes[size],
            )}
            style={{
              top: "50%",
              transform: `translateY(-50%) translateX(-50%)${isDragging ? " scale(var(--hover-scale))" : ""}`,
              left: `${percentage}%`,
            }}
          />

          {/* Tooltip */}
          {showTooltip && showTip && (
            <div
              className={cn(
                "absolute -top-8 px-2 py-0.5 rounded-container",
                "bg-foreground text-background",
                "text-xs font-medium whitespace-nowrap",
                "pointer-events-none",
              )}
              style={{
                left: `${percentage}%`,
                transform: "translateX(-50%)",
              }}
            >
              {displayValue}
            </div>
          )}
        </div>

        {/* Tick marks */}
        {showTicks && tickCount > 0 && (
          <div className="relative w-full h-2 mt-1">
            {Array.from({ length: tickCount + 1 }, (_, i) => {
              const tickPercent = (i / tickCount) * 100;
              return (
                <div
                  key={i}
                  className="absolute w-px h-1.5 bg-muted-foreground"
                  style={{ left: `${tickPercent}%` }}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  },
);

RangeSlider.displayName = "RangeSlider";
