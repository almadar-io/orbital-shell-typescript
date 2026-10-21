'use client';

import React, { useCallback, useRef, useState } from "react";
import type { A11yProps, EventEmit, EntityRow, EntityWith } from "@almadar/core";
import { domPassthrough } from '../../../core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { Typography, Badge, Box } from '../../../core';
import { Icon } from '../../../core';

export type CanvasItemStatus = 'empty' | 'seated' | 'ordered' | 'awaiting-bill' | 'cleaning';
export type CanvasItemShape = 'round' | 'rectangle' | 'square';

/** The per-item entity fields this canvas reads. `x`/`y` are pixel coordinates
 *  in the canvas plane; `status`/`shape` are string literal unions widened to
 *  `string` at the row level. */
export interface CanvasItemRow {
    label: string;
    x: number;
    y: number;
    capacity: number;
    partySize?: number;
    serverName?: string;
    status?: CanvasItemStatus;
    shape?: CanvasItemShape;
}

export interface PositionedCanvasProps extends A11yProps {
    /**
     * Items to render. The molecule narrows non-array values to `[]` and reads
     * each row's `id` / `x` / `y` / `label` fields at render time.
     */
    items: readonly EntityWith<CanvasItemRow>[];
    width?: number;
    height?: number;
    selectedId?: string | null;
    editable?: boolean;
    onSelect?: (id: string | null) => void;
    onMove?: (id: string, x: number, y: number) => void;
    selectEvent?: EventEmit<{ id: string | null }>;
    moveEvent?: EventEmit<{ id: string; x: number; y: number }>;
    className?: string;
}

interface DragState {
    id: string;
    pointerId: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
}

const STATUS_CLASSES: Record<CanvasItemStatus, string> = {
    empty: "bg-surface border-border text-foreground",
    seated: "bg-surface border-success text-foreground",
    ordered: "bg-surface border-warning text-foreground",
    'awaiting-bill': "bg-surface border-info text-foreground",
    cleaning: "bg-muted border-border text-muted-foreground",
};

const STATUS_BADGE: Record<CanvasItemStatus, { variant: "default" | "success" | "warning" | "info" | "neutral"; labelKey: string }> = {
    empty: { variant: "default", labelKey: "positionedCanvas.status.empty" },
    seated: { variant: "success", labelKey: "positionedCanvas.status.seated" },
    ordered: { variant: "warning", labelKey: "positionedCanvas.status.ordered" },
    'awaiting-bill': { variant: "info", labelKey: "positionedCanvas.status.awaitingBill" },
    cleaning: { variant: "neutral", labelKey: "positionedCanvas.status.cleaning" },
};

function getShapeClasses(shape: CanvasItemShape): string {
    switch (shape) {
        case 'round':
            return "rounded-full w-24 h-24";
        case 'square':
            return "rounded-container w-24 h-24";
        case 'rectangle':
            return "rounded-container w-36 h-20";
    }
}

function getStatusIcon(status: CanvasItemStatus): React.ReactNode {
    switch (status) {
        case 'seated':
            return <Icon name="users" className="w-4 h-4" />;
        case 'ordered':
            return <Icon name="coffee" className="w-4 h-4" />;
        case 'awaiting-bill':
            return <Icon name="alert-circle" className="w-4 h-4" />;
        default:
            return null;
    }
}

