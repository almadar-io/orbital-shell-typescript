'use client';
import React from "react";
import { LOADING_STATE_MARKER } from "@almadar/core";
import type { A11yProps } from "@almadar/core";
import { cn } from '../../../core';
import { Box } from '../../../core';
import { Spinner } from '../../../core';
import { VStack } from '../../../core';
import { Typography } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
export interface LoadingStateProps extends A11yProps {
  title?: string;
  message?: string;
  className?: string;
  /** Center over the whole viewport (fix: inset-0 overlay) instead of inline. */
  fullPage?: boolean;
  /** Lines shown one at a time in turn, rotated by CSS alone so they play before any script runs. */
  messages?: string[];
  /** How long each of `messages` stays up, in ms. */
  messageMs?: number;
  /** The page's boot loader: covers the viewport until every scene canvas reports data-orb-ready, then fades. It shows `messages`, then CSS dots and `message` as its visible status. It carries no loading-state marker (and so no Spinner), so a prerendered page keeps it. */
  untilReady?: boolean;
  /** The boot loader's background colour. */
  background?: string;
  /** The boot loader's text colour. */
  foreground?: string;
}

const READY = 'body:has(.orbital-scene-canvas[data-orb-ready="true"]):not(:has(.orbital-scene-canvas:not([data-orb-ready="true"])))';

function bootCss(count: number, messageMs: number): string {
  const hide = `${READY} [data-orb-loader]{opacity:0;visibility:hidden;pointer-events:none}`;
  const dots = '[data-orb-loader-dots]{display:flex;gap:8px;justify-content:center}[data-orb-loader-dots] i{width:8px;height:8px;border-radius:50%;background:currentColor;opacity:.35;animation:orbLoaderDot 1.2s ease-in-out infinite}[data-orb-loader-dots] i:nth-child(2){animation-delay:.2s}[data-orb-loader-dots] i:nth-child(3){animation-delay:.4s}@keyframes orbLoaderDot{0%,100%{opacity:.35;transform:translateY(0)}40%{opacity:1;transform:translateY(-5px)}}@media (prefers-reduced-motion:reduce){[data-orb-loader-dots] i{animation:none;opacity:.8}}';
  const base = '[data-orb-loader]{transition:opacity .32s ease,visibility 0s linear .32s}[data-orb-loader-lines]{display:grid}[data-orb-loader-line]{grid-area:1/1}' + dots;
  if (count < 2) return base + hide;
  const cycle = count * messageMs;
  const share = 100 / count;
  const fade = Math.min(share / 4, (400 / cycle) * 100);
  const keyframes = `@keyframes orbLoaderLine{0%{opacity:0}${fade.toFixed(3)}%{opacity:1}${(share - fade).toFixed(3)}%{opacity:1}${share.toFixed(3)}%{opacity:0}100%{opacity:0}}`;
  const lines = `[data-orb-loader-line]{opacity:0;animation:orbLoaderLine ${cycle}ms linear infinite}`;
  // Each cycle starts past its fade-in, so the first line is up at once, and a remount at boot shows the same line without a blank.
  const lead = Math.round((fade / 100) * cycle);
  const delays = Array.from({ length: count }, (_, i) => `[data-orb-loader-line="${i}"]{animation-delay:${i * messageMs - lead}ms}`).join('');
  const still = '@media (prefers-reduced-motion:reduce){[data-orb-loader-line]{animation:none}[data-orb-loader-line="0"]{opacity:1}}';
  return base + keyframes + lines + delays + still + hide;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  title,
  message,
  className,
  fullPage = false,
  messages,
  messageMs = 5000,
  untilReady = false,
  background,
  foreground,
  ...rest
}) => {
  const { t } = useTranslate();
  const displayMessage = message ?? t('common.loading');
  if (untilReady) {
    const lines = messages ?? [];
    return (
      <Box
        {...domPassthrough(rest)}
        role="status"
        aria-live="polite"
        data-orb-loader=""
        className={cn("fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-6 px-8", className)}
        style={{ background, color: foreground }}
      >
        <style>{bootCss(lines.length, messageMs)}</style>
        {title && (
          <Typography variant="h3" className="text-lg" style={{ color: foreground }}>
            {title}
          </Typography>
        )}
        <Box data-orb-loader-lines="" className="max-w-xl text-center">
          {lines.map((line, i) => (
            <Typography key={i} variant="body" data-orb-loader-line={String(i)} style={{ color: foreground }}>
              {line}
            </Typography>
          ))}
        </Box>
        <Box className="flex flex-col items-center gap-2">
          <Box data-orb-loader-dots="" aria-hidden="true"><i /><i /><i /></Box>
          <Typography variant="small" data-orb-loader-status="" style={{ color: foreground, opacity: 0.75 }}>
            {displayMessage}
          </Typography>
        </Box>
      </Box>
    );
  }
  return (
    <Box {...domPassthrough(rest)} className="contents" {...{ [LOADING_STATE_MARKER]: "" }}>
      <VStack
        align="center"
        className={cn(
          "justify-center",
          fullPage
            ? "fixed inset-0 z-[1000] py-12 bg-background/80 backdrop-blur-sm animate-overlay-in"
            : "py-12",
          className,
        )}
      >
        <Spinner size="lg" />
        {title && (
          <Typography variant="h3" className="mt-4 text-lg text-foreground">
            {title}
          </Typography>
        )}
        <Typography
          variant="small"
          className={cn(
            "text-muted-foreground",
            title ? "mt-2" : "mt-4",
          )}
        >
          {displayMessage}
        </Typography>
      </VStack>
    </Box>
  );
};

LoadingState.displayName = "LoadingState";
