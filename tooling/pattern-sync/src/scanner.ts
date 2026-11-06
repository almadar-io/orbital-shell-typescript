/**
 * Component Scanner
 *
 * Recursively walks design-system directories and collects .tsx component files.
 */

import * as fs from "fs";
import * as path from "path";
import {
  COMPONENTS_DIR,
  CLIENTS_DIR,
  CORE_SRC_DIR,
  EXCLUDE_FILES,
  EXCLUDE_PATTERNS,
} from "./config.js";

export interface ScannedFile {
  /** Absolute path to the file */
  absolutePath: string;
  /** Path relative to the design-system root */
  relativePath: string;
  /** Component file name without extension */
  fileName: string;
  /** Atomic design level */
  level: "atoms" | "molecules" | "organisms" | "templates";
  /** Client name if under clients/, undefined for core */
  client?: string;
  /**
   * Restrict which EXPORTED type names this file contributes to the alias /
   * interface registries. Absent = contribute everything (every component file
   * and every wholesale-scanned type module).
   *
   * Needed because registry visibility is otherwise file-granular, and a core
   * module rarely holds only the type you want. `types/entity.ts` declares
   * `ControlValue` — a closed union the generator SHOULD resolve — right beside
   * `EntityDefinition`, core's whole persistence model, which the UI factory
   * deliberately treats as an opaque runtime handle. Scanning the file wholesale
   * resolved both: `Form.entity` expanded into core's schema and `FormFieldsItem`
   * silently became core's `EntityField` instead of the form's own `SchemaField`.
   *
   * This admits names, never shapes — the declaration is still read from core, so
   * the generated `.lolo` follows a core edit instead of drifting from a copy.
   */
  onlyExports?: ReadonlySet<string>;
  /**
   * Contribute this file's TYPES to the alias/interface registries, but never
   * let it become a pattern.
   *
   * `EXCLUDE_FILES` used to do both jobs with one `continue` at collection
   * time, which also made every type those modules export invisible: `TraitSlot`
   * declares `stateMachine?: TraitStateMachineDefinition`, that alias lives in
   * the excluded `TraitStateViewer.tsx`, so it resolved to a shapeless `object`
   * and `lolo-ui` generated `stateMachine : object` on four ui-* behaviors. The
   * public-barrel gate (G7) cannot substitute here — these files ARE exported
   * from the barrels; being exported is not the same as being a render-ui
   * pattern.
   */
  typesOnly?: boolean;
}

const VALID_LEVELS = new Set(["atoms", "molecules", "organisms", "templates"]);
const ATOMIC_LEVELS = [
  "atoms",
  "molecules",
  "organisms",
  "templates",
] as const;

/**
 * Atomic level of a file, inferred from the NEAREST ancestor directory named
 * atoms/molecules/organisms/templates in its path. This is the folder-agnostic
 * replacement for the old `familyDirs × level` / hardcoded `["2d","3d"] × level`
 * loops — a component is classified by whichever tier directory it lives under,
 * regardless of how deep (`core/<tier>/…`, `game/<dim>/<tier>/…`, a future
 * `game/<dim>/<sub>/<tier>/…`). Returns undefined when no tier segment is
 * present (e.g. `game/shared/providers/…`, `shared/lib/…`).
 */
function levelFromPath(relativePath: string): ScannedFile["level"] | undefined {
  const parts = relativePath.split(/[/\\]/);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (VALID_LEVELS.has(parts[i])) {
      return parts[i] as ScannedFile["level"];
    }
  }
  return undefined;
}

/**
 * Scan a directory for .tsx component files, respecting exclusions.
 */
