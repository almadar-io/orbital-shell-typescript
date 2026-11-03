/**
 * Configuration for the pattern sync tool.
 *
 * Contains path configuration, known component-to-pattern name overrides,
 * and category inference rules.
 */

import * as path from "path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Pattern-sync writes generated files, so its target must be the checkout
 * containing this source. A stale ALMADAR_ROOT from another worktree is an error.
 */
const SOURCE_ROOT = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../.."));

export function resolveRepoRoot(requestedRoot?: string): string {
  const root = fs.realpathSync(path.resolve(requestedRoot ?? SOURCE_ROOT));
  if (root !== SOURCE_ROOT) {
    throw new Error(`pattern-sync refused output root ${root}; source checkout is ${SOURCE_ROOT}`);
  }
  return root;
}

export const REPO_ROOT = resolveRepoRoot(process.env.ALMADAR_ROOT);

/** Design system root: the shell-web renderer pack's `src/` (formerly packages/almadar-ui, archived) */
export const DESIGN_SYSTEM_DIR = path.join(
  REPO_ROOT,
  "orbital-rust/crates/orbital-shell-typescript/renderers/web/src",
);

/**
 * Registry `importPath` base: the path of the component's source file under the renderer pack's
 * `src/`, extensionless. Core atoms are `@almadar/shell-web/core/atoms/<Name>`; every other tier
 * keeps its `components/` segment: `@almadar/shell-web/components/<domain>/<tier>/<Name>`.
 */
export const SHELL_WEB_IMPORT_BASE = "@almadar/shell-web/";

/** `@almadar/core` source root (type admissions read from here) */
export const CORE_SRC_DIR = path.join(REPO_ROOT, "orbital-rust/crates/orbital-shell-typescript/core/src");

/** Core components directory */
export const COMPONENTS_DIR = path.join(DESIGN_SYSTEM_DIR, "components");

/** Client components directory */
export const CLIENTS_DIR = path.join(DESIGN_SYSTEM_DIR, "clients");

/** Pattern registry directory (@almadar/core/patterns source) */
export const PATTERNS_DIR = path.join(REPO_ROOT, "orbital-rust/crates/orbital-shell-typescript/core/src/patterns");

/**
 * Known component name → pattern name overrides.
 *
 * Some components have established pattern names that don't follow
 * simple kebab-case conversion. These are preserved for backward
 * compatibility with existing schemas.
 */
export const PATTERN_NAME_OVERRIDES: Record<string, string> = {
  DetailPanel: "detail-panel",
  // (StatCard is an organism with its own props; the `stats` pattern
  // is a compact StatDisplay-shaped widget — mapped to StatDisplay, not here.)
  Form: "form",
  // FormSection omitted — "form-section" is an alias for "form" (see PATTERN_ALIASES)
  FormFields: "form-fields",
  PageHeader: "page-header",
  SearchInput: "search-input",
  FilterGroup: "filter-group",
  EmptyState: "empty-state",
  LoadingState: "loading-state",
  ErrorState: "error-state",
  Toast: "notification",
  ButtonGroup: "form-actions",
  Tabs: "tabs",
  Accordion: "accordion",
  Modal: "modal",
  Drawer: "drawer",
  Pagination: "pagination",
  Breadcrumb: "breadcrumb",
  SplitPane: "split-pane",
  DashboardGrid: "dashboard-grid",
  TabbedContainer: "tabbed-container",
  ModalSlot: "modal-slot",
  DrawerSlot: "drawer-slot",
  // GameCanvas2D/3D are handled correctly by the kebab-case regex now
  GameHud: "game-hud",
  GameControls: "game-controls",
  GameMenu: "game-menu",
  RuntimeDebugger: "runtime-debugger",
  ComponentPatterns: "component-patterns",
  LayoutPatterns: "layout-patterns",
  // Layout stack shorthands — the .orb IR and runtime use the no-hyphen forms
  VStack: "vstack",
  HStack: "hstack",
};

/**
 * Category inference based on component level and name patterns.
 */
export function inferCategory(
  componentName: string,
  level: string,
  existingCategory?: string,
): string {
  // Preserve existing category if available, unless it was misclassified.
  // "form" is wrong for canvas/game components (happened before game category existed).
  const nameLower = componentName.toLowerCase();
  const isGameCanvas = (nameLower.includes("canvas") || nameLower.includes("hud") ||
    nameLower.includes("sprite")) && !nameLower.includes("error") && !nameLower.includes("loading");
  const misclassifiedAsForm = isGameCanvas && existingCategory === "form";
  if (existingCategory && !misclassifiedAsForm) return existingCategory;

  // Templates are always "template"
  if (level === "templates") return "template";

  // Name-based category inference for organisms
  // Game check first: "platformercanvas" contains "form" as substring of "platformer",
  // so game must be checked before form to avoid false classification.
  if (
    nameLower.includes("game") ||
    nameLower.includes("canvas") ||
    nameLower.includes("hud") ||
    nameLower.includes("sprite") ||
    nameLower.includes("hex") ||
    nameLower.includes("tile") ||
    nameLower.includes("board") ||
    nameLower.includes("combat") ||
    nameLower.includes("inventory") ||
    nameLower.includes("dialogue")
  )
    return "game";
  if (
    nameLower.includes("form") ||
    nameLower.includes("input") ||
    nameLower.includes("select")
  )
    return "form";
  if (
    nameLower.includes("table") ||
    nameLower.includes("list") ||
    nameLower.includes("card") ||
    nameLower.includes("detail") ||
    nameLower.includes("stat") ||
    nameLower.includes("meter") ||
    nameLower.includes("chart") ||
    nameLower.includes("grid")
  )
    return "display";
  if (
    nameLower.includes("header") ||
    nameLower.includes("title") ||
    nameLower.includes("hero")
  )
    return "header";
  if (
    nameLower.includes("nav") ||
    nameLower.includes("tab") ||
    nameLower.includes("breadcrumb") ||
    nameLower.includes("pagination") ||
    nameLower.includes("sidebar")
  )
    return "navigation";
  if (
    nameLower.includes("layout") ||
    nameLower.includes("split") ||
    nameLower.includes("master") ||
    nameLower.includes("dashboard") ||
    nameLower.includes("container") ||
    nameLower.includes("slot")
  )
    return "layout";
  if (
    nameLower.includes("modal") ||
    nameLower.includes("drawer") ||
    nameLower.includes("dialog") ||
    nameLower.includes("popup") ||
    nameLower.includes("overlay")
  )
    return "container";
  if (
    nameLower.includes("toast") ||
    nameLower.includes("alert") ||
    nameLower.includes("error") ||
    nameLower.includes("empty") ||
    nameLower.includes("loading") ||
    nameLower.includes("notification")
  )
    return "state";
  if (
    nameLower.includes("search") ||
    nameLower.includes("filter")
  )
    return "filter";
  if (
    nameLower.includes("debug") ||
    nameLower.includes("inspector")
  )
    return "debug";

  // Default based on level
  if (level === "atoms") return "component";
  if (level === "molecules") return "component";
  return "display";
}

