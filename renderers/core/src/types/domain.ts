/**
 * Domain Context Types (Self-Contained)
 *
 * Defines domain classification types for applications.
 * Copied from schema/domain-context.ts to make orbitals/ self-contained.
 *
 * @packageDocumentation
 */

import { z } from "zod";

// ============================================================================
// Domain Categories
// ============================================================================

/**
 * High-level domain categories
 */
export type DomainCategory =
  | "healthcare"
  | "education"
  | "finance"
  | "ecommerce"
  | "real-estate"
  | "logistics"
  | "hospitality"
  | "hr-management"
  | "project-management"
  | "social"
  | "content-management"
  | "iot"
  | "analytics"
  | "game"
  | "custom";

export const DomainCategorySchema = z.enum([
  "healthcare",
  "education",
  "finance",
  "ecommerce",
  "real-estate",
  "logistics",
  "hospitality",
  "hr-management",
  "project-management",
  "social",
  "content-management",
  "iot",
  "analytics",
  "game",
  "custom",
]);

// ============================================================================
// Agent Domain Categories (simplified for LLM-based tools)
// ============================================================================

/**
 * Simplified domain categories used by the agent tools for application classification.
 * All agent tools and skill generators should derive from this constant.
 */
export const AGENT_DOMAIN_CATEGORIES = [
  "game",
  "business",
  "dashboard",
  "form",
  "content",
  "social",
  "ecommerce",
  "workflow",
] as const;

export type AgentDomainCategory = (typeof AGENT_DOMAIN_CATEGORIES)[number];

export const AgentDomainCategorySchema = z.enum([...AGENT_DOMAIN_CATEGORIES]);

// ============================================================================
// Game Sub-Categories
// ============================================================================

/**
 * Game genre sub-categories
 */
export type GameSubCategory =
  | "platformer"
  | "shooter"
  | "puzzle"
  | "rpg"
  | "board"
  | "racing"
  | "fighting"
  | "tower-defense"
  | "endless-runner"
  | "simulation"
  | "arcade"
  | "adventure";

export const GameSubCategorySchema = z.enum([
  "platformer",
  "shooter",
  "puzzle",
  "rpg",
  "board",
  "racing",
  "fighting",
  "tower-defense",
  "endless-runner",
  "simulation",
  "arcade",
  "adventure",
]);

// ============================================================================
// Node Classification
// ============================================================================

/**
 * Domain vs System classification
 */
export type NodeClassification = "domain" | "system";

export const NodeClassificationSchema = z.enum(["domain", "system"]);

// ============================================================================
// Semantic Roles
// ============================================================================

export type StateSemanticRole =
  | "pending"
  | "active"
  | "completed"
  | "cancelled"
  | "error"
  | "suspended"
  | "blocked"
  | "domain_workflow"
  | "domain_status"
  | "system_loading"
  | "system_error"
  | "system_idle"
  | "system_editing"
  | "system_confirming";

export const StateSemanticRoleSchema = z.enum([
  "pending",
  "active",
  "completed",
  "cancelled",
  "error",
  "suspended",
  "blocked",
  "domain_workflow",
  "domain_status",
  "system_loading",
  "system_error",
  "system_idle",
  "system_editing",
  "system_confirming",
]);

export type EventSemanticRole =
  | "domain_action"
  | "domain_trigger"
  | "system_crud"
  | "system_navigation"
  | "system_form"
  | "system_ui";

export const EventSemanticRoleSchema = z.enum([
  "domain_action",
  "domain_trigger",
  "system_crud",
  "system_navigation",
  "system_form",
  "system_ui",
]);

export type EntitySemanticRole =
  | "domain_core"
  | "domain_supporting"
  | "domain_reference"
  | "system_user"
  | "system_config"
  | "system_audit";

export const EntitySemanticRoleSchema = z.enum([
  "domain_core",
  "domain_supporting",
  "domain_reference",
  "system_user",
  "system_config",
  "system_audit",
]);

// ============================================================================
// Domain Vocabulary
// ============================================================================

/**
 * Domain-specific vocabulary for naming conventions.
 * Maps generic terms to domain-appropriate labels.
 */
export type DomainVocabulary = {
  /** Label for items (e.g., "Task", "Cargo", "Patient") */
  item?: string;
  /** Label for collections (e.g., "Tasks", "Inventory", "Patients") */
  collection?: string;
  /** Label for create action (e.g., "Add", "Recruit", "Admit") */
  create?: string;
  /** Label for delete action (e.g., "Remove", "Discharge", "Archive") */
  delete?: string;
  /** Label for container (e.g., "List", "Hold", "Ward") */
  container?: string;
  /** Additional custom vocabulary */
  [key: string]: string | undefined;
};

export const DomainVocabularySchema = z
  .record(z.string(), z.string())
  .optional();

// ============================================================================
// Domain Context (Simplified for Design System)
// ============================================================================

/**
 * User persona for UX decisions
 */
export type UserPersona = {
  /** Persona name */
  name: string;
  /** Role for RBAC */
  role?: string;
  /** Primary device */
  device?: "mobile" | "tablet" | "desktop";
};

export const UserPersonaSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  device: z.enum(["mobile", "tablet", "desktop"]).optional(),
});

/**
 * Domain context - user request + classification
 */
export type DomainContext = {
  /** Original user request - verbatim (typically at schema level) */
  request: string;
  /**
   * The verbatim excerpt or summary of the user request that produced THIS orbital.
   *
   * Purpose: Traceability - know exactly what the user asked for that led to this orbital.
   *
   * Can be:
   * - Exact quote: "...with a calendar that syncs with Google Calendar..."
   * - Summarized: "Calendar integration with Google Calendar sync"
   *
   * Examples:
   * - Request: "Build a project management app with tasks, team collaboration, and Gantt charts"
   * - Task orbital: requestFragment: "tasks"
   * - Team orbital: requestFragment: "team collaboration"
   * - Timeline orbital: requestFragment: "Gantt charts"
   *
   * This enables:
   * - Understanding WHY this orbital exists
   * - Regenerating with original context preserved
   * - Validating the orbital matches user intent
   */
  requestFragment?: string;
  /** Domain category */
  category: AgentDomainCategory;
  /** Sub-domain for more specific classification */
  subDomain?: string;
  /** User personas */
  personas?: UserPersona[];
  /** Domain-specific vocabulary for naming */
  vocabulary?: DomainVocabulary;
};

export const DomainContextSchema = z.object({
  request: z.string().min(1, "Original request is required"),
  requestFragment: z.string().optional(),
  category: AgentDomainCategorySchema,
  subDomain: z.string().optional(),
  personas: z.array(UserPersonaSchema).optional(),
  vocabulary: DomainVocabularySchema.optional(),
});

// ============================================================================
// UX Hints
// ============================================================================

/**
 * UX hints for guiding UI generation.
 * These inform pattern selection and layout decisions.
 */
/**
 * UX hints for guiding UI generation.
 * These inform pattern selection and layout decisions.
 *
 * Note: These are HINTS, not strict requirements. LLMs may use any string value
 * including 'dashboard-grid', 'none', etc. The subagent generator interprets these
 * flexibly to produce appropriate render-ui effects.
 */