function scanDir(
  dir: string,
  designSystemRoot: string,
  level: string,
  client?: string,
): ScannedFile[] {
  if (!fs.existsSync(dir)) return [];

  const results: ScannedFile[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories (but not node_modules, etc.)
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      results.push(...scanDir(fullPath, designSystemRoot, level, client));
      continue;
    }

    // Accept .tsx (components) AND .ts (shared type modules like
    // `organisms/types.ts` declaring shared entity interfaces —
    // needed so InterfaceRegistry can resolve `EntityDisplayProps<T>` to
    // full element shapes for the ORB_RUI_ELEMENT_SHAPE_MISMATCH rule).
    // Skip .d.ts declaration files.
    if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".d.ts")) continue;

    // Skip excluded file names
    if (EXCLUDE_FILES.has(entry.name)) continue;

    // Skip excluded patterns
    if (EXCLUDE_PATTERNS.some((p) => entry.name.endsWith(p))) continue;

    const fileName = entry.name.replace(/\.tsx?$/, "");

    results.push({
      absolutePath: fullPath,
      relativePath: path.relative(designSystemRoot, fullPath),
      fileName,
      level: level as ScannedFile["level"],
      client,
    });
  }

  return results;
}

/**
 * Recursively collect every component file under `componentsDir`, deriving each
 * file's atomic level from its path (nearest tier ancestor dir). This is the
 * folder-agnostic core scan: it does NOT assume any particular family layout or
 * `game/<dim>/<tier>` nesting depth, so a folder reorg can never silently drop a
 * tier (the Wave-6 dimension move that broke the old hardcoded `["2d","3d"]`
 * loop). Files that sit outside any tier directory (e.g. `game/shared/…`) are
 * collected here with `level: undefined`; the caller fills their level from the
 * public-barrel name→level map — BUT shared/providers/ and shared/lib/ are
 * excluded even when barrel-exported (they're React infra, not patterns).
 */
function collectComponentFiles(
  dir: string,
  designSystemRoot: string,
): Array<ScannedFile | { unleveled: ScannedFile }> {
  if (!fs.existsSync(dir)) return [];
  const results: Array<ScannedFile | { unleveled: ScannedFile }> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      results.push(...collectComponentFiles(fullPath, designSystemRoot));
      continue;
    }

    if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".d.ts")) continue;
    if (EXCLUDE_FILES.has(entry.name)) continue;
    if (EXCLUDE_PATTERNS.some((p) => entry.name.endsWith(p))) continue;

    const relativePath = path.relative(designSystemRoot, fullPath);
    const level = levelFromPath(relativePath);
    const file: ScannedFile = {
      absolutePath: fullPath,
      relativePath,
      fileName: entry.name.replace(/\.tsx?$/, ""),
      level: (level ?? "molecules") as ScannedFile["level"],
    };
    results.push(level ? file : { unleveled: file });
  }

  return results;
}

/**
 * Scan all core components (atoms, molecules, organisms, templates) across the
 * whole `components/` tree, folder-agnostically.
 *
 * Discovery is driven by the ui tree itself: a single recursive walk classifies
 * every component by the tier directory it lives under, no matter how deep
 * (`core/<tier>/…`, `game/<dim>/<tier>/…`, future moves). Files outside any tier
 * dir are admitted only when `@almadar/shell-web`'s public barrels re-export them and
 * they are NOT under shared/providers/ or shared/lib/ (React infra exclusions).
 */
