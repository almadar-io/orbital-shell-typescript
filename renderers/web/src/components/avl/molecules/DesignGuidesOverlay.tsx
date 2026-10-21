/**
 * DesignGuidesOverlay — Figma's smart guides (lines an element being moved
 * snaps to) and ⌥ measurements (distances from the selection, labelled in
 * px), drawn over a paused card in its content coordinates. Pure drawing:
 * the geometry comes from `lib/selection-geometry` (`snapMove`,
 * `distanceLines`).
 */
import React from 'react';
import { Box } from '../../../core';
import type { GuideLine, MeasureLine } from '../../../lib/selection-geometry';

export interface DesignGuidesOverlayProps {
  guides: readonly GuideLine[];
  measures: readonly MeasureLine[];
  /** Canvas zoom; labels are scaled back so they read the same at any zoom. */
  zoom: number;
}

const GUIDE_COLOR = 'var(--color-error)';

export function DesignGuidesOverlay({ guides, measures, zoom }: DesignGuidesOverlayProps): React.ReactElement | null {
  if (guides.length === 0 && measures.length === 0) return null;
  const scale = zoom > 0 ? 1 / zoom : 1;
  return (
    <Box className="absolute inset-0 pointer-events-none" style={{ zIndex: 24 }}>
      {guides.map((g, i) => (
        <Box
          key={`g${i}`}
          data-testid="design-guide"
          className="absolute"
          style={g.orientation === 'vertical'
            ? { left: g.at, top: g.from, width: 1, height: g.to - g.from, background: GUIDE_COLOR }
            : { top: g.at, left: g.from, height: 1, width: g.to - g.from, background: GUIDE_COLOR }}
        />
      ))}
      {measures.map((m, i) => {
        const vertical = m.x1 === m.x2;
        const left = Math.min(m.x1, m.x2);
        const top = Math.min(m.y1, m.y2);
        return (
          <Box
            key={`m${i}`}
            data-testid="design-measure"
            className="absolute flex items-center justify-center"
            style={vertical
              ? { left, top, width: 1, height: Math.abs(m.y2 - m.y1), background: GUIDE_COLOR }
              : { left, top, height: 1, width: Math.abs(m.x2 - m.x1), background: GUIDE_COLOR }}
          >
            <Box
              data-testid="design-measure-label"
              className="rounded px-1 text-[10px] font-mono whitespace-nowrap bg-error text-error-foreground"
              style={{ transform: `scale(${scale})` }}
            >
              {m.length}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

DesignGuidesOverlay.displayName = 'DesignGuidesOverlay';