export type UXHints = {
  /** Overall user flow pattern (e.g., 'hub-spoke', 'crud-cycle', 'linear') */
  flowPattern?: string;
  /** Pattern for displaying lists (e.g., 'table-view', 'data-grid', 'dashboard-grid', 'none') */
  listPattern?: string;
  /** Pattern for create/edit forms (e.g., 'modal', 'drawer', 'page', 'none') */
  formPattern?: string;
  /** Pattern for entity detail views (e.g., 'drawer', 'page', 'split', 'none') */
  detailPattern?: string;
  /** Cross-orbital navigation links */
  relatedLinks?: RelatedLink[];
};

// UX hints use flexible string types - they are guidance, not strict validation
export const UXHintsSchema = z.object({
  flowPattern: z.string().optional(),
  listPattern: z.string().optional(),
  formPattern: z.string().optional(),
  detailPattern: z.string().optional(),
  relatedLinks: z.array(z.lazy(() => RelatedLinkSchema)).optional(),
});

/**
 * Related link for cross-orbital navigation.
 */
export type RelatedLink = {
  /** Field name of the relation (e.g., "customerId") */
  relation: string;
  /** Button/link text (e.g., "View Customer") */
  label: string;
  /** Target view type */
  targetView?: "list" | "detail";
};

export const RelatedLinkSchema = z.object({
  relation: z.string().min(1),
  label: z.string().min(1),
  targetView: z.enum(["list", "detail"]).optional(),
});

// ============================================================================
// Suggested Guards (Pre-Generation)
// ============================================================================

/**
 * Suggested guard - natural language description for decomposition phase.
 * Generator converts these to S-expressions during generation.
 */
export type SuggestedGuard = {
  /** Unique identifier */
  id: string;
  /** Natural language description (e.g., "Weight must be under 1000kg") */
  description: string;
  /** Events this guard applies to (e.g., ["Cargo.CREATE", "Cargo.UPDATE"]) */
  appliesTo: string[];
};

export const SuggestedGuardSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  appliesTo: z.array(z.string().min(1)),
});

// ============================================================================
// Design Preferences
// ============================================================================

/**
 * Design preferences for visual styling
 */
export type DesignPreferences = {
  /** Design style */
  style?: "minimal" | "modern" | "playful" | "data-driven" | "immersive";
  /** Primary color (hex) */
  primaryColor?: string;
  /** Target device */
  device?: "mobile" | "tablet" | "desktop" | "all";
  /** Dark mode */
  darkMode?: boolean;
  /** UX hints for pattern selection */
  uxHints?: UXHints;
};

export const DesignPreferencesSchema = z.object({
  style: z
    .enum(["minimal", "modern", "playful", "data-driven", "immersive"])
    .optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Must be valid hex color")
    .optional(),
  device: z.enum(["mobile", "tablet", "desktop", "all"]).optional(),
  darkMode: z.boolean().optional(),
  uxHints: UXHintsSchema.optional(),
});

// ============================================================================
// Theme Definition — Skin axes (Layer 1 visual variation, see docs/Almadar_Std_Variations.md)
// ============================================================================

/** Spacing scale entry — each step pairs with a CSS `--space-N` variable */
export type SpacingScale = {
  space0?: string;
  space1?: string;
  space2?: string;
  space3?: string;
  space4?: string;
  space5?: string;
  space6?: string;
  space7?: string;
  space8?: string;
  space9?: string;
  space10?: string;
  space11?: string;
  space12?: string;
};

export const SpacingScaleSchema = z.object({
  space0: z.string().optional(),
  space1: z.string().optional(),
  space2: z.string().optional(),
  space3: z.string().optional(),
  space4: z.string().optional(),
  space5: z.string().optional(),
  space6: z.string().optional(),
  space7: z.string().optional(),
  space8: z.string().optional(),
  space9: z.string().optional(),
  space10: z.string().optional(),
  space11: z.string().optional(),
  space12: z.string().optional(),
});

/**
 * Density axis — spacing rhythm + per-element heights and paddings.
 * Determines whether a UI feels compact (Linear), cozy (default), or spacious (Notion).
 */
export type DensityTokens = {
  spacing?: SpacingScale;
  buttonHeightSm?: string;
  buttonHeightMd?: string;
  buttonHeightLg?: string;
  inputHeightSm?: string;
  inputHeightMd?: string;
  inputHeightLg?: string;
  rowHeightCompact?: string;
  rowHeightNormal?: string;
  rowHeightSpacious?: string;
  cardPaddingSm?: string;
  cardPaddingMd?: string;
  cardPaddingLg?: string;
  dialogPadding?: string;
  sectionGap?: string;
};

export const DensityTokensSchema = z.object({
  spacing: SpacingScaleSchema.optional(),
  buttonHeightSm: z.string().optional(),
  buttonHeightMd: z.string().optional(),
  buttonHeightLg: z.string().optional(),
  inputHeightSm: z.string().optional(),
  inputHeightMd: z.string().optional(),
  inputHeightLg: z.string().optional(),
  rowHeightCompact: z.string().optional(),
  rowHeightNormal: z.string().optional(),
  rowHeightSpacious: z.string().optional(),
  cardPaddingSm: z.string().optional(),
  cardPaddingMd: z.string().optional(),
  cardPaddingLg: z.string().optional(),
  dialogPadding: z.string().optional(),
  sectionGap: z.string().optional(),
});

/** Single entry in the type scale — size + matching line-height */
export type TypeScaleEntry = {
  size: string;
  lineHeight: string;
};

export const TypeScaleEntrySchema = z.object({
  size: z.string(),
  lineHeight: z.string(),
});

/** Type slot (which family the intent renders in) */
export type TypeSlot = "display" | "body" | "mono";

export const TypeSlotSchema = z.enum(["display", "body", "mono"]);

/** Type size key from the scale */
export type TypeSizeKey =
  | "xs"
  | "sm"
  | "base"
  | "lg"
  | "xl"
  | "2xl"
  | "3xl"
  | "4xl"
  | "display-1"
  | "display-2";

export const TypeSizeKeySchema = z.enum([
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "display-1",
  "display-2",
]);

/** Type weight key */
export type TypeWeight = "normal" | "medium" | "bold";

export const TypeWeightSchema = z.enum(["normal", "medium", "bold"]);

/** Intent → (slot, size, weight) mapping. Authors write intent in render-ui; skin resolves. */
export type TypeIntent = {
  slot: TypeSlot;
  size: TypeSizeKey;
  weight: TypeWeight;
};

export const TypeIntentSchema = z.object({
  slot: TypeSlotSchema,
  size: TypeSizeKeySchema,
  weight: TypeWeightSchema,
});

export type TypeScale = {
  xs?: TypeScaleEntry;
  sm?: TypeScaleEntry;
  base?: TypeScaleEntry;
  lg?: TypeScaleEntry;
  xl?: TypeScaleEntry;
  "2xl"?: TypeScaleEntry;
  "3xl"?: TypeScaleEntry;
  "4xl"?: TypeScaleEntry;
  "display-1"?: TypeScaleEntry;
  "display-2"?: TypeScaleEntry;
};