export function scanCoreComponents(
  componentsDir: string = COMPONENTS_DIR,
): ScannedFile[] {
  const designSystemRoot = path.dirname(componentsDir);
  // Core atoms live beside the kernel core (`<root>/core/atoms`), outside `components/`.
  const collected = [
    ...collectComponentFiles(componentsDir, designSystemRoot),
    ...collectComponentFiles(path.join(designSystemRoot, "core", "atoms"), designSystemRoot),
  ];
  const levelByName = getPublicComponentLevels(componentsDir);

  const results: ScannedFile[] = [];
  for (const item of collected) {
    if ("unleveled" in item) {
      // No tier segment in the path — only keep it if a public barrel exports
      // it, and take that barrel's tier so it classifies correctly.
      const barrelLevel = levelByName.get(item.unleveled.fileName);
      if (!barrelLevel) continue;
      // Files under a providers/ lib/ or hooks/ infra directory are React
      // infrastructure (context providers, hooks, pure utilities) — never
      // renderable std patterns, regardless of family (game/providers/,
      // game/lib/, game/hooks/ after the game/shared retirement, or any
      // future <family>/{providers,lib,hooks}/). A real pattern lives under a
      // tier dir (atoms/molecules/…) so it is never `unleveled` here.
      const rp = item.unleveled.relativePath.replace(/\\/g, "/");
      if (/\/(providers|lib|hooks)\//.test(rp)) continue;
      results.push({ ...item.unleveled, level: barrelLevel });
    } else {
      results.push(item);
    }
  }

  return results;
}

/**
 * Scan all client components.
 *
 * @param targetClient If specified, only scan this client
 */
export function scanClientComponents(
  clientsDir: string = CLIENTS_DIR,
  targetClient?: string,
): ScannedFile[] {
  if (!fs.existsSync(clientsDir)) return [];

  const designSystemRoot = path.dirname(clientsDir);
  const results: ScannedFile[] = [];

  const clientDirs = fs.readdirSync(clientsDir, { withFileTypes: true });

  for (const clientEntry of clientDirs) {
    if (!clientEntry.isDirectory()) continue;
    if (targetClient && clientEntry.name !== targetClient) continue;

    const clientName = clientEntry.name;
    const clientDir = path.join(clientsDir, clientName);

    for (const level of VALID_LEVELS) {
      const levelDir = path.join(clientDir, level);
      results.push(
        ...scanDir(levelDir, designSystemRoot, level, clientName),
      );
    }
  }

  return results;
}

/**
 * Scan all components (core + clients).
 */
export function scanAllComponents(
  targetClient?: string,
  coreOnly?: boolean,
): ScannedFile[] {
  const core = scanCoreComponents();
  if (coreOnly) return [...core, ...scanTypeSourceFiles()];

  const clients = scanClientComponents(CLIENTS_DIR, targetClient);
  return [...core, ...scanTypeSourceFiles(), ...clients];
}

/**
 * Type-only source files OUTSIDE `components/` that component props reference.
 *
 * These are never components and never become patterns — they exist purely so
 * `buildInterfaceRegistry` / `buildAliasRegistry` can RESOLVE a prop whose type
 * is declared elsewhere. They reach the registry because `patterns.ts` passes
 * the unfiltered scan as the registry source while parsing only files present
 * in the public barrels, so anything here is filtered out of the component set
 * by `publicExports` (same mechanism that already admits
 * `components/core/organisms/types.ts`).
 *
 * Why `lib/` specifically: `Canvas.tsx` types its props with `CanvasLighting` /
 * `CanvasPost` / `DrawableNode`, all declared under `lib/drawable/`. With that
 * directory unscanned the registry could not resolve them, the parser emitted a
 * shapeless `{ types: ["object"] }` with no `properties`, and `lolo-ui` had
 * nothing to mint a struct alias from — which surfaced as 2885
 * ORB_T_CONFIG_OBJECT_ARRAY_FORBIDDEN errors across 240 behaviors, all of them
 * generated files whose authors never wrote the offending knob.
 *
 * `level` is required by the interface but meaningless here — the registry
 * builders read only `absolutePath`, and these files never enter the parsed set.
 */
export function scanTypeSourceFiles(): ScannedFile[] {
  const roots = [
    // Outside `components/` entirely — never walked by the component scan.
    path.join(path.dirname(COMPONENTS_DIR), "lib"),
    // The kernel core's own lib/types (`BandEdge`, atlas slices, …) that core atoms' props name.
    path.join(path.dirname(COMPONENTS_DIR), "core", "lib"),
    path.join(path.dirname(COMPONENTS_DIR), "core", "types"),
    // Inside `components/` but with no tier segment in the path, so
    // `scanCoreComponents` classifies it "unleveled" and drops it unless a
    // public barrel exports it — which a type-only module never is. Same
    // failure as `lib/`, one directory over: `avl/types/avl-canvas-types.ts`
    // declares `AvlNodeData` (8 real fields), and without it `ModuleCard.data`
    // and `BehaviorView.data` resolved to a shapeless `object`.
    ...findTypeDirs(COMPONENTS_DIR),
    // `@almadar/core`'s SHARED payload types. A prop typed
    // `EventEmit<ItemActionPayload>` is the correct, non-duplicating way to
    // declare a bus payload, but the alias lived outside every scan root, so
    // `serializePayloadSchema` could not resolve it and fell through to the
    // opaque `_payload` — i.e. doing the right thing produced a worse schema
    // than inlining the shape. One FILE, not the directory: `patterns/` also
    // holds the generated `pattern-types.ts` and the registry types, none of
    // which should reach the interface registry.
    path.join(CORE_SRC_DIR, "patterns", "payloads.ts"),
    // Same story for the shared asset/scene types. `Camera` is a concrete
    // 7-field interface, but every unrecognised `@almadar/core` import is
    // treated as an opaque passthrough (`coreImports.has(typeName)`), so
    // `camera` degraded to `freeform` → `json` on 4 canvas patterns and ~940
    // composed warnings. The interface-registry lookup runs BEFORE that
    // fallback, so making the declaration visible is enough — the heuristic
    // never gets the chance to fire.
    path.join(CORE_SRC_DIR, "types", "asset.ts"),
    // Same story for the agent-trace view-model. `SubagentTracePanel`'s
    // `subagents`/`coordinatorMessages` props are typed `TraceSubagent[]` /
    // `readonly TraceChatMessage[]` — real, well-shaped interfaces — but
    // they live outside every scan root, so they degraded to an actionable
    // shapeless gap instead of resolving to their real fields.
    path.join(CORE_SRC_DIR, "agent-trace-view.ts"),
  ];
  const out: ScannedFile[] = [];
  const seen = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "__tests__") continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.(test|spec|d)\.tsx?$/.test(entry.name)) continue;
      if (seen.has(full)) continue;
      seen.add(full);
      out.push({
        absolutePath: full,
        relativePath: path.relative(path.dirname(COMPONENTS_DIR), full),
        fileName: entry.name.replace(/\.(ts|tsx)$/, ""),
        level: "atoms",
        typesOnly: true,
      });
    }
  };
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    // A root may be a single FILE (see the `payloads.ts` entry above) — walking
    // its parent directory would drag in siblings we deliberately exclude.
    if (fs.statSync(root).isDirectory()) {
      walk(root);
      continue;
    }
    if (seen.has(root)) continue;
    seen.add(root);
    out.push({
      absolutePath: root,
      relativePath: path.relative(path.dirname(COMPONENTS_DIR), root),
      fileName: path.basename(root).replace(/\.(ts|tsx)$/, ""),
      level: "atoms",
    });
  }
  return [...out, ...scanAdmittedCoreTypes(seen), ...scanExcludedTypeBearers(seen)];
}

