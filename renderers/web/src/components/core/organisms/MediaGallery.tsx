'use client';
/**
 * MediaGallery Organism Component
 *
 * A gallery component for displaying images and media in a grid layout.
 * Supports lightbox viewing, selection, and upload interactions.
 *
 * Orbital Component Interface Compliance:
 * - Entity binding with auto-fetch when entity is a string
 * - Event emission via useEventBus (UI:* events)
 * - isLoading and error state props
 * - className for external styling
 */

import React, { useState, useCallback } from "react";
import type { A11yProps, EventKey, AssetUrl, EventEmit } from "@almadar/core";
import { domPassthrough } from '../../../core';
import { resolveImageUrl } from "../../../lib/getNestedValue";
import { cn } from '../../../core';
import { Typography, Badge, Button, Icon, Box } from '../../../core';
import { VStack, HStack } from '../../../core';
import { LoadingState } from "../molecules/LoadingState";
import { ErrorState } from "../molecules/ErrorState";
import { EmptyState } from "../molecules/EmptyState";
import { Lightbox } from "../molecules/Lightbox";
import { useEventBus, useEventListener } from '../../../core';
import { useContentSurface } from '../../../core';
import type { SurfaceMode } from '@almadar/core';
import { useTranslate } from '../../../core';
import type { DisplayStateProps } from "./types";
import type { EntityRow } from "@almadar/core";
import { ZoomIn, Upload, Image as ImageIcon } from "lucide-react";

export type MediaItem = EntityRow & {
    /** Unique identifier */
    id: string;
    /** Media URL */
    src: AssetUrl;
    /** Alt text */
    alt?: string;
    /** Thumbnail URL (defaults to src) */
    thumbnail?: AssetUrl;
    /** Media type */
    mediaType?: "image" | "video";
    /** Caption */
    caption?: string;
    /** File size */
    fileSize?: string;
};

export interface MediaGalleryAction {
    label: string;
    event?: EventKey;
    navigatesTo?: string;
    variant?: "primary" | "secondary" | "ghost";
}

export interface MediaGalleryProps extends DisplayStateProps, Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
    /** Content surface: `auto` paints the theme's surface behind this block unless it already sits on one (a card, dialog or another block); `none` opts out. */
    surface?: SurfaceMode;
    /** Entity rows to display (collection cardinality). */
    entity?: readonly EntityRow[];
    /** Gallery title */
    title?: string;
    /** Media items */
    items?: readonly MediaItem[];
    /** Column count */
    columns?: 2 | 3 | 4 | 5 | 6;
    /** Enable item selection */
    selectable?: boolean;
    /** Selected item IDs */
    selectedItems?: readonly string[];
    /** Event name emitted when selection changes (emitted as UI:{selectionEvent}) */
    selectionEvent?: EventEmit<{ selection: string[] }>;
    /** Show upload button */
    showUpload?: boolean;
    /** Actions */
    actions?: readonly MediaGalleryAction[];
    /** Aspect ratio for thumbnails */
    aspectRatio?: "square" | "landscape" | "portrait";
    /** Record field holding each image's URL (entity mode). Default `src`. */
    srcField?: string;
    /** Record field holding each image's caption (entity mode). Default `caption`. */
    captionField?: string;
}

const COLUMN_CLASSES: Record<number, string> = {
    2: "grid-cols-2",
    3: "grid-cols-2 sm:grid-cols-3",
    4: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
    5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
    6: "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6",
};

const ASPECT_CLASSES: Record<string, string> = {
    square: "aspect-square",
    landscape: "aspect-video",
    portrait: "aspect-[3/4]",
};

