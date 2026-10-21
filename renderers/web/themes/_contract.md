# Theme CSS Variable Contract

> Reference: `docs/Almadar_Std_Variations.md` §2 (Skin layer).
> Type counterpart: `@almadar/core` exports `ThemeTokens` with typed sub-interfaces — `DensityTokens`, `TypeScaleTokens`, `MotionTokens`, `IconographyTokens`, `ElevationTokens`, `GeometryTokens`.
> This file is **not loaded at runtime**. It is the authoritative reference both for theme authors and for the `_defaults.css` fallback layer in `themes/index.css`.

CSS custom properties are the runtime source of truth — every `@almadar/ui` component reads from these variables via Tailwind utility classes (mapped in `tailwind-preset.cjs`). A theme that omits a variable inherits a deterministic fallback from the `:root` block declared in `themes/index.css`; the fallbacks are calibrated to preserve the visual baseline of the 18 pre-Layer-1 themes.

A "truly unique" theme overrides variables across **all** axes below — not just `--color-*`. Two themes that diverge only on color will feel like the same product in two paint jobs.

## Existing variables (preserved unchanged)

These were defined by every pre-Layer-1 theme and continue to be the canonical paint surface. Backfill agents MUST NOT change existing values; they only append the new axis variables below.

### Color
`--color-primary`, `--color-primary-hover`, `--color-primary-foreground`,
`--color-secondary`, `--color-secondary-hover`, `--color-secondary-foreground`,
`--color-accent`, `--color-accent-foreground`,
`--color-muted`, `--color-muted-foreground`,
`--color-background`, `--color-foreground`,
`--color-card`, `--color-card-foreground`,
`--color-surface`, `--color-border`, `--color-input`, `--color-ring`,
`--color-error`, `--color-error-foreground`,
`--color-success`, `--color-success-foreground`,
`--color-warning`, `--color-warning-foreground`,
`--color-info`, `--color-info-foreground`.

Optional table-specific (defined by some themes, fall back to neutrals when absent): `--color-table-header`, `--color-table-border`, `--color-table-row-hover`, `--color-surface-hover`, `--color-border-hover`, `--color-placeholder`.

### Radius (existing — Geometry axis below adds intent overlay)
`--radius-none`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`, `--radius-full`.

### Border width (existing — Geometry axis adds intent overlay)
`--border-width`, `--border-width-thin`, `--border-width-thick`.

### Shadow (existing — Elevation axis adds intent overlay)
`--shadow-none`, `--shadow-sm`, `--shadow-main`, `--shadow-lg`, `--shadow-inner`, `--shadow-hover`, `--shadow-active`.

### Typography (existing — TypeScale axis adds family triplet + scale)
`--font-family`, `--font-weight-normal`, `--font-weight-medium`, `--font-weight-bold`, `--line-height`, `--letter-spacing`.

### Icon (existing — Iconography axis adds family selector)
`--icon-stroke-width`, `--icon-color`.

### Transitions (existing — Motion axis adds named palette)
`--transition-fast`, `--transition-normal`, `--transition-slow`, `--transition-timing`.

### Interaction (existing)
`--hover-scale`, `--hover-translate-y`, `--hover-translate-x`,
`--active-scale`, `--active-translate-y`,
`--focus-ring-width`, `--focus-ring-offset`, `--focus-ring-color`.

---

## New variables (added in Layer 1)

Every theme — backfilled or new — defines the variables below. The defaults column shows what the `_defaults.css` `:root` block declares; backfill agents copy these into each existing theme block so post-migration visual output stays identical. New-theme authors override per their personality brief.

### Density axis — `--space-*` scale + per-element heights/paddings

Spacing scale (12 steps; current Tailwind defaults shown to preserve `p-3 / p-4 / p-6` parity):

| Variable | Default | Tailwind equivalent |
|---|---|---|
| `--space-0` | `0px` | `0` |
| `--space-1` | `4px` | `1` |
| `--space-2` | `8px` | `2` |
| `--space-3` | `12px` | `3` |
| `--space-4` | `16px` | `4` |
| `--space-5` | `20px` | `5` |
| `--space-6` | `24px` | `6` |
| `--space-7` | `28px` | `7` |
| `--space-8` | `32px` | `8` |
| `--space-9` | `36px` | `9` |
| `--space-10` | `40px` | `10` |
| `--space-11` | `44px` | `11` |
| `--space-12` | `48px` | `12` |

Per-element heights:

| Variable | Default | Used by |
|---|---|---|
| `--button-height-sm` | `28px` | Button size="sm" |
| `--button-height-md` | `36px` | Button size="md" |
| `--button-height-lg` | `44px` | Button size="lg" |
| `--input-height-sm` | `28px` | Input size="sm" |
| `--input-height-md` | `36px` | Input size="md" |
| `--input-height-lg` | `44px` | Input size="lg" |
| `--row-height-compact` | `32px` | Table dense rows |
| `--row-height-normal` | `40px` | Table default rows |
| `--row-height-spacious` | `48px` | Table comfortable rows |

Per-element padding:

| Variable | Default | Used by |
|---|---|---|
| `--card-padding-sm` | `12px` | Card padding="sm" (matches `p-3`) |
| `--card-padding-md` | `16px` | Card padding="md" (matches `p-4`) |
| `--card-padding-lg` | `24px` | Card padding="lg" (matches `p-6`) |
| `--dialog-padding` | `24px` | Dialog body |
| `--section-gap` | `32px` | Section-to-section vertical rhythm |

### Type axis — family triplet + scale + intent mapping

Family slots (the existing `--font-family` aliases to `--font-family-body` for backward compat):

| Variable | Default |
|---|---|
| `--font-family-display` | `var(--font-family)` |
| `--font-family-body` | `var(--font-family)` |
| `--font-family-mono` | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` |