export const TypeScaleSchema = z.object({
  xs: TypeScaleEntrySchema.optional(),
  sm: TypeScaleEntrySchema.optional(),
  base: TypeScaleEntrySchema.optional(),
  lg: TypeScaleEntrySchema.optional(),
  xl: TypeScaleEntrySchema.optional(),
  "2xl": TypeScaleEntrySchema.optional(),
  "3xl": TypeScaleEntrySchema.optional(),
  "4xl": TypeScaleEntrySchema.optional(),
  "display-1": TypeScaleEntrySchema.optional(),
  "display-2": TypeScaleEntrySchema.optional(),
});

export type TypeIntentMap = {
  headingMajor?: TypeIntent;
  headingMinor?: TypeIntent;
  bodyEmphasis?: TypeIntent;
  bodyDefault?: TypeIntent;
  bodyQuiet?: TypeIntent;
  caption?: TypeIntent;
  numeric?: TypeIntent;
};

export const TypeIntentMapSchema = z.object({
  headingMajor: TypeIntentSchema.optional(),
  headingMinor: TypeIntentSchema.optional(),
  bodyEmphasis: TypeIntentSchema.optional(),
  bodyDefault: TypeIntentSchema.optional(),
  bodyQuiet: TypeIntentSchema.optional(),
  caption: TypeIntentSchema.optional(),
  numeric: TypeIntentSchema.optional(),
});

/**
 * Type axis — family triplet, size scale, and intent mapping.
 * Determines whether a UI reads as editorial (serif display + sans body),
 * tech (sans + mono numeric), or dense (mono everywhere, tight leading).
 */
export type TypeScaleTokens = {
  /** Heading / display family — every h1–h6 and heading variant renders in it. */
  displayFamily?: string;
  bodyFamily?: string;
  monoFamily?: string;
  /** Stylesheet URL that loads the theme's web fonts (e.g. a Google Fonts css2 URL). */
  fontImport?: string;
  /** Heading voice — CSS `font-weight` for headings (`--heading-weight`). */
  headingWeight?: string;
  /** Heading voice — CSS `text-transform` (`uppercase`, `lowercase`, `none`). */
  headingTransform?: string;
  /** Heading voice — CSS `letter-spacing` (`--heading-tracking`). */
  headingTracking?: string;
  /** Heading voice — CSS `font-style` (`italic` for Victorian/Nouveau voices). */
  headingStyle?: string;
  /** Heading voice — CSS `text-shadow` (glow, emboss, letterpress, misregistration). */
  headingShadow?: string;
  scale?: TypeScale;
  intents?: TypeIntentMap;
};

/**
 * A CSS `font-family` stack is a comma-separated list of family names, each a
 * fully quoted string, an unquoted identifier sequence, or a `var(...)`. A
 * malformed stack (`"A""B"`, `"A"B`) invalidates the whole declaration in the
 * browser and the theme's font silently falls back, so the schema rejects it.
 */
export function isWellFormedFontStack(stack: string): boolean {
  const items: string[] = [];
  let current = '';
  let quote: string | null = null;
  let depth = 0;
  for (const ch of stack) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (quote || depth !== 0) return false;
  items.push(current.trim());
  return items.every(
    (item) =>
      /^"[^"]+"$/.test(item) ||
      /^'[^']+'$/.test(item) ||
      /^-?[A-Za-z][\w-]*( [A-Za-z0-9][\w-]*)*$/.test(item) ||
      /^var\(--[\w-]+(,.*)?\)$/.test(item),
  );
}

const FontStackSchema = z.string().refine(isWellFormedFontStack, {
  message: 'Malformed CSS font-family stack (each family must be comma-separated and fully quoted or bare)',
});

/** Legacy `typography` map: its `font-family*` keys carry font stacks. */
const LegacyTypographySchema = z.record(z.string(), z.string()).superRefine((map, ctx) => {
  for (const [key, value] of Object.entries(map)) {
    if (key.startsWith('font-family') && !isWellFormedFontStack(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `Malformed CSS font-family stack: ${value}` });
    }
  }
});

export const TypeScaleTokensSchema = z.object({
  displayFamily: FontStackSchema.optional(),
  bodyFamily: FontStackSchema.optional(),
  monoFamily: FontStackSchema.optional(),
  fontImport: z.string().optional(),
  headingWeight: z.string().optional(),
  headingTransform: z.string().optional(),
  headingTracking: z.string().optional(),
  headingStyle: z.string().optional(),
  headingShadow: z.string().optional(),
  scale: TypeScaleSchema.optional(),
  intents: TypeIntentMapSchema.optional(),
});

/** Duration palette key */
export type MotionDurationKey =
  | "instant"
  | "fast"
  | "normal"
  | "slow"
  | "dramatic";

export const MotionDurationKeySchema = z.enum([
  "instant",
  "fast",
  "normal",
  "slow",
  "dramatic",
]);

/** Easing palette key */
export type MotionEasingKey = "linear" | "standard" | "emphasized" | "spring";

export const MotionEasingKeySchema = z.enum([
  "linear",
  "standard",
  "emphasized",
  "spring",
]);

/** Per-intent motion specification (duration + easing) */
export type MotionIntent = {
  duration: MotionDurationKey;
  easing: MotionEasingKey;
};

export const MotionIntentSchema = z.object({
  duration: MotionDurationKeySchema,
  easing: MotionEasingKeySchema,
});

export type MotionDurationPalette = {
  instant?: string;
  fast?: string;
  normal?: string;
  slow?: string;
  dramatic?: string;
};

export const MotionDurationPaletteSchema = z.object({
  instant: z.string().optional(),
  fast: z.string().optional(),
  normal: z.string().optional(),
  slow: z.string().optional(),
  dramatic: z.string().optional(),
});

export type MotionEasingPalette = {
  linear?: string;
  standard?: string;
  emphasized?: string;
  spring?: string;
};

export const MotionEasingPaletteSchema = z.object({
  linear: z.string().optional(),
  standard: z.string().optional(),
  emphasized: z.string().optional(),
  spring: z.string().optional(),
});

export type MotionIntentMap = {
  enter?: MotionIntent;
  exit?: MotionIntent;
  hover?: MotionIntent;
  press?: MotionIntent;
  expand?: MotionIntent;
  transition?: MotionIntent;
};

export const MotionIntentMapSchema = z.object({
  enter: MotionIntentSchema.optional(),
  exit: MotionIntentSchema.optional(),
  hover: MotionIntentSchema.optional(),
  press: MotionIntentSchema.optional(),
  expand: MotionIntentSchema.optional(),
  transition: MotionIntentSchema.optional(),
});

/**
 * Motion axis — duration palette + easing palette + per-intent mapping.
 * Mechanical (linear, fast) vs organic (cubic-bezier, medium) vs dramatic (spring, slow).
 */
/**
 * Motion shapes — the transform each animated surface starts its enter from
 * and ends its exit at (opacity always fades). Raw CSS `transform` values:
 * `scale(0.9)`, `translateY(24px)`, `perspective(800px) rotateX(-12deg)`,
 * `none` for a pure fade. Duration/easing still come from the palettes.
 */
