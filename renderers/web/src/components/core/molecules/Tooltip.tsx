'use client';
/**
 * Tooltip Molecule Component
 * 
 * A tooltip component with position variants and delay options.
 * Uses theme-aware CSS variables for styling.
 */

import type { A11yProps } from '@almadar/core';
import React, { useState, useRef, useEffect, useLayoutEffect, useId } from 'react';
import { Typography } from '../../../core';
import { cn } from '../../../core';
import { useTapReveal } from '../../../core';
import { ThemedPortal } from "../../../lib/ThemedPortal";

import { domPassthrough } from '../../../core';
export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps extends A11yProps {
  /** Tooltip content */
  content: React.ReactNode;
  /** Tooltip trigger element (ReactElement or ReactNode that will be wrapped in span) */
  children: React.ReactNode;
  /** Tooltip position */
  position?: TooltipPosition;
  /** Show delay in milliseconds */
  delay?: number;
  /** Hide delay in milliseconds */
  hideDelay?: number;
  /** Show arrow */
  showArrow?: boolean;
  /** Additional CSS classes */
  className?: string;
}

const TRIGGER_GAP = 8;

interface TriggerProps {
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  onFocus?: (e: React.FocusEvent) => void;
  onBlur?: (e: React.FocusEvent) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  'aria-describedby'?: string;
}

// Arrow colors use CSS variables
const arrowClasses: Record<TooltipPosition, string> = {
  top: 'top-full left-1/2 -translate-x-1/2 border-t-primary border-l-transparent border-r-transparent border-b-transparent',
  bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-primary border-l-transparent border-r-transparent border-t-transparent',
  left: 'left-full top-1/2 -translate-y-1/2 border-l-primary border-t-transparent border-b-transparent border-r-transparent',
  right: 'right-full top-1/2 -translate-y-1/2 border-r-primary border-t-transparent border-b-transparent border-l-transparent',
};

// Resolve the portaled `fixed` tooltip to absolute viewport pixel coordinates.
// The gap and centering are baked into `left`/`top`/`transform` here so the
// panel needs no positioning utility classes — those resolve against the
// viewport on a `fixed` element and yank the tooltip off its trigger.
function computeTooltipStyle(
  position: TooltipPosition,
  triggerRect: DOMRect,
): React.CSSProperties {
  switch (position) {
    case 'bottom':
      return {
        left: triggerRect.left + triggerRect.width / 2,
        top: triggerRect.bottom + TRIGGER_GAP,
        transform: 'translateX(-50%)',
      };
    case 'left':
      return {
        left: triggerRect.left - TRIGGER_GAP,
        top: triggerRect.top + triggerRect.height / 2,
        transform: 'translate(-100%, -50%)',
      };
    case 'right':
      return {
        left: triggerRect.right + TRIGGER_GAP,
        top: triggerRect.top + triggerRect.height / 2,
        transform: 'translateY(-50%)',
      };
    case 'top':
    default:
      return {
        left: triggerRect.left + triggerRect.width / 2,
        top: triggerRect.top - TRIGGER_GAP,
        transform: 'translate(-50%, -100%)',
      };
  }
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
  delay = 200,
  hideDelay = 0,
  showArrow = true,
  className,
  ...rest
}) => {
  const tooltipId = useId();
  const [isVisible, setIsVisible] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const updatePosition = () => {
    if (triggerRef.current) {
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    }
  };

  const handleMouseEnter = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    updatePosition();
    showTimeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
    }
    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false);
    }, hideDelay);
  };

  // Touch has no hover, so the tooltip is unreachable on mobile. A tap reveals
  // it through the SAME show/hide path; an outside tap dismisses it.
  const { triggerProps } = useTapReveal({
    onReveal: handleMouseEnter,
    onDismiss: handleMouseLeave,
    refs: [triggerRef, tooltipRef],
  });

  useLayoutEffect(() => {
    if (isVisible) {
      updatePosition();
    }
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
      setIsVisible(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isVisible]);

  useEffect(() => {
    return () => {
      if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  // Wrap non-element children in a span
  const triggerElement = React.isValidElement(children) ? children : <span>{children}</span>;

  // The trigger keeps its own ref and handlers; the tooltip's run alongside.
  const child = triggerElement as React.ReactElement<TriggerProps>;
  const childRef = (child.props as { ref?: React.Ref<HTMLElement> }).ref ?? (child as { ref?: React.Ref<HTMLElement> }).ref;
  const setTriggerRef = (el: HTMLElement | null) => {
    triggerRef.current = el;
    if (typeof childRef === 'function') childRef(el);
    else if (childRef) (childRef as React.MutableRefObject<HTMLElement | null>).current = el;
  };
  const trigger = React.cloneElement(child, {
    ref: setTriggerRef,
    'aria-describedby': isVisible
      ? [child.props['aria-describedby'], tooltipId].filter(Boolean).join(' ')
      : child.props['aria-describedby'],
    onMouseEnter: (e: React.MouseEvent) => { child.props.onMouseEnter?.(e); handleMouseEnter(); },
    onMouseLeave: (e: React.MouseEvent) => { child.props.onMouseLeave?.(e); handleMouseLeave(); },
    onFocus: (e: React.FocusEvent) => { child.props.onFocus?.(e); handleMouseEnter(); },
    onBlur: (e: React.FocusEvent) => { child.props.onBlur?.(e); handleMouseLeave(); },
    onPointerDown: (e: React.PointerEvent) => {
      triggerProps.onPointerDown(e);
      child.props.onPointerDown?.(e);
    },
  } as TriggerProps & { ref: (el: HTMLElement | null) => void });

  const tooltipContent = isVisible && triggerRect ? (
    <div
      ref={tooltipRef}
      {...domPassthrough(rest)}
      id={tooltipId}
      className={cn(
        'fixed z-50 px-3 py-2 max-w-xs',
        'bg-primary text-primary-foreground',
        'shadow-elevation-popover rounded-container',
        'text-sm pointer-events-none',
        'break-words whitespace-normal',
        'h-auto min-h-fit',
        className
      )}
      style={computeTooltipStyle(position, triggerRect)}
      role="tooltip"
    >
      <div className="w-full break-words whitespace-normal h-auto">
        {typeof content === 'string' ? (
          <Typography variant="small" className="text-primary-foreground break-words whitespace-normal">
            {content}
          </Typography>
        ) : (
          <div className="break-words whitespace-normal">
            {content}
          </div>
        )}
      </div>
      {showArrow && (
        <div
          className={cn(
            'absolute w-0 h-0 border-heavy',
            arrowClasses[position]
          )}
        />
      )}
    </div>
  ) : null;

  return (
    <>
      {trigger}
      {typeof window !== 'undefined' && tooltipContent
        ? (<ThemedPortal>{tooltipContent}</ThemedPortal>)
        : tooltipContent}
    </>
  );
};

Tooltip.displayName = 'Tooltip';
