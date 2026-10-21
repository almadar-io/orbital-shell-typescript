/**
 * The Tailwind class vocabulary a visual editor may write onto a pattern's
 * `className`. Declared once here: editors pick from it, and
 * `@almadar/ui/tailwind-preset` safelists exactly it, so every class an
 * editor writes is compiled into the builder and every generated app.
 *
 * Color and radius classes are backed by theme tokens (`bg-primary` reads
 * `--color-primary`), so an edit can target the class (this element) or the
 * token (every element using it). Spacing steps 0–12 read `--space-N` theme
 * tokens (not linear: the base theme's `--space-4` is 14px); the rest are
 * Tailwind's rem steps. What a step renders at is therefore a theme question —
 * callers that convert pixels pass the rendered size of each step.
 */

import type { JsonValue, OrbitalDefinition, OrbitalSchema } from '@almadar/core';

/** Color tokens the preset maps to `--color-<token>` (`tailwind-preset.cjs` `colors`). */
export const DESIGN_COLOR_TOKENS = [
  'primary', 'primary-foreground', 'primary-hover',
  'secondary', 'secondary-foreground', 'secondary-hover',
  'muted', 'muted-foreground',
  'accent', 'accent-foreground',
  'background', 'foreground',
  'card', 'card-foreground',
  'surface', 'border', 'input', 'ring',
  'error', 'error-foreground',
  'success', 'success-foreground',
  'warning', 'warning-foreground',
  'info', 'info-foreground',
] as const;
export type DesignColorToken = (typeof DESIGN_COLOR_TOKENS)[number];

/** Utilities that take a color token. */
export const DESIGN_COLOR_UTILITIES = ['bg', 'text', 'border'] as const;
export type DesignColorUtility = (typeof DESIGN_COLOR_UTILITIES)[number];

/** Radius tokens the preset maps to `--radius-<token>` (`rounded-<token>`). */
export const DESIGN_RADIUS_TOKENS = ['none', 'sm', 'md', 'lg', 'xl', 'full'] as const;
export type DesignRadiusToken = (typeof DESIGN_RADIUS_TOKENS)[number];

/** Tailwind's spacing scale (1 step = 0.25rem = 4px at a 16px root). */
export const DESIGN_SPACING_SCALE = [
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72,
  80, 96,
] as const;
export type DesignSpacingStep = (typeof DESIGN_SPACING_SCALE)[number];

/** Utilities that take a spacing step. */
export const DESIGN_SPACING_UTILITIES = [
  'w', 'h', 'min-w', 'max-w', 'min-h', 'max-h', 'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'm', 'mx', 'my', 'gap',
] as const;

/** Figma's non-fixed sizing modes per axis: Hug contents (`fit`) and Fill container (`full`). */
export const DESIGN_SIZING_CLASSES = ['w-fit', 'w-full', 'h-fit', 'h-full'] as const;
export type DesignSpacingUtility = (typeof DESIGN_SPACING_UTILITIES)[number];

/** Figma auto layout: direction, the 3×3 alignment grid (main axis `justify`, cross axis `items`), space-between and wrap. */
export const DESIGN_LAYOUT_CLASSES = [
  'flex-row', 'flex-col',
  'items-start', 'items-center', 'items-end',
  'justify-start', 'justify-center', 'justify-end', 'justify-between',
  'flex-wrap',
] as const;

/** Absolute position: the element, its positioning context, and the Center constraint's class pairs. Pixel and % offsets are arbitrary values. */
export const DESIGN_POSITION_CLASSES = [
  'absolute', 'relative',
  'left-0', 'right-0', 'top-0', 'bottom-0',
  'left-1/2', '-translate-x-1/2', 'top-1/2', '-translate-y-1/2',
] as const;

/** Pixels per spacing step at the default 16px root. */
export const DESIGN_SPACING_STEP_PX = 4;

