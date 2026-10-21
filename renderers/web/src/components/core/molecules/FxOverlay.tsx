'use client';
/**
 * `fx-overlay` — screen-space transient effects (confetti / flash / shake /
 * sparkle / float-text / streak-glow), driven by the SAME fx entity rows the
 * canvas `draw-fx-layer` consumes, filtered to `space == "screen"`.
 *
 * Each item's CSS animation starts when its DOM node MOUNTS (keyed by `id`)
 * and plays `forwards` to invisible; the fx mechanic's ttl decay then removes
 * the row and unmounts the node. That makes the overlay self-clearing with no
 * boolean edge to miss — the deadlock that left the config-triggered
 * `confetti-effect` pattern unusable from transitions. A new burst is a new
 * id, so re-fires always replay. NAME-BLIND: the look rides each item's
 * resolved typed fields (`effect`/`color`/`size`/…); the effect-kind
 * vocabulary stays consumer-declared.
 *
 * `children` (optional) is the wrapped content — the `shake` target and the
 * overlay's positioning bounds; without it the overlay is a pure absolute
 * layer over the nearest positioned ancestor (and `shake` items are inert).
 */
import type { A11yProps } from '@almadar/core';
import React from 'react';
import { cn } from '../../../core';
import { Box } from '../../../core';
import { CONFETTI_BURST_KEYFRAMES, createConfettiParticles, fxHash01, type FxOverlayItem } from '../../../core';

import { domPassthrough } from '../../../core';


export interface FxOverlayProps extends A11yProps {
    /** Live screen-space fx entries (the mechanic's fx list filtered to `space == "screen"`); mount starts each item's animation, ttl decay unmounts it. */
    items: FxOverlayItem[];
    /** The fx mechanic's decay tick period in ms; per-item animation duration = maxTtl × tickMs. Default 500. */
    tickMs?: number;
    /** Wrapped content — the `shake` target and the overlay's bounds. */
    children?: React.ReactNode;
    /** Additional class names on the outermost element. */
    className?: string;
}

const DEFAULT_TICK_MS = 500;

const FX_OVERLAY_KEYFRAMES = `
${CONFETTI_BURST_KEYFRAMES}
@keyframes fx-overlay-flash {
  0% { opacity: 0.75; }
  100% { opacity: 0; }
}
@keyframes fx-overlay-glow {
  0% { opacity: 0.9; }
  60% { opacity: 0.6; }
  100% { opacity: 0; }
}
@keyframes fx-overlay-sparkle {
  0% { opacity: 0; transform: scale(0); }
  30% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.3); }
}
@keyframes fx-overlay-float {
  0% { opacity: 0; transform: translate(-50%, 8px); }
  15% { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -40px); }
}
@keyframes fx-overlay-shake {
  0% { transform: translateX(0); }
  15% { transform: translateX(-6px); }
  30% { transform: translateX(5px); }
  45% { transform: translateX(-4px); }
  60% { transform: translateX(3px); }
  75% { transform: translateX(-2px); }
  100% { transform: translateX(0); }
}
`;

const lifeMsOf = (it: FxOverlayItem, tickMs: number): number =>
    Math.max(it.maxTtl ?? it.ttl, it.ttl, 1) * tickMs;

function ConfettiBurst({ item, lifeMs }: { item: FxOverlayItem; lifeMs: number }): React.JSX.Element {
    const particles = createConfettiParticles(item.particleCount ?? 30, item.id);
    const left = (item.x ?? 0.5) * 100;
    const top = (item.z ?? item.y ?? 0.4) * 100;
    return (
        <Box position="absolute" style={{ left: `${left}%`, top: `${top}%` }}>
            {particles.map((p) => {
                const rad = (p.angle * Math.PI) / 180;
                const tx = Math.cos(rad) * p.distance * (item.size ?? 1);
                const ty = Math.sin(rad) * p.distance * (item.size ?? 1) - 20;
                return (
                    <Box
                        key={p.id}
                        className="absolute rounded-sm"
                        style={{
                            left: (p.left - 50) * 2,
                            top: -10,
                            width: p.size,
                            height: p.size,
                            backgroundColor: item.color ?? p.color,
                            animation: `confetti-burst ${Math.max(lifeMs - p.delay, 200)}ms ease-out ${p.delay}ms forwards`,
                            opacity: 0,
                            '--confetti-tx': `${tx}px`,
                            '--confetti-ty': `${ty}px`,
                            '--confetti-rotate': `${p.rotation}deg`,
                        } as React.CSSProperties & Record<`--${string}`, string>}
                    />
                );
            })}
        </Box>
    );
}

