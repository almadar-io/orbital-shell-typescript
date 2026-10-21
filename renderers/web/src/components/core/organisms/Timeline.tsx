'use client';
/**
 * Timeline Organism Component
 *
 * A vertical timeline component for displaying chronological events.
 * Composes atoms and molecules for layout, uses CSS variables for theming.
 *
 * Orbital Component Interface Compliance:
 * - Entity binding with auto-fetch when entity is a string
 * - Event emission via useEventBus (UI:* events)
 * - isLoading and error state props
 * - className for external styling
 */

import { useItemMoves } from "../../../lib/item-move";
import React from "react";
import type { A11yProps, SkeletonSpec, EventKey } from "@almadar/core";
import { Skeleton } from "../molecules/Skeleton";
import { domPassthrough } from '../../../core';
import { entityRows } from "../../../lib/entityRows";
import { cn } from '../../../core';
import { Typography, Badge, Icon, Box, Button } from '../../../core';
import { VStack, HStack } from '../../../core';
import { LoadingState } from "../molecules/LoadingState";
import { ErrorState } from "../molecules/ErrorState";
import { EmptyState } from "../molecules/EmptyState";
import { useContentSurface } from '../../../core';
import type { SurfaceMode } from '@almadar/core';
import { useTranslate, useFormatContext } from '../../../core';
import { formatValue } from '../../../core';
// Timeline carries `icon?: IconInput` on TimelineItem (a React component),
// which is the separate non-entity item channel. Schema entity data arrives
// via the `entity` prop typed against @almadar/core's EntityRow, and is
// normalised into TimelineItems (icon-less) at render time; UI-shaped
// TimelineItems come through the dedicated `items` prop.
import type { EntityRow, EventPayload } from "@almadar/core";
import type { IconInput } from '../../../core';
import type { LucideIcon } from "lucide-react";
import { Circle, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import type { UiError } from '../../../core';

export type TimelineItemStatus = "complete" | "active" | "pending" | "error";

/**
 * Layer 2 visual treatment for the timeline pattern — orthogonal to the
 * semantic status conveyed by per-item style.
 */
export type TimelineLook =
    | "vertical-compact"
    | "vertical-spacious"
    | "horizontal"
    | "swimlane";

export interface TimelineItem {
    /** Unique identifier */
    id: string;
    /** Item title */
    title: string;
    /** Item description */
    description?: string;
    /** Timestamp string */
    date?: string;
    /** Status indicator */
    status?: TimelineItemStatus;
    /** Icon override */
    icon?: IconInput;
    /** Additional metadata tags */
    tags?: readonly string[];
}

export interface TimelineAction {
    label: string;
    event?: EventKey;
    navigatesTo?: string;
    variant?: "primary" | "secondary" | "ghost";
}

export interface TimelineProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
    /** Content surface: `auto` paints the theme's surface behind this block unless it already sits on one (a card, dialog or another block); `none` opts out. */
    surface?: SurfaceMode;
    /** Additional CSS classes */
    className?: string;
    /** Loading state indicator */
    isLoading?: boolean;
    /** Skeleton drawn while loading, and the shape an empty slot shows while this element's server render is in flight (`none` opts out). */
    skeleton?: SkeletonSpec;
    /** Error state */
    error?: UiError | null;
    /**
     * Schema entity data typed against @almadar/core's EntityRow. Items from
     * `entity` are normalised into `items` when `items` is omitted. UI-specific
     * TimelineItem fields (`icon`, callbacks) cannot round-trip through the
     * event bus, so decorative stories that need them pass `items` directly.
     */
    entity?: EntityRow | readonly EntityRow[];
    /** Timeline title */
    title?: string;
    /** Timeline items */
    items?: readonly TimelineItem[];
    /** Entity fields the timeline draws; each slot is named by its own `*Field` prop. */
    fields?: readonly string[];
    /** Entity field holding each item's title. */
    titleField?: string;
    /** Entity field holding each item's description. */
    descriptionField?: string;
    /** Entity field holding each item's date. */
    dateField?: string;
    /** Entity field holding each item's status (complete | active | pending | error). */
    statusField?: string;
    /** Actions per item */
    itemActions?: readonly TimelineAction[];
    /** Layer 2 visual treatment. */
    look?: TimelineLook;
}

// Layer 2 look styles. Each non-default look is a delta on the baseline
// (vertical-spacious). The Timeline DOM doesn't render <ul>/<li>, so the
// selectors target the actual item containers — VStack rendered <div>s
// inside the items wrapper. `swimlane` ships v1 as `horizontal` plus extra
// gap; grouping by lane needs additional DOM and is deferred.
const lookStyles: Record<TimelineLook, string> = {
    "vertical-compact": "gap-1 [&>*]:py-1",
    "vertical-spacious": "",
    horizontal: "flex-row [&>*]:flex-row [&>*]:items-center",
    swimlane: "flex-row gap-6 [&>*]:flex-row [&>*]:items-center",
};

const STATUS_STYLES: Record<
    TimelineItemStatus,
    { dotColor: string; lineColor: string; icon: LucideIcon }
