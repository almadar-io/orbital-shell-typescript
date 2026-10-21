/**
 * themeTokens — runtime mirror of the orbital compiler's theme codegen.
 *
 * The compile path (orbital-rust/crates/orbital-shell-typescript/src/codegen/theme.rs)
 * reads `OrbitalDefinition.theme.tokens` and emits CSS custom-property
 * declarations into a `[data-theme="<name>-<mode>"]` block. The runtime
 * does not parse compiled CSS — it reads the same `tokens` object directly
 * and produces the same `{ '--color-primary': '…', '--radius-md': '…' }` map
 * that the compiler emits.
 *
 * Keeping the two paths byte-identical at the variable level is the contract:
 * editing tokens via the Studio Design System tab must produce the exact
 * same rendered result as editing them in source and running `orbital
 * compile`. The mapping rules here mirror `generate_tokens_css` /
 * `generate_tokens_css_dark` (theme.rs:122–351).
 *
 * Compile vs runtime difference (intentional):
 * - Compile emits the FULL set: schema overrides on top of defaults. This is
 *   needed because the compiled CSS replaces the theme entirely.
 * - Runtime emits ONLY the keys present in `tokens` (and `variants.dark`).
 *   Missing keys cascade from the parent `[data-theme]` rule on the document
 *   element. The provider scopes overrides to an orbital subtree without
 *   shadowing inherited defaults.
 *
 * The per-axis var tables below (`DENSITY_SPACING_VARS`, `TYPE_INTENT_VARS`, …)
 * are the ONE mapping between a typed-axis field and its CSS variable name.
 * `themeTokensToCssVars` reads them forward (token → CSS); `almadar-core`'s
 * one-time `scripts/migrate-css-themes.ts` reads them in reverse (CSS →
 * token) to build `packages/almadar-core/themes/*.json` from the checked-in
 * preset CSS — see that script for the inverse direction.
 *
 * @packageDocumentation
 */

import type {
  DensityTokens,
  DiagramTokens,
  SceneTokens,
  ElevationTokens,
  GeometryTokens,
  IllustrationTokens,
  IconographyTokens,
  MotionDurationKey,
  MotionEasingKey,
  MotionIntent,
  MotionIntentMap,
  MotionShapeTokens,
  EnterAnimation,
  MotionTokens,
  SurfaceTokens,
  ThemeDefinition,
  ThemeRef,
  ThemeTokens,
  ThemeVariant,
  TypeIntent,
  TypeIntentMap,
  TypeScaleTokens,
  TypeSizeKey,
  TypeWeight,
} from '@almadar/core';

/** Resolved color mode. Mirrors `ThemeContext.resolvedMode`. */
export type ThemeMode = 'light' | 'dark';

/** The keys of `T` whose value is a plain (optional) string — excludes
 * nested-object fields like `DensityTokens['spacing']` or
 * `TypeScaleTokens['scale']`, which are never single CSS values. */
export type StringValueKey<T> = { [K in keyof T]-?: T[K] extends string | undefined ? K : never }[keyof T] &
  string;

/** One flat scalar field on an axis object and the CSS var name it maps to. */
export interface FlatVarEntry<T> {
  readonly cssVar: string;
  readonly key: StringValueKey<T>;
}

function applyFlat<T>(obj: T | undefined, table: ReadonlyArray<FlatVarEntry<T>>, vars: Record<string, string>): void {
  if (!obj) return;
  for (const { cssVar, key } of table) {
    // `key: StringValueKey<T>` (a conditional/mapped derived type) proves
    // `obj[key]` is `string | undefined` for every real call site, but a
    // generic function body can't collapse that correlation on its own —
    // a direct `string` cast (never through `any`/`unknown`), not a type hole.
    const value = obj[key] as string | undefined;
    if (value !== undefined) vars[cssVar] = value;
  }
}

