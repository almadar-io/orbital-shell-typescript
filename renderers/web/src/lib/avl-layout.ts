/**
 * AVL layout utilities for positioning atoms in composed diagrams.
 */

/** Distribute N points evenly around a ring.
 *  Handles edge cases: 1 state (centered), 2 states (horizontal). */
export function ringPositions(
  cx: number,
  cy: number,
  r: number,
  count: number,
  startAngle = -Math.PI / 2,
): Array<{ x: number; y: number; angle: number }> {
  if (count === 0) return [];
  if (count === 1) {
    return [{ x: cx, y: cy, angle: 0 }];
  }
  if (count === 2) {
    // Place horizontally so the two states don't stack vertically
    return [
      { x: cx - r * 0.7, y: cy, angle: Math.PI },
      { x: cx + r * 0.7, y: cy, angle: 0 },
    ];
  }
  return Array.from({ length: count }, (_, i) => {
    const angle = startAngle + (Math.PI * 2 * i) / count;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      angle,
    };
  });
}

/** Create an SVG arc path between two angles on a circle. */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2}`;
}

/** Distribute N points radially from a center. */
export function radialPositions(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  count: number,
  startAngle = -Math.PI / 2,
): Array<{ x1: number; y1: number; x2: number; y2: number; angle: number }> {
  return Array.from({ length: count }, (_, i) => {
    const angle = startAngle + (Math.PI * 2 * i) / count;
    return {
      x1: cx + innerR * Math.cos(angle),
      y1: cy + innerR * Math.sin(angle),
      x2: cx + outerR * Math.cos(angle),
      y2: cy + outerR * Math.sin(angle),
      angle,
    };
  });
}

/** Simple grid layout: position items in columns and rows. */
export function gridPositions(
  startX: number,
  startY: number,
  cols: number,
  cellWidth: number,
  cellHeight: number,
  count: number,
): Array<{ x: number; y: number; col: number; row: number }> {
  return Array.from({ length: count }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      x: startX + col * cellWidth,
      y: startY + row * cellHeight,
      col,
      row,
    };
  });
}

/** Compute a quadratic bezier control point offset perpendicular to the line. */
export function curveControlPoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  offset: number,
): { cpx: number; cpy: number } {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return {
    cpx: mx + (-dy / len) * offset,
    cpy: my + (dx / len) * offset,
  };
}
