export type BandEdge = 'none' | 'curve' | 'wave' | 'arc' | 'tilt' | 'step' | 'scallop';
export type BandEdgeColor = 'background' | 'muted' | 'surface' | 'gradient' | 'inverse';

const shape = (d: string): string =>
  `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 100' preserveAspectRatio='none'><path d='${d}'/></svg>")`;

export const BAND_SHAPES: Record<Exclude<BandEdge, 'none' | 'curve'>, string> = {
  wave: shape('M0 60 C240 100 480 100 720 60 C960 20 1200 20 1440 60 V100 H0 Z'),
  arc: shape('M0 100 Q720 0 1440 100 Z'),
  tilt: shape('M0 100 L1440 0 V100 Z'),
  step: shape('M0 100 V75 H360 V50 H720 V25 H1080 V0 H1440 V100 Z'),
  scallop: shape('M0 100 V40 a60 40 0 0 1 120 0 a60 40 0 0 1 120 0 a60 40 0 0 1 120 0 a60 40 0 0 1 120 0 a60 40 0 0 1 120 0 a60 40 0 0 1 120 0 a60 40 0 0 1 120 0 a60 40 0 0 1 120 0 a60 40 0 0 1 120 0 a60 40 0 0 1 120 0 a60 40 0 0 1 120 0 a60 40 0 0 1 120 0 V100 Z'),
};

const BAND_EDGE_HEIGHT = 'clamp(24px, 6vw, 96px)';

export const BAND_ACCENT_FALLBACK =
  'linear-gradient(180deg, color-mix(in oklab, var(--color-primary) 12%, var(--color-background)), var(--color-background))';

export const BAND_EDGE_FILL: Record<BandEdgeColor, string> = {
  background: 'var(--surface-page-image, none), var(--color-background)',
  muted: 'var(--color-muted)',
  surface: 'var(--color-card)',
  gradient: `var(--surface-accent-image, ${BAND_ACCENT_FALLBACK}), var(--color-muted)`,
  inverse: 'var(--color-foreground)',
};

export function bandEdgeMask(edge: Exclude<BandEdge, 'none'>): string {
  return edge === 'curve' ? 'var(--surface-edge-mask, none)' : BAND_SHAPES[edge];
}

export function bandEdgeHeight(edge: Exclude<BandEdge, 'none'>): string {
  return edge === 'curve' ? `var(--surface-edge-height, ${BAND_EDGE_HEIGHT})` : BAND_EDGE_HEIGHT;
}

export interface BandEdgeLayerStyle {
  height: string;
  background: string;
  maskImage: string;
  WebkitMaskImage: string;
  transform?: string;
  backgroundSize?: string;
  backgroundAttachment?: string;
}

export function bandEdgeLayerStyle(
  edge: Exclude<BandEdge, 'none'>,
  side: 'top' | 'bottom',
  flip: boolean,
  color: BandEdgeColor,
): BandEdgeLayerStyle {
  const mask = bandEdgeMask(edge);
  const turn = side === 'top' ? (flip ? 'scaleY(-1)' : 'rotate(180deg)') : flip ? 'scaleX(-1)' : undefined;
  const style: BandEdgeLayerStyle = { height: bandEdgeHeight(edge), background: BAND_EDGE_FILL[color], maskImage: mask, WebkitMaskImage: mask, transform: turn };
  // A cut into a transparent neighbour shows the page ground, which `.surface-page` paints fixed to the viewport.
  if (color === 'background') {
    style.backgroundSize = 'var(--surface-page-image-size, auto), auto';
    style.backgroundAttachment = 'fixed';
  }
  return style;
}

export function bandPadding(basePad: string, edge: BandEdge): string | undefined {
  return edge === 'none' ? undefined : `calc(${basePad} + ${bandEdgeHeight(edge)})`;
}
