/**
 * canvasTheme — the theme's drawing axes resolved for one scope (see `CanvasTheme` in
 * `@almadar/core`), plus the helpers every drawing surface uses to turn a mark's roles into
 * canvas state. SVG and DOM surfaces use the CSS vars directly; canvas 2D and three.js cannot.
 *
 * @packageDocumentation
 */

import type {
  CanvasShadow,
  CanvasTheme,
  DiagramFillStyle,
  DiagramLabelCase,
  DiagramLabelFont,
  DiagramLineCap,
  DiagramLineJoin,
  DiagramMarker,
  DiagramMarkRoles,
  DiagramStrokeWeight,
  DiagramTextCase,
  DiagramTextSize,
  DiagramTone,
} from '@almadar/core';
import { DIAGRAM_TONES, DIAGRAM_TEXT_SIZES, DIAGRAM_TONE_COLOR_KEYS } from '@almadar/core';
import { createLogger } from '@almadar/logger';
import { parseComputedColor, resolveThemeColor, type ResolvedColor } from './theme-color';

const log = createLogger('almadar:ui:canvas-theme');

const toneVar = (tone: DiagramTone): string => `--color-${DIAGRAM_TONE_COLOR_KEYS[tone]}`;

const SERIES_TONES: readonly DiagramTone[] = ['series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6', 'series-7', 'series-8'];

const TONE_SET: ReadonlySet<string> = new Set(DIAGRAM_TONES);

export function isDiagramTone(value: string): value is DiagramTone {
  return TONE_SET.has(value);
}

