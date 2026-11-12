/**
 * Registry Writer
 *
 * Merges parsed components into the existing pattern registry,
 * component mapping, and event contracts JSON files.
 */

import * as fs from "fs";
import * as path from "path";
import { PATTERNS_DIR, SHELL_WEB_IMPORT_BASE, REPO_ROOT, toPatternName, inferCategory, inferTypicalSize, PATTERN_ALIASES } from "./config.js";
import { withEntryProps } from "./entry-props.js";
import { withSkeletonProps } from "./skeleton-props.js";
import { withA11yProps } from "./a11y-props.js";
import type {
  ParsedComponent,
  PatternEntry,
  MappingEntry,
  EventContractEntry,
  SyncReport,
} from "./types.js";
import patternTileGeometry from "./pattern-tile-geometry-source.json" with { type: "json" };
import gameFontFamilies from "./game-font-families-source.json" with { type: "json" };

interface RegistryFile {
  version: string;
  exportedAt: string;
  patterns: Record<string, PatternEntry>;
}

interface MappingFile {
  version: string;
  exportedAt: string;
  mappings: Record<string, MappingEntry>;
}

interface ContractFile {
  version: string;
  exportedAt: string;
  project?: string;
  contracts: Record<string, EventContractEntry>;
}

/**
 * Read and parse a JSON file, returning a default if it doesn't exist.
 */