/** Density axis — spacing scale steps (`density.spacing.space<N>` → `--space-<N>`). */
export const DENSITY_SPACING_VARS: ReadonlyArray<FlatVarEntry<NonNullable<DensityTokens['spacing']>>> = [
  { cssVar: '--space-0', key: 'space0' },
  { cssVar: '--space-1', key: 'space1' },
  { cssVar: '--space-2', key: 'space2' },
  { cssVar: '--space-3', key: 'space3' },
  { cssVar: '--space-4', key: 'space4' },
  { cssVar: '--space-5', key: 'space5' },
  { cssVar: '--space-6', key: 'space6' },
  { cssVar: '--space-7', key: 'space7' },
  { cssVar: '--space-8', key: 'space8' },
  { cssVar: '--space-9', key: 'space9' },
  { cssVar: '--space-10', key: 'space10' },
  { cssVar: '--space-11', key: 'space11' },
  { cssVar: '--space-12', key: 'space12' },
];

/** Density axis — per-element heights + paddings. */
export const DENSITY_ELEMENT_VARS: ReadonlyArray<FlatVarEntry<DensityTokens>> = [
  { cssVar: '--button-height-sm', key: 'buttonHeightSm' },
  { cssVar: '--button-height-md', key: 'buttonHeightMd' },
  { cssVar: '--button-height-lg', key: 'buttonHeightLg' },
  { cssVar: '--input-height-sm', key: 'inputHeightSm' },
  { cssVar: '--input-height-md', key: 'inputHeightMd' },
  { cssVar: '--input-height-lg', key: 'inputHeightLg' },
  { cssVar: '--row-height-compact', key: 'rowHeightCompact' },
  { cssVar: '--row-height-normal', key: 'rowHeightNormal' },
  { cssVar: '--row-height-spacious', key: 'rowHeightSpacious' },
  { cssVar: '--card-padding-sm', key: 'cardPaddingSm' },
  { cssVar: '--card-padding-md', key: 'cardPaddingMd' },
  { cssVar: '--card-padding-lg', key: 'cardPaddingLg' },
  { cssVar: '--dialog-padding', key: 'dialogPadding' },
  { cssVar: '--section-gap', key: 'sectionGap' },
];

/** Type axis — family triplet. */
export const TYPE_FAMILY_VARS: ReadonlyArray<FlatVarEntry<TypeScaleTokens>> = [
  { cssVar: '--font-family-display', key: 'displayFamily' },
  { cssVar: '--font-family-body', key: 'bodyFamily' },
  { cssVar: '--font-family-mono', key: 'monoFamily' },
];

/** Type axis — heading voice (weight/case/tracking/style/shadow of every heading). */
export const TYPE_HEADING_VARS: ReadonlyArray<FlatVarEntry<TypeScaleTokens>> = [
  { cssVar: '--heading-weight', key: 'headingWeight' },
  { cssVar: '--heading-transform', key: 'headingTransform' },
  { cssVar: '--heading-tracking', key: 'headingTracking' },
  { cssVar: '--heading-style', key: 'headingStyle' },
  { cssVar: '--heading-shadow', key: 'headingShadow' },
];

/** Type axis — size scale keys, ordered exactly as emitted. Each pairs `--text-<k>` / `--leading-<k>`. */
export const TYPE_SIZE_KEYS: ReadonlyArray<TypeSizeKey> = [
  'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', 'display-1', 'display-2',
];

/** Type axis — intent names, ordered exactly as emitted. Each is 3 vars: `-size` / `-weight` / `-leading`. */
export const TYPE_INTENT_VARS: ReadonlyArray<{ key: keyof TypeIntentMap & string; cssName: string }> = [
  { key: 'headingMajor', cssName: 'heading-major' },
  { key: 'headingMinor', cssName: 'heading-minor' },
  { key: 'bodyEmphasis', cssName: 'body-emphasis' },
  { key: 'bodyDefault', cssName: 'body-default' },
  { key: 'bodyQuiet', cssName: 'body-quiet' },
  { key: 'caption', cssName: 'caption' },
  { key: 'numeric', cssName: 'numeric' },
];

/** Motion axis — duration palette keys, ordered exactly as emitted. */
export const MOTION_DURATION_KEYS: ReadonlyArray<MotionDurationKey> = [
  'instant', 'fast', 'normal', 'slow', 'dramatic',
];

/** Motion axis — easing palette keys, ordered exactly as emitted. */
export const MOTION_EASING_KEYS: ReadonlyArray<MotionEasingKey> = [
  'linear', 'standard', 'emphasized', 'spring',
];

