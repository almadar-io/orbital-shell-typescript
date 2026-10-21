'use client';
/**
 * useGameCanvas3DEvents
 *
 * Event bus integration hook for GameCanvas3D.
 * Handles declarative event props (tileClickEvent, unitClickEvent, etc.)
 *
 * @packageDocumentation
 */

import { useCallback, useRef } from 'react';
import type { EventEmit } from '@almadar/core';
import { useEventBus, useEmitEvent } from '../../../../core';
import type { IsometricTile, IsometricUnit, IsometricFeature } from '../../../isometricTypes';

export interface GameCanvas3DEventConfig {
    /** Event name for tile clicks. `tileId` is optional — the neutral draw-host emits
     *  only the scene coordinate `{ x, z }` (the FSM keys off the cell, not an id). */
    tileClickEvent?: EventEmit<{ x: number; z: number; tileId?: string; type?: string; terrain?: string; elevation?: number }>;
    /** Event name for unit clicks */
    unitClickEvent?: EventEmit<{ unitId: string; x: number; z: number; unitType?: string; name?: string; team?: string; faction?: string; health?: number; maxHealth?: number }>;
    /** Event name for feature clicks */
    featureClickEvent?: EventEmit<{ featureId: string; x: number; z: number; type?: string; elevation?: number }>;
    /** Event name for canvas clicks */
    canvasClickEvent?: EventEmit<{ clientX: number; clientY: number; button: number }>;
    /** Event name for tile hover */
    tileHoverEvent?: EventEmit<{ tileId: string; x: number; z: number; type?: string }>;
    /** Event name for tile leave */
    tileLeaveEvent?: EventEmit<Record<string, never>>;
    /** Event name for unit animation changes */
    unitAnimationEvent?: EventEmit<{ unitId: string; state: string; timestamp: number }>;
    /** Event name for camera changes */
    cameraChangeEvent?: EventEmit<{ position: { x: number; y: number; z: number }; timestamp: number }>;
}

/** Minimal mouse event interface — satisfied by both React.MouseEvent and ThreeEvent<MouseEvent> */
export interface MinimalMouseEvent {
    clientX: number;
    clientY: number;
    button: number;
}

export interface UseGameCanvas3DEventsOptions extends GameCanvas3DEventConfig {
    /** Callback for tile clicks (direct) */
    onTileClick?: (tile: IsometricTile, event: MinimalMouseEvent) => void;
    /** Callback for unit clicks (direct) */
    onUnitClick?: (unit: IsometricUnit, event: MinimalMouseEvent) => void;
    /** Callback for feature clicks (direct) */
    onFeatureClick?: (feature: IsometricFeature, event: MinimalMouseEvent) => void;
    /** Callback for canvas clicks (direct) */
    onCanvasClick?: (event: MinimalMouseEvent) => void;
    /** Callback for tile hover (direct) */
    onTileHover?: (tile: IsometricTile | null, event: MinimalMouseEvent) => void;
    /** Callback for unit animation changes (direct) */
    onUnitAnimation?: (unitId: string, state: string) => void;
}

export interface UseGameCanvas3DEventsReturn {
    /** Handle tile click - emits event and calls callback */
    handleTileClick: (tile: IsometricTile, event: MinimalMouseEvent) => void;
    /** Handle unit click - emits event and calls callback */
    handleUnitClick: (unit: IsometricUnit, event: MinimalMouseEvent) => void;
    /** Handle feature click - emits event and calls callback */
    handleFeatureClick: (feature: IsometricFeature, event: MinimalMouseEvent) => void;
    /** Handle canvas click - emits event and calls callback */
    handleCanvasClick: (event: MinimalMouseEvent) => void;
    /** Handle tile hover - emits event and calls callback */
    handleTileHover: (tile: IsometricTile | null, event: MinimalMouseEvent) => void;
    /** Handle unit animation - emits event and calls callback */
    handleUnitAnimation: (unitId: string, state: string) => void;
    /** Handle camera change - emits event */
    handleCameraChange: (position: { x: number; y: number; z: number }) => void;
}

/**
 * Hook for integrating GameCanvas3D with the event bus
 *
 * Supports both declarative event props (tileClickEvent) and
 * direct callback props (onTileClick).
 *
 * @example
 * ```tsx
 * const events = useGameCanvas3DEvents({
 *     tileClickEvent: 'TILE_SELECTED',
 *     unitClickEvent: 'UNIT_SELECTED',
 *     onTileClick: (tile) => console.log('Tile:', tile)
 * });
 *
 * // In component:
 * <TileRenderer onTileClick={events.handleTileClick} />
 * ```
 */