/**
 * The `EXCLUDE_FILES` component modules, as TYPE sources only.
 *
 * They are excluded from the pattern set for a good reason (editor chrome, not
 * a render-ui pattern), but the types they export are referenced by the props of
 * files that ARE patterns. Marked `typesOnly` so they feed the registries and
 * nothing else.
 */
function scanExcludedTypeBearers(seen: Set<string>): ScannedFile[] {
  const out: ScannedFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "__tests__") continue;
        walk(full);
        continue;
      }
      if (!EXCLUDE_FILES.has(entry.name)) continue;
      if (seen.has(full)) continue;
      seen.add(full);
      out.push({
        absolutePath: full,
        relativePath: path.relative(path.dirname(COMPONENTS_DIR), full),
        fileName: entry.name.replace(/\.(ts|tsx)$/, ""),
        level: "atoms",
        typesOnly: true,
      });
    }
  };
  if (fs.existsSync(COMPONENTS_DIR)) walk(COMPONENTS_DIR);
  return out;
}

/**
 * Core modules contributing only NAMED types to the registries.
 *
 * The wholesale entries above work when a module holds nothing but types the
 * generator should resolve. These modules do not: the type we need sits beside
 * types the UI factory must keep opaque, and registry visibility is otherwise
 * all-or-nothing per file.
 *
 * Keyed by module → the exported names admitted from it. Shapes are still read
 * from core, so this cannot drift from core's definition the way a transcribed
 * copy would; it only says WHICH declarations the generator is allowed to see.
 */
