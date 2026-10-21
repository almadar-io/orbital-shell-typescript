'use client';
/**
 * Meter Molecule
 *
 * A gauge/meter component for displaying a value within a range.
 * Supports linear, radial, and segmented display modes.
 * Pure molecule: no entity prop, no data fetching.
 */

import React, { useMemo, useCallback } from "react";
import { cn } from '../../../core';
import { Card, Typography, Badge, Box } from '../../../core';
import { VStack, HStack } from '../../../core';
import { LoadingState } from "./LoadingState";
import { ErrorState } from "./ErrorState";
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import type { UiError } from '../../../core';
import type { A11yProps, EventKey } from "@almadar/core";
import { domPassthrough } from '../../../core';

export type MeterVariant = "linear" | "radial" | "segmented";

export interface MeterThreshold {
    value: number;
    color: string;
    label?: string;
}

export interface MeterAction {
    label: string;
    event?: EventKey;
    navigatesTo?: string;
    variant?: "primary" | "secondary" | "ghost";
}

export interface MeterProps extends A11yProps {
    /** Current value */
    value: number;
    /** Minimum value */
    min?: number;
    /** Maximum value */
    max?: number;
    /** Display label */
    label?: string;
    /** Unit suffix (e.g., '%', 'MB', 'credits') */
    unit?: string;
    /** Display variant */
    variant?: MeterVariant;
    /** Color thresholds */
    thresholds?: readonly MeterThreshold[];
    /** Number of segments (for segmented variant) */
    segments?: number;
    /** Show value text */
    showValue?: boolean;
    /** Size (for radial variant) */
    size?: "sm" | "md" | "lg";
    /** Actions */
    actions?: readonly MeterAction[];
    /** Loading state */
    isLoading?: boolean;
    /** Error state */
    error?: UiError | null;
    /** Additional CSS classes */
    className?: string;
}

/** Default thresholds using CSS variables */
const DEFAULT_THRESHOLDS: MeterThreshold[] = [
    { value: 30, color: "var(--color-error)" },
    { value: 70, color: "var(--color-warning)" },
    { value: 100, color: "var(--color-success)" },
];

function getColorForValue(
    value: number,
    max: number,
    thresholds: readonly MeterThreshold[],
): string {
    const percentage = (value / max) * 100;
    for (const threshold of thresholds) {
        if (percentage <= threshold.value) {
            return threshold.color;
        }
    }
    return thresholds[thresholds.length - 1]?.color ?? "var(--color-primary)";
}

const radialSizes = {
    sm: { size: 80, stroke: 6, fontSize: "12px" },
    md: { size: 120, stroke: 8, fontSize: "16px" },
    lg: { size: 160, stroke: 10, fontSize: "20px" },
};