/** Motion axis — intent names, ordered exactly as emitted. Each is 2 vars: `-duration` / `-easing`. */
export const MOTION_INTENT_VARS: ReadonlyArray<{ key: keyof MotionIntentMap & string; cssName: string }> = [
  { key: 'enter', cssName: 'enter' },
  { key: 'exit', cssName: 'exit' },
  { key: 'hover', cssName: 'hover' },
  { key: 'press', cssName: 'press' },
  { key: 'expand', cssName: 'expand' },
  { key: 'transition', cssName: 'transition' },
];

/** Motion axis — per-surface shapes (the enter-from / exit-to transform endpoints). */
export const MOTION_SHAPE_VARS: ReadonlyArray<FlatVarEntry<MotionShapeTokens>> = [
  { cssVar: '--motion-modal-enter-from-transform', key: 'modalEnter' },
  { cssVar: '--motion-modal-exit-to-transform', key: 'modalExit' },
  { cssVar: '--motion-popover-enter-from-transform', key: 'popoverEnter' },
  { cssVar: '--motion-popover-exit-to-transform', key: 'popoverExit' },
  { cssVar: '--motion-toast-enter-from-transform', key: 'toastEnter' },
  { cssVar: '--motion-toast-exit-to-transform', key: 'toastExit' },
  { cssVar: '--motion-page-enter-from-transform', key: 'pageEnter' },
  { cssVar: '--motion-enter-rise-from-transform', key: 'enterRise' },
  { cssVar: '--motion-enter-scale-from-transform', key: 'enterScale' },
  { cssVar: '--motion-enter-slide-from-transform', key: 'enterSlide' },
];

/** Iconography axis — flat fields. */
export const ICONOGRAPHY_VARS: ReadonlyArray<FlatVarEntry<IconographyTokens>> = [
  { cssVar: '--icon-family', key: 'family' },
  { cssVar: '--icon-stroke-width', key: 'strokeWidth' },
  { cssVar: '--icon-default-size', key: 'defaultSize' },
];

/** Elevation axis — flat fields. */
export const ELEVATION_VARS: ReadonlyArray<FlatVarEntry<ElevationTokens>> = [
  { cssVar: '--elevation-card', key: 'cardElevation' },
  { cssVar: '--elevation-popover', key: 'popoverElevation' },
  { cssVar: '--elevation-dialog', key: 'dialogElevation' },
  { cssVar: '--elevation-toast', key: 'toastElevation' },
  { cssVar: '--elevation-interactive', key: 'interactiveElevation' },
  { cssVar: '--elevation-pressed', key: 'pressedElevation' },
];

/** Geometry axis — flat fields. */
export const GEOMETRY_VARS: ReadonlyArray<FlatVarEntry<GeometryTokens>> = [
  { cssVar: '--radius-container', key: 'radiusContainer' },
  { cssVar: '--radius-interactive', key: 'radiusInteractive' },
  { cssVar: '--radius-pill', key: 'radiusPill' },
  { cssVar: '--border-hairline', key: 'borderHairline' },
  { cssVar: '--border-standard', key: 'borderStandard' },
  { cssVar: '--border-heavy', key: 'borderHeavy' },
  { cssVar: '--corner-shape', key: 'cornerShape' },
  { cssVar: '--corner-shape-pill', key: 'cornerShapePill' },
  { cssVar: '--corner-shape-interactive', key: 'cornerShapeInteractive' },
  { cssVar: '--border-style', key: 'borderStyle' },
  { cssVar: '--border-style-interactive', key: 'borderStyleInteractive' },
];

/** Surface axis — panel/page material. */
export const SURFACE_VARS: ReadonlyArray<FlatVarEntry<SurfaceTokens>> = [
  { cssVar: '--surface-backdrop', key: 'backdrop' },
  { cssVar: '--surface-card-image', key: 'cardImage' },
  { cssVar: '--surface-page-image', key: 'pageImage' },
  { cssVar: '--surface-page-image-size', key: 'pageImageSize' },
  { cssVar: '--surface-diagram', key: 'diagram' },
  { cssVar: '--surface-edge-mask', key: 'edgeMask' },
  { cssVar: '--surface-edge-height', key: 'edgeHeight' },
  { cssVar: '--surface-texture-mask', key: 'textureMask' },
  { cssVar: '--surface-texture-size', key: 'textureSize' },
  { cssVar: '--surface-accent-image', key: 'accentImage' },
  { cssVar: '--surface-scrim', key: 'scrim' },
];