export function colorClass(utility: DesignColorUtility, token: DesignColorToken): string {
  return `${utility}-${token}`;
}

export function radiusClass(token: DesignRadiusToken): string {
  return `rounded-${token}`;
}

export function spacingClass(utility: DesignSpacingUtility, step: DesignSpacingStep): string {
  return `${utility}-${step}`;
}

/** What a spacing step renders at, in px. */
export type SpacingStepPx = (step: DesignSpacingStep) => number;

/** Tailwind's default: 0.25rem per step at a 16px root. */
export const defaultSpacingStepPx: SpacingStepPx = (step) => step * DESIGN_SPACING_STEP_PX;

/** Steps the preset maps to `--space-N` theme tokens (`tailwind-preset.cjs` `spacing`). */
export const DESIGN_SPACING_TOKEN_STEPS: readonly DesignSpacingStep[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** The theme token a spacing step reads, or null for a plain rem step. */
export function spacingTokenOf(step: DesignSpacingStep): `--space-${number}` | null {
  return DESIGN_SPACING_TOKEN_STEPS.includes(step) ? `--space-${step}` : null;
}

/**
 * The spacing step whose rendered size is nearest `px`. On a tie a
 * token-backed step wins (it follows the theme), then the smaller step.
 */
export function snapToSpacingStep(px: number, pxOf: SpacingStepPx = defaultSpacingStepPx): DesignSpacingStep {
  const target = Math.max(0, px);
  let best: DesignSpacingStep = DESIGN_SPACING_SCALE[0];
  for (const step of DESIGN_SPACING_SCALE) {
    const d = Math.abs(pxOf(step) - target);
    const bestD = Math.abs(pxOf(best) - target);
    if (d < bestD || (d === bestD && spacingTokenOf(step) !== null && spacingTokenOf(best) === null)) best = step;
  }
  return best;
}

/** Every class in the vocabulary — the preset's safelist. */
export function allDesignClasses(): string[] {
  return [
    ...DESIGN_COLOR_UTILITIES.flatMap((u) => DESIGN_COLOR_TOKENS.map((t) => colorClass(u, t))),
    ...DESIGN_RADIUS_TOKENS.map(radiusClass),
    ...DESIGN_SPACING_UTILITIES.flatMap((u) => DESIGN_SPACING_SCALE.map((s) => spacingClass(u, s))),
    ...DESIGN_SIZING_CLASSES,
    ...DESIGN_LAYOUT_CLASSES,
    ...DESIGN_POSITION_CLASSES,
  ];
}

// ---------------------------------------------------------------------------
// Sizing and spacing modes — Figma auto layout, written as Tailwind classes
// ---------------------------------------------------------------------------

const SPACING_STEP_BY_TEXT: ReadonlyMap<string, DesignSpacingStep> = new Map(
  DESIGN_SPACING_SCALE.map((step) => [String(step), step]),
);

/** The step a `<utility>-<step>` class names, if it is one (never a variant-prefixed class). */
function stepOf(className: string, utility: string): DesignSpacingStep | undefined {
  if (!className.startsWith(`${utility}-`)) return undefined;
  return SPACING_STEP_BY_TEXT.get(className.slice(utility.length + 1));
}

/** Figma's per-axis resizing: Fixed (a spacing step), Hug contents, or Fill container. */
export type DesignSizing =
  | { mode: 'fixed'; step: DesignSpacingStep }
  | { mode: 'hug' }
  | { mode: 'fill' };

export type DesignAxis = 'w' | 'h';

/** A base (unprefixed) class that sets this axis's size. */
function isAxisSizeClass(className: string, axis: DesignAxis): boolean {
  return className.startsWith(`${axis}-`);
}

export function sizingOf(classes: readonly string[], axis: DesignAxis): DesignSizing {
  for (const c of classes) {
    if (c === `${axis}-full`) return { mode: 'fill' };
    if (c === `${axis}-fit`) return { mode: 'hug' };
    const step = stepOf(c, axis);
    if (step !== undefined) return { mode: 'fixed', step };
  }
  return { mode: 'hug' };
}

/** Replace this axis's base size class with the one for `sizing`; everything else stays. */
export function withSizing(classes: readonly string[], axis: DesignAxis, sizing: DesignSizing): string[] {
  const kept = classes.filter((c) => !isAxisSizeClass(c, axis));
  const next = sizing.mode === 'fixed' ? `${axis}-${sizing.step}` : sizing.mode === 'hug' ? `${axis}-fit` : `${axis}-full`;
  return [...kept, next];
}

export type DesignSizeLimit = 'min' | 'max';

/** The spacing step a `min-*` / `max-*` class sets on this axis, or null (a custom `[…]` value is not a step). */
export function sizeLimitOf(classes: readonly string[], axis: DesignAxis, limit: DesignSizeLimit): DesignSpacingStep | null {
  for (const c of classes) {
    const step = stepOf(c, `${limit}-${axis}`);
    if (step !== undefined) return step;
  }
  return null;
}

/** Replace this axis's base `min-*` / `max-*` class (a step or a custom value) with `step`, or clear it with null. */
export function withSizeLimit(
  classes: readonly string[],
  axis: DesignAxis,
  limit: DesignSizeLimit,
  step: DesignSpacingStep | null,
): string[] {
  const kept = classes.filter((c) => !c.startsWith(`${limit}-${axis}-`));
  return step === null ? kept : [...kept, `${limit}-${axis}-${step}`];
}

/** Gap between children and padding per side, in spacing steps. */
export interface DesignSpacing {
  gap: DesignSpacingStep;
  top: DesignSpacingStep;
  right: DesignSpacingStep;
  bottom: DesignSpacingStep;
  left: DesignSpacingStep;
}

const PADDING_UTILITIES = ['p', 'px', 'py', 'pt', 'pr', 'pb', 'pl'] as const;

function isSpacingClass(className: string): boolean {
  return stepOf(className, 'gap') !== undefined || PADDING_UTILITIES.some((u) => stepOf(className, u) !== undefined);
}

/** Current spacing; a side-specific class beats an axis class, which beats `p-*`. */
export function spacingOf(classes: readonly string[]): DesignSpacing {
  const find = (utility: string): DesignSpacingStep | undefined => {
    for (const c of classes) {
      const step = stepOf(c, utility);
      if (step !== undefined) return step;
    }
    return undefined;
  };
  const all = find('p') ?? 0;
  const x = find('px') ?? all;
  const y = find('py') ?? all;
  return {
    gap: find('gap') ?? 0,
    top: find('pt') ?? y,
    right: find('pr') ?? x,
    bottom: find('pb') ?? y,
    left: find('pl') ?? x,
  };
}

/** Apply `change` and write the smallest class set for the result (`p-*`, else `px-* py-*`, else each side). */
export function withSpacing(classes: readonly string[], change: Partial<DesignSpacing>): string[] {
  const next = { ...spacingOf(classes), ...change };
  const kept = classes.filter((c) => !isSpacingClass(c));
  const out = [...kept];
  if (next.gap !== 0) out.push(`gap-${next.gap}`);
  const { top, right, bottom, left } = next;
  if (top === right && right === bottom && bottom === left) {
    if (top !== 0) out.push(`p-${top}`);
  } else if (top === bottom && left === right) {
    out.push(`px-${left}`, `py-${top}`);
  } else {
    out.push(`pt-${top}`, `pr-${right}`, `pb-${bottom}`, `pl-${left}`);
  }
  return out;
}

/** One grid position on an axis. */
export type DesignAlignment = 'start' | 'center' | 'end';
export type DesignDirection = 'horizontal' | 'vertical';

/** Main-axis distribution: a grid position, or Figma's space-between. */
export type DesignJustify = DesignAlignment | 'between';

/** Auto layout as the classes set it; null where no base class decides it (the element's own default applies). */
export interface DesignLayout {
  direction: DesignDirection | null;
  /** Cross axis (`items-*`). */
  align: DesignAlignment | null;
  /** Main axis (`justify-*`). */
  justify: DesignJustify | null;
  wrap: boolean;
}

const DIRECTION_CLASSES = ['flex-row', 'flex-row-reverse', 'flex-col', 'flex-col-reverse'];
const ALIGNMENTS: readonly DesignAlignment[] = ['start', 'center', 'end'];
const JUSTIFIES: readonly DesignJustify[] = [...ALIGNMENTS, 'between'];
const WRAP_CLASSES = ['flex-wrap', 'flex-nowrap', 'flex-wrap-reverse'];

function firstOf<T extends string>(classes: readonly string[], utility: string, values: readonly T[]): T | null {
  for (const c of classes) {
    for (const v of values) if (c === `${utility}-${v}`) return v;
  }
  return null;
}

export function layoutOf(classes: readonly string[]): DesignLayout {
  const direction = classes.find((c) => DIRECTION_CLASSES.includes(c));
  return {
    direction: direction === undefined ? null : direction.startsWith('flex-row') ? 'horizontal' : 'vertical',
    align: firstOf(classes, 'items', ALIGNMENTS),
    justify: firstOf(classes, 'justify', JUSTIFIES),
    wrap: classes.includes('flex-wrap'),
  };
}

/** Replace the base class for each changed part of the layout; everything else (variants included) stays. */
export function withLayout(
  classes: readonly string[],
  change: Partial<{ direction: DesignDirection; align: DesignAlignment; justify: DesignJustify; wrap: boolean }>,
): string[] {
  let next = [...classes];
  if (change.direction) {
    next = next.filter((c) => !DIRECTION_CLASSES.includes(c));
    next.push(change.direction === 'horizontal' ? 'flex-row' : 'flex-col');
  }
  if (change.align) {
    next = next.filter((c) => !c.startsWith('items-'));
    next.push(`items-${change.align}`);
  }
  if (change.justify) {
    next = next.filter((c) => !c.startsWith('justify-'));
    next.push(`justify-${change.justify}`);
  }
  if (change.wrap !== undefined) {
    next = next.filter((c) => !WRAP_CLASSES.includes(c));
    if (change.wrap) next.push('flex-wrap');
  }
  return next;
}

// ---------------------------------------------------------------------------
// Absolute position + Figma constraints
// ---------------------------------------------------------------------------

/**
 * How an absolute element keeps its place when its parent resizes, per axis
 * (Figma constraints): pinned to the start (left/top) or end (right/bottom)
 * side, to both (stretches), centred, or scaled (offsets in % of the parent).
 */
export type DesignConstraint = 'start' | 'end' | 'both' | 'center' | 'scale';

/** One axis: its constraint and the start/end offsets it uses — px, or % for `scale`; for `center`, `start` is the px offset from the centre. */
export interface DesignAxisPosition {
  constraint: DesignConstraint;
  start: number;
  end: number;
}

export interface DesignPosition {
  absolute: boolean;
  x: DesignAxisPosition;
  y: DesignAxisPosition;
}

const AXIS_SIDES = { x: ['left', 'right'], y: ['top', 'bottom'] } as const;
const CENTER_CLASSES = { x: ['left-1/2', '-translate-x-1/2'], y: ['top-1/2', '-translate-y-1/2'] } as const;

type Offset = { value: number; unit: 'px' | '%' };

/** A base `<side>-*` offset: a spacing step (in px), `[Npx]` or `[N%]`. */
function offsetOf(classes: readonly string[], side: string): Offset | null {
  for (const c of classes) {
    if (!c.startsWith(`${side}-`)) continue;
    const step = stepOf(c, side);
    if (step !== undefined) return { value: defaultSpacingStepPx(step), unit: 'px' };
    const m = /^\[(-?\d+(?:\.\d+)?)(px|%)\]$/.exec(c.slice(side.length + 1));
    if (m) return { value: Number(m[1]), unit: m[2] === '%' ? '%' : 'px' };
  }
  return null;
}

/** A centre offset: `left-1/2` is 0, `left-[calc(50%+12px)]` is 12. */
function centerOffsetOf(classes: readonly string[], side: string): number | null {
  for (const c of classes) {
    if (c === `${side}-1/2`) return 0;
    const m = new RegExp(`^${side}-\\[calc\\(50%([+-])(\\d+(?:\\.\\d+)?)px\\)\\]$`).exec(c);
    if (m) return (m[1] === '-' ? -1 : 1) * Number(m[2]);
  }
  return null;
}

function axisPositionOf(classes: readonly string[], axis: 'x' | 'y'): DesignAxisPosition {
  const [startSide, endSide] = AXIS_SIDES[axis];
  const center = centerOffsetOf(classes, startSide);
  if (center !== null && classes.includes(CENTER_CLASSES[axis][1])) return { constraint: 'center', start: center, end: 0 };
  const start = offsetOf(classes, startSide);
  const end = offsetOf(classes, endSide);
  if ((start?.unit === '%') || (end?.unit === '%')) {
    return { constraint: 'scale', start: start?.value ?? 0, end: end?.value ?? 0 };
  }
  if (start && end) return { constraint: 'both', start: start.value, end: end.value };
  if (end) return { constraint: 'end', start: 0, end: end.value };
  return { constraint: 'start', start: start?.value ?? 0, end: 0 };
}

export function positionOf(classes: readonly string[]): DesignPosition {
  return {
    absolute: classes.includes('absolute'),
    x: axisPositionOf(classes, 'x'),
    y: axisPositionOf(classes, 'y'),
  };
}

function isPositionClass(className: string): boolean {
  if (className === 'absolute') return true;
  if (CENTER_CLASSES.x.some((c) => c === className) || CENTER_CLASSES.y.some((c) => c === className)) return true;
  return [...AXIS_SIDES.x, ...AXIS_SIDES.y].some((side) => className.startsWith(`${side}-`));
}

function offsetClass(side: string, value: number, unit: 'px' | '%'): string {
  const rounded = unit === '%' ? Math.round(value * 10) / 10 : Math.round(value);
  return rounded === 0 ? `${side}-0` : `${side}-[${rounded}${unit}]`;
}

function axisClasses(axis: 'x' | 'y', p: DesignAxisPosition): string[] {
  const [startSide, endSide] = AXIS_SIDES[axis];
  switch (p.constraint) {
    case 'center': {
      const offset = Math.round(p.start);
      const pin = offset === 0 ? CENTER_CLASSES[axis][0] : `${startSide}-[calc(50%${offset < 0 ? '-' : '+'}${Math.abs(offset)}px)]`;
      return [pin, CENTER_CLASSES[axis][1]];
    }
    case 'end': return [offsetClass(endSide, p.end, 'px')];
    case 'both': return [offsetClass(startSide, p.start, 'px'), offsetClass(endSide, p.end, 'px')];
    case 'scale': return [offsetClass(startSide, p.start, '%'), offsetClass(endSide, p.end, '%')];
    case 'start': return [offsetClass(startSide, p.start, 'px')];
  }
}

/** Replace every base position class with the ones `position` needs; not absolute → none at all. */
export function withPosition(classes: readonly string[], position: DesignPosition): string[] {
  const kept = classes.filter((c) => !isPositionClass(c));
  if (!position.absolute) return kept;
  return [...kept, 'absolute', ...axisClasses('x', position.x), ...axisClasses('y', position.y)];
}

/** Make an element the positioning context for its absolute children (`relative`, unless it is already positioned). */
export function withPositioningContext(classes: readonly string[]): string[] {
  return classes.includes('relative') || classes.includes('absolute') ? [...classes] : [...classes, 'relative'];
}

/** The theme token a class reads, when it reads one. */
export type DesignClassToken =
  | { group: 'colors'; key: DesignColorToken }
  | { group: 'radii'; key: DesignRadiusToken }
  | { group: 'spacing'; key: string };

const COLOR_TOKEN_SET: ReadonlySet<string> = new Set(DESIGN_COLOR_TOKENS);
const RADIUS_TOKEN_SET: ReadonlySet<string> = new Set(DESIGN_RADIUS_TOKENS);

function isColorToken(value: string): value is DesignColorToken {
  return COLOR_TOKEN_SET.has(value);
}

function isRadiusToken(value: string): value is DesignRadiusToken {
  return RADIUS_TOKEN_SET.has(value);
}

/**
 * The theme token behind one class (`hover:bg-primary` → colors `primary`,
 * `p-4` → spacing `4`, i.e. `--space-4`), or null when the class is outside
 * the vocabulary or not token-backed.
 */
export function tokenOfDesignClass(className: string): DesignClassToken | null {
  const base = className.slice(className.lastIndexOf(':') + 1);
  if (base.startsWith('rounded-')) {
    const key = base.slice('rounded-'.length);
    return isRadiusToken(key) ? { group: 'radii', key } : null;
  }
  for (const utility of DESIGN_COLOR_UTILITIES) {
    const prefix = `${utility}-`;
    if (!base.startsWith(prefix)) continue;
    const key = base.slice(prefix.length);
    if (isColorToken(key)) return { group: 'colors', key };
  }
  for (const utility of DESIGN_SPACING_UTILITIES) {
    const step = stepOf(base, utility);
    if (step !== undefined && spacingTokenOf(step) !== null) return { group: 'spacing', key: String(step) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Arbitrary values — `w-[243px]`, `bg-[#e14b2a]`
// ---------------------------------------------------------------------------

/**
 * An arbitrary-value class — one class (no spaces) ending in a `[…]` value,
 * variants allowed: `w-[243px]`, `hover:bg-[#e14b2a]`. The designer's custom
 * field accepts only these; scale and token classes have their own editors.
 */
export function isArbitraryClass(className: string): boolean {
  return /^[a-z0-9:@/-]*-\[[^\]\s]+\]$/i.test(className);
}

function collectClasses(value: JsonValue, found: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectClasses(item, found);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'className' && typeof child === 'string') {
      for (const cls of child.split(/\s+/)) if (cls && isArbitraryClass(cls)) found.add(cls);
    } else {
      collectClasses(child, found);
    }
  }
}

/** One boundary hop from a typed schema part to plain JSON, then its classes. */
function classesOfPart(part: object): string[] {
  const found = new Set<string>();
  collectClasses(JSON.parse(JSON.stringify(part)), found);
  return [...found];
}

/** Previews build many schemas around the same orbital objects; each orbital is walked once. */
const classesByOrbital = new WeakMap<OrbitalDefinition, readonly string[]>();

/**
 * Every arbitrary-value class in the schema's literal `className`s, once,
 * sorted. Tailwind only compiles classes it saw at build time, so a runtime
 * that renders a schema compiles these on demand (the scale and token classes
 * are safelisted by the preset). Bound (expression) classNames are skipped.
 * `_metadata` and `ledger` are provenance and identity records, never render trees.
 */
export function arbitraryClassesOf(schema: OrbitalSchema): string[] {
  const { orbitals, _metadata: _provenance, ledger: _identities, ...rest } = schema;
  const found = new Set<string>(classesOfPart(rest));
  for (const orbital of orbitals ?? []) {
    let classes = classesByOrbital.get(orbital);
    if (!classes) {
      classes = classesOfPart(orbital);
      classesByOrbital.set(orbital, classes);
    }
    for (const cls of classes) found.add(cls);
  }
  return [...found].sort();
}
