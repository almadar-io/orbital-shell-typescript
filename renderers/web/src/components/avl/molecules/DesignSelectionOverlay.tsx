/**
 * DesignSelectionOverlay
 *
 * Figma-style editing of the element selected on a paused canvas card,
 * written as Tailwind classes on that element (`@almadar/core`
 * design-classes, so every class compiles):
 *
 * - Resize handles (right, bottom, corner): dragging sets a Fixed size
 *   snapped to the spacing scale (`w-60`); double-clicking an edge sets Hug
 *   contents (`w-fit`); ⌥-double-click sets Fill container (`w-full`).
 * - The size label reads `Hug`, `Fill` or the pixel size per axis.
 * - On a layout container, pink handles sit in each gap between children
 *   (drag → `gap-*`) and in each padding band (drag → `pt-*`… ; ⌥ also sets
 *   the opposite side; a click without dragging opens a field to type the
 *   pixels, snapped to the scale), and a bar above it sets the auto-layout direction
 *   (`flex-row` / `flex-col`), alignment (a 3×3 grid → `items-*` +
 *   `justify-*`; rows follow the vertical axis, columns the horizontal one),
 *   space-between (`justify-between`; the grid then sets only the cross axis)
 *   and wrap (`flex-wrap`).
 */
import React, { useCallback, useState } from 'react';

import { Box } from '../../../core';
import { Icon } from '../../../core';
import { Input } from '../../../core';
import { useTranslate } from '../../../core';
import {
  gapHandleRects,
  paddingHandleRects,
  type LayoutAxis,
  type OverlayRect,
  type PaddingSide,
} from '../../../lib/selection-geometry';
import { layoutOf, sizingOf, snapToSpacingStep, spacingOf, withLayout, withSizing, withSpacing, defaultSpacingStepPx, type DesignAlignment, type DesignAxis, type DesignJustify, type DesignSpacing, type SpacingStepPx } from '../../../lib/design-classes';

type ResizeEdge = 'e' | 's' | 'se';

type Drag =
  | { kind: 'resize'; edge: ResizeEdge; startX: number; startY: number; width: number; height: number }
  | { kind: 'gap'; box: OverlayRect; startX: number; startY: number; startPx: number; px: number; moved?: boolean }
  | { kind: 'padding'; side: PaddingSide; box: OverlayRect; mirror: boolean; startX: number; startY: number; startPx: number; px: number; moved?: boolean };

/** The spacing value being typed after a click on its handle. */
type Typing =
  | { kind: 'gap'; box: OverlayRect; text: string }
  | { kind: 'padding'; side: PaddingSide; box: OverlayRect; text: string };

/** Pointer travel (px) below which a press on a spacing handle is a click, not a drag. */
const CLICK_SLOP_PX = 3;

const OPPOSITE: Record<PaddingSide, PaddingSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

export interface DesignSelectionOverlayProps {
  /** The selected element's box, in the card's content coordinates. */
  rect: OverlayRect;
  /** Its direct children's boxes when it is a layout container. */
  childRects: readonly OverlayRect[];
  /** Its layout direction, or null when it is not a layout container. */
  axis: LayoutAxis | null;
  /** The alignment it renders with (cross axis, main axis), where a grid position describes it. */
  alignment?: { align: DesignAlignment | null; justify: DesignJustify | null };
  /** Its current classes, or null when `className` is a binding (not editable here). */
  classes: readonly string[] | null;
  /** Canvas zoom — pointer deltas are divided by it. */
  zoom: number;
  /** Show the auto-layout bar (direction + alignment) on a layout container. */
  layoutBar?: boolean;
  /** What each spacing step renders at on this element (theme `--space-N` tokens; see `spacingScaleOf`). */
  pxOfStep?: SpacingStepPx;
  /**
   * Its gap and padding as rendered, in px. Props (a stack's `gap="md"`) set
   * spacing the classes don't show, so edits start from — and keep — these.
   */
  renderedSpacing?: Record<keyof DesignSpacing, number>;
  /** The element's next class list. */
  onChange: (classes: string[]) => void;
}

function sizeLabel(classes: readonly string[], axis: DesignAxis, px: number): string {
  const sizing = sizingOf(classes, axis);
  return sizing.mode === 'hug' ? 'Hug' : sizing.mode === 'fill' ? 'Fill' : String(Math.round(px));
}