/** A resolved color as a canvas style string, keeping alpha. */
export function colorCss(c: ResolvedColor): string {
  return c.a >= 1 ? c.css : `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T, name: string): T {
  const hit = allowed.find((a) => a === value);
  if (hit !== undefined) return hit;
  if (value !== '') log.warn('invalid-theme-keyword', { var: name, value, allowed });
  return fallback;
}

const PLAIN_LENGTH = /^(-?[\d.]+)(px)?$/;

/** Reads declared custom properties as they compute inside one scope. */
class ScopeReader {
  private readonly style: CSSStyleDeclaration;
  private readonly probe: HTMLElement;

  constructor(private readonly scope: Element) {
    this.style = getComputedStyle(scope);
    const doc = scope.ownerDocument;
    this.probe = doc.createElement('span');
    this.probe.style.position = 'absolute';
    this.probe.style.visibility = 'hidden';
    this.probe.style.pointerEvents = 'none';
    scope.appendChild(this.probe);
  }

  dispose(): void {
    this.probe.remove();
  }

  raw(name: string): string {
    return this.style.getPropertyValue(name).trim();
  }

  /** A length var in px: a plain value parses directly, a derived one (`calc`, `var`) through the probe. */
  length(name: string, fallback: number): number {
    const raw = this.raw(name);
    const plain = PLAIN_LENGTH.exec(raw);
    if (plain) return Number(plain[1]);
    if (raw === '') return fallback;
    this.probe.style.width = `var(${name})`;
    const computed = PLAIN_LENGTH.exec(getComputedStyle(this.probe).width.trim());
    this.probe.style.width = '';
    if (computed) return Number(computed[1]);
    log.warn('unresolvable-theme-length', { var: name, raw });
    return fallback;
  }

  number(name: string, fallback: number): number {
    const raw = this.raw(name);
    if (raw === '') return fallback;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
    log.warn('unresolvable-theme-number', { var: name, raw });
    return fallback;
  }

  /** A duration var in ms (`250ms`, `0.25s`, or a `var()` alias resolved through the probe). */
  durationMs(name: string, fallback: number): number {
    const parse = (v: string): number | null => {
      const m = /^([\d.]+)(ms|s)$/.exec(v.trim());
      return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : null;
    };
    const raw = this.raw(name);
    const direct = parse(raw);
    if (direct !== null) return direct;
    if (raw === '') return fallback;
    this.probe.style.transitionDuration = `var(${name})`;
    const computed = parse(getComputedStyle(this.probe).transitionDuration.split(',')[0] ?? '');
    this.probe.style.transitionDuration = '';
    return computed ?? fallback;
  }

  color(name: string): ResolvedColor | null {
    const raw = this.raw(name);
    return parseComputedColor(raw) ?? resolveThemeColor(`var(${name})`, this.scope);
  }

  shadow(name: string): CanvasShadow | null {
    const raw = this.raw(name);
    if (raw === '' || raw === 'none') return null;
    this.probe.style.boxShadow = `var(${name})`;
    const computed = getComputedStyle(this.probe).boxShadow.trim() || raw;
    this.probe.style.boxShadow = '';
    const colorMatch = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}|oklch\([^)]*\))/i.exec(computed);
    const lengths = computed.replace(colorMatch?.[0] ?? '', '').trim().split(/\s+/).map((t) => PLAIN_LENGTH.exec(t)).filter((m): m is RegExpExecArray => m !== null).map((m) => Number(m[1]));
    if (lengths.length < 2) return null;
    const color = colorMatch ? parseComputedColor(colorMatch[0]) : null;
    return { offsetX: lengths[0], offsetY: lengths[1], blur: lengths[2] ?? 0, color: color ? colorCss(color) : 'rgba(0, 0, 0, 0.25)' };
  }

  family(name: string, fallback: string): string {
    return this.raw(name) || fallback;
  }
}

function dashList(raw: string, fallback: readonly number[]): readonly number[] {
  if (raw === '') return fallback;
  const parts = raw.split(/[\s,]+/).map(Number);
  return parts.every((n) => Number.isFinite(n) && n >= 0) ? parts : fallback;
}

function prefersReducedMotion(scope: Element): boolean {
  const view = scope.ownerDocument.defaultView;
  return typeof view?.matchMedia === 'function' && view.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Resolve the drawing axes as they compute inside `scope`. */
export function resolveCanvasTheme(scope: Element): CanvasTheme {
  const r = new ScopeReader(scope);
  try {
    const tones = {} as Record<DiagramTone, string>;
    for (const tone of DIAGRAM_TONES) {
      const c = r.color(toneVar(tone));
      tones[tone] = c ? colorCss(c) : 'currentColor';
    }
    const surface = (name: string): string => {
      const c = r.color(name);
      return c ? colorCss(c) : 'transparent';
    };
    const ground = r.color('--surface-diagram');
    const text = {} as Record<DiagramTextSize, number>;
    const TEXT_FALLBACK: Readonly<Record<DiagramTextSize, number>> = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24 };
    for (const size of DIAGRAM_TEXT_SIZES) text[size] = r.length(`--text-${size}`, TEXT_FALLBACK[size]);
    const body = r.family('--font-family-body', r.family('--font-family', 'system-ui, sans-serif'));
    return {
      ground: ground ? colorCss(ground) : 'transparent',
      surfaces: {
        muted: surface('--color-muted'),
        card: surface('--color-card'),
        onPrimary: surface('--color-primary-foreground'),
      },
      tones,
      series: SERIES_TONES.map((t) => tones[t]),
      strokes: {
        thin: r.length('--diagram-stroke-thin', 1),
        normal: r.length('--diagram-stroke-normal', 1.5),
        bold: r.length('--diagram-stroke-bold', 3),
      },
      lineCap: oneOf<DiagramLineCap>(r.raw('--diagram-line-cap'), ['butt', 'round', 'square'], 'round', '--diagram-line-cap'),
      lineJoin: oneOf<DiagramLineJoin>(r.raw('--diagram-line-join'), ['miter', 'round', 'bevel'], 'round', '--diagram-line-join'),
      dash: dashList(r.raw('--diagram-dash'), [6, 4]),
      dot: dashList(r.raw('--diagram-dot'), [1, 4]),
      fillStyle: oneOf<DiagramFillStyle>(r.raw('--diagram-fill-style'), ['solid', 'tint', 'outline', 'hatch'], 'tint', '--diagram-fill-style'),
      fillOpacity: r.number('--diagram-fill-opacity', 0.18),
      roughness: r.number('--diagram-roughness', 0),
      glow: r.number('--diagram-glow', 0),
      shadow: r.shadow('--diagram-shadow'),
      marker: oneOf<DiagramMarker>(r.raw('--diagram-marker'), ['triangle', 'open', 'line', 'dot'], 'triangle', '--diagram-marker'),
      faces: {
        body,
        display: r.family('--font-family-display', body),
        mono: r.family('--font-family-mono', 'ui-monospace, monospace'),
      },
      label: {
        font: oneOf<DiagramLabelFont>(r.raw('--diagram-label-font'), ['body', 'display', 'mono'], 'body', '--diagram-label-font'),
        size: oneOf<DiagramTextSize>(r.raw('--diagram-label-size'), DIAGRAM_TEXT_SIZES, 'sm', '--diagram-label-size'),
        weight: r.raw('--diagram-label-weight') || '500',
        uppercase: oneOf<DiagramLabelCase>(r.raw('--diagram-label-case'), ['none', 'uppercase'], 'none', '--diagram-label-case') === 'uppercase',
      },
      text,
      corner: r.length('--diagram-corner', 4),
      motion: {
        enabled: r.raw('--motion-enable') !== 'off' && !prefersReducedMotion(scope),
        fastMs: r.durationMs('--duration-fast', 150),
        normalMs: r.durationMs('--duration-normal', 250),
        slowMs: r.durationMs('--duration-slow', 400),
        easing: r.raw('--easing-standard') || 'ease',
      },
      scene: {
        roughness: r.number('--material-roughness', 0.6),
        metalness: r.number('--material-metalness', 0),
        flat: r.number('--material-flat', 0) >= 1,
        outline: r.number('--material-outline', 0),
        ambient: r.number('--light-ambient', 0.55),
        key: r.number('--light-key', 1),
        keyColor: (() => {
          const c = r.color('--light-key-color');
          return c ? colorCss(c) : '#ffffff';
        })(),
        fog: r.number('--scene-fog', 0),
      },
    };
  } finally {
    r.dispose();
  }
}

/**
 * `theme` with its categorical palette replaced by `series` (each entry a tone name, token or
 * literal), so `series-N` tones resolve to the override. Identity when `series` is unset.
 */
export function withSeries(theme: CanvasTheme | null, series: readonly string[] | undefined, scope: Element | null): CanvasTheme | null {
  if (!theme || !series || series.length === 0 || !scope) return theme;
  const colors = series.map((c, i) => markColor(theme, c, scope, SERIES_TONES[i % SERIES_TONES.length]));
  const tones = { ...theme.tones };
  SERIES_TONES.forEach((tone, i) => {
    tones[tone] = colors[i % colors.length];
  });
  return { ...theme, tones, series: SERIES_TONES.map((t) => tones[t]) };
}

/**
 * The canvas color for a mark's color slot: a tone name resolves through the theme, a `var()` or
 * `color-mix()` expression through the scope, a literal passes through. Absent → `fallback` tone.
 */
export function markColor(theme: CanvasTheme, value: string | undefined, scope: Element, fallback: DiagramTone): string {
  if (value === undefined || value === '') return theme.tones[fallback];
  if (isDiagramTone(value)) return theme.tones[value];
  if (value.startsWith('var(') || value.startsWith('color-mix(')) {
    const resolved = resolveThemeColor(value, scope);
    return resolved ? colorCss(resolved) : theme.tones[fallback];
  }
  return value;
}

/** Stroke width for a mark: a literal width wins, then its role, then the theme's normal weight. */
export function markStrokeWidth(theme: CanvasTheme, literal: number | undefined, role: DiagramStrokeWeight | undefined, fallback: DiagramStrokeWeight = 'normal'): number {
  return literal ?? theme.strokes[role ?? fallback];
}

/** The canvas `font` shorthand for a label: a literal px size wins, then its text role, then the theme's label size. */
export function labelFont(theme: CanvasTheme, roles: Pick<DiagramMarkRoles, 'textSize' | 'font'>, literalPx?: number, literalFamily?: string): { font: string; px: number } {
  const px = literalPx ?? theme.text[roles.textSize ?? theme.label.size];
  const family = literalFamily ?? theme.faces[roles.font ?? theme.label.font];
  return { font: `${theme.label.weight} ${px}px ${family}`, px };
}

/** A label's text in the theme's label case. */
export function labelText(theme: CanvasTheme, text: string, textCase: DiagramTextCase = 'theme'): string {
  return theme.label.uppercase && textCase === 'theme' ? text.toUpperCase() : text;
}

type LabelContext = Pick<CanvasRenderingContext2D, 'save' | 'restore' | 'strokeText' | 'fillText' | 'strokeStyle' | 'lineWidth' | 'lineJoin'>;

/** Draws a label with a ground-colored halo so it stays legible where it crosses a mark. Font, fill and alignment are the caller's. */
export function fillLabel(ctx: LabelContext, theme: CanvasTheme, text: string, x: number, y: number): void {
  if (!text) return;
  ctx.save();
  ctx.strokeStyle = theme.ground;
  ctx.lineWidth = Math.max(2, theme.text.xs * 0.3);
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.restore();
  ctx.fillText(text, x, y);
}

/**
 * An outline-style mark keeps the meaning its fill carried: its outline takes the fill's color. The
 * background `fill` tint carries no meaning, so a mark filled with it keeps its stroke.
 */
export function outlineStroke(stroke: string, fill: string | undefined, style: DiagramFillStyle, fillTone?: string): string {
  return outlineCarriesFill(fill, style, fillTone) && fill !== undefined ? fill : stroke;
}

/** Whether an outline-style mark's outline stands in for a meaningful fill (it is then drawn bold). */
export function outlineCarriesFill(fill: string | undefined, style: DiagramFillStyle, fillTone?: string): boolean {
  return style === 'outline' && fill !== undefined && fillTone !== 'fill';
}

/** Applies the theme's line character (cap, join, glow) to a context for one stroke color. */
export function applyLineCharacter(ctx: CanvasRenderingContext2D, theme: CanvasTheme, strokeColor: string): void {
  ctx.lineCap = theme.lineCap;
  ctx.lineJoin = theme.lineJoin;
  if (theme.glow > 0) {
    ctx.shadowColor = strokeColor;
    ctx.shadowBlur = theme.glow;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }
}

/** Dash list for a mark's dash role. */
export function markDash(theme: CanvasTheme, dash: 'solid' | 'dashed' | 'dotted' | undefined): readonly number[] {
  if (dash === 'dashed') return theme.dash;
  if (dash === 'dotted') return theme.dot;
  return [];
}

/** Deterministic wobble in [-1, 1] from a coordinate pair — stable frame to frame. */
function wobble(x: number, y: number, k: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * Traces a path through `points` into the context's current path, roughened by the theme's
 * `--diagram-roughness` (hand-drawn wobble). Exact geometry when roughness is 0.
 */
export function tracePolyline(ctx: CanvasRenderingContext2D, theme: CanvasTheme, points: readonly { x: number; y: number }[], closed: boolean): void {
  ctx.beginPath();
  if (points.length === 0) return;
  const amp = theme.roughness;
  const pts = closed ? [...points, points[0]] : [...points];
  ctx.moveTo(pts[0].x + amp * wobble(pts[0].x, pts[0].y, 0), pts[0].y + amp * wobble(pts[0].y, pts[0].x, 1));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (amp === 0) {
      ctx.lineTo(b.x, b.y);
      continue;
    }
    const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 24));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      ctx.lineTo(x + amp * wobble(x, y, 2), y + amp * wobble(y, x, 3));
    }
  }
  if (closed) ctx.closePath();
}

/** Points on a circle/ellipse arc, for roughened round marks. */
export function arcPoints(cx: number, cy: number, rx: number, ry: number, startRad = 0, endRad = Math.PI * 2): { x: number; y: number }[] {
  const steps = Math.max(12, Math.round((Math.abs(endRad - startRad) * Math.max(rx, ry)) / 8));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = startRad + ((endRad - startRad) * i) / steps;
    out.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return out;
}

/**
 * Fills the context's current path in the theme's (or the mark's) fill treatment: solid, a
 * translucent tint, a hatch, or nothing for `outline`.
 */
export function fillMark(ctx: CanvasRenderingContext2D, theme: CanvasTheme, color: string, style: DiagramFillStyle = theme.fillStyle): void {
  if (style === 'outline') return;
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  if (theme.shadow) {
    ctx.shadowColor = theme.shadow.color;
    ctx.shadowOffsetX = theme.shadow.offsetX;
    ctx.shadowOffsetY = theme.shadow.offsetY;
    ctx.shadowBlur = theme.shadow.blur;
  }
  if (style === 'hatch') {
    ctx.clip();
    const span = ctx.canvas.width + ctx.canvas.height;
    ctx.strokeStyle = color;
    ctx.lineWidth = theme.strokes.thin;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let d = -span; d < span; d += 6) {
      ctx.moveTo(d, 0);
      ctx.lineTo(d + span, span);
    }
    ctx.stroke();
  } else {
    ctx.globalAlpha *= style === 'tint' ? theme.fillOpacity : 1;
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();
}

/** Draws the theme's arrowhead at (x2, y2) pointing along (x1, y1) → (x2, y2). */
export function drawMarker(ctx: CanvasRenderingContext2D, theme: CanvasTheme, x1: number, y1: number, x2: number, y2: number, color: string, width: number): void {
  const size = Math.max(8, width * 4);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const left = { x: x2 - size * Math.cos(angle - Math.PI / 6), y: y2 - size * Math.sin(angle - Math.PI / 6) };
  const right = { x: x2 - size * Math.cos(angle + Math.PI / 6), y: y2 - size * Math.sin(angle + Math.PI / 6) };
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash([]);
  switch (theme.marker) {
    case 'triangle': {
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'open':
    case 'line': {
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(x2, y2);
      ctx.lineTo(right.x, right.y);
      if (theme.marker === 'open') ctx.stroke();
      else {
        ctx.moveTo(x2 - size * 0.5 * Math.cos(angle + Math.PI / 2), y2 - size * 0.5 * Math.sin(angle + Math.PI / 2));
        ctx.lineTo(x2 + size * 0.5 * Math.cos(angle + Math.PI / 2), y2 + size * 0.5 * Math.sin(angle + Math.PI / 2));
        ctx.stroke();
      }
      break;
    }
    case 'dot': {
      ctx.beginPath();
      ctx.arc(x2, y2, Math.max(2.5, width * 1.5), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}