/** Diagram axis — how marks are drawn on every drawing surface. */
export const DIAGRAM_VARS: ReadonlyArray<FlatVarEntry<DiagramTokens>> = [
  { cssVar: '--diagram-stroke-thin', key: 'strokeThin' },
  { cssVar: '--diagram-stroke-normal', key: 'strokeNormal' },
  { cssVar: '--diagram-stroke-bold', key: 'strokeBold' },
  { cssVar: '--diagram-line-cap', key: 'lineCap' },
  { cssVar: '--diagram-line-join', key: 'lineJoin' },
  { cssVar: '--diagram-dash', key: 'dash' },
  { cssVar: '--diagram-dot', key: 'dot' },
  { cssVar: '--diagram-fill-style', key: 'fillStyle' },
  { cssVar: '--diagram-fill-opacity', key: 'fillOpacity' },
  { cssVar: '--diagram-roughness', key: 'roughness' },
  { cssVar: '--diagram-glow', key: 'glow' },
  { cssVar: '--diagram-shadow', key: 'shadow' },
  { cssVar: '--diagram-marker', key: 'marker' },
  { cssVar: '--diagram-label-font', key: 'labelFont' },
  { cssVar: '--diagram-label-size', key: 'labelSize' },
  { cssVar: '--diagram-label-weight', key: 'labelWeight' },
  { cssVar: '--diagram-label-case', key: 'labelCase' },
  { cssVar: '--diagram-corner', key: 'corner' },
];

/** Scene axis — 3D material and lighting. */
export const SCENE_VARS: ReadonlyArray<FlatVarEntry<SceneTokens>> = [
  { cssVar: '--material-roughness', key: 'materialRoughness' },
  { cssVar: '--material-metalness', key: 'materialMetalness' },
  { cssVar: '--material-flat', key: 'materialFlat' },
  { cssVar: '--material-outline', key: 'materialOutline' },
  { cssVar: '--light-ambient', key: 'lightAmbient' },
  { cssVar: '--light-key', key: 'lightKey' },
  { cssVar: '--light-key-color', key: 'lightKeyColor' },
  { cssVar: '--scene-fog', key: 'fog' },
];

/** Legacy free-form map prefixes (`ThemeTokens.colors`/`radii`/`spacing`/`shadows`). `typography` has no prefix — see below. */
export const LEGACY_PREFIXES = {
  colors: '--color-',
  radii: '--radius-',
  spacing: '--space-',
  shadows: '--shadow-',
} as const;

/**
 * Convert `ThemeTokens` (+ optional dark variant) into a CSS custom-property
 * map keyed by variable name (e.g. `--color-primary`).
 *
 * Mapping rules (mirror theme.rs):
 * - `tokens.colors.<k>`     → `--color-<k>`
 * - `tokens.radii.<k>`      → `--radius-<k>`
 * - `tokens.spacing.<k>`    → `--space-<k>`
 * - `tokens.typography.<k>` → `--<k>` (keys already include their `font-`/
 *                                       `letter-`/`line-` prefix)
 * - `tokens.shadows.<k>`    → `--shadow-<k>` (schema key has no prefix)
 *
 * In `'dark'` mode, the `darkVariant` overrides are merged on top of the
 * base tokens per category — same precedence the Rust compiler uses
 * (`generate_tokens_css_dark`). Categories not present in `darkVariant` fall
 * back to the base tokens.
 */
