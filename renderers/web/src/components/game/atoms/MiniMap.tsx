'use client';
import * as React from 'react';
import type { A11yProps, Asset } from '@almadar/core';
import { cn } from '../../../core';
import { Box } from '../../../core';
import type { Rect } from '../../../core';
import { domPassthrough } from '../../../core';
import { useTranslate } from '../../../core';

export interface MiniMapTile {
  x: number;
  y: number;
  color: string;
}

export interface MiniMapUnit {
  x: number;
  y: number;
  color: string;
  isPlayer?: boolean;
}

export interface MiniMapProps extends A11yProps {
  /** Tile data: each tile renders as a 1px dot at (x,y) with the given color */
  tiles?: MiniMapTile[];
  /** Unit positions: each unit renders as a 2px dot */
  units?: MiniMapUnit[];
  /** Canvas display width in pixels */
  width?: number;
  /** Canvas display height in pixels */
  height?: number;
  /** Logical map width (for coordinate scaling) */
  mapWidth?: number;
  /** Logical map height (for coordinate scaling) */
  mapHeight?: number;
  /** Viewport rectangle outline */
  viewportRect?: Rect;
  /** Additional CSS classes */
  className?: string;
  /** Map of terrain key → Asset; when present, draws sprites instead of flat hex colors for tiles. */
  tileAssets?: Record<string, Asset>;
  /** Map of unit id or unit type → Asset; when present, draws sprites instead of flat dots for units. */
  unitAssets?: Record<string, Asset>;
}

const DEFAULT_TILES: MiniMapTile[] = [
  { x: 10, y: 10, color: '#4ade80' },
  { x: 20, y: 15, color: '#4ade80' },
  { x: 30, y: 25, color: '#22c55e' },
  { x: 50, y: 40, color: '#4ade80' },
  { x: 60, y: 55, color: '#16a34a' },
  { x: 40, y: 60, color: '#4ade80' },
  { x: 70, y: 30, color: '#22c55e' },
  { x: 80, y: 70, color: '#4ade80' },
];
const DEFAULT_UNITS: MiniMapUnit[] = [
  { x: 30, y: 30, color: '#60a5fa', isPlayer: true },
];
const DEFAULT_VIEWPORT = { x: 20, y: 20, w: 40, h: 40 };

export function MiniMap({
  tiles = DEFAULT_TILES,
  units = DEFAULT_UNITS,
  width = 150,
  height = 150,
  mapWidth = 100,
  mapHeight = 100,
  viewportRect = DEFAULT_VIEWPORT,
  className,
  tileAssets,
  unitAssets,
  ...rest
}: MiniMapProps) {
  const { t } = useTranslate();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  // Cache loaded Image objects so we don't reload on every frame.
  const imgCacheRef = React.useRef<Map<string, HTMLImageElement>>(new Map());

  function loadImg(url: string): HTMLImageElement | null {
    const cached = imgCacheRef.current.get(url);
    if (cached) return cached.complete ? cached : null;
    const img = new Image();
    img.crossOrigin = 'anonymous'; // keep the canvas untainted for capture/pixel reads
    img.src = url;
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Force a repaint once the image has loaded
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, 0, 0);
    };
    imgCacheRef.current.set(url, img);
    return null;
  }

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scaleX = width / mapWidth;
    const scaleY = height / mapHeight;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, width, height);

    for (const tile of tiles) {
      const tileAsset = tileAssets?.[tile.color] ?? tileAssets?.['default'];
      const tileImg = tileAsset ? loadImg(tileAsset.url) : null;
      const tx = Math.floor(tile.x * scaleX);
      const ty = Math.floor(tile.y * scaleY);
      const tw = Math.max(1, Math.ceil(scaleX));
      const th = Math.max(1, Math.ceil(scaleY));
      if (tileImg) {
        ctx.drawImage(tileImg, tx, ty, tw, th);
      } else {
        ctx.fillStyle = tile.color;
        ctx.fillRect(tx, ty, tw, th);
      }
    }

    for (const unit of units) {
      if (unit.isPlayer) continue; // player marker rendered as DOM overlay
      const unitAsset = unitAssets?.[unit.color] ?? unitAssets?.['default'];
      const unitImg = unitAsset ? loadImg(unitAsset.url) : null;
      const ux = Math.floor(unit.x * scaleX) - 1;
      const uy = Math.floor(unit.y * scaleY) - 1;
      if (unitImg) {
        ctx.drawImage(unitImg, ux, uy, 5, 5);
      } else {
        ctx.fillStyle = unit.color;
        ctx.fillRect(ux, uy, 3, 3);
      }
    }

    if (viewportRect) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        Math.floor(viewportRect.x * scaleX),
        Math.floor(viewportRect.y * scaleY),
        Math.floor(viewportRect.w * scaleX),
        Math.floor(viewportRect.h * scaleY)
      );
    }
  }, [tiles, units, width, height, mapWidth, mapHeight, viewportRect, tileAssets, unitAssets]);

  const scaleX = width / mapWidth;
  const scaleY = height / mapHeight;
  const playerUnit = units.find((u) => u.isPlayer);
  const playerLeft = playerUnit ? Math.floor(playerUnit.x * scaleX) - 1 : null;
  const playerTop = playerUnit ? Math.floor(playerUnit.y * scaleY) - 1 : null;

  return (
    <>
      <style>{`@keyframes minimap-blink{0%,49%{opacity:1}50%,100%{opacity:0}}`}</style>
      <Box
        position="relative"
        display="inline-block"
        className={cn(
          'border border-border/20 rounded-container',
          className
        )}
      >
        {/* canvas is the rendering surface — not chrome */}
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="block"
          style={{ width, height }}
          role="img"
          aria-label={t('aria.minimap')}
          {...domPassthrough(rest)}
        />
        {playerLeft !== null && playerTop !== null && (
          <Box
            position="absolute"
            style={{
              left: playerLeft,
              top: playerTop,
              width: 3,
              height: 3,
              backgroundColor: '#ffffff',
              animation: 'minimap-blink 1s steps(2, end) infinite',
              pointerEvents: 'none',
            }}
          />
        )}
      </Box>
    </>
  );
}

MiniMap.displayName = 'MiniMap';