const CORE_TYPE_ADMISSIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
  // `ControlValue` — the CLOSED set a form control puts on the bus. Left
  // unresolved it fell to the `coreImports.has(typeName)` passthrough in
  // `parser.ts`, so `Form.onFieldChange`'s `value: ControlValue` published
  // `types:["object"]`, `lolo-ui` generated `value : object!`, and composition
  // inlined that into 134 consumer traits.
  //
  // Admitted BY NAME, not by file: `entity.ts` also declares `EntityDefinition`
  // (core's persistence model, deliberately an opaque runtime handle to the UI
  // factory) and the recursive `FieldValue`. Scanning the module wholesale
  // resolved those too — `Form.entity` expanded into core's schema and
  // `FormFieldsItem` silently became core's `EntityField` instead of the form's
  // own `SchemaField`. `FieldValue` is deliberately NOT admitted: it is
  // genuinely open, so the opaque reading is the correct one.
  ["types/entity.ts", ["ControlValue"]],
  // `FileValue` is `ControlValue`'s one struct member; without it the union's
  // file arm cannot resolve. Nothing else here is admitted — `field.ts` owns
  // `EntityField`, which collides with component-side field descriptors.
  ["types/field.ts", ["FileValue"]],
  // The agent trace a feed renders: a closed tagged union of concrete
  // variants (`TraceActivity`) and the shapes its variants name.
  ["agent-trace-view.ts", ["TraceActivity", "TraceAvatarRole", "TraceFileOperation", "TraceDiffLine", "TraceDiffHunk", "AppToolKind"]],
  ["types/sse.ts", ["LlmCallMeta"]],
  ["types/changeset.ts", ["SemanticChangeKind"]],
  // The roles a drawn mark carries (`LearningShape extends DiagramMarkRoles`): without them a
  // canvas shape's `tone`/`stroke`/`textSize` never reach the generated struct items, so .lolo
  // could only style a mark with literals.
  ["types/canvas-theme.ts", ["DiagramMarkRoles", "DiagramTone", "DiagramStrokeWeight", "DiagramTextSize", "DiagramTextCase"]],
  ["types/domain.ts", ["DiagramLabelFont", "DiagramFillStyle"]],
  // A canvas selection's address in the resolved program (`SelectedPattern.focus`).
  ["render-ui-edit.ts", ["EditFocus", "EditFocusLevel"]],
  // A played circuit step (`AvlPlayStep.result`, the cosmic scene `.lolo` replays).
  ["types/verification.ts", ["CircuitStepResult", "EffectTrace", "EventLogEntry", "GuardEvaluation"]],
  ["types/expression.ts", ["EvalStep", "EvalTrace"]],
];

function scanAdmittedCoreTypes(seen: Set<string>): ScannedFile[] {
  const coreSrc = CORE_SRC_DIR;
  const out: ScannedFile[] = [];
  for (const [rel, names] of CORE_TYPE_ADMISSIONS) {
    const full = path.join(coreSrc, ...rel.split("/"));
    if (!fs.existsSync(full) || seen.has(full)) continue;
    seen.add(full);
    out.push({
      absolutePath: full,
      relativePath: path.relative(path.dirname(COMPONENTS_DIR), full),
      fileName: path.basename(full).replace(/\.(ts|tsx)$/, ""),
      level: "atoms",
      onlyExports: new Set(names),
    });
  }
  return out;
}

/** Every `types/` directory nested anywhere under `root`. */
function findTypeDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      const full = path.join(dir, entry.name);
      // `types` AND `lib`: both hold type-only modules that component props
      // reference. `components/avl/types/avl-canvas-types.ts` declares
      // `AvlNodeData`, whose members are typed by `FieldInfo` / `TraitLevelData`
      // / `ExternalLink` from the sibling `components/avl/lib/avl-schema-parser`
      // — unscanned, so five members of `behavior-view.data` and `module-card.data`
      // resolved to a shapeless `[object]`. Only the top-level `lib/` was scanned;
      // a nested one was not.
      if (entry.name === "types" || entry.name === "lib") out.push(full);
      else walk(full);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