Size scale + paired line-heights (defaults match Tailwind's default `text-*` scale so existing `text-sm` resolves to identical px):

| Size key | `--text-*` default | `--leading-*` default |
|---|---|---|
| `xs` | `12px` | `16px` |
| `sm` | `14px` | `20px` |
| `base` | `16px` | `24px` |
| `lg` | `18px` | `28px` |
| `xl` | `20px` | `28px` |
| `2xl` | `24px` | `32px` |
| `3xl` | `30px` | `36px` |
| `4xl` | `36px` | `40px` |
| `display-1` | `48px` | `52px` |
| `display-2` | `60px` | `64px` |

Intent mapping — three vars per intent (`size`, `weight`, `leading`). Defaults are calibrated against current component usage (Card title `text-lg` → `heading-major`; subtitle `text-sm` muted → `caption`):

| Intent | `--intent-*-size` | `--intent-*-weight` | `--intent-*-leading` |
|---|---|---|---|
| `heading-major` | `var(--text-2xl)` | `var(--font-weight-bold)` | `var(--leading-2xl)` |
| `heading-minor` | `var(--text-lg)` | `var(--font-weight-bold)` | `var(--leading-lg)` |
| `body-emphasis` | `var(--text-base)` | `var(--font-weight-medium)` | `var(--leading-base)` |
| `body-default` | `var(--text-sm)` | `var(--font-weight-normal)` | `var(--leading-sm)` |
| `body-quiet` | `var(--text-sm)` | `var(--font-weight-normal)` | `var(--leading-sm)` |
| `caption` | `var(--text-xs)` | `var(--font-weight-normal)` | `var(--leading-xs)` |
| `numeric` | `var(--text-sm)` | `var(--font-weight-medium)` | `var(--leading-sm)` |

### Motion axis — duration palette + easing palette

Duration palette (existing `--transition-fast/normal/slow` alias to `--duration-fast/normal/slow`):

| Variable | Default |
|---|---|
| `--duration-instant` | `0ms` |
| `--duration-fast` | `var(--transition-fast)` |
| `--duration-normal` | `var(--transition-normal)` |
| `--duration-slow` | `var(--transition-slow)` |
| `--duration-dramatic` | `600ms` |

Easing palette (existing `--transition-timing` aliases to `--easing-standard`):

| Variable | Default |
|---|---|
| `--easing-linear` | `linear` |
| `--easing-standard` | `var(--transition-timing)` |
| `--easing-emphasized` | `cubic-bezier(0.2, 0, 0, 1)` |
| `--easing-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` |

**Master toggle:** `--motion-enable` (`on` \| `off`, default `on`). Set `off` to collapse every
motion to instant — the programmatic opt-out (independent of `prefers-reduced-motion`, which the
base layer also honours globally).

### Motion axis — keyframe endpoints (surface shapes)

Every animated surface has enter + exit endpoints so `<Presence>` (the one enter/leave primitive)
can animate both directions. Override these in a theme block to restyle the *shape*; duration &
easing still come from the palettes above.

| Surface | Endpoints (enter/exit) | Default shape |
|---|---|---|
| overlay | `--motion-overlay-enter-from-opacity`, `--motion-overlay-exit-to-opacity` | fade |
| modal | `--motion-modal-{enter,exit}-{from,to}-{opacity,transform}` | scale .96 + translateY(8px) + fade |
| slide-up | `--motion-slide-up-from-{opacity,transform}` | translateY(16px) + fade |
| drawer | `--motion-drawer-{enter,exit}-{from,to}-{opacity,transform}` + `--motion-drawer-sign` (1 / -1) | horizontal slide by side |
| popover | `--motion-popover-{enter,exit}-{from,to}-{opacity,transform}` | scale .95 + fade |
| toast | `--motion-toast-{enter,exit}-{from,to}-{opacity,transform}` | translateY(16px) + fade |
| fade | `--motion-fade-{enter,exit}-{from,to}-opacity` | opacity only |
| page | `--motion-page-{enter,exit}-{from,to}-{opacity,transform}` | translateY(±8px) + fade |

These back the preset utilities `animate-<surface>-in` / `animate-<surface>-out`. A reduced-motion
user (`@media (prefers-reduced-motion: reduce)`, declared once in `_base.css`) gets every surface
instantly regardless of theme.

### Iconography axis

| Variable | Default | Notes |
|---|---|---|
| `--icon-family` | `lucide` | String identifier consumed by the icon resolver. Values: `lucide` \| `phosphor-outline` \| `phosphor-fill` \| `phosphor-duotone` \| `tabler` \| `fa-solid`. |
| `--icon-default-size` | `16px` | Default icon px size when component doesn't override. |

`--icon-stroke-width` and `--icon-color` continue from the existing surface.

### Elevation axis — per-layer mapping

| Variable | Default |
|---|---|
| `--elevation-card` | `var(--shadow-sm)` |
| `--elevation-popover` | `var(--shadow-main)` |
| `--elevation-dialog` | `var(--shadow-lg)` |
| `--elevation-toast` | `var(--shadow-main)` |

### Geometry axis — radius rhythm + border-width rhythm with intent

| Variable | Default |
|---|---|
| `--radius-container` | `var(--radius-md)` |
| `--radius-interactive` | `var(--radius-md)` |
| `--radius-pill` | `var(--radius-full)` |
| `--border-hairline` | `1px` |
| `--border-standard` | `var(--border-width)` |
| `--border-heavy` | `var(--border-width-thick)` |

### Range axes — heading voice, corner/border style, interactive elevation, surface, fonts

These separate artistic styles (Art Deco vs Win95 vs wabi-sabi) along dimensions color cannot. Every consumer carries its own fallback, so a theme that omits them renders exactly as before.

| Typed field (`@almadar/core`) | CSS variable | Consumed by | Fallback |
|---|---|---|---|
| `typeScale.displayFamily` | `--font-family-display` | every h1–h6, `Typography` heading variants (`.heading-voice`) | `--font-family` |
| `typeScale.headingWeight` | `--heading-weight` | `.heading-voice`, `[data-theme] h1–h6` | `--font-weight-bold` |
| `typeScale.headingTransform` | `--heading-transform` | same | `none` |
| `typeScale.headingTracking` | `--heading-tracking` | same | `--letter-spacing` |
| `typeScale.headingStyle` | `--heading-style` | same | `normal` |
| `typeScale.headingShadow` | `--heading-shadow` | same (text-shadow: glow, emboss, misregistration) | `none` |
| `typeScale.fontImport` | — (not a var) | preset: generated `_fonts.css` `@import`; inline: `OrbitalThemeProvider` `<link>`; compiled: `@import` atop the theme CSS | — |
| `geometry.cornerShape` | `--corner-shape` | every element inside `[data-theme]` (CSS `corner-shape`; Chromium 139+, other engines render plain round corners) | `round` |
| `geometry.cornerShapePill` | `--corner-shape-pill` | `.rounded-full` / `.rounded-pill` | `round` |
| `geometry.cornerShapeInteractive` | `--corner-shape-interactive` | `Button`, `Input`, `Select`, `Textarea` (`.interactive-border`) | `--corner-shape` |
| `geometry.borderStyle` | `--border-style` | every bordered element (scoped reset) | `solid` |
| `geometry.borderStyleInteractive` | `--border-style-interactive` | `Button` (`.interactive-border`) | `--border-style` |
| `elevation.interactiveElevation` | `--elevation-interactive` | `Button` resting (`shadow-elevation-interactive`) | `--shadow-sm` |
| `elevation.pressedElevation` | `--elevation-pressed` | `Button` `:active` (`shadow-elevation-pressed`) | `--shadow-sm` |
| `surface.backdrop` | `--surface-backdrop` | `.surface-material` (cards, overlays): `backdrop-filter` | `none` |
| `surface.cardImage` | `--surface-card-image` | `.surface-material`: `background-image` over the card color | `none` |
| `surface.pageImage` | `--surface-page-image` | `.surface-page` (app shells, themed orbital roots) | `none` |
| `surface.pageImageSize` | `--surface-page-image-size` | `.surface-page` | `auto` |
| `surface.contentBg` | `--surface-content-bg` | `.surface-content`: the background behind every content block (table, calendar, list, chart …) and the default `Card` | `--color-card` |
| `surface.contentBorderWidth` | `--surface-content-border-width` | `.surface-content` | `--border-width` |
| `surface.contentBorderColor` | `--surface-content-border-color` | `.surface-content` | `--color-border` |
| `surface.contentRadius` | `--surface-content-radius` | `.surface-content` | `--radius-container` |
| `surface.contentShadow` | `--surface-content-shadow` | `.surface-content` | `--elevation-card` |
| `surface.edgeMask` | `--surface-edge-mask` | `.band-edge` (Box `edgeTop`/`edgeBottom: curve`) | `none` (straight edge) |
| `surface.edgeHeight` | `--surface-edge-height` | `.band-edge` (curve only) | `clamp(24px, 6vw, 96px)` |
| `surface.textureMask` | `--surface-texture-mask` | `.band-texture` (Box `texture`) | built-in dot tile |
| `surface.textureSize` | `--surface-texture-size` | `.band-texture` | `24px 24px` |
| `surface.accentImage` | `--surface-accent-image` | `.band-gradient` (Box `bg: gradient`) | faint primary-tinted linear gradient |
| `surface.scrim` | `--surface-scrim` | `.band-scrim` (std-hero `surface: image`) | dark bottom-up gradient |

| `motion.shapes.modalEnter` / `modalExit` | `--motion-modal-enter-from-transform` / `--motion-modal-exit-to-transform` | `Modal` (every modal slot: runtime, contained preview, compiled) | `scale(.96) translateY(8px)` / `scale(.92) translateY(16px)` |
| `motion.shapes.popoverEnter` / `popoverExit` | `--motion-popover-enter-from-transform` / `--motion-popover-exit-to-transform` | `Popover`, menus | `scale(.95)` |
| `motion.shapes.toastEnter` / `toastExit` | `--motion-toast-enter-from-transform` / `--motion-toast-exit-to-transform` | `Toast` | `translateY(16px)` |
| `motion.shapes.pageEnter` | `--motion-page-enter-from-transform` | `PageTransition` (pages animate in only) | `translateY(8px)` |

**Where motion plays.** Modal/drawer slots stay mounted through their exit animation (a cleared slot keeps its last content until `onExited`). Page content animates in on navigation through `PageTransition`: `UISlotRenderer`'s `pageKey` (OrbPreview) and the compiled `App.tsx` host wrap the routed content, and a layout's content region (`DashboardLayout`'s `<main>`) claims the transition so its chrome stays still. `--motion-enable: off` and `prefers-reduced-motion` disable all of it.

`.lolo` inline themes author these under `tokens { typeScale { … } geometry { … } elevation { … } surface { … } motion { … } }` (flat camelCase keys, parse-checked; `motion` takes the shape keys). A frosted-glass theme needs a translucent `card` color (`rgba`) for `backdrop` to show. `double` / `groove` / `ridge` borders need a border width of 3px or more to read.

---

### Drawing axes — `diagram`, `scene`, diagram colors, `--surface-diagram`

How every drawing surface (learning canvases, charts, graph canvases, game boards, AVL, 3D
scenes) draws its marks. Components never hardcode a drawing color, weight or face; they resolve
these through `useCanvasTheme` (`hooks/useCanvasTheme.ts`). Defaults in `_base.css` derive every
var from the theme's own tokens, so a preset that sets nothing still draws in its own palette,
border weight, faces and corners. A preset sets them to give its drawings a hand of their own
(sketch wobble, neon glow, blueprint dashes, Bauhaus square caps).

| Var | Source key | Meaning |
|---|---|---|
| `--surface-diagram` | `surface.diagram` | Ground a drawing sits on (default `--color-card`) |
| `--color-series-1…8` | `colors.series-N` | Categorical data palette with no status meaning (default: primary turned around the hue wheel) |
| `--color-diagram-ink` / `-label` / `-guide` / `-axis` / `-grid` / `-highlight` / `-fill` | `colors.diagram-*` | Mark roles: default stroke, label text, construction lines, axes, grid, the one emphasized mark, default fill |
| `--diagram-stroke-thin` / `-normal` / `-bold` | `diagram.strokeThin/Normal/Bold` | Stroke weights for guides / marks / emphasis (default from the border rhythm) |
| `--diagram-line-cap` / `-line-join` | `diagram.lineCap/lineJoin` | `butt\|round\|square` / `miter\|round\|bevel` |
| `--diagram-dash` / `-dot` | `diagram.dash/dot` | Dash patterns (space-separated lengths) of dashed / dotted marks |
| `--diagram-fill-style` / `-fill-opacity` | `diagram.fillStyle/fillOpacity` | `solid\|tint\|outline\|hatch`; tint strength |
| `--diagram-roughness` | `diagram.roughness` | Hand-drawn wobble in px (`0` = exact) |
| `--diagram-glow` | `diagram.glow` | Glow blur in px around strokes (`0` = none) |
| `--diagram-shadow` | `diagram.shadow` | Shadow recipe on filled marks |
| `--diagram-marker` | `diagram.marker` | Arrowhead: `triangle\|open\|line\|dot` |
| `--diagram-label-font` / `-size` / `-weight` / `-case` | `diagram.label*` | Label face (`body\|display\|mono`), type-scale step, weight, `none\|uppercase` |
| `--diagram-corner` | `diagram.corner` | Corner radius of rects and bars |
| `--material-roughness` / `-metalness` / `-flat` / `-outline` | `scene.material*` | 3D material response; `flat` `1` = flat shading; `outline` = toon outline px |
| `--light-ambient` / `-key` / `-key-color` | `scene.light*` | 3D lighting |
| `--scene-fog` | `scene.fog` | Depth haze 0–1 |

Motion has no drawing-specific vars: animated surfaces use `--duration-*` / `--easing-*` and stop
when `--motion-enable: off` or `prefers-reduced-motion` is set.

## Authoring rules

1. **Backfill agents** (B1, B2, B3): copy the defaults above verbatim into each existing theme's light and dark blocks. Do not change any pre-existing variable. The migration must produce pixel-identical output to today for every pre-Layer-1 theme.
2. **New-theme agents** (B4–B8): define every variable above. Pick values that express the personality brief — compact density, editorial type, sharp geometry, dramatic motion, filled iconography, etc. Defaults are NOT a fallback for new themes; new themes are the proof that the axis surface works.
3. **No raw pixel literals in components**. All dimensional values flow through these tokens or through Tailwind utilities backed by them in `tailwind-preset.cjs`. Components that hardcode `text-[10px]` or `min-w-[44px]` are migration targets.
4. **Icon family swap is runtime-resolved**. `--icon-family` is read by the icon resolver in `@almadar/ui`; setting the variable in a theme does not require component edits.
5. **Wireframe and trait-wars exceptions**. Wireframe's `--easing-standard` is `linear` not the default cubic-bezier; trait-wars's iconography may remain `lucide` even if its visual personality diverges. Document any per-theme override at the top of the theme file.
6. **Contrast is gated.** Every theme's canonical foreground/fill pairs must pass WCAG AA 4.5:1 — enforced by `scripts/theme-contrast-audit.mjs` (`pnpm verify:themes`), which runs in CI and before every npm publish and exits non-zero on any violation. A new or edited theme that fails the audit blocks the publish. The script also accepts `--dir <themes-dir>` (`scripts/` is published) so another package can audit its own theme dir with the same rules.
7. **No hardcoded palette colors in components.** Components must consume these tokens only (no `text-white`, `bg-gray-800`, `border-indigo-300`, `text-[#hex]`). Enforced by the `almadar/no-hardcoded-colors` ESLint rule (`@almadar/eslint-plugin`, enabled in this package's `eslint.config.cjs`). The single sanctioned exception is media-overlay chrome (white text / dark scrims painted over images or video), which requires an inline `eslint-disable-next-line almadar/no-hardcoded-colors` comment stating the reason.

**Drawing roles stay apart.** In every theme mode the roles a canvas draws meaning with — `diagram-ink`,
`diagram-highlight`, `muted-foreground`, `success`, `warning`, `error`, `series-1`…`series-8` — are at least
ΔE 10 (CIEDE2000) from each other (`@almadar/core` `__tests__/theme-tone-colors.test.ts`; `INDISTINCT_DELTA_E`).
A monochrome theme keeps its UI monochrome and gives its drawings a small on-identity palette. In an `outline`
fill-style theme a mark's meaningful fill becomes its (bold) outline, so the outline look never erases a state.