/**
 * Map atomic design level to typical size.
 */
export function inferTypicalSize(level: string): string {
  switch (level) {
    case "atoms":
      return "small";
    case "molecules":
      return "medium";
    case "organisms":
      return "large";
    case "templates":
      return "full";
    default:
      return "medium";
  }
}

/**
 * Convert a PascalCase component name to kebab-case pattern name.
 *
 * Handles uppercase runs like "2D", "3D", "UI", "API" correctly:
 *   GameCanvas2D  → game-canvas-2d
 *   GameCanvas3D  → game-canvas-3d
 *   APIGateway    → api-gateway
 */
export function toPatternName(componentName: string): string {
  // Check overrides first
  if (PATTERN_NAME_OVERRIDES[componentName]) {
    return PATTERN_NAME_OVERRIDES[componentName];
  }

  // Convert PascalCase to kebab-case:
  // 1. lowercase→uppercase or lowercase→digit: Canvas2 → canvas-2
  // 2. Acronym boundary: APIGateway → API-Gateway, 3DBattle → 3D-Battle
  // Note: digit→uppercase (2D, 3D) stays together — no hyphen inserted
  return componentName
    .replace(/([a-z])([A-Z\d])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
    .replace(/--+/g, '-');
}

/**
 * Pattern aliases — map one pattern type to another's propsSchema.
 *
 * When the runtime (UISlotRenderer) maps multiple pattern types to the same
 * component, we need the validator to accept the same props for both.
 * The alias gets a copy of the source pattern's full propsSchema.
 */
export const PATTERN_ALIASES: Record<string, string> = {
  "form-section": "form", // Both render the Form component at runtime
  // heading/text aliases removed: the Heading/Text wrapper components were
  // deleted from @almadar/shell-web (redundant with Typography). `typography` is now
  // the sole text-render pattern; behaviors render `type: typography`.
};

/** Files and patterns to skip during scanning */
export const EXCLUDE_FILES = new Set([
  "index.ts",
  "index.tsx",
  // Onboarding chrome — UI for the Studio tutorial, never an orbital render-ui
  // pattern. Excluded so they don't leak into the .orb pattern registry.
  "Coachmark.tsx",
  "OnboardingSpotlight.tsx",
  // Inspector/authoring chrome — the playground's config controls (and their
  // asset/icon/grid sub-pickers). Used directly as React components in the
  // catalog inspector, never composed into an app's orbital render-ui (a
  // PropertyInspector requires a live `config` to inspect, which a factory atom
  // can't supply). Excluded so they don't leak in as std factory behaviors.
  "PropertyInspector.tsx",
  "AssetPicker.tsx",
  "IconPicker.tsx",
  "GridPicker.tsx",
  // Inspector value-editors for structured config (array/object/Map) — same
  // chrome class: they edit a live config value, not an app render-ui pattern.
  "JsonTreeEditor.tsx",
  "NodeSlotEditor.tsx",
  // Editor-chrome sub-components composed INSIDE a mapped molecule, never rendered
  // by a .lolo type: key directly, so they must not leak in as standalone factory
  // patterns: RuleEditor + TraitStateViewer are drawn by ObjectRulePanel / TraitSlot.
  // (VariablePanel / StateJsonView / ObjectRulePanel were promoted to dumb render-ui
  // molecules that the puzzle-board .lolo composes DIRECTLY — the .lolo supplies
  // their props — so they are intentionally NOT excluded anymore.)
  "TraitStateViewer.tsx",
  "RuleEditor.tsx",
]);

export const EXCLUDE_PATTERNS = [
  ".stories.tsx",
  ".stories.ts",
  ".test.tsx",
  ".test.ts",
  ".d.ts",
];

/** Platform types the extractor accepts by exact name; each maps to the registry kinds listed. */
export const PLATFORM_TYPES: Readonly<Record<string, { types: readonly string[]; reason: string }>> = {
  Error: { types: ["object"], reason: "a callback argument that never crosses into .lolo" },
  File: { types: ["object"], reason: "a browser file handle passed to a callback, never authored in .lolo" },
  ErrorInfo: { types: ["object"], reason: "React's error-boundary info argument of an onError callback, never authored in .lolo" },
  "React.KeyboardEvent": { types: ["object"], reason: "a DOM event argument of an onKeyDown callback, never authored in .lolo" },
  "React.MouseEvent": { types: ["object"], reason: "a DOM event argument of an onClick callback, never authored in .lolo" },
};