export function useGameCanvas3DEvents(
    options: UseGameCanvas3DEventsOptions
): UseGameCanvas3DEventsReturn {
    const {
        tileClickEvent,
        unitClickEvent,
        featureClickEvent,
        canvasClickEvent,
        tileHoverEvent,
        tileLeaveEvent,
        unitAnimationEvent,
        cameraChangeEvent,
        onTileClick,
        onUnitClick,
        onFeatureClick,
        onCanvasClick,
        onTileHover,
        onUnitAnimation,
    } = options;

    const emit = useEmitEvent();

    // Use refs to avoid stale closures
    const optionsRef = useRef(options);
    optionsRef.current = options;

    const handleTileClick = useCallback(
        (tile: IsometricTile, event: MinimalMouseEvent) => {
            // Emit declarative event
            if (tileClickEvent) {
                emit(tileClickEvent, {
                    tileId: tile.id,
                    x: tile.x,
                    z: tile.z ?? tile.y ?? 0,
                    type: tile.type,
                    terrain: tile.terrain,
                    elevation: tile.elevation,
                });
            }

            // Call direct callback
            optionsRef.current.onTileClick?.(tile, event);
        },
        [tileClickEvent, emit]
    );

    const handleUnitClick = useCallback(
        (unit: IsometricUnit, event: MinimalMouseEvent) => {
            if (unitClickEvent) {
                emit(unitClickEvent, {
                    unitId: unit.id,
                    x: unit.x,
                    z: unit.z ?? unit.y ?? 0,
                    unitType: unit.unitType,
                    name: unit.name,
                    team: unit.team,
                    faction: unit.faction,
                    health: unit.health,
                    maxHealth: unit.maxHealth,
                });
            }

            optionsRef.current.onUnitClick?.(unit, event);
        },
        [unitClickEvent, emit]
    );

    const handleFeatureClick = useCallback(
        (feature: IsometricFeature, event: MinimalMouseEvent) => {
            if (featureClickEvent) {
                emit(featureClickEvent, {
                    featureId: feature.id,
                    x: feature.x,
                    z: feature.z ?? feature.y ?? 0,
                    type: feature.type,
                    elevation: feature.elevation,
                });
            }

            optionsRef.current.onFeatureClick?.(feature, event);
        },
        [featureClickEvent, emit]
    );

    const handleCanvasClick = useCallback(
        (event: MinimalMouseEvent) => {
            if (canvasClickEvent) {
                emit(canvasClickEvent, {
                    clientX: event.clientX,
                    clientY: event.clientY,
                    button: event.button,
                });
            }

            optionsRef.current.onCanvasClick?.(event);
        },
        [canvasClickEvent, emit]
    );

    const handleTileHover = useCallback(
        (tile: IsometricTile | null, event: MinimalMouseEvent) => {
            if (tile) {
                if (tileHoverEvent) {
                    emit(tileHoverEvent, {
                        tileId: tile.id,
                        x: tile.x,
                        z: tile.z ?? tile.y ?? 0,
                        type: tile.type,
                    });
                }
            } else {
                if (tileLeaveEvent) {
                    emit(tileLeaveEvent, {});
                }
            }

            optionsRef.current.onTileHover?.(tile, event);
        },
        [tileHoverEvent, tileLeaveEvent, emit]
    );

    const handleUnitAnimation = useCallback(
        (unitId: string, state: string) => {
            if (unitAnimationEvent) {
                emit(unitAnimationEvent, {
                    unitId,
                    state,
                    timestamp: Date.now(),
                });
            }

            optionsRef.current.onUnitAnimation?.(unitId, state);
        },
        [unitAnimationEvent, emit]
    );

    const handleCameraChange = useCallback(
        (position: { x: number; y: number; z: number }) => {
            if (cameraChangeEvent) {
                emit(cameraChangeEvent, {
                    position,
                    timestamp: Date.now(),
                });
            }
        },
        [cameraChangeEvent, emit]
    );

    return {
        handleTileClick,
        handleUnitClick,
        handleFeatureClick,
        handleCanvasClick,
        handleTileHover,
        handleUnitAnimation,
        handleCameraChange,
    };
}

export default useGameCanvas3DEvents;