/**
 * Walk a barrel file and any `export * from './sub'` re-exports transitively,
 * collecting every component-style identifier the package surfaces publicly.
 *
 * Tracks visited paths to avoid cycles. Resolves star re-exports against
 * `index.ts` / `index.tsx` / a `.ts` sibling — matching how Node/Vite
 * resolve the bare specifier.
 *
 * G7 — the pattern registry is restricted to names reachable from the
 * design system's level barrels so the generated
 * `import { X } from '@almadar/shell-web/components'` references in codegen
 * always resolve.
 */
function readBarrelExportsTransitive(
  barrelPath: string,
  visited: Set<string>,
  out: Set<string>,
  level?: ScannedFile["level"],
  levelByName?: Map<string, ScannedFile["level"]>,
): void {
  if (visited.has(barrelPath)) return;
  visited.add(barrelPath);
  if (!fs.existsSync(barrelPath)) return;
  const src = fs.readFileSync(barrelPath, "utf8");

  // The tier a name belongs to is the tier of the barrel that DIRECTLY exports
  // it — derived from this barrel file's own path when it sits under a tier dir
  // (`game/2d/molecules/index.ts` → molecules), else the inherited tier. This is
  // what lets a molecule re-exported from a mis-placed `core/atoms` barrel still
  // record as `molecules` (the ui package re-exports game/2d/molecules from
  // core/atoms; the authoritative tier is the source barrel's, not the importer's).
  const barrelLevel =
    levelFromPath(path.basename(path.dirname(barrelPath))) ?? level;

  const record = (name: string): void => {
    out.add(name);
    if (barrelLevel && levelByName && !levelByName.has(name)) {
      levelByName.set(name, barrelLevel);
    }
  };

  const namedExportRe = /export\s*(?:type)?\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = namedExportRe.exec(src)) !== null) {
    const inner = m[1];
    for (const raw of inner.split(",")) {
      const part = raw.trim();
      if (!part) continue;
      const stripped = part.replace(/^type\s+/, "");
      const alias = stripped.split(/\s+as\s+/i).pop()!.trim();
      if (alias) record(alias);
    }
  }

  const declExportRe = /export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = declExportRe.exec(src)) !== null) {
    record(m[1]);
  }

  const starRe = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g;
  const dir = path.dirname(barrelPath);
  while ((m = starRe.exec(src)) !== null) {
    const spec = m[1];
    if (!spec.startsWith(".")) continue;
    const bare = spec.replace(/\.js$/, "");
    const candidates = [
      path.resolve(dir, `${bare}.ts`),
      path.resolve(dir, `${bare}.tsx`),
      path.resolve(dir, `${spec}.ts`),
      path.resolve(dir, `${spec}.tsx`),
      path.resolve(dir, spec, "index.ts"),
      path.resolve(dir, spec, "index.tsx"),
    ];
    const resolved = candidates.find((p) => fs.existsSync(p));
    if (resolved) {
      // Pass THIS barrel's resolved tier as the inherited default; the callee
      // re-derives from its own path if it sits under a tier dir. A sub-barrel
      // with no tier of its own (a passthrough `index.ts`) keeps the nearest
      // tier seen so far.
      readBarrelExportsTransitive(resolved, visited, out, barrelLevel, levelByName);
    }
  }
}

/**
 * Recursively find every `patterns.ts` metadata barrel under `componentsDir`.
 * These are curated lists of public pattern component names (the historical
 * `game/three/patterns.ts` was one). Discovering them by walk — not a fixed
 * path — means a `patterns.ts` is honored wherever it lives, present or future.
 */
function findPatternsMetadataFiles(componentsDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "__tests__") continue;
        walk(path.join(dir, entry.name));
      } else if (entry.name === "patterns.ts") {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  walk(componentsDir);
  return out;
}