export type MotionShapeTokens = {
  /** Dialog enter-from transform (`--motion-modal-enter-from-transform`). */
  modalEnter?: string;
  /** Dialog exit-to transform (`--motion-modal-exit-to-transform`). */
  modalExit?: string;
  /** Popover/menu enter-from transform. */
  popoverEnter?: string;
  /** Popover/menu exit-to transform. */
  popoverExit?: string;
  /** Toast enter-from transform. */
  toastEnter?: string;
  /** Toast exit-to transform. */
  toastExit?: string;
  /** Page (route) content enter-from transform (pages animate in only). */
  pageEnter?: string;
  /** `rise` element-entry enter-from transform (`--motion-enter-rise-from-transform`). */
  enterRise?: string;
  /** `scale` element-entry enter-from transform. */
  enterScale?: string;
  /** `slide` element-entry enter-from transform (inline-start side). */
  enterSlide?: string;
};

export const MotionShapeTokensSchema = z.object({
  modalEnter: z.string().optional(),
  modalExit: z.string().optional(),
  popoverEnter: z.string().optional(),
  popoverExit: z.string().optional(),
  toastEnter: z.string().optional(),
  toastExit: z.string().optional(),
  pageEnter: z.string().optional(),
  enterRise: z.string().optional(),
  enterScale: z.string().optional(),
  enterSlide: z.string().optional(),
});

/**
 * Element-entry vocabulary — how a rendered element animates in when it mounts.
 * One list for both layers: a theme's `motion.entry.default` and a render-ui
 * node's own `enter` (which always wins; `none` opts out).
 */
export const ENTER_ANIMATIONS = ["none", "fade", "rise", "scale", "slide"] as const;
export type EnterAnimation = (typeof ENTER_ANIMATIONS)[number];
export const EnterAnimationSchema = z.enum(ENTER_ANIMATIONS);

/** Stagger steps a node may declare as `enterDelay` (each step = `--motion-enter-stagger`). */
export const ENTER_DELAY_STEPS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export type EnterDelayStep = (typeof ENTER_DELAY_STEPS)[number];

/** Theme-level element entry: the default for slot content + the stagger step. */
export type MotionEntryTokens = {
  /** Entry every slot's content plays when it changes (`--motion-enter-default`); `none` = off. */
  default?: EnterAnimation;
  /** Delay between consecutive staggered entries (`--motion-enter-stagger`), e.g. `40ms`. */
  stagger?: string;
};

export const MotionEntryTokensSchema = z.object({
  default: EnterAnimationSchema.optional(),
  stagger: z.string().optional(),
});

export type MotionTokens = {
  durations?: MotionDurationPalette;
  easings?: MotionEasingPalette;
  intents?: MotionIntentMap;
  /** Per-surface motion shapes (modal, popover, toast, page, element entry). */
  shapes?: MotionShapeTokens;
  /** Element entry: the default for slot content and the stagger step. */
  entry?: MotionEntryTokens;
  /** How long an action must run before its control shows a spinner (`--motion-busy-delay`, e.g. `300ms`). */
  busyDelay?: string;
  /** Whether an empty slot shows the predicted skeleton while its server-backed trait awaits a round trip (`--awaiting-skeleton: on | off`). */
  awaitingSkeleton?: boolean;
};

export const MotionTokensSchema = z.object({
  durations: MotionDurationPaletteSchema.optional(),
  easings: MotionEasingPaletteSchema.optional(),
  intents: MotionIntentMapSchema.optional(),
  shapes: MotionShapeTokensSchema.optional(),
  entry: MotionEntryTokensSchema.optional(),
  busyDelay: z.string().optional(),
  awaitingSkeleton: z.boolean().optional(),
});

/** Icon family selector */
export type IconFamily =
  | "lucide"
  | "phosphor-outline"
  | "phosphor-fill"
  | "phosphor-duotone"
  | "tabler"
  | "fa-solid";

export const IconFamilySchema = z.enum([
  "lucide",
  "phosphor-outline",
  "phosphor-fill",
  "phosphor-duotone",
  "tabler",
  "fa-solid",
]);

/**
 * Iconography axis — icon set + stroke + default size.
 * Outline (Lucide) vs filled (Phosphor-fill) vs duotone (Phosphor-duotone).
 */
export type IconographyTokens = {
  family?: IconFamily;
  strokeWidth?: string;
  defaultSize?: string;
};

export const IconographyTokensSchema = z.object({
  family: IconFamilySchema.optional(),
  strokeWidth: z.string().optional(),
  defaultSize: z.string().optional(),
});

/**
 * Elevation axis — per-layer shadow mapping.
 * Each value references a `--shadow-*` token or a raw CSS shadow value.
 */
export type ElevationTokens = {
  cardElevation?: string;
  popoverElevation?: string;
  dialogElevation?: string;
  toastElevation?: string;
  /** Resting shadow on interactive controls (buttons) — `--elevation-interactive`. */
  interactiveElevation?: string;
  /** Shadow while a control is pressed — `--elevation-pressed` (inset for bevel/neumorphic). */
  pressedElevation?: string;
};

export const ElevationTokensSchema = z.object({
  cardElevation: z.string().optional(),
  popoverElevation: z.string().optional(),
  dialogElevation: z.string().optional(),
  toastElevation: z.string().optional(),
  interactiveElevation: z.string().optional(),
  pressedElevation: z.string().optional(),
});

/**
 * Geometry axis — radius rhythm + border-width rhythm with intent.
 * Sharp (radius 0) vs soft (radius 8/12) vs pill (radius full on interactive).
 */
export type GeometryTokens = {
  radiusContainer?: string;
  radiusInteractive?: string;
  radiusPill?: string;
  borderHairline?: string;
  borderStandard?: string;
  borderHeavy?: string;
  /** CSS `corner-shape` for every rounded box (`round`, `squircle`, `bevel`, `scoop`, `notch`, `superellipse(n)`). */
  cornerShape?: string;
  /** CSS `corner-shape` for pill/circle boxes (`rounded-full`) — keeps avatars round under a bevel theme. */
  cornerShapePill?: string;
  /** CSS `corner-shape` for interactive controls (buttons, inputs) — round controls inside a scoop/notch frame. Falls back to `cornerShape`. */
  cornerShapeInteractive?: string;
  /** CSS `border-style` for every bordered box (`solid`, `dashed`, `double`, `dotted`, `groove`, `ridge`, `inset`, `outset`). */
  borderStyle?: string;
  /** CSS `border-style` for interactive controls (buttons) — `outset` for bevelled chrome. */
  borderStyleInteractive?: string;
};

export const GeometryTokensSchema = z.object({
  radiusContainer: z.string().optional(),
  radiusInteractive: z.string().optional(),
  radiusPill: z.string().optional(),
  borderHairline: z.string().optional(),
  borderStandard: z.string().optional(),
  borderHeavy: z.string().optional(),
  cornerShape: z.string().optional(),
  cornerShapePill: z.string().optional(),
  cornerShapeInteractive: z.string().optional(),
  borderStyle: z.string().optional(),
  borderStyleInteractive: z.string().optional(),
});