> = {
    complete: {
        dotColor: "text-success",
        lineColor: "bg-success",
        icon: CheckCircle2,
    },
    active: {
        dotColor: "text-primary",
        lineColor: "bg-primary",
        icon: Clock,
    },
    pending: {
        dotColor: "text-muted-foreground",
        lineColor: "bg-border",
        icon: Circle,
    },
    error: {
        dotColor: "text-error",
        lineColor: "bg-error",
        icon: AlertCircle,
    },
};

export const Timeline: React.FC<TimelineProps> = ({
    title,
    items: propItems,
    titleField,
    descriptionField,
    dateField,
    statusField,
    itemActions,
    entity,
    isLoading = false,
    skeleton = 'list',
    error,
    className,
    look = "vertical-spacious",
    surface = 'auto',
    ...rest
}) => {
    const contentSurface = useContentSurface(surface);
    const { t } = useTranslate();
    const fmt = useFormatContext();

    // Normalize entity data to TimelineItem[] if schema data is provided
    const entityData = entityRows(entity);
    const items: readonly TimelineItem[] = React.useMemo(() => {
        if (propItems && propItems.length > 0) return propItems;
        if (entityData.length === 0) return [];

        return entityData.map((record, idx) => {
            return {
                id: String(record.id ?? idx),
                title: titleField ? String(record[titleField] ?? "") : "",
                description: descriptionField && record[descriptionField] ? String(record[descriptionField]) : undefined,
                date: dateField && record[dateField] ? String(record[dateField]) : undefined,
                status: statusField ? (record[statusField] as TimelineItemStatus) || "pending" : "pending",
            };
        });
    }, [propItems, entityData, titleField, descriptionField, dateField, statusField]);
    // An event added on top pushes the others down with a glide.
    const moves = useItemMoves(true);

    if (isLoading) {
        return (
            <Box {...domPassthrough(rest)}>
                <Skeleton spec={skeleton} className={className} />
            </Box>
        );
    }

    if (error) {
        return (
            <Box {...domPassthrough(rest)}>
                <ErrorState
                    title={t('display.timelineError')}
                    message={error.message}
                    className={className}
                />
            </Box>
        );
    }

    if (items.length === 0) {
        return (
            <Box {...domPassthrough(rest)}>
                <EmptyState
                    title={t('display.noEvents')}
                    description={t('display.noTimelineEvents')}
                    className={className}
                />
            </Box>
        );
    }

    return contentSurface.provide(
        <Box {...domPassthrough(rest)} className={cn(contentSurface.className, "p-6 rounded-container", className)}>
            <VStack gap="md">
                {title && (
                    <Typography variant="h5">
                        {title}
                    </Typography>
                )}

                <VStack gap="none" className={cn("relative", lookStyles[look])} data-item-move-root={moves.root}>
                    {items.map((item, idx) => {
                        const status = (item.status as TimelineItemStatus) || "pending";
                        const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
                        const ItemIcon = item.icon || style.icon;
                        const isLast = idx === items.length - 1;

                        return (
                            <HStack key={item.id} gap="md" align="start" className="relative" data-entity-id={item.id} data-item-key={item.id} data-item-move={moves.row}>
                                {/* Timeline track */}
                                <VStack align="center" className="flex-shrink-0 relative" style={{ width: "24px" }}>
                                    <Icon
                                        icon={ItemIcon}
                                        size="sm"
                                        className={cn(style.dotColor, "z-10 bg-card")}
                                    />
                                    {!isLast && (
                                        <Box
                                            className={cn(
                                                "w-0.5 flex-1 min-h-[24px]",
                                                style.lineColor,
                                                "opacity-40",
                                            )}
                                        />
                                    )}
                                </VStack>

                                {/* Content */}
                                <VStack gap="xs" className={cn("flex-1 min-w-0", !isLast && "pb-6")}>
                                    <HStack justify="between" align="start" wrap>
                                        <Typography variant="body" weight="semibold">
                                            {item.title}
                                        </Typography>
                                        {item.date && (
                                            <Typography variant="caption" color="secondary" className="flex-shrink-0">
                                                {formatValue(item.date, 'date', fmt)}
                                            </Typography>
                                        )}
                                    </HStack>

                                    {item.description && (
                                        <Typography variant="small" color="secondary">
                                            {item.description}
                                        </Typography>
                                    )}

                                    {item.tags && item.tags.length > 0 && (
                                        <HStack gap="xs" wrap>
                                            {item.tags.map((tag, tagIdx) => (
                                                <Badge key={tagIdx} variant="default">
                                                    {tag}
                                                </Badge>
                                            ))}
                                        </HStack>
                                    )}

                                    {itemActions && itemActions.length > 0 && (
                                        <HStack gap="xs" className="mt-1">
                                            {itemActions.map((action, actionIdx) => {
                                                // TimelineItem.icon is non-serializable (component or string ref).
                                                // Project only the JSON-safe fields into the bus payload.
                                                const { icon: _icon, ...rowSafe } = item;
                                                return (
                                                <Button
                                                    key={actionIdx}
                                                    variant="ghost"
                                                    size="sm"
                                                    action={action.event}
                                                    actionPayload={{ row: rowSafe satisfies EventPayload }}
                                                >
                                                    {action.label}
                                                </Button>
                                                );
                                            })}
                                        </HStack>
                                    )}
                                </VStack>
                            </HStack>
                        );
                    })}
                </VStack>
            </VStack>
        </Box>,
    );
};

Timeline.displayName = "Timeline";