export const PositionedCanvas: React.FC<PositionedCanvasProps> = ({
    items: itemsProp,
    width = 800,
    height = 600,
    selectedId = null,
    editable = false,
    onSelect,
    onMove,
    selectEvent,
    moveEvent,
    className,
    ...rest
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragState | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const eventBus = useEventBus();
    const { t } = useTranslate();

    const items: readonly EntityRow[] = Array.isArray(itemsProp) ? itemsProp : [];

    const handlePointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>, item: EntityRow) => {
            if (!editable) return;
            const target = e.currentTarget;
            const rect = target.getBoundingClientRect();
            dragRef.current = {
                id: item.id as string,
                pointerId: e.pointerId,
                offsetX: e.clientX - rect.left,
                offsetY: e.clientY - rect.top,
                moved: false,
            };
            target.setPointerCapture(e.pointerId);
            setDraggingId(item.id as string);
        },
        [editable],
    );

    const handlePointerMove = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            const drag = dragRef.current;
            const container = containerRef.current;
            if (!drag || !container || drag.pointerId !== e.pointerId) return;

            const containerRect = container.getBoundingClientRect();
            const target = e.currentTarget;
            const itemWidth = target.offsetWidth;
            const itemHeight = target.offsetHeight;

            const newX = e.clientX - containerRect.left - drag.offsetX;
            const newY = e.clientY - containerRect.top - drag.offsetY;

            const clampedX = Math.max(0, Math.min(width - itemWidth, newX));
            const clampedY = Math.max(0, Math.min(height - itemHeight, newY));

            drag.moved = true;
            onMove?.(drag.id, clampedX, clampedY);
            if (moveEvent) {
                eventBus.emit(`UI:${moveEvent}`, { id: drag.id, x: clampedX, y: clampedY });
            }
        },
        [width, height, onMove, moveEvent, eventBus],
    );

    const toggleSelect = useCallback(
        (itemId: string) => {
            const next = selectedId === itemId ? null : itemId;
            onSelect?.(next);
            if (selectEvent) {
                eventBus.emit(`UI:${selectEvent}`, { id: next });
            }
        },
        [selectedId, onSelect, selectEvent, eventBus],
    );

    const selectable = onSelect !== undefined || selectEvent !== undefined;

    const handlePointerUp = useCallback(
        (e: React.PointerEvent<HTMLDivElement>, item: EntityRow) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== e.pointerId) return;

            const target = e.currentTarget;
            if (target.hasPointerCapture(e.pointerId)) {
                target.releasePointerCapture(e.pointerId);
            }

            const wasDrag = drag.moved;
            dragRef.current = null;
            setDraggingId(null);

            if (!wasDrag) toggleSelect(item.id as string);
        },
        [toggleSelect],
    );

    const handleContainerClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (e.target === e.currentTarget) {
                onSelect?.(null);
                if (selectEvent) {
                    eventBus.emit(`UI:${selectEvent}`, { id: null });
                }
            }
        },
        [onSelect, selectEvent, eventBus],
    );

    return (
        // Outer scroll viewport: caps the visual footprint to the parent's
        // available width on small screens. The inner plane keeps its fixed
        // {width × height} coordinate system (items are positioned by
        // absolute item.x/item.y), so a phone-sized viewport pans inside
        // the larger logical canvas rather than busting the layout.
        <Box
            role="group"
            aria-label={t('aria.positionedCanvas')}
            {...domPassthrough(rest)}
            className={cn("max-w-full overflow-auto rounded-container", className)}
        >
        <Box
            ref={containerRef}
            data-testid="positioned-canvas"
            className="relative bg-background border border-border rounded-container overflow-hidden touch-none"
            style={{ width, height }}
            onClick={handleContainerClick}
        >
            {items.map((item) => {
                const itemId = item.id as string;
                const label = item.label as string;
                const x = item.x as number;
                const y = item.y as number;
                const capacity = item.capacity as number;
                const partySize = item.partySize as number | undefined;
                const serverName = item.serverName as string | undefined;
                const status = (item.status as CanvasItemStatus | undefined) ?? 'empty';
                const shape = (item.shape as CanvasItemShape | undefined) ?? 'round';
                const isSelected = selectedId === itemId;
                const isDragging = draggingId === itemId;
                const statusBadge = STATUS_BADGE[status];

                return (
                    <Box
                        key={itemId}
                        data-testid={`item-node-${itemId}`}
                        data-status={status}
                        className={cn(
                            "absolute flex flex-col items-center justify-center gap-1 border-heavy select-none",
                            "transition-shadow",
                            STATUS_CLASSES[status],
                            getShapeClasses(shape),
                            editable ? "cursor-move" : "cursor-pointer",
                            isSelected && "outline outline-2 outline-offset-2 outline-primary shadow-elevation-card",
                            isDragging && "shadow-elevation-popover z-10",
                        )}
                        style={{ left: x, top: y, touchAction: 'none' }}
                        {...(selectable ? {
                            role: 'button' as const,
                            tabIndex: 0,
                            'aria-pressed': isSelected,
                            onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                                if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                                e.preventDefault();
                                toggleSelect(itemId);
                            },
                        } : {})}
                        onPointerDown={(e) => handlePointerDown(e, item)}
                        onPointerMove={handlePointerMove}
                        onPointerUp={(e) => handlePointerUp(e, item)}
                        onPointerCancel={(e) => handlePointerUp(e, item)}
                    >
                        <Box className="flex items-center gap-1">
                            {getStatusIcon(status)}
                            <Typography variant="body2" weight="semibold">
                                {label}
                            </Typography>
                        </Box>
                        <Typography variant="caption" color="secondary">
                            {partySize !== undefined && status === 'seated'
                                ? `${partySize}/${capacity}`
                                : t('positionedCanvas.capacity', { count: capacity })}
                        </Typography>
                        <Typography variant="caption" className="sr-only">
                            {t(statusBadge.labelKey)}
                        </Typography>
                        {status === 'seated' && serverName && (
                            <Typography variant="caption" color="secondary" className="truncate max-w-[80%]">
                                {serverName}
                            </Typography>
                        )}
                        {isSelected && (
                            <Badge
                                variant={statusBadge.variant}
                                size="sm"
                                className="absolute -top-2 -right-2"
                            >
                                {t(statusBadge.labelKey)}
                            </Badge>
                        )}
                    </Box>
                );
            })}
        </Box>
        </Box>
    );
};

PositionedCanvas.displayName = "PositionedCanvas";