const GRID: readonly DesignAlignment[] = ['start', 'center', 'end'];
const ROW_LABEL = ['designOverlay.top', 'designOverlay.middle', 'designOverlay.bottom'] as const;
const COLUMN_LABEL = ['designOverlay.left', 'designOverlay.center', 'designOverlay.right'] as const;

export function DesignSelectionOverlay({ rect, childRects, axis, alignment, classes, zoom, layoutBar = true, pxOfStep = defaultSpacingStepPx, renderedSpacing, onChange }: DesignSelectionOverlayProps): React.ReactElement {
  const { t } = useTranslate();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [typing, setTyping] = useState<Typing | null>(null);
  const scale = zoom > 0 ? zoom : 1;
  // In steps: what renders when known, else what the classes set.
  const spacing: DesignSpacing | null = !classes
    ? null
    : renderedSpacing
      ? {
          gap: snapToSpacingStep(renderedSpacing.gap, pxOfStep),
          top: snapToSpacingStep(renderedSpacing.top, pxOfStep),
          right: snapToSpacingStep(renderedSpacing.right, pxOfStep),
          bottom: snapToSpacingStep(renderedSpacing.bottom, pxOfStep),
          left: snapToSpacingStep(renderedSpacing.left, pxOfStep),
        }
      : spacingOf(classes);
  // Pixels an edit starts from: the rendered value, else the class value.
  const pxOf = (key: keyof DesignSpacing): number =>
    renderedSpacing ? renderedSpacing[key] : pxOfStep(spacing?.[key] ?? 0);

  const begin = useCallback((next: Drag) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ ...next, startX: e.clientX, startY: e.clientY });
  }, []);

  const move = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / scale;
    const dy = (e.clientY - drag.startY) / scale;
    if (drag.kind === 'resize') {
      setDrag({
        ...drag,
        width: drag.edge === 's' ? rect.width : Math.max(0, rect.width + dx),
        height: drag.edge === 'e' ? rect.height : Math.max(0, rect.height + dy),
      });
    } else if (drag.kind === 'gap') {
      const moved = drag.moved || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) >= CLICK_SLOP_PX;
      setDrag({ ...drag, moved, px: Math.max(0, drag.startPx + (axis === 'vertical' ? dy : dx)) });
    } else {
      const delta = drag.side === 'top' ? dy : drag.side === 'bottom' ? -dy : drag.side === 'left' ? dx : -dx;
      const moved = drag.moved || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) >= CLICK_SLOP_PX;
      setDrag({ ...drag, moved, px: Math.max(0, drag.startPx + delta) });
    }
  }, [drag, scale, rect, axis]);

  const end = useCallback(() => {
    if (!drag || !classes) {
      setDrag(null);
      return;
    }
    if (drag.kind !== 'resize' && !drag.moved) {
      const text = String(drag.startPx);
      setTyping(drag.kind === 'padding'
        ? { kind: 'padding', side: drag.side, box: drag.box, text }
        : { kind: 'gap', box: drag.box, text });
      setDrag(null);
      return;
    }
    if (drag.kind === 'resize') {
      let next = [...classes];
      if (drag.edge !== 's') next = withSizing(next, 'w', { mode: 'fixed', step: snapToSpacingStep(drag.width, pxOfStep) });
      if (drag.edge !== 'e') next = withSizing(next, 'h', { mode: 'fixed', step: snapToSpacingStep(drag.height, pxOfStep) });
      onChange(next);
    } else if (drag.kind === 'gap') {
      onChange(withSpacing(classes, { ...spacing, gap: snapToSpacingStep(drag.px, pxOfStep) }));
    } else {
      const step = snapToSpacingStep(drag.px, pxOfStep);
      const change: Partial<DesignSpacing> = { [drag.side]: step };
      if (drag.mirror) change[OPPOSITE[drag.side]] = step;
      onChange(withSpacing(classes, { ...spacing, ...change }));
    }
    setDrag(null);
  }, [drag, classes, onChange, pxOfStep, renderedSpacing]);

  const commitTyping = useCallback(() => {
    if (!typing || !classes) return;
    const px = Number(typing.text);
    if (typing.text.trim() === '' || !Number.isFinite(px) || px < 0) return;
    const step = snapToSpacingStep(px, pxOfStep);
    onChange(withSpacing(classes, { ...spacing, ...(typing.kind === 'gap' ? { gap: step } : { [typing.side]: step }) }));
    setTyping(null);
  }, [typing, classes, onChange, pxOfStep, renderedSpacing]);

  const toMode = useCallback((edge: ResizeEdge) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!classes) return;
    const sizing = e.altKey ? { mode: 'fill' as const } : { mode: 'hug' as const };
    let next = [...classes];
    if (edge !== 's') next = withSizing(next, 'w', sizing);
    if (edge !== 'e') next = withSizing(next, 'h', sizing);
    onChange(next);
  }, [classes, onChange]);

  const width = drag?.kind === 'resize' ? drag.width : rect.width;
  const height = drag?.kind === 'resize' ? drag.height : rect.height;
  const editable = classes !== null;

  const handleProps = {
    className: 'nodrag nopan absolute',
    onPointerMove: move,
    onPointerUp: end,
  };

  const resizeHandle = (edge: ResizeEdge, style: React.CSSProperties) => (
    <Box
      {...handleProps}
      data-testid={`design-resize-${edge}`}
      className={`${handleProps.className} rounded-sm border border-primary bg-card`}
      style={{ width: 8, height: 8, pointerEvents: 'auto', cursor: edge === 'e' ? 'ew-resize' : edge === 's' ? 'ns-resize' : 'nwse-resize', ...style }}
      onPointerDown={begin({ kind: 'resize', edge, startX: 0, startY: 0, width: rect.width, height: rect.height })}
      onDoubleClick={toMode(edge)}
    />
  );

  const spacingBand = (testId: string, box: OverlayRect, onDown: (e: React.PointerEvent<HTMLDivElement>) => void, cursor: string, label: string) => (
    <Box
      key={testId}
      {...handleProps}
      data-testid={testId}
      title={label}
      className={`${handleProps.className} flex items-center justify-center bg-accent/20 hover:bg-accent/40`}
      style={{
        top: box.top - rect.top,
        left: box.left - rect.left,
        width: Math.max(box.width, 4),
        height: Math.max(box.height, 4),
        pointerEvents: 'auto',
        cursor,
      }}
      onPointerDown={onDown}
    />
  );

  const bands = axis && spacing ? paddingHandleRects(rect, childRects) : null;

  // Grid row = vertical position, column = horizontal position; which of
  // them is the main axis (`justify`) depends on the direction.
  const layout = classes ? layoutOf(classes) : null;
  const align = layout?.align ?? alignment?.align ?? null;
  const justify = layout?.justify ?? alignment?.justify ?? null;
  const between = justify === 'between';
  const cellOf = (row: number, column: number) =>
    axis === 'vertical' ? { justify: GRID[row], align: GRID[column] } : { justify: GRID[column], align: GRID[row] };
  const wrap = layout?.wrap ?? false;
  const stop = (e: React.PointerEvent) => e.stopPropagation();

  const layoutControls = layoutBar && editable && axis && classes && (
    <Box
      data-testid="design-layout-bar"
      className="nodrag nopan absolute flex items-center gap-1 rounded bg-card border border-border shadow-sm p-1"
      style={{ bottom: '100%', left: 0, transform: 'translateY(-6px)', pointerEvents: 'auto' }}
      onPointerDown={stop}
    >
      {(['vertical', 'horizontal'] as const).map((direction) => (
        <Box
          key={direction}
          role="button"
          data-testid={`design-layout-direction-${direction}`}
          aria-pressed={axis === direction}
          aria-label={t(direction === 'vertical' ? 'designOverlay.layoutVertical' : 'designOverlay.layoutHorizontal')}
          title={t(direction === 'vertical' ? 'designOverlay.layoutVertical' : 'designOverlay.layoutHorizontal')}
          className={`flex items-center justify-center rounded w-5 h-5 cursor-pointer ${axis === direction ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onChange(withLayout(classes, { direction }));
          }}
        >
          <Icon name={direction === 'vertical' ? 'arrow-down' : 'arrow-right'} size="xs" />
        </Box>
      ))}
      <Box className="grid grid-cols-3 gap-px ml-1">
        {GRID.map((_, row) => GRID.map((__, column) => {
          const cell = cellOf(row, column);
          // Space-between spreads the main axis, so a cell only picks the cross axis.
          const active = cell.align === align && (between || cell.justify === justify);
          return (
            <Box
              key={`${row}-${column}`}
              role="button"
              data-testid={`design-align-${row}-${column}`}
              aria-pressed={active}
              aria-label={t('designOverlay.align', { row: t(ROW_LABEL[row]), column: t(COLUMN_LABEL[column]) })}
              className={`w-2 h-2 rounded-sm cursor-pointer ${active ? 'bg-primary' : 'bg-muted hover:bg-accent'}`}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                onChange(withLayout(classes, between ? { align: cell.align } : cell));
              }}
            />
          );
        }))}
      </Box>
      {([
        {
          id: 'space-between',
          pressed: between,
          label: 'designOverlay.spaceBetween',
          icon: axis === 'vertical' ? 'align-vertical-space-between' : 'align-horizontal-space-between',
          change: { justify: between ? 'start' : 'between' },
        },
        { id: 'wrap', pressed: wrap, label: 'designOverlay.wrap', icon: 'wrap-text', change: { wrap: !wrap } },
      ] as const).map((toggle) => (
        <Box
          key={toggle.id}
          role="button"
          data-testid={`design-layout-${toggle.id}`}
          aria-pressed={toggle.pressed}
          aria-label={t(toggle.label)}
          title={t(toggle.label)}
          className={`flex items-center justify-center rounded w-5 h-5 cursor-pointer ${toggle.id === 'space-between' ? 'ml-1' : ''} ${toggle.pressed ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onChange(withLayout(classes, toggle.change));
          }}
        >
          <Icon name={toggle.icon} size="xs" />
        </Box>
      ))}
    </Box>
  );

  return (
    <Box
      data-testid="orb-preview-selection"
      data-design-overlay=""
      style={{
        position: 'absolute',
        pointerEvents: 'none',
        top: rect.top,
        left: rect.left,
        width,
        height,
        outline: '2px solid var(--color-primary)',
        outlineOffset: '1px',
        borderRadius: '2px',
        zIndex: 21,
      }}
    >
      {editable && axis && spacing && gapHandleRects(childRects, axis).map((box, i) =>
        spacingBand(
          `design-gap-${i}`,
          box,
          begin({ kind: 'gap', box, startX: 0, startY: 0, startPx: pxOf('gap'), px: pxOf('gap') }),
          axis === 'vertical' ? 'ns-resize' : 'ew-resize',
          `gap-${spacing.gap}`,
        ),
      )}
      {editable && bands && spacing && (['top', 'right', 'bottom', 'left'] as const).map((side) =>
        spacingBand(
          `design-padding-${side}`,
          bands[side],
          (e) => begin({
            kind: 'padding',
            side,
            box: bands[side],
            mirror: e.altKey,
            startX: 0,
            startY: 0,
            startPx: pxOf(side),
            px: pxOf(side),
          })(e),
          side === 'top' || side === 'bottom' ? 'ns-resize' : 'ew-resize',
          `padding-${side}: ${spacing[side]}`,
        ),
      )}
      {layoutControls}
      {typing && (
        <Box
          className="nodrag nopan absolute"
          style={{ top: typing.box.top - rect.top, left: typing.box.left - rect.left, width: 56, pointerEvents: 'auto', zIndex: 22 }}
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
        >
          <Input
            data-testid="design-spacing-input"
            inputType="number"
            autoFocus
            value={typing.text}
            className="h-6 px-1 text-xs"
            onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setTyping({ ...typing, text: e.target.value })}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitTyping();
              else if (e.key === 'Escape') setTyping(null);
            }}
            onBlur={() => setTyping(null)}
          />
        </Box>
      )}
      {editable && resizeHandle('e', { right: -5, top: '50%', marginTop: -4 })}
      {editable && resizeHandle('s', { bottom: -5, left: '50%', marginLeft: -4 })}
      {editable && resizeHandle('se', { right: -5, bottom: -5 })}
      {editable && classes && (
        <Box
          data-testid="orb-preview-size-label"
          className="absolute rounded px-1 text-[10px] font-mono bg-primary text-primary-foreground whitespace-nowrap"
          style={{ top: '100%', left: '50%', transform: 'translate(-50%, 6px)' }}
        >
          {drag?.kind === 'resize'
            ? `${Math.round(width)} × ${Math.round(height)}`
            : drag?.kind === 'gap'
              ? `gap ${pxOfStep(snapToSpacingStep(drag.px, pxOfStep))}`
              : drag?.kind === 'padding'
                ? `${drag.side} ${pxOfStep(snapToSpacingStep(drag.px, pxOfStep))}`
                : `${sizeLabel(classes, 'w', rect.width)} × ${sizeLabel(classes, 'h', rect.height)}`}
        </Box>
      )}
    </Box>
  );
}

DesignSelectionOverlay.displayName = 'DesignSelectionOverlay';