/**
 * Surface axis — the material a theme's panels and page are made of: frosted
 * glass (backdrop filter), gloss or paper (card image layers), grid paper,
 * halftone or tessellation (page image layers). Values are raw CSS.
 */
export type SurfaceTokens = {
  /** CSS `backdrop-filter` on card/overlay surfaces (`blur(18px) saturate(1.6)`). */
  backdrop?: string;
  /** CSS `background-image` layered over card surfaces (gloss gradient, grain, paper). */
  cardImage?: string;
  /** CSS `background-image` on the page background (grid paper, halftone, pattern tile). */
  pageImage?: string;
  /** CSS `background-size` for `pageImage`. */
  pageImageSize?: string;
  /** Ground a canvas, chart or diagram draws on (`var(--color-card)`, a chalkboard green, blueprint blue). */
  diagram?: string;
  /** CSS `mask-image` of a band's curved edge (`url("data:image/svg+xml;…")`); `none` = straight edge. */
  edgeMask?: string;
  /** Height of a band's curved edge (`clamp(24px, 6vw, 96px)`). */
  edgeHeight?: string;
  /** CSS `mask-image` tiled as a band texture; the theme's primary color shows through it. */
  textureMask?: string;
  /** CSS `mask-size` for `textureMask`. */
  textureSize?: string;
  /** CSS `background-image` of an accent band (soft mesh, gradient); `none` = flat. */
  accentImage?: string;
  /** CSS `background-image` laid over a photo so text on it stays readable. */
  scrim?: string;
};

export const SurfaceTokensSchema = z.object({
  backdrop: z.string().optional(),
  cardImage: z.string().optional(),
  pageImage: z.string().optional(),
  pageImageSize: z.string().optional(),
  diagram: z.string().optional(),
  edgeMask: z.string().optional(),
  edgeHeight: z.string().optional(),
  textureMask: z.string().optional(),
  textureSize: z.string().optional(),
  accentImage: z.string().optional(),
  scrim: z.string().optional(),
});

export type DiagramLineCap = 'butt' | 'round' | 'square';
export const DiagramLineCapSchema = z.enum(['butt', 'round', 'square']);

export type DiagramLineJoin = 'miter' | 'round' | 'bevel';
export const DiagramLineJoinSchema = z.enum(['miter', 'round', 'bevel']);

/** How a closed mark is filled: a solid fill, a translucent tint, no fill, or hatching. */
export type DiagramFillStyle = 'solid' | 'tint' | 'outline' | 'hatch';
export const DiagramFillStyleSchema = z.enum(['solid', 'tint', 'outline', 'hatch']);

export type DiagramMarker = 'triangle' | 'open' | 'line' | 'dot';
export const DiagramMarkerSchema = z.enum(['triangle', 'open', 'line', 'dot']);

/** Which of the theme's three faces diagram labels are set in. */
export type DiagramLabelFont = 'body' | 'display' | 'mono';
export const DiagramLabelFontSchema = z.enum(['body', 'display', 'mono']);

export type DiagramLabelCase = 'none' | 'uppercase';
export const DiagramLabelCaseSchema = z.enum(['none', 'uppercase']);

/**
 * Diagram axis — how marks are drawn on every drawing surface (canvas, chart, diagram, game
 * board): stroke weights and character, fill treatment, hand-drawn wobble, glow, arrowheads and
 * label voice. Colors ride the `colors` map (`series-1…8`, `diagram-ink/guide/axis/grid/
 * highlight/label/fill`); the ground is `surface.diagram`.
 */
export type DiagramTokens = {
  /** Guide and construction lines. */
  strokeThin?: string;
  /** Ordinary marks. */
  strokeNormal?: string;
  /** Emphasized marks. */
  strokeBold?: string;
  lineCap?: DiagramLineCap;
  lineJoin?: DiagramLineJoin;
  /** Dash pattern of a dashed mark, as space-separated lengths (`6 4`). */
  dash?: string;
  /** Dash pattern of a dotted mark (`1 4`). */
  dot?: string;
  fillStyle?: DiagramFillStyle;
  /** Opacity of a `tint` fill, 0–1. */
  fillOpacity?: string;
  /** Hand-drawn wobble in px; `0` draws exact geometry. */
  roughness?: string;
  /** Glow blur in px around strokes; `0` is none. */
  glow?: string;
  /** CSS box-shadow recipe applied to filled marks (`none`, a hard offset, a soft drop). */
  shadow?: string;
  marker?: DiagramMarker;
  labelFont?: DiagramLabelFont;
  /** A type-scale step (`xs`, `sm`, `base`, …) labels are set at. */
  labelSize?: string;
  labelWeight?: string;
  labelCase?: DiagramLabelCase;
  /** Corner radius of rects and bars in px. */
  corner?: string;
};

const DIAGRAM_TOKEN_KEY_LIST = [
  'strokeThin', 'strokeNormal', 'strokeBold', 'lineCap', 'lineJoin', 'dash', 'dot', 'fillStyle',
  'fillOpacity', 'roughness', 'glow', 'shadow', 'marker', 'labelFont', 'labelSize', 'labelWeight',
  'labelCase', 'corner',
] as const satisfies readonly (keyof DiagramTokens)[];

/** Every `DiagramTokens` key — see `COLOR_TOKEN_KEYS`. */
export const DIAGRAM_TOKEN_KEYS: KeysComplete<DiagramTokens, typeof DIAGRAM_TOKEN_KEY_LIST> = DIAGRAM_TOKEN_KEY_LIST;
export type DiagramTokenKey = (typeof DIAGRAM_TOKEN_KEYS)[number];

export const DiagramTokensSchema = z.object({
  strokeThin: z.string().optional(),
  strokeNormal: z.string().optional(),
  strokeBold: z.string().optional(),
  lineCap: DiagramLineCapSchema.optional(),
  lineJoin: DiagramLineJoinSchema.optional(),
  dash: z.string().optional(),
  dot: z.string().optional(),
  fillStyle: DiagramFillStyleSchema.optional(),
  fillOpacity: z.string().optional(),
  roughness: z.string().optional(),
  glow: z.string().optional(),
  shadow: z.string().optional(),
  marker: DiagramMarkerSchema.optional(),
  labelFont: DiagramLabelFontSchema.optional(),
  labelSize: z.string().optional(),
  labelWeight: z.string().optional(),
  labelCase: DiagramLabelCaseSchema.optional(),
  corner: z.string().optional(),
});

/**
 * Scene axis — the look of 3D drawing surfaces: material response (clay, glass, metal, flat
 * toon) and lighting. Numbers are carried as strings like every other token.
 */
export type SceneTokens = {
  /** 0 (mirror) – 1 (matte). */
  materialRoughness?: string;
  /** 0 (dielectric) – 1 (metal). */
  materialMetalness?: string;
  /** `1` flat-shades every face (low-poly, pixel, toon); `0` smooth. */
  materialFlat?: string;
  /** Toon outline width in px; `0` is none. */
  materialOutline?: string;
  lightAmbient?: string;
  lightKey?: string;
  lightKeyColor?: string;
  /** Depth haze 0–1. */
  fog?: string;
};