function readJSON<T>(filePath: string, defaultValue: T): T {
  if (!fs.existsSync(filePath)) return defaultValue;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

/**
 * Components that require a fully-qualified @almadar/shell-web subpath import
 * instead of the main barrel. These are intentionally excluded from the
 * barrel to avoid pulling in heavy optional dependencies (Three.js, etc.).
 * Key = component name, value = package subpath.
 */
const NON_BARREL_IMPORTS: Record<string, string> = {};

/**
 * Build import path from a parsed component.
 * Components listed in NON_BARREL_IMPORTS use fully-qualified @almadar/shell-web
 * subpaths so the compiler doesn't rewrite them to the main barrel (which
 * doesn't export them).
 */
function buildImportPath(component: ParsedComponent): string {
  if (component.client) {
    return `@/clients/${component.client}/${component.level}/${component.componentName}`;
  }

  // Check for non-barrel components
  if (NON_BARREL_IMPORTS[component.componentName]) {
    return NON_BARREL_IMPORTS[component.componentName];
  }

  // For secondary components extracted from a multi-component file (e.g. VStack
  // from Stack.tsx), the import path must reference the FILE stem, not the
  // component name, so the generated import resolves correctly.
  const fileStem = path.basename(component.relativePath).replace(/\.tsx?$/, "");
  const importTarget = fileStem !== component.componentName ? fileStem : component.componentName;

  // `relativePath` is relative to the design-system root (the renderer pack's `src/`), so it
  // starts with `components/` (every tier but core atoms) or `core/` (core atoms). The import
  // path mirrors that physical location. Nested dirs between the root and the tier segment are
  // kept (`core/` in `components/core/molecules/FormSection.tsx`) so secondary exports
  // (FormActions, FormLayout) resolve to the file that declares them.
  const relParts = path.dirname(component.relativePath).replace(/\\/g, "/").split("/");
  const levelIdx = relParts.lastIndexOf(component.level);
  const subDirPrefix = levelIdx > 0 ? relParts.slice(0, levelIdx).join("/") + "/" : "";

  return `${SHELL_WEB_IMPORT_BASE}${subDirPrefix}${component.level}/${importTarget}`;
}

/**
 * Generate suggested-for keywords from component name and description.
 */
function generateSuggestedFor(component: ParsedComponent): string[] {
  const keywords: string[] = [];
  const name = component.componentName.toLowerCase();

  // Add words from name split by uppercase
  const words = component.componentName
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase()
    .split(/\s+/);
  keywords.push(...words.filter((w) => w.length > 2));

  // Add a joined phrase
  keywords.push(words.join(" "));

  return [...new Set(keywords)];
}

/**
 * Convert a ParsedComponent to a PatternEntry.
 */
export function toPatternEntry(
  component: ParsedComponent,
  existingEntry?: PatternEntry,
): PatternEntry {
  const propsSchema: PatternEntry["propsSchema"] = {};

  for (const prop of component.props) {
    propsSchema[prop.name] = {
      types: prop.types,
      description: prop.description || `${prop.name} prop`,
      ...(prop.required ? { required: true } : {}),
      ...(prop.enumValues && prop.enumValues.length > 0
        ? { enumValues: prop.enumValues }
        : {}),
      ...(prop.numericEnumValues && prop.numericEnumValues.length > 0
        ? { numericEnumValues: prop.numericEnumValues }
        : {}),
      ...(prop.mapKeyEnum ? { mapKeyEnum: prop.mapKeyEnum } : {}),
      ...(prop.tupleItems ? { tupleItems: prop.tupleItems } : {}),
      ...(prop.kind ? { kind: prop.kind } : {}),
      ...(prop.of ? { of: prop.of } : {}),
      ...(prop.eventField ? { eventField: prop.eventField } : {}),
      ...(prop.payloadFor ? { payloadFor: prop.payloadFor } : {}),
      ...(prop.changedBy ? { changedBy: prop.changedBy } : {}),
      ...(prop.itemKind ? { itemKind: prop.itemKind } : {}),
      ...(prop.entityRowField ? { entityRowField: prop.entityRowField } : {}),
      ...(prop.cardinality ? { cardinality: prop.cardinality } : {}),
      ...(prop.decoder ? { decoder: prop.decoder } : {}),
      ...(prop.notification ? { notification: true } : {}),
      ...(prop.requiredFields && prop.requiredFields.length > 0 ? { requiredFields: prop.requiredFields } : {}),
      ...(prop.emitPayloadSchema ? { emitPayloadSchema: prop.emitPayloadSchema } : {}),
      ...(prop.listenPayloadSchema ? { listenPayloadSchema: prop.listenPayloadSchema } : {}),
      ...(prop.callbackArgs ? { callbackArgs: prop.callbackArgs } : {}),
      ...(prop.renderCallback ? { renderCallback: true } : {}),
      ...(prop.nonEmittable ? { nonEmittable: true } : {}),
      ...(prop.nonAuthorable ? { nonAuthorable: true } : {}),
      ...(prop.items ? { items: prop.items } : {}),
      ...(prop.mapValue ? { mapValue: prop.mapValue } : {}),
      ...(prop.properties ? { properties: prop.properties } : {}),
      ...(prop.propertyRequired && prop.propertyRequired.length > 0
        ? { propertyRequired: prop.propertyRequired }
        : {}),
      ...(prop.dateLike ? { dateLike: true } : {}),
      ...(prop.scenePos ? { scenePos: true } : {}),
      ...(prop.drawableSlot ? { drawableSlot: true } : {}),
      ...(prop.controlValue ? { controlValue: true } : {}),
      ...(prop.eventPayloadBrand ? { eventPayloadBrand: true } : {}),
      ...(prop.variants ? { variants: prop.variants } : {}),
      ...(prop.discriminator ? { discriminator: prop.discriminator } : {}),
      ...(prop.default !== undefined ? { default: prop.default } : {}),
      ...(prop.example !== undefined ? { example: prop.example } : {}),
      ...(prop.synonyms ? { synonyms: prop.synonyms } : {}),
      ...(prop.tier ? { tier: prop.tier } : {}),
    };
  }

  Object.assign(propsSchema, withEntryProps(propsSchema));
  Object.assign(propsSchema, withSkeletonProps(propsSchema, component.props.some((p) => p.name === "skeleton" && p.skeletonSpec === true)));
  Object.assign(propsSchema, withA11yProps(propsSchema, component.forwardsA11y === true));

  const patternName = toPatternName(component.componentName);
  // Path-based category override: components under any `game/` sub-folder
  // are game components regardless of name (e.g. ActionPalette, ResourceBar,
  // ItemSlot, TurnPanel). Without this, they default to `display`, which
  // routes their `actions:` prop through the `label/event/variant` Almadar
  // action shape, breaking the component's typed SlotItemData / etc shapes.
  const isUnderGameFolder = component.relativePath.includes('/game/');
  const isLearningFamily = component.family === 'learning';
  // AVL draws programs, never games: its editor canvas must not fall into the
  // name-inferred `game` vocabulary (FlowCanvas, 2026-10-09).
  const isAvlFamily = component.family === 'avl';
  const avlExisting = existingEntry?.category === 'game' ? undefined : existingEntry?.category;
  const category = isLearningFamily
    ? 'learning'
    : isUnderGameFolder
      ? 'game'
      : isAvlFamily
        ? (avlExisting ?? 'display')
        : inferCategory(
            component.componentName,
            component.level,
            existingEntry?.category,
          );

  // A pattern is DRAWABLE when its props are grounded in core `ScenePos` — a
  // `position: ScenePos` (atoms) or a `-layer` whose `items` element carries one
  // (molecules). Derived by the `scenePos` type-identity tag pattern-sync stamps
  // (see parser's `ScenePos` case), NOT by name/signal — the one contract the
  // orbital-rust validator reads to gate a draw-host canvas's `children`.
  const drawable = Object.values(propsSchema).some(propGroundsDrawable);

  // A pattern is a canvas DRAW-HOST when it declares a slot of drawables — a prop
  // typed `DrawableNode[]` (the host's authored `children`). Derived from the
  // `drawableSlot` type-identity tag (see parser's `DrawableNode` case), NOT a name
  // or hand-marker. UISlotRenderer reads this to route authored `children` into the
  // host's `drawables` prop (painted) instead of DOM-wrapping them.
  const drawHost = Object.values(propsSchema).some(propHostsDrawables);

  return {
    type: patternName,
    category,
    ...(patternName === "pattern-tile" ? { geometry: patternTileGeometry } : {}),
    sourceFile: component.relativePath,
    tier: component.level,
    ...(component.family ? { family: component.family } : {}),
    ...(component.dimension ? { dimension: component.dimension } : {}),
    // Curated-at-source (`@capabilities` present): the component JSDoc is
    // authoritative — no registry stickiness. Otherwise legacy behavior: an
    // existing registry description wins.
    description: component.capabilities
      ? component.description
      : existingEntry?.description || component.description,
    ...(component.capabilities ? { capabilities: component.capabilities } : {}),
    ...(component.fieldsContract ? { fieldsContract: component.fieldsContract } : {}),
    ...(component.minUsableWidth !== undefined ? { minUsableWidth: component.minUsableWidth } : {}),
    ...(component.layoutOnly ? { layoutOnly: true } : {}),
    ...(component.accessibleName ? { accessibleName: component.accessibleName } : {}),
    suggestedFor:
      existingEntry?.suggestedFor || generateSuggestedFor(component),
    typicalSize:
      existingEntry?.typicalSize || inferTypicalSize(component.level),
    propsSchema,
    ...(drawable ? { drawable: true } : {}),
    ...(drawHost ? { drawHost: true } : {}),
    ...(component.client ? { client: component.client } : {}),
  };
}

export function writePatternTileGeometry(dryRun: boolean): string {
  const outputPath = path.join(PATTERNS_DIR, "pattern-tile-geometry.json");
  if (!dryRun) fs.writeFileSync(outputPath, `${JSON.stringify(patternTileGeometry, null, 2)}\n`);
  return outputPath;
}

export function writeGameFontFamilies(dryRun: boolean): string[] {
  const outputPaths = [
    path.join(PATTERNS_DIR, "game-font-families.json"),
    path.join(REPO_ROOT, "orbital-rust/crates/orbital-shell-rust/renderers/dioxus/assets/game-font-families.json"),
  ];
  if (!dryRun) {
    const body = `${JSON.stringify(gameFontFamilies, null, 2)}\n`;
    for (const outputPath of outputPaths) fs.writeFileSync(outputPath, body);
  }
  return outputPaths;
}

/** True when a prop schema is (or transitively contains) a core-`ScenePos`-typed
 *  value — the type-identity signal that grounds the `drawable` capability. */
function propGroundsDrawable(schema: {
  scenePos?: boolean;
  items?: unknown;
  mapValue?: unknown;
  properties?: Record<string, unknown>;
}): boolean {
  if (schema.scenePos) return true;
  if (schema.items && propGroundsDrawable(schema.items as Parameters<typeof propGroundsDrawable>[0])) return true;
  if (schema.mapValue && propGroundsDrawable(schema.mapValue as Parameters<typeof propGroundsDrawable>[0])) return true;
  if (schema.properties) {
    for (const v of Object.values(schema.properties)) {
      if (propGroundsDrawable(v as Parameters<typeof propGroundsDrawable>[0])) return true;
    }
  }
  return false;
}

/** True when a prop schema is (or transitively contains) a `DrawableNode`-typed
 *  slot — the type-identity signal that grounds the `drawHost` capability. */
function propHostsDrawables(schema: {
  drawableSlot?: boolean;
  items?: unknown;
  mapValue?: unknown;
  properties?: Record<string, unknown>;
}): boolean {
  if (schema.drawableSlot) return true;
  if (schema.items && propHostsDrawables(schema.items as Parameters<typeof propHostsDrawables>[0])) return true;
  if (schema.mapValue && propHostsDrawables(schema.mapValue as Parameters<typeof propHostsDrawables>[0])) return true;
  if (schema.properties) {
    for (const v of Object.values(schema.properties)) {
      if (propHostsDrawables(v as Parameters<typeof propHostsDrawables>[0])) return true;
    }
  }
  return false;
}

/**
 * Convert a ParsedComponent to a MappingEntry.
 */
function toMappingEntry(
  component: ParsedComponent,
  existingEntry?: MappingEntry,
): MappingEntry {
  // Always recompute importPath from the current component file. Reusing
  // `existingEntry.importPath` made the path sticky when a .tsx was moved
  // or renamed (see MasterDetail → MasterDetailLayout rename in Phase 12.5).
  void existingEntry;
  const isUnderGameFolder = component.relativePath.includes('/game/');
  const isLearningFamily = component.family === 'learning';
  return {
    component: component.componentName,
    importPath: buildImportPath(component),
    category: isLearningFamily
      ? 'learning'
      : isUnderGameFolder
        ? 'game'
        : component.family === 'avl'
          ? (existingEntry?.category === 'game' || existingEntry?.category === undefined ? 'display' : existingEntry.category)
          : inferCategory(
              component.componentName,
              component.level,
              existingEntry?.category,
            ),
    ...(component.client ? { client: component.client } : {}),
  };
}

/**
 * Convert a ParsedComponent to an EventContractEntry.
 */
function toEventContract(
  component: ParsedComponent,
  existingContract?: EventContractEntry,
): EventContractEntry | null {
  if (component.events.length === 0 && !existingContract) return null;

  // Check if component accepts entity prop
  const hasEntityProp = component.props.some((p) => p.name === "entity");

  return {
    emits: component.events.length > 0
      ? component.events
      : existingContract?.emits || [],
    requires: existingContract?.requires || [],
    entityAware: hasEntityProp,
    ...(existingContract?.configDriven !== undefined
      ? { configDriven: existingContract.configDriven }
      : {}),
  };
}

/**
 * Check if two pattern entries have meaningful differences in their props.
 */
/** Key-order-independent JSON: objects by sorted keys, undefined dropped, arrays in order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

/**
 * Whether a freshly built registry entry differs from the stored one — over the WHOLE entry.
 * A field-by-field list silently never delivers a field it does not name (`payloadFor`,
 * `example`): the fresh entry is judged unchanged and discarded.
 */
export function entryChanged(existing: unknown, updated: unknown): boolean {
  return JSON.stringify(canonical(existing)) !== JSON.stringify(canonical(updated));
}

/**
 * Merge parsed components into registry files and return a sync report.
 *
 * @param dryRun If true, don't write files
 */
export function syncToRegistry(
  components: ParsedComponent[],
  dryRun: boolean = false,
  pruneOrphans: boolean = false,
): SyncReport {
  const registryPath = path.join(PATTERNS_DIR, "patterns-registry.json");
  const mappingPath = path.join(PATTERNS_DIR, "component-mapping.json");
  const contractsPath = path.join(PATTERNS_DIR, "event-contracts.json");

  // Read existing files
  const registry = readJSON<RegistryFile>(registryPath, {
    version: "1.0.0",
    exportedAt: "",
    patterns: {},
  });
  const mapping = readJSON<MappingFile>(mappingPath, {
    version: "1.0.0",
    exportedAt: "",
    mappings: {},
  });
  const contracts = readJSON<ContractFile>(contractsPath, {
    version: "1.0.0",
    exportedAt: "",
    contracts: {},
  });

  // Track changes
  const report: SyncReport = {
    scanned: {
      total: components.length,
      core: { atoms: 0, molecules: 0, organisms: 0, templates: 0 },
      clients: {},
    },
    registry: { added: [], updated: [], unchanged: [], orphaned: [] },
    mapping: { added: [], updated: [] },
    contracts: { added: [], updated: [] },
  };

  // Count scanned files
  for (const comp of components) {
    if (comp.client) {
      report.scanned.clients[comp.client] =
        (report.scanned.clients[comp.client] || 0) + 1;
    } else {
      report.scanned.core[comp.level]++;
    }
  }

  // Track which patterns we've seen from components
  const seenPatterns = new Set<string>();

  // Atomic-level priority for kebab-key collisions. When two components share
  // a pattern name (e.g. an atom and a molecule both named
  // X), the lower-tier wins so the registry reflects the
  // canonical atomic component (which is also what component-mapping.json
  // targets). Without this, scan order silently determines the winner.
  const levelRank: Record<string, number> = {
    atoms: 0,
    molecules: 1,
    organisms: 2,
    templates: 3,
  };
  // Total order: levelRank first, then relativePath, then componentName. A
  // partial order (levelRank alone) leaves same-level, same-file collisions
  // (e.g. two components exported from one .tsx) resolved only by incoming
  // scan order, which downstream consumers must never rely on — the sort has
  // to fully determine "first claimant" on its own.
  const sortedComponents = [...components].sort((a, b) => {
    const rankDiff = (levelRank[a.level] ?? 99) - (levelRank[b.level] ?? 99);
    if (rankDiff !== 0) return rankDiff;
    const pathDiff = a.relativePath.localeCompare(b.relativePath);
    if (pathDiff !== 0) return pathDiff;
    return a.componentName.localeCompare(b.componentName);
  });

  interface PatternClaimant {
    relativePath: string;
    componentName: string;
  }
  const claimedBy = new Map<string, PatternClaimant>();

  // Pattern-alias targets (e.g. "form-section" -> "form") are owned by the
  // alias mirror applied after this loop, not by whatever component happens
  // to kebab-case to the same name. Reserve them up front so a same-name
  // component collides with the alias deterministically, the same way it
  // would collide with any other earlier claimant.
  for (const [alias, source] of Object.entries(PATTERN_ALIASES)) {
    claimedBy.set(alias, {
      relativePath: "(pattern alias)",
      componentName: `alias of "${source}"`,
    });
  }

  // Process each component
  for (const component of sortedComponents) {
    const patternName = toPatternName(component.componentName);
    const claimant = claimedBy.get(patternName);
    if (claimant) {
      // Already claimed by an earlier (or reserved) entry — skip so repeated
      // runs stay idempotent instead of alternating which component's data
      // wins the shared pattern-name key.
      console.warn(
        `  ! Pattern "${patternName}" already claimed by ${claimant.componentName} ` +
          `(${claimant.relativePath}); skipping ${component.componentName} (${component.relativePath})`,
      );
      continue;
    }
    claimedBy.set(patternName, {
      relativePath: component.relativePath,
      componentName: component.componentName,
    });
    seenPatterns.add(patternName);

    // --- Registry ---
    const existingPattern = registry.patterns[patternName];
    const newPattern = toPatternEntry(component, existingPattern);

    if (!existingPattern) {
      registry.patterns[patternName] = newPattern;
      report.registry.added.push(patternName);
    } else if (entryChanged(existingPattern, newPattern)) {
      registry.patterns[patternName] = newPattern;
      report.registry.updated.push(patternName);
    } else {
      report.registry.unchanged.push(patternName);
    }

    // --- Component Mapping ---
    const existingMapping = mapping.mappings[patternName];
    const newMapping = toMappingEntry(component, existingMapping);

    if (!existingMapping) {
      mapping.mappings[patternName] = newMapping;
      report.mapping.added.push(patternName);
    } else if (entryChanged(existingMapping, newMapping)) {
      mapping.mappings[patternName] = newMapping;
      report.mapping.updated.push(patternName);
    }

    // --- Event Contracts ---
    const existingContract = contracts.contracts[patternName];
    const newContract = toEventContract(component, existingContract);

    if (newContract) {
      if (!existingContract) {
        contracts.contracts[patternName] = newContract;
        report.contracts.added.push(patternName);
      } else if (entryChanged(existingContract, newContract)) {
        contracts.contracts[patternName] = newContract;
        report.contracts.updated.push(patternName);
      }
    }
  }

  // Alias targets are backed by their source pattern's component, not a
  // component of their own (the natural component claim was reserved away
  // above) — count them as seen so the orphan gate below doesn't flag the
  // entries the aliasing pass is about to (re)write as orphans.
  for (const [alias, source] of Object.entries(PATTERN_ALIASES)) {
    if (registry.patterns[source]) {
      seenPatterns.add(alias);
    }
  }

  // Find orphaned patterns (in registry but no component found)
  for (const patternName of Object.keys(registry.patterns)) {
    if (!seenPatterns.has(patternName)) {
      report.registry.orphaned.push(patternName);
    }
  }

  // Prune orphans if requested (removes patterns not found in scan)
  if (pruneOrphans) {
    for (const orphan of report.registry.orphaned) {
      delete registry.patterns[orphan];
      delete mapping.mappings[orphan];
      delete contracts.contracts[orphan];
    }
  }

  // Apply pattern aliases — copy source pattern entry with aliased type name.
  // This allows e.g. "form-section" to accept all the same props as "form",
  // since both map to the same runtime component (UISlotRenderer).
  for (const [alias, source] of Object.entries(PATTERN_ALIASES)) {
    if (registry.patterns[source]) {
      registry.patterns[alias] = {
        ...registry.patterns[source],
        type: alias,
        description: `Alias for ${source} — ${registry.patterns[source].description}`,
      };
      // Also mirror the mapping and contracts
      if (mapping.mappings[source]) {
        mapping.mappings[alias] = { ...mapping.mappings[source] };
      }
      if (contracts.contracts[source]) {
        contracts.contracts[alias] = { ...contracts.contracts[source] };
      }
    }
  }

  // Write files (unless dry run)
  if (!dryRun) {
    const timestamp = new Date().toISOString();

    registry.exportedAt = timestamp;
    mapping.exportedAt = timestamp;
    contracts.exportedAt = timestamp;

    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n");
    fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2) + "\n");
    fs.writeFileSync(contractsPath, JSON.stringify(contracts, null, 2) + "\n");
  }

  return report;
}

