/**
 * GameShell — thin fullscreen game SURFACE.
 *
 * Contributes positioning + the game skin (Kenney font, 9-slice panel chrome, floating overlays)
 * and nothing else: the canvas fills the viewport underneath; composed atoms/molecules land in
 * overlay slots. `hud` floats top; `addons` floats bottom-right (action cluster). Dumb: props in,
 * layout out — no descriptor resolution, no runtime logic.
 */

import React from "react";
import type { A11yProps, Asset } from "@almadar/core";
import { domPassthrough } from '../../../core';
import { cn } from '../../../core';
import { resolveGameFontFamily } from "../../../lib/gameFonts";
import { Box } from '../../../core';
import { Card } from '../../../core';
import { Typography } from '../../../core';
import { AtlasPanel } from '../../../core';
import { useTranslate } from '../../../core';
import { GameOverlayContext } from "../molecules/GameMenu";

export interface GameShellProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
    /** Application / game title shown as a floating chip */
    appName?: string;
    /** Stat chips row — floats along the top edge. Legacy chrome surface: new behaviors emit HUD chrome via `render-ui "hud-top"` instead. */
    hud?: React.ReactNode;
    /** Action cluster — floats bottom-right (End Turn, Fire, Reset, …). Legacy chrome surface: new behaviors emit action chrome via `render-ui "hud-bottom"` or `"floating"` instead. */
    addons?: React.ReactNode;
    /** Movement controls — floats bottom-left (d-pad / control-grid). Legacy chrome surface: new behaviors emit movement controls via `render-ui "hud-bottom"` instead. */
    controls?: React.ReactNode;
    /** Centered overlay layer (victory/defeat banners, dialogs). Legacy chrome surface: new behaviors emit overlays via `render-ui "overlay"` (clear with `render-ui "overlay" null` on every exit) instead. */
    overlay?: React.ReactNode;
    /** Extra class name on the root container */
    className?: string;
    /** Whether to show the title chip (default: true) */
    showTopBar?: boolean;
    /** Game content — fills the whole surface underneath the overlays */
    children?: React.ReactNode;
    /** Pattern slice tiled at low opacity across the surface (never cover-stretched). */
    backgroundAsset?: Asset;
    /** Per-call-site 9-sliced panel override. Chrome normally comes from the active theme; most callers leave this unset. */
    hudBackgroundAsset?: Asset;
    /** Game display-font key (pixel | fredoka | future | future-narrow | blocks | mini) or a CSS font-family. Scoped override of the theme contract's --font-family-display slot: titles and numerics take this face, body text follows the active theme. Unset = the theme token decides. */
    fontFamily?: string;
    /** Scopes an `@almadar/ui` theme (e.g. "game-sci-fi-dark") to this shell's subtree. */
    "data-theme"?: string;
}

export const GameShell: React.FC<GameShellProps> = ({
    appName: appNameProp,
    hud,
    addons,
    controls,
    overlay,
    className,
    showTopBar = true,
    children,
    backgroundAsset,
    fontFamily,
    "data-theme": dataTheme,
    ...rest
}) => {
    const { t } = useTranslate();
    const appName = appNameProp ?? t('gameShell.defaultName');
    const displayFont = resolveGameFontFamily(fontFamily);
    return (
        <Box
            {...domPassthrough(rest)}
            data-theme={dataTheme || undefined}
            className={cn("game-shell", className)}
            style={{
                position: "relative",
                width: "100%",
                maxWidth: "100vw",
                height: "100vh",
                overflow: "hidden",
                background: "var(--color-background, #0a0a0f)",
                color: "var(--color-foreground, #e0e0e0)",
                // The fontFamily knob is a scoped override of the theme contract's
                // display slot: titles/numerics take the game face, body text keeps
                // the active theme's --font-family-body. Set ONLY when explicitly
                // passed — an always-on inline stamp would shadow the orbital's
                // inline-theme font-family-display token (inline style beats the
                // theme provider's vars for the whole shell subtree).
                ...(displayFont
                    ? { "--font-family-display": displayFont }
                    : {}),
            } as React.CSSProperties}
        >
            {/* Optional tiled pattern — subtle game-table texture, never a stretched slice. */}
            {backgroundAsset && (
                <AtlasPanel
                    asset={backgroundAsset}
                    mode="repeat"
                    aria-hidden
                    className="game-shell__bg"
                    style={{ position: "absolute", inset: 0, opacity: 0.18, zIndex: 0, display: "block" }}
                />
            )}

            {/* Game surface — the canvas owns the full viewport. */}
            <Box className="game-shell__content" style={{ position: "absolute", inset: 0, zIndex: 1 }}>
                {children}
            </Box>

            {/* Floating top overlay: title chip + HUD chips. */}
            {(showTopBar || hud) && (
                <Box
                    className="game-shell__top pointer-events-none"
                    style={{
                        position: "absolute",
                        top: 12,
                        left: 12,
                        right: 12,
                        zIndex: 2,
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                    }}
                >
                    {showTopBar && (
                        <Card
                            variant="bordered"
                            padding="none"
                            className="game-shell__title bg-card pointer-events-auto"
                            style={{ padding: "6px 16px", flexShrink: 0 }}
                        >
                            <Typography
                                as="span"
                                className="font-display"
                                style={{
                                    fontWeight: 700,
                                    fontSize: "1.05rem",
                                    letterSpacing: "0.06em",
                                    textShadow: "0 2px 0 rgba(0,0,0,0.5)",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {appName}
                            </Typography>
                        </Card>
                    )}
                    {hud && (
                        <Box className="game-shell__hud pointer-events-auto" style={{ flex: 1, minWidth: 0 }}>
                            {hud}
                        </Box>
                    )}
                </Box>
            )}

            {/* Floating bottom-left movement controls (d-pad / control-grid). */}
            {controls && (
                <Box
                    className="game-shell__controls pointer-events-auto"
                    style={{
                        position: "absolute",
                        left: 16,
                        bottom: 16,
                        zIndex: 2,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: 10,
                        filter: "drop-shadow(0 6px 12px rgba(0,0,0,0.5))",
                    }}
                >
                    {controls}
                </Box>
            )}

            {/* Floating bottom-right action cluster. */}
            {addons && (
                <Box
                    className="game-shell__actions pointer-events-auto"
                    style={{
                        position: "absolute",
                        right: 16,
                        bottom: 16,
                        zIndex: 2,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 10,
                        filter: "drop-shadow(0 6px 12px rgba(0,0,0,0.5))",
                    }}
                >
                    {addons}
                </Box>
            )}

            {/* Centered overlay layer — banners/dialogs; container never blocks the canvas. */}
            {overlay && (
                <Box
                    className="game-shell__overlay pointer-events-none"
                    style={{
                        position: "absolute",
                        inset: 0,
                        zIndex: 3,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Box className="pointer-events-auto">
                        <GameOverlayContext.Provider value={true}>{overlay}</GameOverlayContext.Provider>
                    </Box>
                </Box>
            )}
        </Box>
    );
};

GameShell.displayName = "GameShell";