const SCENE_TOKEN_KEY_LIST = [
  'materialRoughness', 'materialMetalness', 'materialFlat', 'materialOutline', 'lightAmbient',
  'lightKey', 'lightKeyColor', 'fog',
] as const satisfies readonly (keyof SceneTokens)[];

/** Every `SceneTokens` key — see `COLOR_TOKEN_KEYS`. */
export const SCENE_TOKEN_KEYS: KeysComplete<SceneTokens, typeof SCENE_TOKEN_KEY_LIST> = SCENE_TOKEN_KEY_LIST;
export type SceneTokenKey = (typeof SCENE_TOKEN_KEYS)[number];

export const SceneTokensSchema = z.object({
  materialRoughness: z.string().optional(),
  materialMetalness: z.string().optional(),
  materialFlat: z.string().optional(),
  materialOutline: z.string().optional(),
  lightAmbient: z.string().optional(),
  lightKey: z.string().optional(),
  lightKeyColor: z.string().optional(),
  fog: z.string().optional(),
});

/**
 * Color axis — semantic + surface + feedback color tokens as a typed bundle.
 *
 * Replaces the free-form `colors: Record<string, string>` on `ThemeTokens` for
 * authors targeting the typed SkinSpec entrypoint. Every field maps 1:1 to a
 * `--color-*` CSS custom property emitted by themes. All fields are optional
 * so a partial slice can layer onto a default (light/dark mode pair, etc.).
 */
export type ColorTokens = {
  /* Brand / accent */
  primary?: string;
  primaryHover?: string;
  primaryForeground?: string;
  secondary?: string;
  secondaryHover?: string;
  secondaryForeground?: string;
  accent?: string;
  accentForeground?: string;
  muted?: string;
  mutedForeground?: string;

  /* Surface palette */
  background?: string;
  foreground?: string;
  card?: string;
  cardForeground?: string;
  surface?: string;
  border?: string;
  input?: string;
  ring?: string;

  /* Feedback */
  error?: string;
  errorForeground?: string;
  success?: string;
  successForeground?: string;
  warning?: string;
  warningForeground?: string;
  info?: string;
  infoForeground?: string;

  /* Optional table-specific (themes that ship them; default to neutrals) */
  tableHeader?: string;
  tableBorder?: string;
  tableRowHover?: string;
  surfaceHover?: string;
  borderHover?: string;
  placeholder?: string;

  /* Backdrop dimming behind modals, drawers and lightboxes */
  scrim?: string;
};

/** Rejects the array unless it names every key of `T` — the completeness half
 *  of "one list, derived from the type": `satisfies readonly (keyof T)[]` stops
 *  a non-key, this stops a missing key. */
export type KeysComplete<T, Keys extends readonly (keyof T)[]> =
  Exclude<keyof T, Keys[number]> extends never ? Keys : never;

const COLOR_TOKEN_KEY_LIST = [
  'primary', 'primaryHover', 'primaryForeground', 'secondary', 'secondaryHover', 'secondaryForeground',
  'accent', 'accentForeground', 'muted', 'mutedForeground', 'background', 'foreground',
  'card', 'cardForeground', 'surface', 'border', 'input', 'ring',
  'error', 'errorForeground', 'success', 'successForeground', 'warning', 'warningForeground',
  'info', 'infoForeground', 'tableHeader', 'tableBorder', 'tableRowHover', 'surfaceHover',
  'borderHover', 'placeholder', 'scrim',
] as const satisfies readonly (keyof ColorTokens)[];

/** Every `ColorTokens` key, in declaration order — the ONE list. The zod twin
 *  below, the native theme accessors (`almadar-pattern-sync`
 *  `native-theme-map.ts`) and the `theme-tokens/every-key` fixture that gates
 *  the Rust `ColorTokens` mirror all derive from it (ledger §166). */
export const COLOR_TOKEN_KEYS: KeysComplete<ColorTokens, typeof COLOR_TOKEN_KEY_LIST> = COLOR_TOKEN_KEY_LIST;
export type ColorTokenKey = (typeof COLOR_TOKEN_KEYS)[number];

export const ColorTokensSchema: z.ZodType<ColorTokens> = z.object(
  Object.fromEntries(COLOR_TOKEN_KEYS.map((key) => [key, z.string().optional()])),
);

/**
 * Illustration style preset for empty/loading/error/onboarding states.
 *
 * - `minimal`: icon + short text, no imagery (current default)
 * - `illustrated`: svg illustration library (undraw-style)
 * - `photo`: stock photography
 * - `text-only`: clean text, no imagery
 * - `mascot`: branded character (Mailchimp-style)
 */
export type IllustrationStyle =
  | "minimal"
  | "illustrated"
  | "photo"
  | "text-only"
  | "mascot";

export const IllustrationStyleSchema = z.enum([
  "minimal",
  "illustrated",
  "photo",
  "text-only",
  "mascot",
]);

/**
 * Illustration axis — empty/loading/error/onboarding imagery style.
 * `style` selects the preset; the per-state `*Asset` fields are optional
 * overrides for skins that want to ship custom artwork.
 */
export type IllustrationTokens = {
  style?: IllustrationStyle;
  emptyAsset?: string;
  loadingAsset?: string;
  errorAsset?: string;
  onboardingAsset?: string;
};

const ILLUSTRATION_TOKEN_KEY_LIST = [
  'style', 'emptyAsset', 'loadingAsset', 'errorAsset', 'onboardingAsset',
] as const satisfies readonly (keyof IllustrationTokens)[];

/** Every `IllustrationTokens` key — see `COLOR_TOKEN_KEYS`. */
export const ILLUSTRATION_TOKEN_KEYS: KeysComplete<IllustrationTokens, typeof ILLUSTRATION_TOKEN_KEY_LIST> =
  ILLUSTRATION_TOKEN_KEY_LIST;
export type IllustrationTokenKey = (typeof ILLUSTRATION_TOKEN_KEYS)[number];

export const IllustrationTokensSchema = z.object({
  style: IllustrationStyleSchema.optional(),
  emptyAsset: z.string().optional(),
  loadingAsset: z.string().optional(),
  errorAsset: z.string().optional(),
  onboardingAsset: z.string().optional(),
});

/**
 * Theme tokens - CSS custom properties for design system.
 *
 * Layer 1 visual variation (see docs/Almadar_Std_Variations.md): the original
 * `colors`/`radii`/`spacing`/`typography`/`shadows` Record fields are kept for
 * backward compatibility. The new typed axes (`density`, `typeScale`, `motion`,
 * `iconography`, `elevation`, `geometry`) carry the structured token surface
 * that lets two themes feel like different products, not just different paint.
 */