export const MediaGallery: React.FC<MediaGalleryProps> = ({
    title,
    items: propItems,
    columns = 3,
    selectable = false,
    selectedItems = [],
    selectionEvent = "SELECTION_CHANGE",
    showUpload = false,
    actions,
    aspectRatio = "square",
    srcField = "src",
    captionField = "caption",
    entity,
    isLoading = false,
    error,
    className,
    surface = 'auto',
    ...rest
}) => {
    const contentSurface = useContentSurface(surface);
    const eventBus = useEventBus();
    const { t } = useTranslate();
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set());

    const closeLightbox = useCallback(() => setLightboxIndex(null), []);
    useEventListener("UI:LIGHTBOX_CLOSE", closeLightbox);

    const handleImageError = useCallback((id: string) => {
        setFailedIds((prev) => {
            if (prev.has(id)) return prev;
            const next = new Set(prev);
            next.add(id);
            return next;
        });
    }, []);

    const handleItemClick = useCallback(
        (item: MediaItem, index: number) => {
            if (selectable) {
                const isSelected = selectedItems.includes(item.id);
                const newSelection = isSelected
                    ? selectedItems.filter((id) => id !== item.id)
                    : [...selectedItems, item.id];
                eventBus.emit(`UI:${selectionEvent}`, { selection: newSelection });
            } else {
                setLightboxIndex(index);
            }
            eventBus.emit("UI:MEDIA_SELECT", { row: item });
        },
        [selectable, selectedItems, selectionEvent, eventBus],
    );

    // Normalize entity data
    const entityData = Array.isArray(entity) ? entity : [];
    const items: readonly MediaItem[] = React.useMemo(() => {
        if (propItems && propItems.length > 0) return propItems;
        if (entityData.length === 0) return [];

        return entityData.map((record, idx): MediaItem => {
            const alt = record.alt ? String(record.alt) : undefined;
            const thumbnail = resolveImageUrl(record.thumbnail);
            const caption = record[captionField] != null ? String(record[captionField]) : undefined;
            return {
                id: String(record.id ?? idx),
                src: resolveImageUrl(record[srcField]) ?? "",
                ...(alt !== undefined ? { alt } : {}),
                ...(thumbnail !== undefined ? { thumbnail } : {}),
                ...(caption !== undefined ? { caption } : {}),
            };
        });
    }, [propItems, entityData, srcField, captionField]);

    if (isLoading) {
        return (
            <Box {...domPassthrough(rest)}>
                <LoadingState message={t('common.loading')} className={className} />
            </Box>
        );
    }

    if (error) {
        return (
            <Box {...domPassthrough(rest)}>
                <ErrorState
                    title={t('display.galleryError')}
                    message={error.message}
                    className={className}
                />
            </Box>
        );
    }

    if (items.length === 0 && !showUpload) {
        return (
            <Box {...domPassthrough(rest)}>
                <EmptyState
                    icon={ImageIcon}
                    title={t('display.noMedia')}
                    description={t('mediaGallery.noMediaDescription')}
                    className={className}
                />
            </Box>
        );
    }

    return contentSurface.provide(
        <>
            <Box {...domPassthrough(rest)} className={cn(contentSurface.className, "p-6 rounded-container", className)}>
                <VStack gap="md">
                    {/* Header */}
                    {(title || showUpload || (actions && actions.length > 0)) && (
                        <HStack justify="between" align="center">
                            {title && (
                                <Typography variant="h5">
                                    {title}
                                </Typography>
                            )}
                            <HStack gap="sm">
                                {showUpload && (
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        icon={Upload}
                                        action="MEDIA_UPLOAD"
                                    >
                                        {t('mediaGallery.upload')}
                                    </Button>
                                )}
                                {actions?.map((action, idx) => (
                                    <Box
                                        key={idx}
                                        action={action.event}
                                        className="cursor-pointer hover:opacity-80 transition-opacity"
                                    >
                                        <Badge variant="default">
                                            {action.label}
                                        </Badge>
                                    </Box>
                                ))}
                            </HStack>
                        </HStack>
                    )}

                    {/* Selection count */}
                    {selectable && selectedItems.length > 0 && (
                        <HStack gap="sm" align="center">
                            <Badge variant="info">{t('table.bulk.selected', { count: selectedItems.length })}</Badge>
                        </HStack>
                    )}

                    {/* Grid — using CSS grid here since almadar SimpleGrid doesn't support all column configs */}
                    <Box
                        className={cn(
                            "grid gap-3",
                            COLUMN_CLASSES[columns],
                        )}
                    >
                        {items.map((item, index) => {
                            const isSelected = selectedItems.includes(item.id);
                            return (
                                <Box
                                    key={item.id}
                                    className={cn(
                                        "group relative overflow-hidden rounded-container cursor-pointer",
                                        "border-heavy transition-all duration-fast",
                                        isSelected
                                            ? "border-primary ring-2 ring-primary/30"
                                            : "border-transparent hover:border-border",
                                        ASPECT_CLASSES[aspectRatio],
                                    )}
                                     
                                    role="button"
                                    tabIndex={0}
                                    aria-label={item.alt || item.caption || item.id}
                                    aria-pressed={selectable ? isSelected : undefined}
                                    onClick={() => handleItemClick(item, index)}
                                    onKeyDown={(e: React.KeyboardEvent) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            handleItemClick(item, index);
                                        }
                                    }}
                                >
                                    { }
                                    {failedIds.has(item.id) ? (
                                        <Box className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
                                            <Icon icon={ImageIcon} size="lg" />
                                        </Box>
                                    ) : (
                                        <img
                                            src={item.thumbnail || item.src}
                                            alt={item.alt || item.caption || ""}
                                            className="w-full h-full object-cover"
                                            loading="lazy"
                                            onError={() => handleImageError(item.id)}
                                        />
                                    )}
                                    {/* Hover overlay */}
                                    <Box
                                        className={cn(
                                            "absolute inset-0 bg-foreground/0 group-hover:bg-foreground/20",
                                            "transition-colors duration-fast flex items-center justify-center",
                                        )}
                                    >
                                        <Icon
                                            icon={ZoomIn}
                                            size="md"
                                            // eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: always over a dark scrim
                                            className="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-fast"
                                        />
                                    </Box>
                                    {/* Caption */}
                                    {item.caption && (
                                        // eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: caption scrim over image
                                        <Box className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
                                            {/* eslint-disable-next-line almadar/no-hardcoded-colors -- media overlay: caption over dark scrim */}
                                            <Typography variant="caption" className="text-white truncate">
                                                {item.caption}
                                            </Typography>
                                        </Box>
                                    )}
                                    {/* Selection indicator */}
                                    {selectable && isSelected && (
                                        <Box className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                                            <Typography variant="caption" className="text-primary-foreground text-xs">
                                                ✓
                                            </Typography>
                                        </Box>
                                    )}
                                </Box>
                            );
                        })}
                    </Box>
                </VStack>
            </Box>

            <Lightbox
                images={items.map((it) => ({ src: it.src, alt: it.alt || it.caption, caption: it.caption }))}
                currentIndex={lightboxIndex ?? 0}
                isOpen={lightboxIndex !== null}
                onClose={closeLightbox}
                closeAction="LIGHTBOX_CLOSE"
            />
        </>,
    );
};

MediaGallery.displayName = "MediaGallery";