export function themeTokensToCssVars(
  tokens: ThemeTokens,
  mode: ThemeMode = 'light',
  darkVariant?: ThemeVariant,
): Record<string, string> {
  const vars: Record<string, string> = {};
  const isDark = mode === 'dark';

  const pickColors = isDark && darkVariant?.colors ? darkVariant.colors : tokens.colors;
  if (pickColors) {
    for (const [key, value] of Object.entries(pickColors)) {
      vars[`${LEGACY_PREFIXES.colors}${key}`] = value;
    }
    // When dark variant supplies *some* colors but not all, layer base
    // tokens.colors under the variant (mirrors theme.rs:269-285 which
    // includes custom colors not present in dark defaults).
    if (isDark && darkVariant?.colors && tokens.colors) {
      for (const [key, value] of Object.entries(tokens.colors)) {
        const varName = `${LEGACY_PREFIXES.colors}${key}`;
        if (!(varName in vars)) vars[varName] = value;
      }
    }
  }

  const pickRadii = isDark && darkVariant?.radii ? darkVariant.radii : tokens.radii;
  if (pickRadii) {
    for (const [key, value] of Object.entries(pickRadii)) {
      vars[`${LEGACY_PREFIXES.radii}${key}`] = value;
    }
  }

  const pickSpacing = isDark && darkVariant?.spacing ? darkVariant.spacing : tokens.spacing;
  if (pickSpacing) {
    for (const [key, value] of Object.entries(pickSpacing)) {
      vars[`${LEGACY_PREFIXES.spacing}${key}`] = value;
    }
  }

  // Typography keys already carry their full prefix (font-family, font-size,
  // letter-spacing, line-height, …) per the compile-time contract.
  const pickTypography = isDark && darkVariant?.typography ? darkVariant.typography : tokens.typography;
  if (pickTypography) {
    for (const [key, value] of Object.entries(pickTypography)) {
      vars[`--${key}`] = value;
    }
  }

  // Shadows: schema key is bare (e.g. "main", "sm", "lg"); emit with prefix.
  const pickShadows = isDark && darkVariant?.shadows ? darkVariant.shadows : tokens.shadows;
  if (pickShadows) {
    for (const [key, value] of Object.entries(pickShadows)) {
      vars[`${LEGACY_PREFIXES.shadows}${key}`] = value;
    }
  }

  // Layer 1 skin axes (density / typeScale / motion / iconography / elevation / geometry).
  // Cascade: per category, prefer darkVariant.<axis> if Some in dark mode, else base tokens.<axis>.
  // Mirrors orbital-shell-typescript/src/codegen/theme.rs `emit_skin_axes_dark`.
  const pickDensity = isDark && darkVariant?.density ? darkVariant.density : tokens.density;
  emitDensity(pickDensity, vars);

  const pickTypeScale = isDark && darkVariant?.typeScale ? darkVariant.typeScale : tokens.typeScale;
  emitTypeScale(pickTypeScale, vars);

  const pickMotion = isDark && darkVariant?.motion ? darkVariant.motion : tokens.motion;
  emitMotion(pickMotion, vars);

  const pickIconography = isDark && darkVariant?.iconography ? darkVariant.iconography : tokens.iconography;
  emitIconography(pickIconography, vars);

  const pickElevation = isDark && darkVariant?.elevation ? darkVariant.elevation : tokens.elevation;
  emitElevation(pickElevation, vars);

  const pickGeometry = isDark && darkVariant?.geometry ? darkVariant.geometry : tokens.geometry;
  emitGeometry(pickGeometry, vars);

  const pickIllustration = isDark && darkVariant?.illustration ? darkVariant.illustration : tokens.illustration;
  emitIllustration(pickIllustration, vars);

  const pickSurface = isDark && darkVariant?.surface ? darkVariant.surface : tokens.surface;
  applyFlat(pickSurface, SURFACE_VARS, vars);

  const pickDiagram = isDark && darkVariant?.diagram ? darkVariant.diagram : tokens.diagram;
  applyFlat(pickDiagram, DIAGRAM_VARS, vars);

  const pickScene = isDark && darkVariant?.scene ? darkVariant.scene : tokens.scene;
  applyFlat(pickScene, SCENE_VARS, vars);

  return vars;
}

// =============================================================================
// Skin axis emitters — byte-for-byte mirrors of orbital-shell-typescript theme.rs
// =============================================================================

function emitDensity(density: DensityTokens | undefined, vars: Record<string, string>): void {
  if (!density) return;
  applyFlat(density.spacing, DENSITY_SPACING_VARS, vars);
  applyFlat(density, DENSITY_ELEMENT_VARS, vars);
}

function typeSizeKeyStr(k: TypeSizeKey): string {
  return k;
}

function typeWeightStr(w: TypeWeight): string {
  return w;
}

function emitTypeIntent(name: string, intent: TypeIntent, vars: Record<string, string>): void {
  const sizeKey = typeSizeKeyStr(intent.size);
  const weight = typeWeightStr(intent.weight);
  vars[`--intent-${name}-size`] = `var(--text-${sizeKey})`;
  vars[`--intent-${name}-weight`] = `var(--font-weight-${weight})`;
  vars[`--intent-${name}-leading`] = `var(--leading-${sizeKey})`;
}