export type ThemeTokens = {
  /**
   * Color axis — typed semantic + surface + feedback colors.
   * Replaces the free-form `colors` Record below for new authors.
   */
  color?: ColorTokens;
  /** Density axis — spacing rhythm, per-element heights and paddings */
  density?: DensityTokens;
  /** Type axis — family triplet, scale, intent mapping */
  typeScale?: TypeScaleTokens;
  /** Motion axis — duration palette, easing palette, intent mapping */
  motion?: MotionTokens;
  /** Iconography axis — icon family, stroke, default size */
  iconography?: IconographyTokens;
  /** Elevation axis — per-layer shadow mapping */
  elevation?: ElevationTokens;
  /** Geometry axis — radius rhythm, border-width rhythm with intent */
  geometry?: GeometryTokens;
  /** Illustration axis — empty/loading/error state imagery style */
  illustration?: IllustrationTokens;
  /** Surface axis — panel/page material (glass, gloss, paper, pattern) */
  surface?: SurfaceTokens;
  /** Diagram axis — how marks are drawn on every drawing surface */
  diagram?: DiagramTokens;
  /** Scene axis — 3D material and lighting */
  scene?: SceneTokens;

  // ── Legacy free-form maps (pre-Layer-1). Kept for back-compat with
  //    older callers that emit raw `--color-*` / `--radius-*` etc. as
  //    string maps. New authors should use the typed axes above.
  /** @deprecated Use `color` (typed). */
  colors?: Record<string, string>;
  /** @deprecated Use `geometry.radius*` and theme CSS for full radius scale. */
  radii?: Record<string, string>;
  /** @deprecated Use `density.spacing` (typed scale). */
  spacing?: Record<string, string>;
  /** @deprecated Use `typeScale` (typed family + scale + intents). */
  typography?: Record<string, string>;
  /** @deprecated Use `elevation` (typed per-layer mapping). */
  shadows?: Record<string, string>;
};

export const ThemeTokensSchema = z.object({
  color: ColorTokensSchema.optional(),
  density: DensityTokensSchema.optional(),
  typeScale: TypeScaleTokensSchema.optional(),
  motion: MotionTokensSchema.optional(),
  iconography: IconographyTokensSchema.optional(),
  elevation: ElevationTokensSchema.optional(),
  geometry: GeometryTokensSchema.optional(),
  illustration: IllustrationTokensSchema.optional(),
  surface: SurfaceTokensSchema.optional(),
  diagram: DiagramTokensSchema.optional(),
  scene: SceneTokensSchema.optional(),
  // Legacy
  colors: z.record(z.string(), z.string()).optional(),
  radii: z.record(z.string(), z.string()).optional(),
  spacing: z.record(z.string(), z.string()).optional(),
  typography: LegacyTypographySchema.optional(),
  shadows: z.record(z.string(), z.string()).optional(),
});

/**
 * Theme variant - overrides for a specific mode (e.g., dark mode).
 * Mirrors ThemeTokens fields with the same backward-compat + new-axis structure.
 */
export type ThemeVariant = {
  /** Color axis overrides */
  color?: ColorTokens;
  /** Density axis overrides */
  density?: DensityTokens;
  /** Type axis overrides */
  typeScale?: TypeScaleTokens;
  /** Motion axis overrides */
  motion?: MotionTokens;
  /** Iconography axis overrides */
  iconography?: IconographyTokens;
  /** Elevation axis overrides */
  elevation?: ElevationTokens;
  /** Geometry axis overrides */
  geometry?: GeometryTokens;
  /** Illustration axis overrides */
  illustration?: IllustrationTokens;
  /** Surface axis overrides */
  surface?: SurfaceTokens;
  /** Diagram axis overrides */
  diagram?: DiagramTokens;
  /** Scene axis overrides */
  scene?: SceneTokens;

  // ── Legacy free-form maps (pre-Layer-1). See ThemeTokens for guidance.
  /** @deprecated Use `color`. */
  colors?: Record<string, string>;
  /** @deprecated */
  radii?: Record<string, string>;
  /** @deprecated */
  spacing?: Record<string, string>;
  /** @deprecated */
  typography?: Record<string, string>;
  /** @deprecated */
  shadows?: Record<string, string>;
};

export const ThemeVariantSchema = z.object({
  color: ColorTokensSchema.optional(),
  density: DensityTokensSchema.optional(),
  typeScale: TypeScaleTokensSchema.optional(),
  motion: MotionTokensSchema.optional(),
  iconography: IconographyTokensSchema.optional(),
  elevation: ElevationTokensSchema.optional(),
  geometry: GeometryTokensSchema.optional(),
  illustration: IllustrationTokensSchema.optional(),
  surface: SurfaceTokensSchema.optional(),
  diagram: DiagramTokensSchema.optional(),
  scene: SceneTokensSchema.optional(),
  colors: z.record(z.string(), z.string()).optional(),
  radii: z.record(z.string(), z.string()).optional(),
  spacing: z.record(z.string(), z.string()).optional(),
  typography: LegacyTypographySchema.optional(),
  shadows: z.record(z.string(), z.string()).optional(),
});

/**
 * Theme definition - design system for an orbital.
 */
export type ThemeDefinition = {
  /** Theme name */
  name: string;
  /** Human-readable name for theme pickers (e.g. "Art Deco"). */
  displayName?: string;
  /** Base tokens */
  tokens: ThemeTokens;
  /** Named variants (e.g., "dark", "high-contrast") */
  variants?: Record<string, ThemeVariant>;
};

export const ThemeDefinitionSchema = z.object({
  name: z.string().min(1, "Theme name is required"),
  displayName: z.string().optional(),
  tokens: ThemeTokensSchema,
  variants: z.record(z.string(), ThemeVariantSchema).optional(),
});

/**
 * ThemeRef - Theme can be inline definition OR reference to imported theme.
 *
 * Reference format: "Alias.theme"
 */
export type ThemeRef = ThemeDefinition | string;

/**
 * NavItem - a single navigation entry rendered by a layout trait (e.g.
 * `AppShell.traits.AppLayout`'s `navItems`). `label` + `href` are required;
 * `icon`/`badge`/`children`/`roles` are optional shaping knobs an author may set on a
 * call-site override. The `@pages` render sigil yields one entry per root page
 * that declares `@label` (`href = page.path`, `label`, plus its `@icon` and
 * `@roles`), which is assignable to this type. `roles` lists the viewer roles
 * the entry shows for (absent = everyone). `children` nests
 * one level deep — a NavItem with children renders as a group header that
 * expands its children on click rather than navigating directly; a further
 * nested `children` on those entries is not rendered (depth 2 only).
 */
export interface NavItem {
  label: string;
  href: string;
  icon?: string;
  badge?: string;
  children?: NavItem[];
  roles?: string[];
}

/**
 * NavStackEntry - one level of the client-session navigation stack an
 * orbital's pages accumulate. The stack lives client-side (per browser
 * session, keyed per orbital) and is what breadcrumb bands and the
 * `navigate-back` effect read: `href` is the visited page path with route
 * params substituted; `label` is the pushed `crumb` from the navigate
 * effect's options when one was carried, else the page's declared/derived
 * label.
 */
export interface NavStackEntry {
  href: string;
  label: string;
}

/**
 * Checks if a theme reference is a string.
 * 
 * Type guard to determine if a theme reference is a string reference
 * (format: "Alias.theme") rather than an inline theme definition.
 * 
 * @param {ThemeRef} theme - Theme reference to check
 * @returns {boolean} True if theme is a string reference, false otherwise
 * 
 * @example
 * isThemeReference("Ocean.theme"); // returns true
 * isThemeReference({ name: "ocean", colors: {...} }); // returns false
 */