export const Meter: React.FC<MeterProps> = ({
    value,
    min = 0,
    max = 100,
    label,
    unit,
    variant = "linear",
    thresholds = DEFAULT_THRESHOLDS,
    segments = 5,
    showValue = true,
    size = "md",
    actions,
    isLoading = false,
    error,
    className,
    "aria-label": ariaLabel,
    ...rest
}) => {
    const passthrough = domPassthrough(rest);
    const eventBus = useEventBus();
    const { t } = useTranslate();

    const handleAction = useCallback(
        (action: MeterAction) => {
            if (action.event) {
                eventBus.emit(`UI:${action.event}`, { value });
            }
        },
        [eventBus, value],
    );

    const safeVal = value ?? 0;

    const percentage = useMemo(() => {
        const range = max - min;
        if (range <= 0) return 0;
        return Math.min(Math.max(((safeVal - min) / range) * 100, 0), 100);
    }, [safeVal, min, max]);

    const activeColor = useMemo(
        () => getColorForValue(safeVal, max, thresholds),
        [safeVal, max, thresholds],
    );

    const displayValue = useMemo(() => {
        const formatted = Number.isInteger(safeVal) ? safeVal : safeVal.toFixed(1);
        return unit ? `${formatted}${unit}` : `${formatted}`;
    }, [safeVal, unit]);

    const meterProps = {
        role: "meter" as const,
        "aria-label": ariaLabel ?? label,
        "aria-valuemin": min,
        "aria-valuemax": max,
        "aria-valuenow": Math.min(Math.max(safeVal, min), max),
        "aria-valuetext": displayValue,
    };

    if (isLoading) {
        return <LoadingState message={t('common.loading')} className={className} />;
    }

    if (error) {
        return (
            <ErrorState
                title={t('display.meterError')}
                message={error.message}
                className={className}
            />
        );
    }

    if (variant === "radial") {
        const dims = radialSizes[size];
        const radius = (dims.size - dims.stroke * 2) / 2;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (percentage / 100) * circumference;
        const center = dims.size / 2;

        return (
            <Card className={cn("p-4", className)} {...passthrough}>
                <VStack gap="sm" align="center">
                    {label && (
                        <Typography variant="small" color="secondary" weight="medium">
                            {label}
                        </Typography>
                    )}
                    <Box className="relative inline-flex items-center justify-center" {...meterProps}>
                        <svg
                            width={dims.size}
                            height={dims.size}
                            viewBox={`0 0 ${dims.size} ${dims.size}`}
                            className="transform -rotate-90"
                        >
                            <circle
                                cx={center}
                                cy={center}
                                r={radius}
                                fill="none"
                                stroke="var(--color-muted)"
                                strokeWidth={dims.stroke}
                            />
                            <circle
                                cx={center}
                                cy={center}
                                r={radius}
                                fill="none"
                                stroke={activeColor}
                                strokeWidth={dims.stroke}
                                strokeDasharray={circumference}
                                strokeDashoffset={offset}
                                strokeLinecap="round"
                                className="transition-all duration-slow ease-emphasized"
                            />
                        </svg>
                        {showValue && (
                            <Box className="absolute inset-0 flex items-center justify-center">
                                <Typography
                                    variant="h5"
                                    className="tabular-nums"
                                    style={{ fontSize: dims.fontSize }}
                                >
                                    {displayValue}
                                </Typography>
                            </Box>
                        )}
                    </Box>
                    {actions && actions.length > 0 && (
                        <HStack gap="xs">
                            {actions.map((action, idx) => (
                                <Badge
                                    key={idx}
                                    variant="default"
                                    className="cursor-pointer hover:opacity-80 transition-opacity"
                                    onClick={() => handleAction(action)}
                                >
                                    {action.label}
                                </Badge>
                            ))}
                        </HStack>
                    )}
                </VStack>
            </Card>
        );
    }

    if (variant === "segmented") {
        const segmentWidth = 100 / segments;
        const activeSegments = Math.round((percentage / 100) * segments);

        return (
            <Card className={cn("p-4", className)} {...passthrough}>
                <VStack gap="sm">
                    {(label || showValue) && (
                        <HStack justify="between" align="center">
                            {label && (
                                <Typography variant="small" color="secondary" weight="medium">
                                    {label}
                                </Typography>
                            )}
                            {showValue && (
                                <Typography variant="small" weight="bold" className="tabular-nums">
                                    {displayValue}
                                </Typography>
                            )}
                        </HStack>
                    )}
                    <HStack gap="xs" className="w-full" {...meterProps}>
                        {Array.from({ length: segments }).map((_, idx) => {
                            const isActive = idx < activeSegments;
                            const segColor = isActive
                                ? getColorForValue(((idx + 1) / segments) * max, max, thresholds)
                                : undefined;
                            return (
                                <Box
                                    key={idx}
                                    className={cn(
                                        "h-2 flex-1 rounded-sm transition-all duration-normal",
                                        !isActive && "bg-muted",
                                    )}
                                    style={isActive ? { backgroundColor: segColor } : undefined}
                                />
                            );
                        })}
                    </HStack>
                    {/* Threshold labels */}
                    {thresholds.some((t) => t.label) && (
                        <HStack justify="between" className="w-full">
                            {thresholds.map((t, idx) => (
                                <Typography key={idx} variant="caption" color="secondary">
                                    {t.label || ""}
                                </Typography>
                            ))}
                        </HStack>
                    )}
                </VStack>
            </Card>
        );
    }

    // Default: linear
    return (
        <Card className={cn("p-4", className)} {...passthrough}>
            <VStack gap="sm">
                {(label || showValue) && (
                    <HStack justify="between" align="center">
                        {label && (
                            <Typography variant="small" color="secondary" weight="medium">
                                {label}
                            </Typography>
                        )}
                        {showValue && (
                            <Typography variant="small" weight="bold" className="tabular-nums">
                                {displayValue}
                            </Typography>
                        )}
                    </HStack>
                )}
                <Box className="w-full h-3 bg-muted rounded-full overflow-hidden" {...meterProps}>
                    <Box
                        className="h-full rounded-full transition-all duration-slow ease-emphasized"
                        style={{
                            width: `${percentage}%`,
                            backgroundColor: activeColor,
                        }}
                    />
                </Box>
                {/* Min/Max labels */}
                <HStack justify="between" className="w-full">
                    <Typography variant="caption" color="secondary">
                        {min}
                        {unit ? ` ${unit}` : ""}
                    </Typography>
                    <Typography variant="caption" color="secondary">
                        {max}
                        {unit ? ` ${unit}` : ""}
                    </Typography>
                </HStack>
                {actions && actions.length > 0 && (
                    <HStack gap="xs">
                        {actions.map((action, idx) => (
                            <Badge
                                key={idx}
                                variant="default"
                                className="cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() => handleAction(action)}
                            >
                                {action.label}
                            </Badge>
                        ))}
                    </HStack>
                )}
            </VStack>
        </Card>
    );
};

Meter.displayName = "Meter";