/**
 * Build the public-component name set AND a name→tier map in one pass. The
 * registry is restricted to this set so codegen-emitted `import { X }`
 * references resolve at consumer-build time, and the tier map lets the core
 * scan classify publicly-exported files that sit outside a tier directory
 * (e.g. `game/shared/providers/GameAudioProvider.tsx`).
 *
 * Discovery is folder-agnostic — two sources, both driven by the ui tree:
 *  1. The four `core/<tier>/index.ts` level barrels, followed transitively
 *     through every `export * from './sub'`. These mirror the published root
 *     surface (`core/molecules → ../game/2d/molecules`, named avl/markdown
 *     re-exports, …) and exclude internal-only barrels the root never exposed.
 *  2. Every `patterns.ts` curated metadata barrel found by RECURSIVELY walking
 *     `componentsDir`. `patterns.ts` is the source of truth for the code-split
 *     optional surfaces (the 3D / Three.js render-ui patterns) that are kept
 *     out of the main barrel; listing them here gives them factories without
 *     admitting the scene internals (Lighting3D, ModelLoader, …) that ship alongside.
 *     Walking — instead of a fixed `game/.../three/patterns.ts` path — means a
 *     folder reorg can never silently drop them (the Wave-6 break).
 */
function buildPublicSurface(componentsDir: string): {
  names: Set<string>;
  levelByName: Map<string, ScannedFile["level"]>;
} {
  const names = new Set<string>();
  const levelByName = new Map<string, ScannedFile["level"]>();
  const visited = new Set<string>();

  for (const level of ATOMIC_LEVELS) {
    const barrel = path.join(componentsDir, "core", level, "index.ts");
    readBarrelExportsTransitive(barrel, visited, names, level, levelByName);
  }

  // Core atoms: the kernel-core barrel (`<root>/core/index.ts`) re-exports each atom file; only
  // its `./atoms/*` exports are components (the rest are hooks, lib and providers).
  const coreBarrel = path.join(path.dirname(componentsDir), "core", "index.ts");
  if (fs.existsSync(coreBarrel)) {
    const barrelSrc = fs.readFileSync(coreBarrel, "utf8");
    for (const m of barrelSrc.matchAll(/export\s*(\*|(?:type\s*)?\{([^}]*)\})\s*from\s*['"](\.\/atoms\/[^'"]+)['"]/g)) {
      const [, , named, spec] = m;
      if (named !== undefined) {
        for (const raw of named.split(",")) {
          const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/i).pop()!.trim();
          if (!name) continue;
          names.add(name);
          if (!levelByName.has(name)) levelByName.set(name, "atoms");
        }
        continue;
      }
      const file = path.resolve(path.dirname(coreBarrel), spec.replace(/\.js$/, ""));
      const resolved = [`${file}.tsx`, `${file}.ts`].find((p) => fs.existsSync(p));
      if (resolved) readBarrelExportsTransitive(resolved, visited, names, "atoms", levelByName);
    }
  }

  for (const patternsFile of findPatternsMetadataFiles(componentsDir)) {
    // A curated `patterns.ts` may live under a tier dir (take that tier) or at
    // the family root (take the tier from the re-exported source path).
    const ownLevel = levelFromPath(path.relative(path.dirname(componentsDir), patternsFile));
    readBarrelExportsTransitive(patternsFile, visited, names, ownLevel, levelByName);
  }

  return { names, levelByName };
}

/**
 * Union of public component names — the registry gate set. See
 * `buildPublicSurface` for how discovery is folder-agnostic.
 */
export function getPublicComponentExports(
  componentsDir: string = COMPONENTS_DIR,
): Set<string> {
  return buildPublicSurface(componentsDir).names;
}

/**
 * Name→tier map for the public surface — used to classify publicly-exported
 * component files that live outside a tier directory.
 */
export function getPublicComponentLevels(
  componentsDir: string = COMPONENTS_DIR,
): Map<string, ScannedFile["level"]> {
  return buildPublicSurface(componentsDir).levelByName;
}