/**
 * Orphan gate. After the registry is (re)built, assert that every non-client
 * pattern in `patterns-registry.json` has a backing `@almadar/shell-web` component —
 * i.e. a `component-mapping.json` entry whose `component` name is in the public
 * export set. A pattern with no backing component is an ORPHAN: a stale entry
 * left behind by a folder reorg or a partial (non-`--core-only`) sync. Shipping
 * it produces an unresolvable `import { X }` at codegen time.
 *
 * Throws with the full offending list so a publish can never ship orphans. The
 * check is deterministic (set membership, no name/text heuristics). Client
 * patterns are skipped — their components live in per-project trees, not the
 * core `@almadar/shell-web` public surface.
 */
export function assertNoOrphanPatterns(publicComponents: Set<string>): void {
  const registryPath = path.join(PATTERNS_DIR, "patterns-registry.json");
  const mappingPath = path.join(PATTERNS_DIR, "component-mapping.json");

  const registry = readJSON<RegistryFile>(registryPath, {
    version: "1.0.0",
    exportedAt: "",
    patterns: {},
  });
  const mapping = readJSON<MappingFile>(mappingPath, {
    version: "1.0.0",
    exportedAt: "",
    mappings: {},
  });

  const orphans: string[] = [];
  for (const [name, entry] of Object.entries(registry.patterns)) {
    if (entry.client) continue; // client patterns resolve against project trees
    const mapped = mapping.mappings[name];
    const component = mapped?.component;
    if (!component || !publicComponents.has(component)) {
      orphans.push(name);
    }
  }

  if (orphans.length > 0) {
    orphans.sort();
    throw new Error(
      `Orphan patterns in patterns-registry.json with no backing @almadar/shell-web ` +
        `component (${orphans.length}): ${orphans.join(", ")}. ` +
        `A folder reorg or a non-\`--core-only\` sync left these behind. ` +
        `Re-run \`patterns --core-only\` to prune them, or restore the missing component(s).`,
    );
  }
}