export function isThemeReference(theme: ThemeRef): theme is string {
  return typeof theme === "string";
}

/** Grammar of a registry theme key — the full kebab-case `data-theme` value. */
const THEME_REGISTRY_KEY_PATTERN = "[a-z][a-z0-9]*(-[a-z0-9]+)*";
const THEME_REGISTRY_KEY = new RegExp(`^${THEME_REGISTRY_KEY_PATTERN}$`);

/**
 * True when `theme` is a registry theme key (e.g. "gazette-light") — a value a
 * `[data-theme]` selector can match — as opposed to an inline definition or
 * the legacy "Alias.theme" import form, which must be resolved upstream.
 */
export function isThemeRegistryKey(theme: ThemeRef | undefined): theme is string {
  return typeof theme === "string" && THEME_REGISTRY_KEY.test(theme);
}

/**
 * The `data-theme` key an orbital's `theme` maps to: a string ref is the key
 * itself, an inline definition keys by its `name`, and an absent theme is "".
 * Mirrors orbital-core's `theme_data_key`.
 */
export function themeDataKey(theme: ThemeRef | undefined): string {
  if (theme === undefined) return "";
  if (typeof theme === "string") return theme;
  return theme.name;
}

/**
 * Validate theme reference format: either the legacy import form
 * "Alias.theme" or a registry theme key (the full kebab-case `data-theme`
 * value, e.g. "linear-clean-light") — the form rabit stamps per-orbital and
 * the `.lolo` `theme "<key>"` declarations carry. Mirrors the compiler's
 * `is_valid_theme_reference` acceptance; key existence is validated there,
 * not here.
 */
export const ThemeRefStringSchema = z
  .string()
  .regex(
    new RegExp(`^([A-Z][a-zA-Z0-9]*\\.theme|${THEME_REGISTRY_KEY_PATTERN})$`),
    'Theme reference must be "Alias.theme" or a registry theme key (e.g., "linear-clean-light")',
  );

export const ThemeRefSchema = z.union([
  ThemeDefinitionSchema,
  ThemeRefStringSchema,
]);

// ============================================================================
// SkinSpec — Layer 1 visual variation vocabulary (docs/Almadar_Std_Variations.md §2.3)
// ============================================================================

/**
 * `SkinSpec` is an alias for `ThemeDefinition` — same object, doc-aligned
 * name. The doc refers to a complete eight-axis visual identity as a
 * "SkinSpec"; in the type system it's a `ThemeDefinition` whose `tokens`
 * field carries the eight typed slices (`color`, `density`, `typeScale`,
 * `geometry`, `elevation`, `motion`, `iconography`, `illustration`).
 *
 * There is no separate type — this alias prevents the two surfaces from
 * drifting.
 */
export type SkinSpec = ThemeDefinition;
export const SkinSpecSchema = ThemeDefinitionSchema;

/**
 * Slice-name aliases — the doc and `_contract.md` refer to each axis as
 * `<Name>Slice`. The existing types use `<Name>Tokens`. These aliases let
 * skin authors write the doc's vocabulary while pointing at the single
 * canonical type definition. No forks.
 */
export type ColorSlice = ColorTokens;
export type DensitySlice = DensityTokens;
export type TypeSlice = TypeScaleTokens;
export type GeometrySlice = GeometryTokens;
export type ElevationSlice = ElevationTokens;
export type MotionSlice = MotionTokens;
export type IconographySlice = IconographyTokens;
export type IllustrationSlice = IllustrationTokens;
export type SurfaceSlice = SurfaceTokens;

export const ColorSliceSchema = ColorTokensSchema;
export const DensitySliceSchema = DensityTokensSchema;
export const TypeSliceSchema = TypeScaleTokensSchema;
export const GeometrySliceSchema = GeometryTokensSchema;
export const ElevationSliceSchema = ElevationTokensSchema;
export const MotionSliceSchema = MotionTokensSchema;
export const IconographySliceSchema = IconographyTokensSchema;
export const IllustrationSliceSchema = IllustrationTokensSchema;
export const SurfaceSliceSchema = SurfaceTokensSchema;

// ============================================================================
// Design Tokens (Legacy)
// ============================================================================

/**
 * Design tokens - reusable Tailwind class collections.
 * @deprecated Use ThemeDefinition instead for new code.
 *
 * Instead of repeating raw Tailwind classes everywhere, define once and reference by name.
 * Example: `token: "surfaces.glass"` resolves to the Tailwind classes defined here.
 */
export interface DesignTokens {
  /** Surface styles: backgrounds, borders, shadows */
  surfaces?: Record<string, string>;
  /** Text styles: typography, colors */
  text?: Record<string, string>;
  /** Interactive element styles: buttons, links */
  interactive?: Record<string, string>;
  /** Effect styles: shadows, animations, transitions */
  effects?: Record<string, string>;
  /** Additional custom categories */
  [category: string]: Record<string, string> | undefined;
}

export const DesignTokensSchema = z
  .record(z.string(), z.record(z.string(), z.string()))
  .optional();

// ============================================================================
// Custom Pattern Definitions
// ============================================================================

/**
 * Allowed HTML elements for custom patterns.
 * These are safe, semantic elements for building custom UIs.
 */
export const ALLOWED_CUSTOM_COMPONENTS = [
  "div",
  "span",
  "button",
  "a",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "footer",
  "section",
  "article",
  "nav",
  "main",
  "aside",
  "ul",
  "ol",
  "li",
  "img",
  "label",
  "input",
  "form",
] as const;

export type AllowedCustomComponent = (typeof ALLOWED_CUSTOM_COMPONENTS)[number];

/**
 * Custom pattern definition for app-specific reusable patterns.
 *
 * Register custom designs that can be referenced by name throughout the schema.
 */
export interface CustomPatternDefinition {
  /** Always 'custom' for custom patterns */
  type: "custom";
  /** HTML element to render */
  component: AllowedCustomComponent;
  /** Base Tailwind classes (can include {prop} placeholders) */
  className: string;
  /** Named content slots for nested content */
  slots?: string[];
  /** Configurable props that can be passed when using the pattern */
  props?: string[];
}

export const CustomPatternDefinitionSchema = z.object({
  type: z.literal("custom"),
  component: z.enum(ALLOWED_CUSTOM_COMPONENTS),
  className: z.string(),
  slots: z.array(z.string()).optional(),
  props: z.array(z.string()).optional(),
});

/**
 * Map of custom pattern names to their definitions.
 */
export type CustomPatternMap = Record<string, CustomPatternDefinition>;

export const CustomPatternMapSchema = z
  .record(z.string(), CustomPatternDefinitionSchema)
  .optional();

// ============================================================================
// Type exports
// ============================================================================

export type DomainContextInput = z.input<typeof DomainContextSchema>;
export type DesignPreferencesInput = z.input<typeof DesignPreferencesSchema>;
export type UserPersonaInput = z.input<typeof UserPersonaSchema>;
export type DesignTokensInput = z.input<typeof DesignTokensSchema>;
export type CustomPatternDefinitionInput = z.input<
  typeof CustomPatternDefinitionSchema
>;
export type CustomPatternMapInput = z.input<typeof CustomPatternMapSchema>;