function SparkleBurst({ item, lifeMs }: { item: FxOverlayItem; lifeMs: number }): React.JSX.Element {
    const count = item.particleCount ?? 8;
    const scale = item.size ?? 1;
    const left = (item.x ?? 0.5) * 100;
    const top = (item.z ?? item.y ?? 0.4) * 100;
    return (
        <Box position="absolute" style={{ left: `${left}%`, top: `${top}%` }}>
            {Array.from({ length: count }, (_, i) => {
                const dx = (fxHash01(item.id, i * 4) - 0.5) * 160 * scale;
                const dy = (fxHash01(item.id, i * 4 + 1) - 0.5) * 120 * scale;
                const dot = (4 + fxHash01(item.id, i * 4 + 2) * 5) * scale;
                const delay = fxHash01(item.id, i * 4 + 3) * lifeMs * 0.4;
                return (
                    <Box
                        key={i}
                        className="absolute rounded-full"
                        style={{
                            left: dx,
                            top: dy,
                            width: dot,
                            height: dot,
                            backgroundColor: item.color ?? 'gold',
                            opacity: 0,
                            animation: `fx-overlay-sparkle ${Math.max(lifeMs - delay, 200)}ms ease-in-out ${delay}ms forwards`,
                        }}
                    />
                );
            })}
        </Box>
    );
}

function OverlayFxNode({ item, tickMs }: { item: FxOverlayItem; tickMs: number }): React.JSX.Element | null {
    const lifeMs = lifeMsOf(item, tickMs);
    switch (item.effect ?? 'sparkle') {
        case 'confetti':
            return <ConfettiBurst item={item} lifeMs={lifeMs} />;
        case 'flash':
            return (
                <Box
                    position="absolute"
                    className="inset-0"
                    style={{
                        backgroundColor: item.color ?? '#ffffff',
                        opacity: 0,
                        animation: `fx-overlay-flash ${lifeMs}ms ease-out forwards`,
                    }}
                />
            );
        case 'streak-glow':
            return (
                <Box
                    position="absolute"
                    className="inset-0"
                    style={{
                        boxShadow: `inset 0 0 ${60 * (item.size ?? 1)}px ${item.color ?? 'var(--color-warning)'}`,
                        opacity: 0,
                        animation: `fx-overlay-glow ${lifeMs}ms ease-in-out forwards`,
                    }}
                />
            );
        case 'float-text': {
            if (!item.message) return null;
            return (
                <Box
                    position="absolute"
                    style={{
                        left: `${(item.x ?? 0.5) * 100}%`,
                        top: `${(item.z ?? item.y ?? 0.4) * 100}%`,
                        color: item.color ?? 'var(--color-success)',
                        fontWeight: 700,
                        fontSize: 16 * (item.size ?? 1),
                        textShadow: '0 1px 2px rgba(0,0,0,0.4)',
                        opacity: 0,
                        animation: `fx-overlay-float ${lifeMs}ms ease-out forwards`,
                        whiteSpace: 'nowrap',
                    }}
                >
                    {item.message}
                </Box>
            );
        }
        case 'shake':
            // Applied to the children wrapper by FxOverlay itself; no overlay node.
            return null;
        default:
            return <SparkleBurst item={item} lifeMs={lifeMs} />;
    }
}

export const FxOverlay: React.FC<FxOverlayProps> = ({ items, tickMs = DEFAULT_TICK_MS, children, className, ...rest }) => {
    const screenItems = (Array.isArray(items) ? items : []).filter(
        (it): it is FxOverlayItem => Boolean(it) && typeof it.id === 'string' && it.space !== 'world',
    );
    const shakeItem = [...screenItems].reverse().find((it) => it.effect === 'shake');

    // The overlay layer mounts persistently (an invisible pointer-events-none
    // container when idle) — a null return would read as a blank portal slot to
    // the verifier and force consumers into mount/unmount churn per burst.
    const hasChildren = children !== undefined && children !== null;
    const overlay = (
        <Box
            {...(hasChildren ? undefined : domPassthrough(rest))}
            position="absolute"
            className={cn('inset-0 pointer-events-none overflow-hidden z-50', !children && className)}
            aria-hidden="true"
        >
            {screenItems.map((it) => (
                <OverlayFxNode key={it.id} item={it} tickMs={tickMs} />
            ))}
            <style>{FX_OVERLAY_KEYFRAMES}</style>
        </Box>
    );

    if (hasChildren) {
        return (
            <Box {...domPassthrough(rest)} position="relative" className={className}>
                <Box
                    key={shakeItem?.id ?? 'steady'}
                    style={
                        shakeItem
                            ? { animation: `fx-overlay-shake ${Math.min(lifeMsOf(shakeItem, tickMs), 600)}ms ease-in-out` }
                            : undefined
                    }
                >
                    {children}
                </Box>
                {overlay}
            </Box>
        );
    }
    return overlay;
};

FxOverlay.displayName = 'FxOverlay';

export default FxOverlay;
