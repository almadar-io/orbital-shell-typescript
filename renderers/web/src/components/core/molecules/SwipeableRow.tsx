'use client';

/**
 * SwipeableRow Molecule
 *
 * Wraps a list item to reveal action buttons on horizontal swipe.
 * Swipe left to reveal right actions, swipe right to reveal left actions.
 * Uses useSwipeGesture for gesture detection and useEventBus for event emission.
 */
import React, { useCallback, useRef, useState } from 'react';
import type { EntityRow, EventKey, EventPayload, A11yProps } from "@almadar/core";
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useRowActions } from '../../../hooks/useRowActions';
import type { RowActionCondition } from '../../../lib/row-action-when';
import { Box } from '../../../core';
import { HStack } from '../../../core';
import { Button } from '../../../core';
import { Icon } from '../../../core';
import type { IconInput } from '../../../core';
import type { ButtonVariant } from '../../../core';

import { domPassthrough } from '../../../core';
export interface SwipeAction {
  label: string;
  icon?: IconInput;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  event: EventKey;
  /** Payload included with the `event` emit
   *  @payloadFor event */
  eventPayload?: EventPayload;
  /** Per-row condition, authored as `(fn row <bool>)`: the swipe action is revealed only when it returns true. Omit = always shown. */
  when?: RowActionCondition;
}

export interface SwipeableRowProps extends A11yProps {
  leftActions?: SwipeAction[];
  rightActions?: SwipeAction[];
  threshold?: number;
  children: React.ReactNode;
  itemData?: EntityRow;
  className?: string;
}

type RevealState = 'closed' | 'left' | 'right';

function useSafeEventBus() {
  try {
    return useEventBus();
  } catch {
    return { emit: () => {}, on: () => () => {}, once: () => {} };
  }
}

export const SwipeableRow: React.FC<SwipeableRowProps> = ({
  leftActions: leftActionDefs = [],
  rightActions: rightActionDefs = [],
  threshold = 80,
  children,
  itemData,
  className,
  ...rest
}) => {
  const eventBus = useSafeEventBus();
  const rowActions = useRowActions();
  const leftActions = rowActions(leftActionDefs, itemData ?? {});
  const rightActions = rowActions(rightActionDefs, itemData ?? {});
  const [revealState, setRevealState] = useState<RevealState>('closed');
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const trackingRef = useRef(false);
  const lockedAxisRef = useRef<'horizontal' | 'vertical' | null>(null);

  const actionsWidth = threshold;

  const handleActionClick = useCallback(
    (action: SwipeAction) => {
      eventBus.emit(`UI:${action.event}`, {
        ...action.eventPayload,
        row: itemData,
      });
      setRevealState('closed');
      setOffsetX(0);
    },
    [eventBus, itemData],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only track primary pointer (touch or left mouse)
      if (e.button !== 0) return;
      startXRef.current = e.clientX;
      startYRef.current = e.clientY;
      trackingRef.current = true;
      lockedAxisRef.current = null;
      setIsSwiping(false);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!trackingRef.current) return;

      const dx = e.clientX - startXRef.current;
      const dy = e.clientY - startYRef.current;

      // Lock axis after initial movement
      if (lockedAxisRef.current === null && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        lockedAxisRef.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      }

      if (lockedAxisRef.current !== 'horizontal') return;

      setIsSwiping(true);

      // If already revealed, adjust offset from the revealed position
      let newOffset = dx;
      if (revealState === 'left') {
        newOffset = actionsWidth + dx;
      } else if (revealState === 'right') {
        newOffset = -actionsWidth + dx;
      }

      // Clamp: don't exceed the actions area
      const maxLeft = leftActions.length > 0 ? actionsWidth : 0;
      const maxRight = rightActions.length > 0 ? actionsWidth : 0;
      const clamped = Math.max(-maxRight, Math.min(maxLeft, newOffset));
      setOffsetX(clamped);
    },
    [revealState, actionsWidth, leftActions.length, rightActions.length],
  );

  const handlePointerUp = useCallback(
    () => {
      trackingRef.current = false;

      if (!isSwiping) {
        // Tap: if revealed, close
        if (revealState !== 'closed') {
          setRevealState('closed');
          setOffsetX(0);
        }
        setIsSwiping(false);
        return;
      }

      setIsSwiping(false);

      // Snap decision based on current offset
      if (offsetX > threshold / 2 && leftActions.length > 0) {
        setRevealState('right');
        setOffsetX(actionsWidth);
      } else if (offsetX < -(threshold / 2) && rightActions.length > 0) {
        setRevealState('left');
        setOffsetX(-actionsWidth);
      } else {
        setRevealState('closed');
        setOffsetX(0);
      }
    },
    [isSwiping, offsetX, threshold, leftActions.length, rightActions.length, actionsWidth, revealState],
  );

  const handlePointerCancel = useCallback(() => {
    trackingRef.current = false;
    setIsSwiping(false);
    setRevealState('closed');
    setOffsetX(0);
  }, []);

  const renderActions = (actions: readonly SwipeAction[], side: 'left' | 'right') => {
    if (actions.length === 0) return null;

    return (
      <HStack
        gap="xs"
        align="stretch"
        className={cn(
          'absolute top-0 bottom-0',
          side === 'left' ? 'left-0' : 'right-0',
        )}
        style={{
          width: `${actionsWidth}px`,
        }}
      >
        {actions.map((action, idx) => (
          <Button
            key={`${action.event}-${idx}`}
            variant={(action.variant ?? 'secondary') as ButtonVariant}
            size="sm"
            icon={action.icon}
            onClick={() => handleActionClick(action)}
            className="flex-1 rounded-none h-full"
          >
            {action.icon ? (
              typeof action.icon === 'string'
                ? <Icon name={action.icon} size="sm" />
                : <Icon icon={action.icon} size="sm" />
            ) : null}
            {action.label}
          </Button>
        ))}
      </HStack>
    );
  };

  return (
    <Box
      {...domPassthrough(rest)}
      overflow="hidden"
      position="relative"
      className={cn(
        'touch-pan-y',
        className,
      )}
    >
      {/* Left actions (visible when content slides right) */}
      {renderActions(leftActions, 'left')}

      {/* Right actions (visible when content slides left) */}
      {renderActions(rightActions, 'right')}

      {/* Main content */}
      <Box
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: isSwiping ? 'none' : 'transform 200ms ease-out',
        }}
        className={cn(
          'relative bg-surface',
          'select-none',
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {children}
      </Box>
    </Box>
  );
};

SwipeableRow.displayName = 'SwipeableRow';