function emitTypeScale(ts: TypeScaleTokens | undefined, vars: Record<string, string>): void {
  if (!ts) return;
  applyFlat(ts, TYPE_FAMILY_VARS, vars);
  applyFlat(ts, TYPE_HEADING_VARS, vars);
  if (ts.scale) {
    const s = ts.scale;
    for (const k of TYPE_SIZE_KEYS) {
      const entry = s[k];
      if (entry !== undefined) {
        vars[`--text-${k}`] = entry.size;
        vars[`--leading-${k}`] = entry.lineHeight;
      }
    }
  }
  if (ts.intents) {
    const i = ts.intents;
    for (const { key, cssName } of TYPE_INTENT_VARS) {
      const intent = i[key];
      if (intent) emitTypeIntent(cssName, intent, vars);
    }
  }
}

function emitMotionIntent(name: string, intent: MotionIntent, vars: Record<string, string>): void {
  vars[`--intent-${name}-duration`] = `var(--duration-${intent.duration})`;
  vars[`--intent-${name}-easing`] = `var(--easing-${intent.easing})`;
}

function emitMotion(m: MotionTokens | undefined, vars: Record<string, string>): void {
  if (!m) return;
  if (m.durations) {
    const d = m.durations;
    for (const k of MOTION_DURATION_KEYS) {
      const v = d[k];
      if (v !== undefined) vars[`--duration-${k}`] = v;
    }
  }
  if (m.easings) {
    const e = m.easings;
    for (const k of MOTION_EASING_KEYS) {
      const v = e[k];
      if (v !== undefined) vars[`--easing-${k}`] = v;
    }
  }
  if (m.intents) {
    const i = m.intents;
    for (const { key, cssName } of MOTION_INTENT_VARS) {
      const intent = i[key];
      if (intent) emitMotionIntent(cssName, intent, vars);
    }
  }
  applyFlat(m.shapes, MOTION_SHAPE_VARS, vars);
  if (m.entry?.default !== undefined) vars['--motion-enter-default'] = enterKeyframe(m.entry.default);
  if (m.entry?.stagger !== undefined) vars['--motion-enter-stagger'] = m.entry.stagger;
  if (m.busyDelay !== undefined) vars['--motion-busy-delay'] = m.busyDelay;
  if (m.awaitingSkeleton !== undefined) vars['--awaiting-skeleton-display'] = m.awaitingSkeleton ? 'block' : 'none';
}

/** The keyframe name an entry keyword plays (`none` stays `none`). */
export function enterKeyframe(enter: EnterAnimation): string {
  return enter === 'none' ? 'none' : `almadar-enter-${enter}`;
}

function emitIconography(i: IconographyTokens | undefined, vars: Record<string, string>): void {
  applyFlat(i, ICONOGRAPHY_VARS, vars);
}

function emitElevation(e: ElevationTokens | undefined, vars: Record<string, string>): void {
  applyFlat(e, ELEVATION_VARS, vars);
}

function emitGeometry(g: GeometryTokens | undefined, vars: Record<string, string>): void {
  applyFlat(g, GEOMETRY_VARS, vars);
}

/** Illustration axis — a theme's loading artwork replaces the Spinner's generic icon. */
function emitIllustration(il: IllustrationTokens | undefined, vars: Record<string, string>): void {
  if (!il?.loadingAsset) return;
  vars['--illustration-loading'] = `url("${il.loadingAsset}")`;
  vars['--loader-mark-display'] = 'inline-block';
  vars['--loader-icon-display'] = 'none';
}

/**
 * `ThemeRef` is `ThemeDefinition | string`. When it's a string, it's an
 * unresolved import reference (e.g. `"Ocean.theme"`) that should have been
 * inlined by the compiler's import phase before runtime. If we still see a
 * string here, the upstream resolution path didn't run — return `undefined`
 * rather than guess. `OrbitalThemeProvider` falls through to passthrough.
 */
export function resolveThemeForRuntime(theme: ThemeRef | undefined): ThemeDefinition | undefined {
  if (theme === undefined) return undefined;
  if (typeof theme === 'string') return undefined;
  return theme;
}
