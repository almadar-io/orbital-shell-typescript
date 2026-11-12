/**
 * Interface Parser
 *
 * Uses the TypeScript Compiler API to parse .tsx files and extract
 * Props interfaces and event contracts.
 */

import * as fs from "fs";
import * as path from "path";
import ts from "typescript";
import { SKELETON_VARIANTS, SURFACE_MODES } from "@almadar/core";
import { REPO_ROOT, toPatternName, PLATFORM_TYPES } from "./config.js";
import type { ScannedFile } from "./scanner.js";
import type {
  ParsedComponent,
  ExtractedProp,
  ExtractedEvent,
  ExtractedPayloadField,
  ExtractedCallbackArg,
  ExtractedPropKind,
  ExtractedDefaultValue,
  PropTypeSchema,
  PropTier,
  UiFamily,
  PatternDimension,
  PayloadTypeWhen,
  PropDecoder,
} from "./types.js";

/** Prop-key text without source quoting — `'data-theme'?: string` must yield
 *  `data-theme`, but `getText()` returns the literal including its quotes. */
function propNameText(name: ts.PropertyName, sourceFile?: ts.SourceFile): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return sourceFile ? name.getText(sourceFile) : name.getText();
}

/**
 * Built-in DOM / binary types that cannot be JSON-serialized into a bus
 * payload (`EventPayloadValue`). A `=> void` callback carrying one of these
 * as an argument (e.g. `(files: File[]) => void`) is a direct React callback,
 * not an event outlet — minting an emit for it produces uncompilable TS
 * (`File[]` is not assignable to `EventPayloadValue`). Deterministic set, not
 * a name heuristic: each is a known non-serializable structural type.
 */
const NON_SERIALIZABLE_TYPE_NAMES = new Set<string>([
  "File", "FileList", "Blob", "FormData", "ArrayBuffer", "ArrayBufferView",
  "DataTransfer", "DataTransferItem", "DataTransferItemList",
  "Event", "SyntheticEvent", "DragEvent", "MouseEvent", "KeyboardEvent",
  "ChangeEvent", "FocusEvent", "PointerEvent", "TouchEvent", "WheelEvent",
  "EventTarget", "Node", "Element", "HTMLElement", "HTMLInputElement",
  "RefObject", "MutableRefObject",
  // Canvas drawing context — a live mutable handle, never a bus payload.
  "CanvasRenderingContext2D", "OffscreenCanvasRenderingContext2D",
  // Error instances carry non-enumerable fields (message/stack) — not a
  // JSON-serializable `EventPayloadValue`.
  "Error", "ErrorInfo",
]);

/** Branded types that are NON-AUTHORABLE as a `.lolo` config knob: injected
 *  runtime handles + structural brands the orbital/runtime supplies, not a
 *  drop-time JSON value. A prop typed as one degrades to a shapeless
 *  `Record<string, FieldValue>` knob that won't assign to the real type, so the
 *  generator omits it (optional) and the component uses its hook/default. */
const NON_AUTHORABLE_BRAND_NAMES = new Set<string>([
  "EventBusContextType", "EventBus",
  "OrbitalSchema", "Trait", "CoreTrait",
  // Pre-computed visualizer layout — an author/runtime artifact, not a
  // drop-time JSON knob (StateMachineView renders nothing without it).
  "DomLayoutData",
]);

/** True when `node` is (or wraps, via array/union/parens) a type whose name is
 *  in `NON_SERIALIZABLE_TYPE_NAMES`. Inspects the syntax node directly because
 *  `mapTypeNode` collapses these unresolved references to a bare `object`,
 *  losing the name. */
function typeNodeIsNonSerializable(node: ts.TypeNode, sourceFile: ts.SourceFile): boolean {
  if (ts.isArrayTypeNode(node)) {
    return typeNodeIsNonSerializable(node.elementType, sourceFile);
  }
  if (ts.isParenthesizedTypeNode(node)) {
    return typeNodeIsNonSerializable(node.type, sourceFile);
  }
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
    return node.types.some((t) => typeNodeIsNonSerializable(t, sourceFile));
  }
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText(sourceFile);
    // Match both the bare name and the rightmost segment of a qualified name
    // (`React.MouseEvent`, `React.KeyboardEvent`, `React.ChangeEvent`, …): the
    // set holds the unqualified brand, but component authors often write the
    // `React.`-qualified form.
    const lastSegment = ts.isQualifiedName(node.typeName)
      ? node.typeName.right.text
      : name;
    if (NON_SERIALIZABLE_TYPE_NAMES.has(name) || NON_SERIALIZABLE_TYPE_NAMES.has(lastSegment)) {
      return true;
    }
    // `Array<File>`, `ReadonlyArray<Blob>`, `Promise<File>` etc.
    if ((name === "Array" || name === "ReadonlyArray" || name === "Promise") && node.typeArguments) {
      return node.typeArguments.some((t) => typeNodeIsNonSerializable(t, sourceFile));
    }
  }
  return false;
}

/**
 * Strip parser-internal fields from a MappedType so it matches the public
 * `PropTypeSchema` shape used in the registry. eventField, payload schemas,
 * and callbackArgs stay parser-internal because they're already surfaced on
 * the parent ExtractedProp — the element-level schema only needs structural
 * type info to drive validator + codegen decisions. `kind`/`payloadFor` are
 * the one narrow exception: only their `event`/sibling-name values cross,
 * for a struct member with no parent ExtractedProp to surface on (an
 * array-item interface's own `action`/`actionPayload` pairing).
 */
function mappedToPropTypeSchema(m: MappedType): PropTypeSchema {
  const out: PropTypeSchema = { types: m.types };
  if (m.enumValues && m.enumValues.length > 0) out.enumValues = m.enumValues;
  if (m.numericEnumValues && m.numericEnumValues.length > 0) out.numericEnumValues = m.numericEnumValues;
  if (m.cyclic) out.cyclic = true;
  if (m.cyclicTypeName) out.cyclicTypeName = m.cyclicTypeName;
  if (m.dateLike) out.dateLike = true;
  if (m.scenePos) out.scenePos = true;
  if (m.drawableSlot) out.drawableSlot = true;
  if (m.controlValue) out.controlValue = true;
  if (m.eventPayloadBrand) out.eventPayloadBrand = true;
  if (m.jsonValueBrand) out.jsonValueBrand = true;
  if (m.genericParam) out.genericParam = true;
  if (m.nonAuthorable) out.nonAuthorable = true;
  // `kind`/`payloadFor` are usually parent-surfaced (see this function's own
  // doc) — the one exception is `event`/`payloadFor`'s struct-member form,
  // which has no parent to surface on (the struct is an array knob's
  // ELEMENT type). Narrow to exactly that pair, not the whole `kind` enum.
  if (m.kind === 'event' || m.kind === 'event-ref') out.kind = 'event';
  if (m.kind === 'field-ref') out.kind = 'field-ref';
  if (m.of) out.of = m.of;
  if (m.kind === 'text') out.kind = 'text';
  if (m.payloadFor) out.payloadFor = m.payloadFor;
  if (m.changedBy) out.changedBy = m.changedBy;
  if (m.items) out.items = mappedToPropTypeSchema(m.items);
  if (m.mapValue) out.mapValue = mappedToPropTypeSchema(m.mapValue);
  if (m.mapKeyEnum) out.mapKeyEnum = m.mapKeyEnum;
  if (m.tupleItems) out.tupleItems = m.tupleItems.map(mappedToPropTypeSchema);
  if (m.variants) out.variants = m.variants.map(mappedToPropTypeSchema);
  if (m.discriminator) out.discriminator = m.discriminator;
  if (m.properties) {
    out.properties = Object.fromEntries(
      Object.entries(m.properties).map(([k, v]) => [k, mappedToPropTypeSchema(v)])
    );
  }
  if (m.required && m.required.length > 0) out.required = m.required;
  if (m.nullable) out.nullable = true;
  return out;
}

/**
 * Cross-file type alias registry. Populated before any parsing so that
 * `mapTypeNode` can resolve `TypeReference`s like `StackJustify` back to
 * their underlying union of string literals.
 *
 * Keyed by alias name (e.g. "StackJustify"), value is the raw TypeNode
 * as declared at `export type X = ...`. Built via `buildAliasRegistry`.
 */
type AliasRegistry = Map<string, { type: ts.TypeNode; sourceFile: ts.SourceFile; coreImports: ImportedSymbolSet }>;

/**
 * Resolution result: kind buckets the registry uses ("string", "number",
 * ...) plus the optional string-literal enum values when the type reduces
 * to a union of string literals.
 *
 * `kind` / `eventField` are semantic markers (mirrors `PropKind` from
 * `@almadar/core/patterns`). Set when the TS type references a semantic alias
 * like `EventKey` from `@almadar/core`. Drives registry consumers that
 * need type-aware event-prop recognition (Rust compiler inline phase,
 * JS preprocess, verifiers).
 */
interface MappedType {
  types: string[];
  /** A struct member typed `T | null` without `?`: absent in `.orb` data, `null` in the TS type. */
  nullable?: boolean;
  /** A map's closed key vocabulary (`Record<'up' | 'down', V>` → `['up', 'down']`). */
  mapKeyEnum?: string[];
  /** A tuple's slot schemas (`[number, number, number]`); `items` is their union. */
  tupleItems?: MappedType[];
  /** Tagged-union arms — see `PropTypeSchema.variants`. */
  variants?: MappedType[];
  discriminator?: string;
  enumValues?: string[];
  /**
   * Set when the type is a union of NUMERIC literals (e.g. `cols?: 1 | 2 | 3`).
   * `.lolo` has no numeric-union type (string enums only), so the generated
   * `.lolo` keeps `number` but the generator seeds the default from the FIRST
   * member here — a plain `0` default is rejected by the literal-union prop type.
   */
  numericEnumValues?: number[];
  kind?: ExtractedPropKind;
  /** For `kind: "field-ref"`: the sibling prop whose rows own the field (`RowFieldName<P>`); absent means the bound entity. */
  of?: string;
  eventField?: string;
  /**
   * For `kind: "entity"` (the data inlet): single record vs collection. Set
   * when the prop type is `EntityRow` / `readonly EntityRow[]` from
   * `@almadar/core`. Surfaced on the parent ExtractedProp.
   */
  cardinality?: 'record' | 'collection';
  /** Entity fields the component declared REQUIRED via `EntityWith<K>` — feeds
   *  the `ORB_X_ENTITY_PROP_CONTRACT` validator gate. */
  requiredFields?: string[];
  emitPayloadSchema?: ExtractedPayloadField[];
  listenPayloadSchema?: ExtractedPayloadField[];
  callbackArgs?: ExtractedCallbackArg[];
  /** A function prop that returns a value (render-prop / compute-prop), not a
   *  `=> void` event-dispatch callback. The factory generator skips it. */
  renderCallback?: boolean;
  /** A `=> void` callback whose argument type is non-serializable (e.g.
   *  `(files: File[]) => void`, a DOM `Event`, a `Blob`) — it cannot become a
   *  bus payload (`EventPayloadValue`). The factory generator skips minting an
   *  emit for it; serialization (if any) is the component's own declarative
   *  `action`/`actionPayload` event. */
  nonEmittable?: boolean;
  /** A prop whose type is NON-AUTHORABLE as a `.lolo` config knob — an injected
   *  runtime handle (`EventBusContextType`), a structural brand the orbital
   *  supplies (`OrbitalSchema`/`Trait`), or a native runtime collection
   *  (`Map`/`Set`). It is not a data shape a config knob could carry at all —
   *  the generator OMITS an optional one (the component falls back to its
   *  hook/default); a required one still gets a best-effort default. */
  nonAuthorable?: boolean;
  /**
   * Element schema for arrays. Populated when the source node is an
   * `ArrayTypeNode` or `Array<T>` / `ReadonlyArray<T>` reference. Bottoms
   * out at primitive types with no further nesting.
   */
  items?: MappedType;
  /**
   * Set when the node is a self-referential interface reference that hit the
   * recursion `seen` guard (e.g. `MenuItem.subMenu: MenuItem[]`). The shape is
   * fully captured one level up — the recursive child is NOT a loose-source
   * gap, so consumers can treat the `json` fallback as accepted (not actionable).
   */
  cyclic?: boolean;
  /** The declared TS interface name the self-reference is back to (e.g.
   *  `ReplyNodeRow`), carried alongside {@link cyclic} so the generator can
   *  name a `.lolo` `type` alias for the recursing shape instead of
   *  collapsing it to `opaque`. */
  cyclicTypeName?: string;
  /**
   * Per-key schema for objects sourced from a declared interface. Populated
   * when a type reference resolves to an entry in the `InterfaceRegistry`.
   * Validators use this to enforce key-name and key-type constraints on
   * object-shaped props (e.g. `WizardProgressStep` requires `title`, not `label`).
   */
  properties?: Record<string, MappedType>;
  /**
   * For a dynamic-key typed map (`Record<string, V>` / `Map<K, V>`): the
   * schema of the uniform value V, emitted as `.lolo` `Map string <V>` (→
   * `Record<string, V>`). Mirrors `items` for arrays. A `Record<string,
   * unknown>` / genuinely unshaped value type is ACTIONABLE (no `mapValue`
   * set at all) — the source must declare V, not leave it open.
   */
  mapValue?: MappedType;
  required?: string[];
  /**
   * Set when the source type is `Date`. Mapping `Date` to a primitive breaks
   * the baked orbital validator (needs a Rust rebuild), so the gap is deferred
   * — bucketed separately from actionable, not forced to a wrong shape.
   */
  dateLike?: boolean;
  /** Set when the source type is core `ScenePos` — grounds the `drawable` capability. */
  scenePos?: boolean;
  /** Set when the source type is the `DrawableNode` union (a canvas host's
   *  drawable-children slot) — grounds the entry-level `drawHost` capability. */
  drawableSlot?: boolean;
  /** Set when the source type is `FieldValue` or `ControlValue` from
   *  `@almadar/core` — the form-control transport union (`string | number |
   *  boolean | [string] | FileValue`). Drives the generator to emit the
   *  shared `ControlValue` alias (+ `FileValue` sibling decl) — a real,
   *  named declared type, not a shapeless fallback. */
  controlValue?: boolean;
  /** Set when the source type is `EventPayload`/`EventPayloadValue` from
   *  `@almadar/core` — a string-keyed bag of recursive scalar-ish bus-payload
   *  values. Drives the generator to emit the shared recursive
   *  `EventPayloadValue` alias (`Map string EventPayloadValue`) — a real,
   *  named declared type, not a shapeless fallback. */
  eventPayloadBrand?: boolean;
  /** Set when the source type is `JsonObject`/`ToolArgs`/`JsonValue` from
   *  `@almadar/core` — the recursive "data crossed a boundary" JSON union.
   *  Drives the generator to emit the shared recursive `JsonValue` alias
   *  (`Map string JsonValue` for the object/map spellings; `JsonValue`
   *  itself for the bare union) — a real, named declared type transcribing
   *  the core type's own recursive shape. */
  jsonValueBrand?: boolean;
  /** Set when the source type is core `SkeletonSpec` (the universal `skeleton` prop). */
  skeletonSpec?: boolean;
  /** Set when the source type is a generic type parameter (`T`) with NO
   *  declared default/constraint `mapTypeNode`'s `genericDefaults` could
   *  resolve to a real shape (a BOUND one — `T = CarouselItem` or `T extends
   *  Foo` — resolves straight through to that shape's own tags instead,
   *  never reaching this flag). Its real shape comes from the consumer's
   *  instantiation, so it's ACTIONABLE — no honest shape exists to fall back
   *  to; fix upstream by giving the TS generic a default/constraint. */
  genericParam?: boolean;
  /** Struct-member twin of `ExtractedProp.payloadFor` — set from a
   *  `@payloadFor <sibling>` JSDoc tag read off THIS member (not the
   *  enclosing prop), by `resolveInterfaceShapeDeep`'s member loop. Names a
   *  sibling key in the SAME `properties` map that carries the dependent
   *  event. */
  payloadFor?: string;
  /** Struct-member twin of `ExtractedProp.changedBy`, read off THIS member's `@changedBy` tag. */
  changedBy?: string[];
  /** For an array: the `kind` its element resolved to when that is `field-ref`. */
  itemKind?: ExtractedPropKind;
}

function emptyMapped(types: string[]): MappedType {
  return { types };
}

/**
 * Rank two candidate union arms by shape richness so a `string[] | TagCloudItem[]`
 * union lifts the object-bearing `TagCloudItem[]` arm rather than the primitive
 * `string[]` arm that merely happened to appear first. "Richer" = carries object
 * `properties` (directly or one level down in `items`); a primitive-`items` array
 * ranks below an object-shaped one.
 */
/** The field every arm declares as one distinct string literal (`type: 'a'` /
 *  `type: 'b'`), or undefined when the arms share no such tag. */
function taggedUnionDiscriminator(arms: readonly MappedType[]): string | undefined {
  const first = arms[0]?.properties;
  if (!first) return undefined;
  for (const field of Object.keys(first)) {
    const tags = arms.map((arm) => {
      const values = arm.properties?.[field]?.enumValues;
      return values?.length === 1 ? values[0] : undefined;
    });
    if (tags.every((tag) => tag !== undefined) && new Set(tags).size === arms.length) return field;
  }
  return undefined;
}

function shapeRichness(m: MappedType): number {
  if (m.properties && Object.keys(m.properties).length > 0) return 2;
  if (m.items && m.items.properties && Object.keys(m.items.properties).length > 0) return 2;
  if (m.items) return 1;
  return 0;
}
function isRicherShape(candidate: MappedType, current: MappedType): boolean {
  return shapeRichness(candidate) > shapeRichness(current);
}

/**
 * React DOM event-handler type references (`React.ChangeEventHandler<…>`,
 * `MouseEventHandler`, …). These are callback functions, not data — map them
 * to `function`/`callback` so the UI factory treats the prop as an event
 * outlet instead of a config blob. The element type argument is irrelevant
 * to the bus contract (the handler receives a DOM SyntheticEvent), so no
 * `callbackArgs` are extracted.
 */
const REACT_HANDLER_TYPES = new Set([
  "ChangeEventHandler",
  "MouseEventHandler",
  "FormEventHandler",
  "KeyboardEventHandler",
  "FocusEventHandler",
  "PointerEventHandler",
  "TouchEventHandler",
  "DragEventHandler",
  "ClipboardEventHandler",
  "WheelEventHandler",
  "AnimationEventHandler",
  "TransitionEventHandler",
  "CompositionEventHandler",
  "UIEventHandler",
  "ReactEventHandler",
  "EventHandler",
]);

function isReactHandlerName(typeName: string): boolean {
  const bare = typeName.startsWith("React.") ? typeName.slice("React.".length) : typeName;
  return REACT_HANDLER_TYPES.has(bare);
}

/**
 * Structural cross-package RUNTIME types the UI factory must NOT try to author
 * as data: a raw SExpression tree, a state-machine
 * trait/definition, a visualizer DOM-layout blob, etc. These are the
 * orbital/interpreter's own runtime handles, not shapes a config knob could
 * ever carry — marked `nonAuthorable` (the generator omits an optional one;
 * a required one gets a best-effort default), never a data-shape gap.
 * Resolved by name (these live in `@almadar/core` / the `lib/visualizer` layer,
 * outside the scanned `components/` registry, so the parser can't walk them).
 */
const OPAQUE_DOMAIN_TYPES = new Set([
  "SExpr",
  "SExpression",
  "Trait",
  "StateMachine",
  "OrbitalDefinition",
  "OrbitalEntity",
  "DomLayoutData",
  // Preview fixture rows the runtime supplies to an editor canvas (`FlowCanvas.mockData`).
  "EntityData",
]);

/** Known cross-file element types whose definitions live outside the scanned
 *  `components/` tree. Maps type name → common field set so demoArrayLiteral
 *  can seed a concrete row instead of a shapeless object. */
const KNOWN_CONCRETE_ELEMENT_TYPES: Record<string, MappedType> = {
  ContentSegment: {
    types: ["object"],
    properties: {
      type: { types: ["string"], enumValues: ["markdown", "code", "orbital", "quiz"] },
      content: { types: ["string"] },
    },
    required: ["type", "content"],
  },
};

/**
 * Per-file tracking of names imported from `@almadar/core`. Populated
 * before traversing a Props interface so `mapTypeNode` can distinguish
 * "this `EventKey` is the core semantic alias" from "this `EventKey` is
 * a local type of the same name" (near-zero collision risk in practice,
 * but the check costs nothing and keeps the resolver honest).
 */
type ImportedSymbolSet = Set<string>;

/**
 * Collect every name imported from `@almadar/core` in this file, for use
 * by `mapTypeNode` in detecting `EventKey` references.
 */
/** `orbital-rust/crates/orbital-shell-typescript/core/src/` — files scanned FROM INSIDE this tree (the
 *  `scanTypeSourceFiles` `asset.ts`/`payloads.ts`/`agent-trace-view.ts`
 *  roots) declare their own cross-references via RELATIVE imports
 *  (`from './types/json.js'`), never the package specifier `@almadar/core`
 *  — that specifier is only how EXTERNAL consumers (a `.tsx` component)
 *  reach the package. `collectCoreImports` must still recognize those
 *  relative references as core brands when resolving a type declared
 *  inside the package itself. */
const CORE_SRC_ROOT = path.join(REPO_ROOT, "orbital-rust/crates/orbital-shell-typescript/core/src");

export class UnresolvedTypeError extends Error {
  readonly typeName: string;
  prop?: string;
  constructor(typeName: string) {
    super(`unresolved type ${typeName}`);
    this.typeName = typeName;
  }
}

const importedSourceFiles = new Map<string, ts.SourceFile | undefined>();

function loadSourceFile(absolutePath: string): ts.SourceFile | undefined {
  if (importedSourceFiles.has(absolutePath)) return importedSourceFiles.get(absolutePath);
  let loaded: ts.SourceFile | undefined;
  if (fs.existsSync(absolutePath)) {
    loaded = ts.createSourceFile(absolutePath, fs.readFileSync(absolutePath, "utf-8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  }
  importedSourceFiles.set(absolutePath, loaded);
  return loaded;
}

function resolveModuleFile(specifier: string, fromFile: string): string | undefined {
  let base: string;
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    base = path.resolve(path.dirname(fromFile), specifier.replace(/\.js$/, ""));
  } else if (specifier === "@almadar/core") {
    base = path.join(CORE_SRC_ROOT, "..", "index");
  } else if (specifier.startsWith("@almadar/core/")) {
    base = path.join(CORE_SRC_ROOT, specifier.slice("@almadar/core/".length));
  } else {
    const resolved = ts.resolveModuleName(specifier, fromFile, { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext }, ts.sys).resolvedModule;
    return resolved?.resolvedFileName;
  }
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}.d.ts`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

type ResolvedDecl = { type: ts.TypeNode; sourceFile: ts.SourceFile } | { objectShaped: true };

function findLocalTypeDecl(sourceFile: ts.SourceFile, name: string): ResolvedDecl | undefined {
  for (const stmt of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === name) return { type: stmt.type, sourceFile };
    if ((ts.isInterfaceDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name?.text === name) return { objectShaped: true };
  }
  return undefined;
}

/** Follow a type name through imports and re-exports (named and `export *`) to its declaration. */
function resolveImportedType(
  typeName: string,
  sourceFile: ts.SourceFile,
  depth: number = 0,
): ResolvedDecl | undefined {
  if (depth > 12) return undefined;
  const local = findLocalTypeDecl(sourceFile, typeName);
  if (local) return local;
  const follow = (specifier: string, original: string): ResolvedDecl | undefined => {
    const target = resolveModuleFile(specifier, sourceFile.fileName);
    const targetFile = target ? loadSourceFile(target) : undefined;
    return targetFile ? resolveImportedType(original, targetFile, depth + 1) : undefined;
  };
  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const bindings = stmt.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const el = bindings.elements.find((e) => e.name.text === typeName);
      if (el) return follow(stmt.moduleSpecifier.text, el.propertyName?.text ?? el.name.text);
    } else if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      const el = stmt.exportClause.elements.find((e) => e.name.text === typeName && e.propertyName);
      if (el?.propertyName) return resolveImportedType(el.propertyName.text, sourceFile, depth + 1);
    } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      if (!stmt.exportClause) {
        const found = follow(stmt.moduleSpecifier.text, typeName);
        if (found) return found;
      } else if (ts.isNamedExports(stmt.exportClause)) {
        const el = stmt.exportClause.elements.find((e) => e.name.text === typeName);
        if (el) return follow(stmt.moduleSpecifier.text, el.propertyName?.text ?? el.name.text);
      }
    }
  }
  return undefined;
}

function collectCoreImports(sourceFile: ts.SourceFile): ImportedSymbolSet {
  const set: ImportedSymbolSet = new Set();
  const isInsideCoreSrc = sourceFile.fileName.startsWith(CORE_SRC_ROOT);
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const spec = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(spec)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    if (spec.text === '@almadar/core' || (isInsideCoreSrc && (spec.text.startsWith('./') || spec.text.startsWith('../')))) {
      for (const el of bindings.elements) {
        // `import { EventKey }`                → record local name `EventKey`.
        // `import { EventKey as E }`           → record local name `E` (the
        //                                        propertyName is the original).
        // Either way, the LOCAL binding is what appears in type references.
        set.add(el.name.text);
      }
    } else if (spec.text === '@almadar/core/patterns') {
      // `AnyPatternConfig` (a render-ui pattern node) is part of a program's
      // render tree; record only that name so `mapTypeNode` reads it as `sexpr`.
      for (const el of bindings.elements) {
        const original = el.propertyName?.text ?? el.name.text;
        if (original === 'AnyPatternConfig') set.add(el.name.text);
      }
    } else if (spec.text === '@almadar/evaluator') {
      // `@almadar/evaluator` re-exports core's `SExpr` brand (its canonical
      // home is `@almadar/core/types/expression`). Record only that one name
      // so `mapTypeNode` recognizes an `SExpr`-typed prop regardless of which
      // of the two entry points the component imported it from. Other
      // evaluator exports are NOT treated as core brands.
      for (const el of bindings.elements) {
        const original = el.propertyName?.text ?? el.name.text;
        if (original === 'SExpr') set.add(el.name.text);
      }
    } else if (/(?:^|\/)lib\/drawable\/paintDispatch$/.test(spec.text)) {
      // The `DrawableNode` union (a canvas draw-host's children-slot contract)
      // lives in @almadar/shell-web's drawable lib. Track it by import identity — like
      // the core brands above — so `mapTypeNode` can stamp a `drawableSlot` and
      // the writer derive `drawHost`, with no name/signal heuristic.
      for (const el of bindings.elements) {
        const original = el.propertyName?.text ?? el.name.text;
        if (original === 'DrawableNode') set.add(el.name.text);
      }
    }
  }
  return set;
}

/**
 * Registry of interface declarations across all scanned files. Used to
 * resolve nested descriptor types (e.g. `itemActions: readonly DataGridItemAction[]`)
 * back to their field list so event-list markers can be attached when a
 * descriptor has an `EventKey`-typed field.
 */
/**
 * Named object shapes reachable by type name. `members` is the authority —
 * `decl` is present only for real `interface` declarations, because an
 * `export type X = { … }` alias (or `A & { … }`) contributes members without
 * one. Registering aliases is what lets a prop whose element type is an alias
 * (e.g. `GameMenu`'s `MenuOption = EventPayload & { … }`) be seen at all;
 * before, the registry was built from `isInterfaceDeclaration` only and every
 * alias-typed prop was silently invisible.
 */
type InterfaceRegistry = Map<string, { decl?: ts.InterfaceDeclaration; members: readonly ts.TypeElement[]; sourceFile: ts.SourceFile; coreImports: ImportedSymbolSet }>;

/** The registry key an admitted `@almadar/core` declaration is also filed under, so a same-named declaration elsewhere cannot shadow it. */
function coreDeclKey(name: string): string {
  return `@almadar/core#${name}`;
}

/** The registry key a reference to `name` in `sourceFile` resolves to: core's declaration when the file imports the name from `@almadar/core` or is the core file that declares it, else the name. */
function interfaceKey(interfaces: InterfaceRegistry, name: string, coreImports: ImportedSymbolSet, sourceFile: ts.SourceFile): string {
  const core = interfaces.get(coreDeclKey(name));
  if (core === undefined) return name;
  return coreImports.has(name) || core.sourceFile.fileName === sourceFile.fileName ? coreDeclKey(name) : name;
}

/**
 * Members an `export type X = …` alias contributes: a bare object literal, or
 * the object-literal arms of an intersection (`EventPayload & { … }`). Returns
 * an empty array for aliases that name no object shape (unions, primitives,
 * mapped types), which the caller treats as "not registrable".
 */
function aliasObjectMembers(node: ts.TypeNode): readonly ts.TypeElement[] {
  if (ts.isTypeLiteralNode(node)) return node.members;
  if (ts.isIntersectionTypeNode(node)) {
    return node.types.flatMap((arm) => aliasObjectMembers(arm));
  }
  if (ts.isParenthesizedTypeNode(node)) return aliasObjectMembers(node.type);
  return [];
}

/**
 * Map a TypeScript type node to a structured descriptor: the "kind" buckets
 * ("string", "number", "array", ...) plus the optional set of allowed
 * string-literal values when the type is a bounded string union. Also
 * carries semantic markers (`kind: "event"` / `"event-list"`) when the
 * node references a semantic alias from `@almadar/core` — see
 * {@link MappedType} for how consumers use them.
 */
/** Extract string-literal members of `'a' | 'b'` (or a single `'a'`). */
function literalStrings(n: ts.TypeNode): string[] {
  if (ts.isUnionTypeNode(n)) return n.types.flatMap(literalStrings);
  if (ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal)) return [n.literal.text];
  return [];
}

interface EntityRowInfo {
  cardinality: "record" | "collection";
  /** Fields the component declared REQUIRED via `EntityWith<K>` / an `EntityRow & {…}` intersection. */
  requiredFields: string[];
}

/**
 * Recognize an entity-DATA prop by the single `EntityRow` type (the brands
 * `EntityInlet`/`EntityRecord`/`EntityCollection` were removed). Bare
 * `EntityRow` → `record`; any array form → `collection`. `EntityWith<'a'|'b'>`
 * and `EntityRow & { a; b }` carry REQUIRED fields (→ `requiredFields`), feeding
 * the `ORB_X_ENTITY_PROP_CONTRACT` validator gate. Returns `undefined` when the
 * node is not an entity prop.
 */
function entityRowInfo(n: ts.TypeNode, coreImports: ImportedSymbolSet): EntityRowInfo | undefined {
  if (ts.isTypeOperatorNode(n) && n.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return entityRowInfo(n.type, coreImports);
  }
  if (ts.isArrayTypeNode(n)) {
    const el = entityRowInfo(n.elementType, coreImports);
    return el ? { cardinality: "collection", requiredFields: el.requiredFields } : undefined;
  }
  if (ts.isTypeReferenceNode(n)) {
    const nm = n.typeName.getText();
    if ((nm === "ReadonlyArray" || nm === "Array") && n.typeArguments?.[0]) {
      const el = entityRowInfo(n.typeArguments[0], coreImports);
      return el ? { cardinality: "collection", requiredFields: el.requiredFields } : undefined;
    }
    if (nm === "EntityRow" && coreImports.has("EntityRow")) {
      return { cardinality: "record", requiredFields: [] };
    }
    if (nm === "EntityWith" && coreImports.has("EntityWith")) {
      return {
        cardinality: "record",
        requiredFields: n.typeArguments?.[0] ? literalStrings(n.typeArguments[0]) : [],
      };
    }
  }
  // `EntityRow & { rating: number }` — refined-by-intersection.
  if (ts.isIntersectionTypeNode(n)) {
    let isEntity = false;
    const req: string[] = [];
    for (const m of n.types) {
      const info = entityRowInfo(m, coreImports);
      if (info) {
        isEntity = true;
        req.push(...info.requiredFields);
      } else if (ts.isTypeLiteralNode(m)) {
        for (const member of m.members) {
          if (ts.isPropertySignature(member) && member.name && !member.questionToken) {
            req.push(propNameText(member.name));
          }
        }
      }
    }
    return isEntity ? { cardinality: "record", requiredFields: req } : undefined;
  }
  // Union, e.g. `EntityWith<K> | readonly EntityWith<K>[]` — collection wins.
  if (ts.isUnionTypeNode(n)) {
    let cardinality: "record" | "collection" | undefined;
    let requiredFields: string[] = [];
    for (const m of n.types) {
      const info = entityRowInfo(m, coreImports);
      if (!info) continue;
      requiredFields = info.requiredFields;
      if (info.cardinality === "collection") cardinality = "collection";
      else if (cardinality !== "collection") cardinality = "record";
    }
    return cardinality ? { cardinality, requiredFields } : undefined;
  }
  return undefined;
}

/** The shape-bearing `TypeNode` of an entity prop — the part whose members are the
 *  entity's declared fields. Resolves `EntityWith<S>` → `S`, the `TemplateProps<E>`
 *  union/array typed-arm → `E`, and `EntityRow & I`/`{…}` → the refined arm. Returns
 *  `undefined` for a shapeless entity (bare `EntityRow`). Routed through `mapTypeNode`
 *  by the caller, which resolves named interfaces + inline literals to `properties`. */
function entityShapeNode(n: ts.TypeNode, coreImports: ImportedSymbolSet): ts.TypeNode | undefined {
  if (ts.isTypeOperatorNode(n) && n.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return entityShapeNode(n.type, coreImports);
  }
  if (ts.isArrayTypeNode(n)) return entityShapeNode(n.elementType, coreImports);
  if (ts.isTypeReferenceNode(n)) {
    const nm = n.typeName.getText();
    if ((nm === "ReadonlyArray" || nm === "Array") && n.typeArguments?.[0]) {
      return entityShapeNode(n.typeArguments[0], coreImports);
    }
    if (nm === "EntityWith" && coreImports.has("EntityWith")) return n.typeArguments?.[0];
    if (nm === "EntityRow" && coreImports.has("EntityRow")) return undefined;
    // A named interface (e.g. the `TemplateProps<E>` typed arm) carries its own shape.
    return n;
  }
  if (ts.isTypeLiteralNode(n)) return n;
  if (ts.isIntersectionTypeNode(n) || ts.isUnionTypeNode(n)) {
    for (const m of n.types) {
      const s = entityShapeNode(m, coreImports);
      if (s) return s;
    }
    return undefined;
  }
  return undefined;
}

/** Walk `sourceFile` looking for `const NAME = [...] as const` (or `export const NAME = [...]`)
 *  and return its string-literal elements. Returns `[]` if not found or non-string. */
function extractConstArrayLiterals(name: string, sourceFile: ts.SourceFile): string[] {
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
      if (!decl.initializer) continue;
      // Unwrap `[...] as const` — the `as const` assertion wraps the array literal
      // in an AsExpression node; peel it to reach the ArrayLiteralExpression.
      const init = ts.isAsExpression(decl.initializer)
        ? decl.initializer.expression
        : decl.initializer;
      if (!ts.isArrayLiteralExpression(init)) continue;
      const values: string[] = [];
      for (const el of init.elements) {
        if (!ts.isStringLiteral(el)) return [];
        values.push(el.text);
      }
      return values;
    }
  }
  return [];
}

function extractConstStringLiteral(name: string, sourceFile: ts.SourceFile): string | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
      if (!decl.initializer) continue;
      const init = ts.isAsExpression(decl.initializer)
        ? decl.initializer.expression
        : decl.initializer;
      if (ts.isStringLiteral(init)) return init.text;
    }
  }
  return undefined;
}

/** The `Asset` struct's bounded-string fields (`style`/`role`/`dimension`/`aspect`) are
 *  enums whose single source of truth is `@almadar/core`'s `asset.ts` (`VISUAL_STYLES`,
 *  `ENTITY_ROLES`, …). The hardcoded `Asset` shape below reads those consts from source
 *  (reusing `extractConstArrayLiterals`) rather than duplicating the literals here, so the
 *  registry carries them as real enums instead of flattened `string` (CG-SWEEP-1 Cat 11).
 *  Lazy singleton; a missing/unreadable file degrades gracefully (fields stay `["string"]`). */
let _coreAssetSf: ts.SourceFile | null | undefined;
function coreAssetSourceFile(): ts.SourceFile | null {
  if (_coreAssetSf !== undefined) return _coreAssetSf;
  const p = path.join(REPO_ROOT, "orbital-rust/crates/orbital-shell-typescript/core/src/types/asset.ts");
  try {
    _coreAssetSf = ts.createSourceFile(
      p,
      fs.readFileSync(p, "utf-8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
  } catch {
    _coreAssetSf = null;
  }
  return _coreAssetSf;
}

function intrinsicElementsReference(name: ts.EntityName): boolean {
  if (!ts.isQualifiedName(name) || name.right.text !== "IntrinsicElements") return false;
  const ns = name.left;
  if (ts.isIdentifier(ns)) return ns.text === "JSX";
  return ns.right.text === "JSX" && ts.isIdentifier(ns.left) && ns.left.text === "React";
}

const _intrinsicTagsCache = new Map<string, string[]>();
function intrinsicElementTags(fromFile: string): string[] {
  const resolved = ts.resolveModuleName("react", fromFile, {
    moduleResolution: ts.ModuleResolutionKind.Node10,
  }, ts.sys).resolvedModule?.resolvedFileName;
  if (!resolved || !resolved.endsWith(".d.ts")) {
    throw new Error(`JSX.IntrinsicElements: no @types/react resolves from ${fromFile}`);
  }
  const cached = _intrinsicTagsCache.get(resolved);
  if (cached) return cached;
  const sf = ts.createSourceFile(resolved, fs.readFileSync(resolved, "utf-8"), ts.ScriptTarget.Latest, true);
  const tags: string[] = [];
  const visit = (n: ts.Node, inJsx: boolean): void => {
    if (ts.isModuleDeclaration(n)) {
      ts.forEachChild(n, (c) => visit(c, inJsx || (ts.isIdentifier(n.name) && n.name.text === "JSX")));
      return;
    }
    if (inJsx && ts.isInterfaceDeclaration(n) && n.name.text === "IntrinsicElements") {
      for (const m of n.members) {
        if (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) && !tags.includes(m.name.text)) tags.push(m.name.text);
      }
      return;
    }
    ts.forEachChild(n, (c) => visit(c, inJsx));
  };
  visit(sf, false);
  if (tags.length === 0) throw new Error(`JSX.IntrinsicElements: no tags declared in ${resolved}`);
  _intrinsicTagsCache.set(resolved, tags);
  return tags;
}

const _coreEnumCache = new Map<string, string[]>();
function coreEnumValues(constName: string): string[] {
  const cached = _coreEnumCache.get(constName);
  if (cached) return cached;
  const sf = coreAssetSourceFile();
  const vals = sf ? extractConstArrayLiterals(constName, sf) : [];
  _coreEnumCache.set(constName, vals);
  return vals;
}

/** `{ types:["string"], enumValues }` when the named core enum const resolves, else a
 *  bare `["string"]` — never fabricates an empty enum. */
function enumMapped(constName: string): MappedType {
  const enumValues = coreEnumValues(constName);
  return enumValues.length > 0
    ? { types: ["string"], enumValues }
    : emptyMapped(["string"]);
}

/** Collect the string-literal keys named by an `Omit<T, K>` / `Pick<T, K>`
 *  second type argument (`"a"`, or `"a" | "b"`). */
function literalKeySet(node: ts.TypeNode | undefined): Set<string> {
  const keys = new Set<string>();
  const collect = (n: ts.TypeNode | undefined) => {
    if (!n) return;
    if (ts.isUnionTypeNode(n)) {
      for (const t of n.types) collect(t);
      return;
    }
    if (ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal)) keys.add(n.literal.text);
  };
  collect(node);
  return keys;
}

/**
 * Walk an interface's `extends` heritage chain — a plain base reference
 * (`extends Base` / `extends Base<T>`), `extends Omit<Base, "k">`, and
 * `extends Pick<Base, "k">`, any number of them combined and each
 * recursing into ITS OWN heritage — merging every base's resolved
 * `properties`/`required` before the interface's own directly-declared
 * members are layered on top (own members win on name collision).
 *
 * This is the GENERAL resolver for a type-reference's element/property shape:
 * the interface-reference branch of {@link mapTypeNode} (which derives an
 * array prop's element shape, e.g. `stats: GameHudStat[]`) calls this instead
 * of reading `iface.members` alone, so a declared shape built through TS
 * composition (`GameHudStat extends Omit<StatBadgeProps, "size">`) flattens
 * the same way a self-contained interface does. `seen` guards recursive
 * extends chains / self-referential interfaces the same way the rest of
 * `mapTypeNode` does.
 */
function resolveInterfaceShapeDeep(
  typeName: string,
  aliases: AliasRegistry,
  interfaces: InterfaceRegistry,
  seen: Set<string>,
): { properties: Record<string, MappedType>; required: string[] } | null {
  const entry = interfaces.get(typeName);
  if (!entry || seen.has(typeName)) return null;
  const nextSeen = new Set(seen);
  nextSeen.add(typeName);

  const properties: Record<string, MappedType> = {};
  const required = new Set<string>();

  const applyBase = (
    base: { properties: Record<string, MappedType>; required: string[] } | null,
    filter?: { keep: Set<string> } | { drop: Set<string> },
  ) => {
    if (!base) return;
    const allowed = (key: string) =>
      !filter || ("keep" in filter ? filter.keep.has(key) : !filter.drop.has(key));
    for (const [k, v] of Object.entries(base.properties)) {
      if (allowed(k)) properties[k] = v;
    }
    for (const r of base.required) {
      if (allowed(r)) required.add(r);
    }
  };

  if (entry.decl?.heritageClauses) {
    for (const clause of entry.decl.heritageClauses) {
      for (const typeExpr of clause.types) {
        const baseName = typeExpr.expression.getText(entry.sourceFile);
        if (baseName === "Omit" || baseName === "Pick") {
          const [targetArg, keysArg] = typeExpr.typeArguments ?? [];
          if (!targetArg || !ts.isTypeReferenceNode(targetArg)) continue;
          const targetName = targetArg.typeName.getText(entry.sourceFile);
          const baseShape = resolveInterfaceShapeDeep(targetName, aliases, interfaces, nextSeen);
          const keys = literalKeySet(keysArg);
          applyBase(baseShape, baseName === "Omit" ? { drop: keys } : { keep: keys });
          continue;
        }
        // Plain `extends Base` / `extends Base<T>` reference — resolved
        // recursively so a multi-level chain (`C extends B`, `B extends A`)
        // flattens fully, not just one hop.
        applyBase(resolveInterfaceShapeDeep(baseName, aliases, interfaces, nextSeen));
      }
    }
  }

  for (const member of entry.members) {
    if (!ts.isPropertySignature(member)) continue;
    const propName = propNameText(member.name, entry.sourceFile);
    const propType = member.type
      ? mapTypeNode(member.type, entry.sourceFile, aliases, entry.coreImports, interfaces, nextSeen)
      : emptyMapped(["unknown"]);
    // A struct member has no parent `ExtractedProp` to surface its own
    // `@payloadFor <sibling>` JSDoc tag on (unlike a TOP-LEVEL prop, read via
    // this same helper in `mapPropertySignatureToProp`) — read it here so
    // `mappedToPropTypeSchema` has something to narrow-copy through.
    const memberTags = getPropJSDocTags(member, entry.sourceFile);
    if (memberTags.payloadFor) propType.payloadFor = memberTags.payloadFor;
    if (memberTags.changedBy) propType.changedBy = memberTags.changedBy;
    const nullableRequired = !member.questionToken && isNullableMember(member.type);
    properties[propName] = nullableRequired ? { ...propType, nullable: true } : propType;
    if (member.questionToken || isNullableMember(member.type)) required.delete(propName);
    else required.add(propName);
  }

  return { properties, required: Array.from(required) };
}

/** `.orb` lowering drops `null` from object literals, so a `T | null` member arrives absent — optional, not required. */
function isNullableMember(type: ts.TypeNode | undefined): boolean {
  return !!type && ts.isUnionTypeNode(type)
    && type.types.some((t) => ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword);
}


/**
 * A dynamic-key map (`Record<K, V>` / `{ [k: string]: V }`) whose VALUE type
 * resolved to the `EventKey` brand (`kind: "event"`) is itself an event
 * OUTLET — a d-pad's direction→event map, a canvas's keycode→event map. The
 * elevation is derived purely from the value type's own identity (never the
 * prop's name), mirroring how `EventKey` itself is detected.
 */
function eventMapKind(mapValue: MappedType): Pick<MappedType, "kind"> {
  return mapValue.kind === "event" ? { kind: "event-map" } : {};
}

function mapTypeNode(
  node: ts.TypeNode,
  sourceFile: ts.SourceFile,
  aliases: AliasRegistry,
  coreImports: ImportedSymbolSet = new Set(),
  interfaces: InterfaceRegistry = new Map(),
  seen: Set<string> = new Set(),
  /** The enclosing component Props interface's OWN declared type-parameter
   *  defaults/constraints (`CarouselProps<T = CarouselItem>` → `T` →
   *  `CarouselItem`'s TypeNode), keyed by type-parameter name. Lexically
   *  scoped to the source file that declared them — NOT threaded into a
   *  cross-file alias/interface resolution (a different file's own `T` means
   *  something else), only into same-file recursive calls. */
  genericDefaults: Map<string, ts.TypeNode> = new Map(),
): MappedType {
  if (!node) return emptyMapped(["unknown"]);

  // Entity-data prop — the ONE entity type, `EntityRow`, used directly.
  // Detected by type identity (like the old brands), cardinality from
  // array-vs-not. `properties` stays field-open: the domain entity supplies
  // the fields at compose time.
  {
    const erInfo = entityRowInfo(node, coreImports);
    if (erInfo) {
      const result: MappedType =
        erInfo.cardinality === "collection"
          ? { types: ["object", "array"], kind: "entity", cardinality: "collection" }
          : { types: ["object"], kind: "entity", cardinality: "record" };
      if (erInfo.requiredFields.length > 0) result.requiredFields = erInfo.requiredFields;
      // Resolve the entity's typed field SHAPE from the shape-bearing node, via the
      // same interface resolver mapTypeNode already uses. Covers `EntityWith<S>`,
      // the `TemplateProps<E>` union/array typed-arm `E`, and `EntityRow & I`/`{…}`
      // intersections — so lolo-ui emits a COMPLETE entity (every field, typed +
      // seeded) instead of a keys-only `{ id; title }` / `{ id }` stub.
      const shapeNode = entityShapeNode(node, coreImports);
      if (shapeNode) {
        const shape = mapTypeNode(shapeNode, sourceFile, aliases, coreImports, interfaces, seen, genericDefaults);
        if (shape.properties && Object.keys(shape.properties).length > 0) {
          result.properties = shape.properties;
          if (shape.required && shape.required.length > 0) result.requiredFields = shape.required;
        }
        // A recursive entity row (`replies?: readonly EntityWith<ReplyNodeRow>[]`
        // inside ReplyNodeRow itself) resolves its shape mid-expansion — the
        // interface guard returns `cyclic` with no properties. Without carrying
        // the flag, the field published a shapeless `object|array` and the
        // generator's `json` fallback swallowed the recursion.
        if (shape.cyclic) result.cyclic = true;
        if (shape.cyclicTypeName) result.cyclicTypeName = shape.cyclicTypeName;
      }
      return result;
    }
  }

  // String keyword
  if (node.kind === ts.SyntaxKind.StringKeyword) return emptyMapped(["string"]);
  if (node.kind === ts.SyntaxKind.NumberKeyword) return emptyMapped(["number"]);
  if (node.kind === ts.SyntaxKind.BooleanKeyword) return emptyMapped(["boolean"]);
  if (node.kind === ts.SyntaxKind.VoidKeyword) return emptyMapped(["void"]);
  if (node.kind === ts.SyntaxKind.AnyKeyword) return emptyMapped(["any"]);
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) return emptyMapped(["undefined"]);
  if (node.kind === ts.SyntaxKind.NullKeyword) return emptyMapped(["null"]);

  // Array types — `T[]`. If `T` is an interface that contains an
  // `EventKey`-typed field, surface the prop as `event-list`; the
  // registry consumer then knows to rewrite per-item event keys. The
  // element type is preserved on `items` so downstream consumers
  // (validator, codegen) can make element-shape decisions instead of
  // falling back to name-list heuristics.
  if (ts.isArrayTypeNode(node)) {
    const eventField = findEventFieldInInterfaceRef(node.elementType, sourceFile, interfaces, coreImports);
    const items = mapTypeNode(node.elementType, sourceFile, aliases, coreImports, interfaces, seen, genericDefaults);
    const result: MappedType = { types: ["array"], items };
    if (items.kind === "field-ref" || items.kind === "text") result.itemKind = items.kind;
    if (eventField) {
      result.kind = "event-list";
      result.eventField = eventField;
    }
    return result;
  }

  // Union types (e.g., "sm" | "md" | "lg" or string | number)
  if (ts.isUnionTypeNode(node)) {
    const memberTypes = new Set<string>();
    const enumValues: string[] = [];
    const numericEnumValues: number[] = [];
    let allStringLiterals = true;
    let allNumericLiterals = true;
    // Track the richest structured arm (an array with `items`, or an object
    // with `properties`) so a `Foo[] | string[]`, `Foo | null`, or
    // `Foo[] | EventPayloadValue` union still carries the concrete arm's shape
    // instead of merging down to a property-less `["array"]` / `["object"]`.
    let shapedArm: MappedType | undefined;
    // A union can carry an array arm AND an object arm as DIFFERENT members
    // (`ControlValue = … | string[] | FileValue`). `shapedArm` keeps only one,
    // so the loser's shape was silently dropped and the union came out
    // structurally incomplete — enough to describe one arm, never the union.
    // Tracked separately so both can be lifted below.
    let arrayArm: MappedType | undefined;
    let objectArm: MappedType | undefined;
    let unionDateLike = false;
    // Count distinct object-literal arms. A union with ≥2 of them is a
    // DISCRIMINATED UNION (`{type:'single';…} | {type:'multi';…}`) — there's no
    // single struct shape to author as a `.lolo` knob (the discriminant + arm
    // fields vary), so the prop is non-authorable: the generator omits an
    // optional one (the component falls back to its default).
    let objectArmCount = 0;
    const objectArms: MappedType[] = [];
    // The single non-null/undefined arm, when there is exactly one. `T | null`
    // is T-made-optional, not a real union.
    let soleRealArm: MappedType | undefined;
    let realArmCount = 0;
    // An arm whose domain is the OPEN string type (bare `string` keyword, or an
    // alias resolving to it). It swallows any sibling string literals: the
    // lifted literal list is neither exhaustive (downstream `resolveType` would
    // close the type around it) nor needed for default seeding (any string is a
    // legal default once the domain is open).
    let openStringArm = false;
    // A member typed `EventEmit<P>`/`EventListen<P>` (`kind: "event-ref"` /
    // `"event-listen"`) is a declarative bus contract, not a "shape" that
    // competes with a sibling arm's object/array shape — it must survive the
    // merge regardless of what else is in the union (a plain callback
    // function type, a React DOM handler type, …). Tracked separately from
    // `shapedArm` because neither arm in `(cb: T) => void | EventEmit<P>`
    // satisfies `hasShape` (both are flat `{types:['function'|'string'], kind}`
    // with no `items`/`properties`/`mapValue`), so the general union merge
    // silently dropped the contract on every such union until now.
    let eventRefArm: MappedType | undefined;
    let eventListenArm: MappedType | undefined;

    for (const member of node.types) {
      if (ts.isLiteralTypeNode(member)) {
        if (ts.isStringLiteral(member.literal)) {
          memberTypes.add("string");
          enumValues.push(member.literal.text);
          allNumericLiterals = false;
        } else if (member.literal.kind === ts.SyntaxKind.StringKeyword) {
          // The bare `string` keyword inside a union-of-literals widens the
          // domain — no longer a bounded enum.
          memberTypes.add("string");
          allStringLiterals = false;
          allNumericLiterals = false;
          openStringArm = true;
        } else if (ts.isNumericLiteral(member.literal)) {
          memberTypes.add("number");
          allStringLiterals = false;
          numericEnumValues.push(Number(member.literal.text));
        } else if (member.literal.kind === ts.SyntaxKind.TrueKeyword ||
                   member.literal.kind === ts.SyntaxKind.FalseKeyword) {
          memberTypes.add("boolean");
          allStringLiterals = false;
          allNumericLiterals = false;
        }
      } else if (member.kind === ts.SyntaxKind.UndefinedKeyword ||
                 member.kind === ts.SyntaxKind.NullKeyword) {
        // Skip undefined/null in union (optional marker)
        continue;
      } else {
        allStringLiterals = false;
        allNumericLiterals = false;
        const memberResult = mapTypeNode(member, sourceFile, aliases, coreImports, interfaces, seen, genericDefaults);
        realArmCount += 1;
        soleRealArm = realArmCount === 1 ? memberResult : undefined;
        if (memberResult.kind === "event-ref" && !eventRefArm) eventRefArm = memberResult;
        if (memberResult.kind === "event-listen" && !eventListenArm) eventListenArm = memberResult;
        if (memberResult.types.includes("string") && !memberResult.enumValues?.length) {
          openStringArm = true;
        }
        for (const t of memberResult.types) memberTypes.add(t);
        // Lift a resolved arm's enumerable literals to the outer union so a
        // union with a TYPE-ALIAS literal arm (e.g. `GridCols | ResponsiveGridCols`
        // where `GridCols = 1|…|12|'none'`) still surfaces the string member as
        // a valid default for the generated knob.
        if (memberResult.enumValues) for (const v of memberResult.enumValues) enumValues.push(v);
        if (memberResult.numericEnumValues) for (const v of memberResult.numericEnumValues) numericEnumValues.push(v);
        if (memberResult.dateLike) unionDateLike = true;
        if (memberResult.properties && Object.keys(memberResult.properties).length > 0) {
          objectArmCount += 1;
          objectArms.push(memberResult);
        }
        const hasShape =
          // Any array arm that carries an element schema (even primitive
          // `string[]` → `items: { types: ['string'] }`) is concrete enough to
          // lift over a permissive sibling arm like `EventPayloadValue`.
          memberResult.items ||
          // A typed-map arm (`Record<string, V>` → `mapValue`) — e.g.
          // `conditionalFields: Record<string, SExpr> | boolean`. Lift the map
          // shape over the bare `boolean` sibling.
          memberResult.mapValue ||
          (memberResult.properties && Object.keys(memberResult.properties).length > 0);
        if (hasShape && (!shapedArm || isRicherShape(memberResult, shapedArm))) {
          shapedArm = memberResult;
        }
        if (memberResult.items && (!arrayArm || isRicherShape(memberResult, arrayArm))) {
          arrayArm = memberResult;
        }
        if (
          memberResult.properties && Object.keys(memberResult.properties).length > 0 &&
          (!objectArm || isRicherShape(memberResult, objectArm))
        ) {
          objectArm = memberResult;
        }
      }
    }

    const result: MappedType = {
      types: memberTypes.size > 0 ? Array.from(memberTypes) : ["string"],
    };
    // ≥2 struct arms: a TAGGED union when every real arm is a struct sharing one
    // single-literal discriminator field — its arms become `variants`. Any other
    // struct union has no single shape to author → non-authorable.
    if (objectArmCount >= 2) {
      const discriminator = objectArmCount === realArmCount ? taggedUnionDiscriminator(objectArms) : undefined;
      if (discriminator !== undefined) {
        return { types: ['object'], variants: objectArms, discriminator };
      }
      result.nonAuthorable = true;
    }
    if (allStringLiterals && enumValues.length > 0) {
      result.enumValues = enumValues;
    }
    if (allNumericLiterals && numericEnumValues.length > 0) {
      result.numericEnumValues = numericEnumValues;
    }
    // A union with string-literal members that is NOT a pure string enum
    // (mixed with numeric literals, an object arm, or a bare keyword) — e.g.
    // `GridCols = 1|…|12|'none'` or `GridCols | ResponsiveGridCols`. `.lolo`
    // can't express the full union, but it CAN express the string-literal arm
    // as an enum, and a string member is a valid default for the real (wider)
    // prop type. Emit it so the generated knob defaults to a real member
    // (a bare `""` / `0` would be rejected by the literal-union prop type).
    if (!allStringLiterals && enumValues.length > 0 && !openStringArm) {
      result.enumValues = enumValues;
    }
    // Lift the concrete arm's element/property shape onto the union result so
    // downstream codegen sees a real `[Type]` / `{ … }` instead of a fallback.
    if (shapedArm) {
      if (shapedArm.items) result.items = shapedArm.items;
      if (shapedArm.itemKind) result.itemKind = shapedArm.itemKind;
      if (shapedArm.mapValue) {
        result.mapValue = shapedArm.mapValue;
        Object.assign(result, eventMapKind(shapedArm.mapValue));
      }
      if (shapedArm.properties) {
        result.properties = shapedArm.properties;
        if (shapedArm.required && shapedArm.required.length > 0) result.required = shapedArm.required;
      }
      // The semantic marker travels with the shape it describes. Lifting
      // `items` but not `kind`/`eventField` left a union arm's descriptor array
      // structurally complete yet semantically anonymous, so every consumer of
      // the `event-list` tag (rename fold, orphan-listener credit, TS codegen
      // scope-qualification) silently skipped it — e.g. `entity-list.itemActions`,
      // whose element already types `event` as `EventKey`.
      if (shapedArm.kind) result.kind = shapedArm.kind;
      if (shapedArm.eventField) result.eventField = shapedArm.eventField;
      // Fill in the shape the winning arm could not carry, so a union with a
      // distinct array arm AND object arm describes both. Never overwrites what
      // `shapedArm` already lifted — this only adds the missing half.
      if (!result.items && arrayArm?.items) result.items = arrayArm.items;
      if (!result.properties && objectArm?.properties) {
        result.properties = objectArm.properties;
        if (objectArm.required && objectArm.required.length > 0) result.required = objectArm.required;
      }
    }
    // The declarative event-outlet contract wins over whatever shape (or lack
    // of one) the sibling arm carries — a `(v: T) => void | EventEmit<P>` prop
    // is authored as an event outlet, the plain-callback arm is the internal
    // fallback signature. Checked after `shapedArm` so it overrides rather
    // than competes with an unrelated object/array shape on another arm.
    if (eventRefArm) {
      result.kind = "event-ref";
      if (eventRefArm.emitPayloadSchema) result.emitPayloadSchema = eventRefArm.emitPayloadSchema;
    } else if (eventListenArm) {
      result.kind = "event-listen";
      if (eventListenArm.listenPayloadSchema) result.listenPayloadSchema = eventListenArm.listenPayloadSchema;
    }
    // A `T | Date` union (e.g. an ISO string or a Date) collapses to the `.lolo`
    // `date` type — `date` accepts string/number, so it covers the other arm.
    if (unionDateLike && !shapedArm) return emptyMapped(["date"]);
    // `T | null` / `T | undefined` is just T made optional, and the null arm is
    // skipped above — so the SURVIVING arm's classification must survive too
    // (a `guard: SomeBrand | null` must keep whatever real tag its sole real
    // arm earned, not silently downgrade to an untagged `object`).
    if (soleRealArm) {
      if (soleRealArm.cyclic) result.cyclic = true;
      if (soleRealArm.cyclicTypeName) result.cyclicTypeName = soleRealArm.cyclicTypeName;
      if (soleRealArm.nonAuthorable) result.nonAuthorable = true;
      if (soleRealArm.controlValue) result.controlValue = true;
      if (soleRealArm.eventPayloadBrand) result.eventPayloadBrand = true;
      if (soleRealArm.jsonValueBrand) result.jsonValueBrand = true;
    }
    return result;
  }

  // Readonly modifier: `readonly T[]` wraps ArrayTypeNode in TypeOperator
  if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return mapTypeNode(node.type, sourceFile, aliases, coreImports, interfaces, seen, genericDefaults);
  }

  // `keyof T` — an object's key set is always string-valued at runtime (the
  // descriptor `Column<T>.key: keyof T | string` is just a field-name string).
  // Map it to `string` so unions like `keyof T | string` don't degrade to
  // `[unknown,string]`.
  if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.KeyOfKeyword) {
    // `keyof JSX.IntrinsicElements` is the closed set of HTML tag names: a string
    // enum read from the React types the component itself resolves.
    if (ts.isTypeReferenceNode(node.type) && intrinsicElementsReference(node.type.typeName)) {
      return { types: ["string"], enumValues: intrinsicElementTags(sourceFile.fileName) };
    }
    return emptyMapped(["string"]);
  }

  // Type references (React.ReactNode, Record<>, aliases like StackJustify, etc.)
  if (ts.isTypeReferenceNode(node)) {
    const typeName = node.typeName.getText(sourceFile);
    const ifaceKey = interfaceKey(interfaces, typeName, coreImports, sourceFile);

    // Semantic alias: `EventKey` from `@almadar/core`. Resolved by type
    // identity (local name matches + imported from `@almadar/core` in this
    // file) rather than by prop name — this is the anchor that lets the
    // registry carry `kind: "event"` without name-matching heuristics.
    // The legacy `'event'` value is kept for back-compat; new authors should
    // prefer `EventEmit<P>` which sets `kind: "event-ref"` AND populates the
    // payload schema for L1/L2 detection (see plan F1).
    if (typeName === "EventKey" && coreImports.has("EventKey")) {
      return { types: ["string"], kind: "event" };
    }

    if (typeName === "EntityFieldName" && coreImports.has("EntityFieldName")) {
      return { types: ["string"], kind: "field-ref" };
    }

    if (typeName === "RowFieldName" && coreImports.has("RowFieldName")) {
      const ofProp = node.typeArguments?.[0];
      if (ofProp && ts.isLiteralTypeNode(ofProp) && ts.isStringLiteral(ofProp.literal)) {
        return { types: ["string"], kind: "field-ref", of: ofProp.literal.text };
      }
      return { types: ["string"], kind: "field-ref" };
    }

    if (typeName === "VisibleText" && coreImports.has("VisibleText")) {
      return { types: ["string"], kind: "text" };
    }

    // Phantom-typed brand from `@almadar/core` for declarative bus-emit
    // props. The structural type is `string`; the type argument `P` carries
    // the bus payload schema for the validator to cross-check against the
    // trait's declared `emits { EVENT { ... } }` payload at parse / validate
    // time. See plan F1 step 1 + L2.2 in the gap doc.
    if (typeName === "EventEmit" && coreImports.has("EventEmit")) {
      const payloadArg = node.typeArguments?.[0];
      const schema = payloadArg
        ? serializePayloadSchema(payloadArg, sourceFile, aliases, coreImports, interfaces, seen)
        : [];
      return { types: ["string"], kind: "event-ref", emitPayloadSchema: schema };
    }

    // Mirror of `EventEmit<P>` for declarative bus-listen props. Reserved
    // for future patterns; no current @almadar/shell-web consumer uses it. The
    // structural type is `string`; `P` documents the payload shape the
    // component subscribes to.
    if (typeName === "EventListen" && coreImports.has("EventListen")) {
      const payloadArg = node.typeArguments?.[0];
      const schema = payloadArg
        ? serializePayloadSchema(payloadArg, sourceFile, aliases, coreImports, interfaces, seen)
        : [];
      return { types: ["string"], kind: "event-listen", listenPayloadSchema: schema };
    }

    // (Entity-data props are detected up-front via `entityRowCardinality` on the
    // single `EntityRow` type — the old `EntityInlet`/`EntityRecord`/
    // `EntityCollection` brands were removed.)

    // `SExpr` brand from `@almadar/core` — a compiled s-expression value.
    // Resolved by type identity (imported from `@almadar/core`), like the
    // `EventKey`/`EventEmit` brands above. The local `SExpression` alias
    // (`type SExpression = SExpr`) resolves through the alias registry to this.
    // Tagged `sexpr` so the generator emits the `.lolo` `SExpr` type
    // (→ the canonical `Record<string, SExpr>` / `SExpr` TS type).
    if (typeName === "SExpr" && coreImports.has("SExpr")) {
      return { types: ["sexpr"] };
    }

    // Core `OrbitalSchema`: a program, which since the language trio is data
    // (`program/read` returns the `.orb` IR as an `sexpr`); core `TraitDescription`
    // is reflection data of the same kind (`behavior/describe`, its machine as IR).
    if ((typeName === "OrbitalSchema" || typeName === "TraitDescription") && coreImports.has(typeName)) {
      return { types: ["sexpr"] };
    }
    // Core `Expression` is core's alias of `SExpr`; `AnyPatternConfig` is a render-ui tree node.
    if ((typeName === "Expression" || typeName === "AnyPatternConfig") && coreImports.has(typeName)) {
      return { types: ["sexpr"] };
    }

    // React DOM event handlers — callback props, not data blobs.
    if (isReactHandlerName(typeName)) {
      return { types: ["function"], kind: "callback", callbackArgs: [] };
    }

    // `Date` → the first-class `.lolo` `date` type (orbital-lolo parser +
    // `FieldType::Date`; `type_helpers` lets it accept ISO-string / epoch-number
    // values). No object/dateLike fallback, no Rust rebuild needed.
    if (typeName === "Date") return emptyMapped(["date"]);

    if (typeName === "React.ReactNode" || typeName === "ReactNode") return emptyMapped(["node"]);
    // A React component passed as a prop (`React.FC<…>` / `FunctionComponent<…>`)
    // — an imperative render-prop override (e.g. GameCanvas3D's tileRenderer /
    // unitRenderer), not a serializable .lolo knob. Omit if optional so the
    // component uses its built-in default renderer; a `{}` JSON default would make
    // `CustomRenderer || DefaultRenderer` resolve to a truthy empty object and
    // throw at render. (`ComponentType`/`ElementType` below is the distinct
    // polymorphic `as` element-name knob.)
    if (
      typeName === "React.FC" || typeName === "FC" ||
      typeName === "React.FunctionComponent" || typeName === "FunctionComponent"
    ) {
      return { types: ["object"], nonAuthorable: true };
    }
    // `Record<K,V>` / `Map<K,V>` are dynamic-key maps. When the VALUE type V is
    // concrete, capture its schema as `mapValue` so the generator emits the
    // `.lolo` `Map string V` type (→ `Record<string, V>`). When V is
    // `unknown`/`any`/`never` (truly open), no shape exists — ACTIONABLE: fix
    // upstream by declaring V, not by widening to a shapeless `object`.
    // A native runtime `Map`/`Set`/`WeakMap`/`WeakSet` INSTANCE is not a plain
    // object — `Record<K,V>`/`{}` is not assignable to it, and it can't be
    // authored as a `.lolo` knob. Mark non-authorable (omit if optional).
    // (Distinct from `Record<K,V>` below, which IS a plain-object dictionary.)
    if (
      typeName === "Map" || typeName === "ReadonlyMap" ||
      typeName === "Set" || typeName === "ReadonlySet" ||
      typeName === "WeakMap" || typeName === "WeakSet"
    ) {
      return { types: ["object"], nonAuthorable: true };
    }
    if (typeName === "Record") {
      const valueArg = node.typeArguments?.[1];
      const isOpaqueValue =
        !valueArg ||
        valueArg.kind === ts.SyntaxKind.UnknownKeyword ||
        valueArg.kind === ts.SyntaxKind.AnyKeyword ||
        valueArg.kind === ts.SyntaxKind.NeverKeyword;
      if (!isOpaqueValue) {
        const mapValue = mapTypeNode(valueArg, sourceFile, aliases, coreImports, interfaces, seen, genericDefaults);
        const keyArg = node.typeArguments?.[0];
        const keyEnum = keyArg
          ? mapTypeNode(keyArg, sourceFile, aliases, coreImports, interfaces, seen, genericDefaults).enumValues
          : undefined;
        return {
          types: ["object"],
          mapValue,
          ...eventMapKind(mapValue),
          ...(keyEnum && keyEnum.length > 0 ? { mapKeyEnum: keyEnum } : {}),
        };
      }
      return { types: ["object"] };
    }
    // Injected runtime handle / structural orbital brand — not a drop-time knob.
    if (NON_AUTHORABLE_BRAND_NAMES.has(typeName)) {
      return { types: ["object"], nonAuthorable: true };
    }
    if (typeName === "LucideIcon") return emptyMapped(["icon"]);
    // `AssetUrl` brand from `@almadar/core` — an asset-reference URL string.
    // Detected by type identity (imported from `@almadar/core`), mirroring the
    // `LucideIcon`/`EventKey` markers. Tagged `asset` so the generator emits a
    // `string` config knob declared as the `asset` config type, which the
    // property inspector dispatches an AssetPicker on.
    if (typeName === "AssetUrl" && coreImports.has("AssetUrl")) return emptyMapped(["asset"]);
    // `GpuBuffer` from `@almadar/core` — a sealed kernel handle; the registry type is the sealed type's name, so
    // a prop typed with it takes only a `GpuBuffer` binding (EXEC-GPU-7).
    if (typeName === "GpuBuffer" && coreImports.has("GpuBuffer")) return emptyMapped(["GpuBuffer"]);
    // `Asset` — the UNIFIED asset struct from `@almadar/core` (`{ url: AssetUrl; role;
    // category; animations?; style?; dimension?; aspect?; ... }`). It is an imported
    // interface (not in the local `interfaces` map), so expand it explicitly here so the
    // value lowers to a lolo `Asset` STRUCT (`{ url: asset, role, dimension, animations,
    // aspect }`) — the render metadata travels with the asset — instead of degrading to
    // the opaque-`@almadar/core` object/string fallback below. The inner `url` is tagged
    // `asset` so the inspector dispatches the AssetPicker on it.
    if (typeName === "Asset" && coreImports.has("Asset")) {
      return {
        types: ["object"],
        properties: {
          url: emptyMapped(["asset"]),
          // `role`/`category` are REQUIRED free strings per core's
          // `SemanticAssetRef` (asset.ts) — role's vocabulary is deliberately
          // unconstrained (genre boards use `boss`, `tower`, …), so no
          // `ENTITY_ROLES` enum here; the projected knob type must stay
          // assignable to `Asset` (required role/category), or every emitted
          // shell's asset prop fails tsc.
          role: emptyMapped(["string"]),
          category: emptyMapped(["string"]),
          // `Asset.animations` is a plain `string[]` in core (asset.ts) — not the
          // `AnimationName` enum — so it stays open.
          animations: { types: ["array"], items: emptyMapped(["string"]) },
          style: enumMapped("VISUAL_STYLES"),
          variant: emptyMapped(["string"]),
          dimension: enumMapped("ASSET_DIMENSIONS"),
          aspect: enumMapped("ASSET_ASPECTS"),
          // `atlas` is an `AssetUrl` (sheet-slicing atlas JSON) — same
          // AssetPicker tag as `url`; `sprite` selects within it.
          atlas: emptyMapped(["asset"]),
          sprite: emptyMapped(["string"]),
          name: emptyMapped(["string"]),
          thumbnailUrl: emptyMapped(["string"]),
        },
        required: ["url", "role", "category"],
      };
    }
    // `ScenePos` — the neutral scene coordinate from `@almadar/core` (`{ x; y; z? }`).
    // Detected by type identity (imported from `@almadar/core`), mirroring the
    // `Asset`/`AssetUrl`/`EventKey` brands. The value stays an authorable `{x,y,z}`
    // object (no new compiler primitive), but `scenePos: true` records the TYPE
    // IDENTITY so `toPatternEntry` can derive the entry's `drawable` capability —
    // the single source-tagged contract the orbital-rust validator reads. Propagates
    // through array `items`, so a `-layer` molecule's element position is detected.
    if (typeName === "ScenePos" && coreImports.has("ScenePos")) {
      return {
        types: ["object"],
        properties: {
          x: emptyMapped(["number"]),
          y: emptyMapped(["number"]),
          z: emptyMapped(["number"]),
        },
        required: ["x", "y"],
        scenePos: true,
      };
    }
    // `DrawableNode` — the drawable-descriptor UNION from @almadar/shell-web's drawable
    // lib (`draw-sprite | draw-shape | draw-text | draw-*-layer`). A prop typed
    // `DrawableNode[]` is a draw-HOST's children slot (canvas-2d / canvas-3d / the
    // unified canvas). Detected by type identity (imported from the drawable lib),
    // mirroring the `ScenePos` brand: the value stays an opaque drawable object, but
    // `drawableSlot: true` records the TYPE IDENTITY so `toPatternEntry` derives the
    // entry's `drawHost` capability — the contract UISlotRenderer + the orbital-rust
    // validator read to route/gate authored `children` as painted descriptors.
    if (typeName === "DrawableNode" && coreImports.has("DrawableNode")) {
      return { types: ["object"], drawableSlot: true };
    }
    // Polymorphic element/component prop (`as?: ElementType`): the value is an
    // HTML element name. Tag `component`; the generator emits an element-name
    // string knob and codegen casts to `keyof React.JSX.IntrinsicElements`
    // (which both `ElementType` and `keyof IntrinsicElements` props accept).
    if (
      typeName === "ElementType" ||
      typeName === "React.ElementType" ||
      typeName === "ComponentType" ||
      typeName === "React.ComponentType"
    ) {
      return emptyMapped(["component"]);
    }
    // Inline-style map: the honest wire shape is a string-keyed map of css
    // values → `Map string string` (numeric values serialize; the style
    // passthrough accepts both). Was `emptyMapped(["object"])`, which fell
    // to the `json` knob — the single most-composed generic in the corpus.
    if (typeName === "React.CSSProperties" || typeName === "CSSProperties") {
      return { types: ["object"], mapValue: { types: ["string"] } };
    }

    // `Array<T>` / `ReadonlyArray<T>` — mirrors the `T[]` case above.
    // Same `items` recursion so element type info reaches downstream consumers.
    if (typeName === "Array" || typeName === "ReadonlyArray") {
      const typeArg = node.typeArguments?.[0];
      if (typeArg) {
        const eventField = findEventFieldInInterfaceRef(typeArg, sourceFile, interfaces, coreImports);
        const items = mapTypeNode(typeArg, sourceFile, aliases, coreImports, interfaces, seen, genericDefaults);
        const result: MappedType = { types: ["array"], items };
        if (items.kind === "field-ref" || items.kind === "text") result.itemKind = items.kind;
        if (eventField) {
          result.kind = "event-list";
          result.eventField = eventField;
        }
        return result;
      }
      return emptyMapped(["array"]);
    }

    if (node.typeArguments && node.typeArguments.length > 0) {
      if (typeName === "Set") return emptyMapped(["object"]);
    }

    // Mapped-type wrappers. `Readonly<X>` / `Required<X>` / `Partial<X>` don't
    // change the structural key set the registry cares about, so unwrap the
    // inner argument and resolve ITS shape (e.g. `Readonly<SchemaField>` →
    // SchemaField's `properties`) instead of degrading to a shapeless object.
    if (
      (typeName === "Readonly" || typeName === "Required" || typeName === "Partial") &&
      node.typeArguments &&
      node.typeArguments.length > 0
    ) {
      return mapTypeNode(node.typeArguments[0], sourceFile, aliases, coreImports, interfaces, seen, genericDefaults);
    }
    if (["Omit", "Pick", "Partial", "Required", "Readonly"].includes(typeName)) {
      return emptyMapped(["object"]);
    }

    // Same-file alias shadows the cross-file registry (standard TS scoping): a
    // locally-declared `type CameraMode = …` binds references in THIS file even
    // when another file exports a same-named alias. The registry collapses name
    // collisions to the FIRST-scanned declaration, so without this the 2D
    // `CameraMode` (`pan-zoom|follow|fixed`, scanned before `3d/`) leaks into
    // GameCanvas3D's 3D `cameraMode` prop.
    if (!seen.has(typeName)) {
      const local = findLocalTypeAlias(sourceFile, typeName);
      if (local) {
        const nextSeen = new Set(seen);
        nextSeen.add(typeName);
        return mapTypeNode(local, sourceFile, aliases, coreImports, interfaces, nextSeen, genericDefaults);
      }
    }

    // Resolve through the cross-file alias registry so `justify?: StackJustify`
    // reduces to its underlying `"start" | "center" | "end" | ...` union.
    // `seen` prevents infinite recursion on self-referencing aliases (none in
    // the codebase today, but cheap insurance).
    if (aliases.has(typeName) && !seen.has(typeName)) {
      const alias = aliases.get(typeName)!;
      const nextSeen = new Set(seen);
      nextSeen.add(typeName);
      // Recurse with the alias's OWN declaring sourceFile AND its OWN coreImports —
      // `member.name.getText()` on inline literals inside the alias body reads against
      // that file (not the consuming file → garbage offsets), and a `@almadar/core`
      // marker referenced in the alias body (e.g. `Asset` inside `type IsometricUnit`)
      // must be resolved against the alias file's imports, not the caller's (which may
      // not import it — else the marker degrades to an opaque `json`/`object`).
      return mapTypeNode(alias.type, alias.sourceFile, aliases, alias.coreImports, interfaces, nextSeen);
    }

    // Type reference to a declared interface (e.g. `TagCloudItem`,
    // `FileTreeNode`, `WizardProgressStep`). Walk the interface's OWN members
    // AND its `extends` heritage chain (plain base / `Omit<Base,K>` /
    // `Pick<Base,K>`, via `resolveInterfaceShapeDeep`) and build a per-key
    // `properties` schema so validators / codegen can enforce exact key names
    // and types instead of treating it as an opaque object, and so a shape
    // declared through TS composition (e.g.
    // `GameHudStat extends Omit<StatBadgeProps, "size">`) is flattened the
    // same as a self-contained interface. `seen` prevents infinite recursion
    // on self-referencing interfaces.
    if (interfaces.has(ifaceKey) && !seen.has(ifaceKey)) {
      const shape = resolveInterfaceShapeDeep(ifaceKey, aliases, interfaces, seen);
      return { types: ["object"], properties: shape?.properties ?? {}, required: shape?.required ?? [] };
    }

    // Self-referential interface reference (the recursion guard already holds
    // this name) — e.g. a tree node's `children: MenuItem[]`. The shape is fully
    // captured at the parent level; flag it `cyclic` so the generator's `json`
    // fallback here is classified accepted, not an actionable loose-source gap.
    if (interfaces.has(ifaceKey) && seen.has(ifaceKey)) {
      return { types: ["object"], cyclic: true, cyclicTypeName: typeName };
    }

    // Known cross-file element types with hardcoded field sets (definitions live
    // outside the scanned `components/` tree — e.g. discriminated unions from lib/).
    if (KNOWN_CONCRETE_ELEMENT_TYPES[typeName]) {
      return KNOWN_CONCRETE_ELEMENT_TYPES[typeName];
    }

    // `FieldValue` / `ControlValue` brand from `@almadar/core` — the form
    // control transport union (`string | number | boolean | [string] |
    // FileValue`). Detected by type identity, mirroring the `AssetUrl`/`SExpr`
    // brands above. `FieldValue` is the wider "entity field, may hold
    // `undefined` map entries" spelling; both carry the same wire shape, so
    // both tag `controlValue` and the generator emits the one shared alias.
    if ((typeName === "FieldValue" || typeName === "ControlValue") && coreImports.has(typeName)) {
      return { types: ["object"], controlValue: true };
    }
    // `EventPayload`/`EventPayloadValue` brand from `@almadar/core` — a
    // string-keyed recursive bag of scalar-ish bus-payload values. Detected
    // by type identity, mirroring the brands above. Tagged `eventPayloadBrand`
    // so the generator emits the declared recursive `EventPayloadValue` alias.
    if (typeName === "EventPayload" && coreImports.has("EventPayload")) {
      return { types: ["object"], eventPayloadBrand: true };
    }
    // `JsonObject`/`ToolArgs` from `@almadar/core` — both literally
    // `Record<string, JsonValue>` (the KEYED BAG form). Routed through the
    // existing `mapValue` carrier (same mechanism `Record<K,V>` itself uses
    // just below) so it resolves via the GENERIC `Map string <V>` path —
    // `V` here is the nested `jsonValueBrand`-tagged `JsonValue` union.
    if ((typeName === "JsonObject" || typeName === "ToolArgs") && coreImports.has(typeName)) {
      return { types: ["object"], mapValue: { types: ["object"], jsonValueBrand: true } };
    }
    // `JsonValue` from `@almadar/core` — the "data crossed a boundary"
    // recursive union ITSELF (not a keyed bag). Detected by type identity,
    // mirroring the brands above. Tagged `jsonValueBrand` so the generator
    // emits the declared recursive `JsonValue` alias — transcribing the core
    // type's own declared shape, not inventing one.
    if (typeName === "JsonValue" && coreImports.has(typeName)) {
      return { types: ["object"], jsonValueBrand: true };
    }
    // `SkeletonSpec` from `@almadar/core` — the universal awaiting-skeleton
    // prop's value. Detected by type identity; pattern-sync's
    // `withSkeletonProps` writes its declared registry shape.
    if (typeName === "SkeletonSpec" && coreImports.has(typeName)) {
      return { types: ["string"], enumValues: [...SKELETON_VARIANTS, "none"], skeletonSpec: true };
    }
    if (typeName === "SkeletonVariant" && coreImports.has(typeName)) {
      return { types: ["string"], enumValues: [...SKELETON_VARIANTS] };
    }
    // `SurfaceMode` from `@almadar/core` — a content block's `surface` prop.
    if (typeName === "SurfaceMode" && coreImports.has(typeName)) {
      return { types: ["string"], enumValues: [...SURFACE_MODES] };
    }
    // Structural cross-package RUNTIME type (`OrbitalSchema`, `SExpr`,
    // `Trait`/`CoreTrait`, `DomLayoutData`, …) — the orbital/interpreter
    // supplies these at runtime; they are not data a `.lolo` config knob
    // could ever carry (no `default`, no author-facing shape), so they're
    // NON-AUTHORABLE (the generator omits an optional one; a required one
    // gets a best-effort default) rather than a data-shape gap.
    if (OPAQUE_DOMAIN_TYPES.has(typeName)) {
      return { types: ["object"], nonAuthorable: true };
    }

    // Bound generic type parameter: the enclosing Props interface declared
    // `<T = Default>` / `<T extends Constraint>` and this reference IS that
    // parameter — resolve to the declared default/constraint's OWN shape
    // instead of falling through to the property-less `genericParam`
    // fallback below (Carousel `CarouselProps<T = CarouselItem>` →
    // `items: T[]` → `CarouselItem`'s real `{ id; title; image }` shape).
    if (!node.typeArguments && genericDefaults.has(typeName)) {
      const bound = genericDefaults.get(typeName)!;
      const nextSeen = new Set(seen);
      nextSeen.add(typeName);
      return mapTypeNode(bound, sourceFile, aliases, coreImports, interfaces, nextSeen, genericDefaults);
    }

    // Unbound generic type parameter (`T`, `K`, `V`, `TItem`, …): a short,
    // uppercase-initial identifier with no type arguments that resolved to
    // neither an alias nor an interface, AND (checked above) not one of the
    // enclosing Props interface's OWN type parameters with a declared
    // default/constraint. Its shape is supplied by the consumer's
    // instantiation — no honest shape exists here at all, so it's
    // ACTIONABLE. `genericParam` is carried so a caller that widens an
    // array's element shape doesn't ALSO guess it's a scalar map — a
    // generic's real instantiation can be scalar-shaped, not necessarily
    // object-shaped.
    if (
      !node.typeArguments &&
      /^[A-Z][A-Za-z]?$|^T[A-Z]/.test(typeName) &&
      !aliases.has(typeName) &&
      !interfaces.has(ifaceKey)
    ) {
      return { types: ["object"], genericParam: true };
    }

    {
      const imported = resolveImportedType(typeName, sourceFile);
      if (imported && seen.has(typeName)) return { types: ["object"], cyclic: true, cyclicTypeName: typeName };
      if (imported && "objectShaped" in imported) return emptyMapped(["object"]);
      if (imported) {
        const nextSeen = new Set(seen);
        nextSeen.add(typeName);
        const resolved = mapTypeNode(imported.type, imported.sourceFile, aliases, collectCoreImports(imported.sourceFile), interfaces, nextSeen, genericDefaults);
        return resolved.types.length === 1 && resolved.types[0] === "object" ? emptyMapped(["object"]) : resolved;
      }
    }

    const platform = PLATFORM_TYPES[typeName];
    if (platform) return emptyMapped([...platform.types]);

    throw new UnresolvedTypeError(typeName);
  }

  // Function types — extract positional parameter names + types as
  // `callbackArgs`. When a schema author binds a callback prop to an event
  // name (e.g. `onTabChange: "TAB_CHANGED"`), the validator (L2.2) uses
  // these to verify name-and-type parity with the trait's declared event
  // payload, and codegen + runtime (C2) build the object payload from the
  // named callback args. See plan F1 step 3.
  if (ts.isFunctionTypeNode(node)) {
    const args: ExtractedCallbackArg[] = [];
    let nonEmittable = false;
    for (const param of node.parameters) {
      const argName = param.name.getText(sourceFile);
      if (param.type && typeNodeIsNonSerializable(param.type, sourceFile)) {
        nonEmittable = true;
      }
      const argType = param.type
        ? mapTypeNode(param.type, sourceFile, aliases, coreImports, interfaces, seen, genericDefaults)
        : emptyMapped(["unknown"]);
      // Carry the full object shape so the generated factory's emit payload can
      // declare a concrete struct (→ strict inline TS payload type) instead of
      // a shapeless `object`. Scalars keep just the `type` string.
      const arg: ExtractedCallbackArg = { name: argName, type: argType.types[0] ?? "unknown" };
      // Carry the shape for ARRAY args too, not just objects. A callback typed
      // `(selected: string[]) => void` published only `type: "array"`, so the
      // generated payload field degraded to `[object]` — the element type was
      // known at extraction and thrown away one line later.
      if (
        (argType.properties && Object.keys(argType.properties).length > 0) ||
        argType.items ||
        argType.mapValue
      ) {
        arg.schema = mappedToPropTypeSchema(argType);
      }
      args.push(arg);
    }
    // A function prop that RETURNS a value (ReactNode, a sprite, a derived
    // number, …) is a render-prop / compute-prop, not an event-dispatch
    // callback — the component calls it to render or compute, never to emit on
    // the bus. Only `=> void` callbacks are real event outlets. Mark the
    // render-prop kind so the factory generator skips it instead of minting a
    // spurious (and sometimes deeply-nested, uncompilable) emit payload.
    const returnsValue =
      node.type !== undefined && node.type.kind !== ts.SyntaxKind.VoidKeyword;
    return {
      types: ["function"],
      // A render-prop/compute-prop (RETURNS a value — `renderCallback: true`)
      // is called to render or compute, never dispatched on the bus, so it
      // carries no event-outlet `kind` at all. Only a real `=> void` bus-emit
      // callback gets `kind: "callback"` — the mis-tag that made data-grid /
      // data-list / table-view / calendar-grid / carousel's `children` read
      // as an event outlet (2026-09-12).
      kind: returnsValue ? undefined : "callback",
      callbackArgs: args,
      renderCallback: returnsValue ? true : undefined,
      nonAuthorable: returnsValue ? true : undefined,
      nonEmittable: nonEmittable ? true : undefined,
    };
  }

  // Intersection types (A & B) — e.g. `EntityRow & { id, src, alt }`. Merge the
  // `properties` of every object-shaped arm (declared interfaces, aliases that
  // resolve to objects, and inline type literals) into one combined key set so
  // the literal arm's fields survive instead of degrading to a shapeless object.
  // Later arms win on key collision (the explicit arm refines the base).
  if (ts.isIntersectionTypeNode(node)) {
    const merged: Record<string, MappedType> = {};
    const required = new Set<string>();
    for (const member of node.types) {
      const m = mapTypeNode(member, sourceFile, aliases, coreImports, interfaces, seen, genericDefaults);
      if (m.properties) {
        for (const [k, v] of Object.entries(m.properties)) merged[k] = v;
        for (const r of m.required ?? []) required.add(r);
      }
    }
    if (Object.keys(merged).length > 0) {
      return { types: ["object"], properties: merged, required: Array.from(required) };
    }
    return emptyMapped(["object"]);
  }

  // Parenthesized types
  if (ts.isParenthesizedTypeNode(node)) {
    return mapTypeNode(node.type, sourceFile, aliases, coreImports, interfaces, seen, genericDefaults);
  }

  // Tuple types — `[number, number]`, `[ReactNode, ReactNode]`, etc. Treated as
  // an array whose element schema is the UNION of the tuple slots: a homogeneous
  // tuple (`[number, number]`) yields a single concrete element type, a mixed
  // tuple merges. A tuple of render nodes (e.g. Split's `[left, right]`) merges
  // to `items.types = ['node']`, which `resolveType` already spells `node`
  // directly — a real declared `.lolo` type, not a fallback needing a flag.
  if (ts.isTupleTypeNode(node)) {
    const elementNodes = node.elements.map((el) =>
      ts.isNamedTupleMember(el) ? el.type : el,
    );
    if (elementNodes.length === 0) return emptyMapped(["array"]);
    const mappedEls = elementNodes.map((el) =>
      mapTypeNode(el, sourceFile, aliases, coreImports, interfaces, seen, genericDefaults),
    );
    const elTypes = new Set<string>();
    for (const m of mappedEls) for (const t of m.types) elTypes.add(t);
    const items: MappedType = mappedEls.length === 1
      ? mappedEls[0]
      : { types: Array.from(elTypes) };
    return mappedEls.length >= 2 ? { types: ["array"], items, tupleItems: mappedEls } : { types: ["array"], items };
  }

  // `(typeof CONST_ARRAY)[number]` — const-assertion tuple indexing.
  // Walk the declaring file to find `const CONST_ARRAY = [...] as const`
  // and extract its string-literal elements as an enum.
  if (ts.isIndexedAccessTypeNode(node)) {
    const indexType = node.indexType;
    // Unwrap parenthesized object type: `(typeof X)[number]` wraps the TypeQuery
    // in a ParenthesizedType before the IndexedAccess, so we must peel it first.
    const objectType = ts.isParenthesizedTypeNode(node.objectType)
      ? node.objectType.type
      : node.objectType;
    if (indexType.kind === ts.SyntaxKind.NumberKeyword && ts.isTypeQueryNode(objectType)) {
      const constName = objectType.exprName.getText(sourceFile);
      const values = extractConstArrayLiterals(constName, sourceFile);
      if (values.length > 0) {
        return { types: ["string"], enumValues: values };
      }
    }
    return emptyMapped(["string"]);
  }

  // Inline object type literal — `{ label: string; event?: string }`. Walk the
  // members into a per-key `properties` schema (mirrors the declared-interface
  // branch) so inline-shaped props (DetailPanel `status`, DataTable `emptyAction`)
  // and inline array elements (`itemActions: { … }[]`) carry their real shape
  // instead of degrading to a property-less `object`. Index signatures and
  // methods are skipped — only property signatures map to registry keys.
  if (ts.isTypeLiteralNode(node)) {
    // An INDEX SIGNATURE (`{ [k: string]: V }`) is a dynamic-key map, the same
    // shape `Record<string, V>` denotes — and it was being skipped entirely, so
    // `traitDetails: { [k: string]: TraitLevelData }` published a property-less
    // `object` while the identical `Record<>` spelling resolved. Report it as a
    // map so `lolo-ui` emits `Map string V`.
    const indexSig = node.members.find(ts.isIndexSignatureDeclaration);
    if (indexSig?.type && !node.members.some(ts.isPropertySignature)) {
      const mapValue = mapTypeNode(indexSig.type, sourceFile, aliases, coreImports, interfaces, seen, genericDefaults);
      return { types: ["object"], mapValue, ...eventMapKind(mapValue) };
    }
    const properties: Record<string, MappedType> = {};
    const required: string[] = [];
    let propCount = 0;
    for (const member of node.members) {
      if (!ts.isPropertySignature(member)) continue;
      const propName = propNameText(member.name, sourceFile);
      const propType = member.type
        ? mapTypeNode(member.type, sourceFile, aliases, coreImports, interfaces, seen, genericDefaults)
        : emptyMapped(["unknown"]);
      const nullableRequired = !member.questionToken && isNullableMember(member.type);
      properties[propName] = nullableRequired ? { ...propType, nullable: true } : propType;
      if (!member.questionToken && !isNullableMember(member.type)) required.push(propName);
      propCount += 1;
    }
    if (propCount > 0) return { types: ["object"], properties, required };
    return emptyMapped(["object"]);
  }

  // A BARE string/numeric/boolean literal type (`type: 'draw-shape'`) — a
  // closed vocabulary of ONE. The union arm above already handles literals as
  // union MEMBERS; on its own a literal fell all the way through to `unknown`,
  // and `unknown` is what made every drawable descriptor's discriminant emit
  // `type : json` in the generated `.lolo`. A one-member vocabulary is still a
  // vocabulary: report the primitive plus its single legal value.
  if (ts.isLiteralTypeNode(node)) {
    if (ts.isStringLiteral(node.literal)) {
      return { types: ["string"], enumValues: [node.literal.text] };
    }
    if (ts.isNumericLiteral(node.literal)) {
      return { types: ["number"], numericEnumValues: [Number(node.literal.text)] };
    }
    if (
      node.literal.kind === ts.SyntaxKind.TrueKeyword ||
      node.literal.kind === ts.SyntaxKind.FalseKeyword
    ) {
      return emptyMapped(["boolean"]);
    }
  }

  // Bare `typeof CONST` where CONST is a module-level string const
  // (`targetQuestionId: string | typeof END_OF_SURVEY`) — the type IS that
  // one string literal. Without this branch it read as `unknown`, which sent
  // the whole union to the `json` fallback.
  if (ts.isTypeQueryNode(node)) {
    const value = extractConstStringLiteral(node.exprName.getText(sourceFile), sourceFile);
    if (value !== undefined) {
      return { types: ["string"], enumValues: [value] };
    }
  }

  return emptyMapped(["unknown"]);
}

/**
 * Serialize a TypeScript type node into a flat list of payload-schema
 * fields suitable for the registry's `emitPayloadSchema` /
 * `listenPayloadSchema`. Mirrors the shape Almadar uses for trait
 * `payloadSchema` so consumers (lolo, validator) can compare apples to
 * apples.
 *
 * Handles three sources of `P` in `EventEmit<P>` / `EventListen<P>`:
 *
 * 1. **Type literal** `{ tabId: string }` — walks members directly.
 * 2. **Type reference to a known interface** (e.g. `MapMarkerData`) — looks
 *    the interface up in the registry and walks its members. Required when
 *    components reference shared shapes (e.g. `EventEmit<MapMarkerData>`).
 * 3. **`Record<string, never>`** — empty payload (no required fields). The
 *    canonical "fires with no payload" shape; emitted as `[]`.
 *
 * Anything else (intersection, union, `EventPayload`, unresolved alias) is
 * recorded as a single field with a placeholder name `_payload` and type
 * `object` so the validator at least knows it's an object payload, even if
 * the field set is variable. Callers can then decide whether to skip the
 * shape compare.
 *
 * Optional members (`field?: T`) get `required: false`; required members
 * get `required: true`. Field types use the same `mapTypeNode` resolver as
 * the prop-level extraction so primitive vs object distinctions land
 * consistently.
 */
function serializePayloadSchema(
  node: ts.TypeNode,
  sourceFile: ts.SourceFile,
  aliases: AliasRegistry,
  coreImports: ImportedSymbolSet,
  interfaces: InterfaceRegistry,
  seen: Set<string>,
): ExtractedPayloadField[] {
  // Direct inline type literal: `{ tabId: string }`
  if (ts.isTypeLiteralNode(node)) {
    return collectFields(node.members, sourceFile, aliases, coreImports, interfaces, seen);
  }

  // Type reference: `MapMarkerData` / `Record<string, never>` / etc.
  if (ts.isTypeReferenceNode(node)) {
    const typeName = node.typeName.getText(sourceFile);

    // `Record<string, never>` — sentinel for "empty payload, no fields".
    // Pattern-sync emits `[]` so the validator knows the bus event carries
    // no required payload fields.
    if (typeName === "Record" && node.typeArguments?.length === 2) {
      const valueArg = node.typeArguments[1];
      if (valueArg.kind === ts.SyntaxKind.NeverKeyword) return [];
    }

    // Resolve through the interface registry: `EventEmit<DialogueChoice>`
    // and similar shared-shape props pull their fields from the declaring
    // interface so the validator sees the full schema.
    const ifaceKey = interfaceKey(interfaces, typeName, coreImports, sourceFile);
    const ifaceEntry = interfaces.get(ifaceKey);
    if (ifaceEntry && !seen.has(ifaceKey)) {
      const nextSeen = new Set(seen);
      nextSeen.add(ifaceKey);
      return collectFields(
        ifaceEntry.members,
        ifaceEntry.sourceFile,
        aliases,
        ifaceEntry.coreImports,
        interfaces,
        nextSeen,
      );
    }

    // Fall through to the catch-all when alias resolves to a literal we
    // can walk inline.
    if (aliases.has(typeName) && !seen.has(typeName)) {
      const alias = aliases.get(typeName)!;
      const nextSeen = new Set(seen);
      nextSeen.add(typeName);
      return serializePayloadSchema(alias.type, alias.sourceFile, aliases, coreImports, interfaces, nextSeen);
    }
  }

  // Parenthesized: unwrap and recurse.
  if (ts.isParenthesizedTypeNode(node)) {
    return serializePayloadSchema(node.type, sourceFile, aliases, coreImports, interfaces, seen);
  }

  // Intersection (`A & B`) — a CONJUNCTION: every member's fields are present
  // together, so flatten the union of them and keep each field's own
  // requiredness. This is how every shared payload type in `@almadar/core` is
  // written (`ItemActionPayload = EventPayload & { id; row }`), and without
  // this arm they all collapsed into the `_payload` catch-all below — so a
  // prop correctly typed `EventEmit<ItemActionPayload>` still published an
  // opaque payload. First writer of a field name wins; `EventPayload`-style
  // index-signature bases contribute no named members and drop out naturally.
  if (ts.isIntersectionTypeNode(node)) {
    const merged: ExtractedPayloadField[] = [];
    let shapeMembers = 0;
    for (const member of node.types) {
      const memberFields = serializePayloadSchema(member, sourceFile, aliases, coreImports, interfaces, seen);
      if (memberFields.some((f) => f.name !== "_payload")) shapeMembers++;
      for (const f of memberFields) {
        // An unreadable member (or the `EventPayload` index-signature base)
        // contributes no NAMED fields — it only means "extra keys may ride
        // along", which is what an open payload already permits. Skip it and
        // keep the members we can read; declaring the known subset beats
        // declaring nothing. If no member yielded a named field we fall
        // through to the opaque form below.
        if (f.name === "_payload") continue;
        if (!merged.some((m) => m.name === f.name)) merged.push(f);
      }
    }
    // Requiredness depends on how many members actually carry named fields.
    // ONE (the `EventPayload & { … }` idiom every shared core payload uses):
    // a real conjunction — the base only permits extra keys, so the shape
    // member's own requiredness stands.
    // TWO OR MORE: distinct shapes combined. TypeScript says "and", but the
    // only way a value satisfies several disjoint required sets at once is if
    // they genuinely co-occur, and nothing here can establish that — in this
    // codebase every such case (all 3 are Canvas's mode-polymorphic events) is
    // an assignability stand-in for "or". Mark them optional: a false-optional
    // loses a check, a false-required manufactures a blocking Gate B error on
    // every consumer that declares one mode's fields.
    if (shapeMembers > 1) return merged.map((f) => ({ ...f, required: false }));
    if (merged.length > 0) return merged;
  }

  // Catch-all for variable shapes (`EventPayload`, unions we can't flatten).
  // Validator falls back to "object payload, unknown fields" — still better
  // than no schema at all because L1's event-name-declared check still fires.
  return [{ name: "_payload", type: "object", required: false }];
}

/**
 * Walk a list of object-type members (from a type literal or interface)
 * and produce flat `ExtractedPayloadField` entries. Skips index signatures
 * and method declarations — payload schemas are property-only.
 */
function collectFields(
  members: ReadonlyArray<ts.TypeElement>,
  sourceFile: ts.SourceFile,
  aliases: AliasRegistry,
  coreImports: ImportedSymbolSet,
  interfaces: InterfaceRegistry,
  seen: Set<string>,
): ExtractedPayloadField[] {
  const fields: ExtractedPayloadField[] = [];
  for (const member of members) {
    if (!ts.isPropertySignature(member)) continue;
    const name = member.name?.getText(sourceFile);
    if (!name) continue;
    const required = !member.questionToken;
    const fieldType = member.type
      ? mapTypeNode(member.type, sourceFile, aliases, coreImports, interfaces, seen)
      : emptyMapped(["unknown"]);
    // Carry the structured shape when there is one. `types[0]` alone turns
    // `readonly string[]` into the bare word "array", which the generator can
    // only render as `[object]`. A `controlValue`/`eventPayloadBrand`/
    // `jsonValueBrand`-tagged field carries no `items`/`properties`/`mapValue`
    // of its own — the marker IS the shape — so it must ride along too, or the
    // generator loses the tag and falls back to the untagged
    // `payloadFieldType('object', …)` path.
    const structured =
      (fieldType.items !== undefined ||
        (fieldType.properties !== undefined && Object.keys(fieldType.properties).length > 0) ||
        fieldType.mapValue !== undefined ||
        fieldType.controlValue ||
        fieldType.eventPayloadBrand ||
        fieldType.jsonValueBrand) ? fieldType : undefined;
    const memberTags = getPropJSDocTags(member, sourceFile);
    fields.push({
      name,
      type: fieldType.types[0] ?? "unknown",
      required,
      ...(fieldType.kind === "event" ? { kind: "event" as const } : {}),
      ...(memberTags.payloadFor ? { payloadFor: memberTags.payloadFor } : {}),
      // A string-literal-union field (directly, or through an alias like
      // `EditorMotion`) — `mapTypeNode` already lifts the members onto
      // `enumValues` for the top-level union branch; carry that same
      // computed value through instead of flattening to bare `"string"`.
      ...(fieldType.enumValues?.length ? { enumValues: fieldType.enumValues } : {}),
      ...(structured ? { schema: structured } : {}),
    });
  }
  return fields;
}

/**
 * Given a type node that appears as the element of an array (`T[]`,
 * `readonly T[]`, `Array<T>`, `ReadonlyArray<T>`), check whether T is a
 * type reference to an interface in {@link InterfaceRegistry} AND that
 * interface contains a field whose declared type is `EventKey`. Returns
 * the field name when it matches, `undefined` otherwise.
 *
 * Used to mark per-item event descriptors (e.g. `DataGridItemAction.event:
 * EventKey`) as `event-list` on the parent pattern prop (e.g. DataGrid's
 * `itemActions`). Keeps detection type-driven: consumers don't guess from
 * the prop name — they see the marker because a registered interface
 * actually has an EventKey-typed field.
 */
function findEventFieldInInterfaceRef(
  elementType: ts.TypeNode,
  sourceFile: ts.SourceFile,
  interfaces: InterfaceRegistry,
  callerCoreImports: ImportedSymbolSet,
): string | undefined {
  // Homomorphic wrappers preserve every member and its type, so
  // `readonly Readonly<SchemaAction>[]` carries the same event field as
  // `readonly SchemaAction[]`. Without this the lookup used the literal name
  // "Readonly", missed the registry, and the prop went untagged.
  const element = unwrapHomomorphicWrapper(elementType);

  // Inline `{ … }[]` — the members are right here, so scan them against the
  // CALLER's core imports. Previously any non-TypeReferenceNode was rejected
  // outright, which hid every anonymously-typed descriptor array.
  if (ts.isTypeLiteralNode(element)) {
    return findEventFieldInMembers(element.members, sourceFile, callerCoreImports, (fields) =>
      reportAmbiguousEventField(`inline type literal in ${sourceFile.fileName}`, fields),
    );
  }

  if (!ts.isTypeReferenceNode(element)) return undefined;
  const typeName = element.typeName.getText();
  const entry = interfaces.get(interfaceKey(interfaces, typeName, callerCoreImports, sourceFile));
  if (!entry) return undefined;
  return findEventFieldInMembers(entry.members, entry.sourceFile, entry.coreImports, (fields) =>
    reportAmbiguousEventField(typeName, fields),
  );
}

/** Ambiguous descriptor shapes seen this run — reported once each, at the end. */
const ambiguousEventFields = new Map<string, readonly string[]>();

function reportAmbiguousEventField(where: string, fields: readonly string[]): void {
  if (ambiguousEventFields.has(where)) return;
  ambiguousEventFields.set(where, fields);
  // Printed at the point of detection, not collected for a summary someone
  // has to remember to render: a gate nobody sees is the same as no gate.
  console.warn(
    `  [event-list ambiguous] ${where} declares ${fields.length} EventKey members (${fields.join(', ')}) — ` +
      `left UNTAGGED. Exactly one member may carry the event; the others are mistyped.`,
  );
}

/**
 * Descriptor shapes that declare more than one `EventKey` member. Each is a
 * real defect in `@almadar/shell-web`: only one member is actually emitted, so the
 * others are mistyped. Left untagged rather than guessed at.
 */
export function takeAmbiguousEventFields(): ReadonlyMap<string, readonly string[]> {
  const snapshot = new Map(ambiguousEventFields);
  ambiguousEventFields.clear();
  return snapshot;
}

/**
 * Strip single-argument homomorphic type wrappers (`Readonly<T>`,
 * `Required<T>`, `Partial<T>`) down to `T`. These change modifiers, never the
 * member set or the member types, so an event field survives all of them.
 */
function unwrapHomomorphicWrapper(node: ts.TypeNode): ts.TypeNode {
  if (!ts.isTypeReferenceNode(node)) return node;
  const name = node.typeName.getText();
  if (name !== "Readonly" && name !== "Required" && name !== "Partial") return node;
  const arg = node.typeArguments?.[0];
  return arg === undefined ? node : unwrapHomomorphicWrapper(arg);
}

/**
 * The member declared as `EventKey`, where the file declaring those members
 * imports `EventKey` from `@almadar/core`. Member NAME is irrelevant —
 * detection stays type-driven so consumers never guess from a prop or member
 * name.
 *
 * EXACTLY ONE such member may exist. `eventField` names THE carrier the
 * rename fold rewrites and codegen scope-qualifies; with two candidates there
 * is no fact of the matter, and picking the first is a guess that silently
 * rewrites the wrong member. Ambiguity therefore leaves the prop UNTAGGED and
 * reports — the status quo, never a wrong tag.
 */
function findEventFieldInMembers(
  members: readonly ts.TypeElement[],
  sourceFile: ts.SourceFile,
  coreImports: ImportedSymbolSet,
  onAmbiguous?: (fields: readonly string[]) => void,
): string | undefined {
  if (!coreImports.has("EventKey")) return undefined;
  const found: string[] = [];
  for (const member of members) {
    if (!ts.isPropertySignature(member)) continue;
    const fieldName = member.name?.getText(sourceFile);
    if (!fieldName) continue;
    const fieldType = member.type;
    if (!fieldType) continue;
    // Walk through parenthesized / union wrappers and look for a direct
    // `EventKey` type reference.
    const unwrapped = unwrapOptional(fieldType);
    if (ts.isTypeReferenceNode(unwrapped) && unwrapped.typeName.getText() === "EventKey") {
      found.push(fieldName);
    }
  }
  if (found.length > 1) {
    onAmbiguous?.(found);
    return undefined;
  }
  return found[0];
}

/**
 * Strip trailing `| undefined` / `| null` from a type node so
 * `event?: EventKey` (a field marked optional) is still recognized as
 * declaring `EventKey`. `event: EventKey | undefined` without the `?`
 * is handled the same way.
 */
function unwrapOptional(node: ts.TypeNode): ts.TypeNode {
  if (!ts.isUnionTypeNode(node)) return node;
  const nonNullable = node.types.filter(
    (t) => t.kind !== ts.SyntaxKind.UndefinedKeyword && t.kind !== ts.SyntaxKind.NullKeyword,
  );
  if (nonNullable.length === 1) return nonNullable[0];
  return node;
}

/**
 * Scan every component file once and collect every `export interface X`
 * declaration so `mapTypeNode` can resolve descriptor types like
 * `DataGridItemAction` back to their field list — enabling event-list
 * detection on array-typed props.
 *
 * Keyed by interface name. First writer wins on collision (design-system
 * interface names are unique; log a warning if `verbose`).
 */
export function buildInterfaceRegistry(
  files: ScannedFile[],
  verbose: boolean = false,
): InterfaceRegistry {
  const registry: InterfaceRegistry = new Map();
  for (const file of files) {
    let fileContent: string;
    try {
      fileContent = fs.readFileSync(file.absolutePath, "utf-8");
    } catch {
      continue;
    }
    const sourceFile = ts.createSourceFile(
      file.absolutePath,
      fileContent,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const coreImports = collectCoreImports(sourceFile);
    for (const statement of sourceFile.statements) {
      // An `interface` and an object-shaped `type` alias are the same thing to
      // every consumer here — both name a set of members. Registering only the
      // former made alias-typed props invisible, which is why an element type
      // like `MenuOption` never reached the `EventKey` scan.
      let name: string | undefined;
      let members: readonly ts.TypeElement[] | undefined;
      let decl: ts.InterfaceDeclaration | undefined;
      if (ts.isInterfaceDeclaration(statement)) {
        name = statement.name.text;
        members = statement.members;
        decl = statement;
      } else if (ts.isTypeAliasDeclaration(statement)) {
        const aliasMembers = aliasObjectMembers(statement.type);
        if (aliasMembers.length === 0) continue;
        name = statement.name.text;
        members = aliasMembers;
      }
      if (name === undefined || members === undefined) continue;
      // Name-scoped type module (see `CORE_TYPE_ADMISSIONS` in scanner.ts):
      // contribute only the declarations it was admitted for.
      if (file.onlyExports && !file.onlyExports.has(name)) continue;
      if (file.onlyExports) registry.set(coreDeclKey(name), { ...(decl !== undefined ? { decl } : {}), members, sourceFile, coreImports });
      if (registry.has(name)) {
        if (verbose) {
          console.log(
            `  [interface-collision] ${name} already registered; skipping ${file.relativePath}`,
          );
        }
        continue;
      }
      registry.set(name, { ...(decl !== undefined ? { decl } : {}), members, sourceFile, coreImports });
    }
  }
  return registry;
}

/**
 * Scan every component file once and collect every `export type X = ...`
 * (and non-exported `type X = ...`) into a single registry keyed by the
 * alias name. Subsequent `mapTypeNode` calls consult this registry when
 * they hit a `TypeReference` they don't recognize.
 *
 * Cross-file collision policy: first writer wins. Design-system type names
 * are unique in practice (StackJustify, AlertVariant, DataGridField, ...).
 * If a collision does arise, the sync tool would miss a later alias — log
 * a warning so it shows up in `--verbose` output.
 */
/** Find a type-alias declaration named `typeName` in `sourceFile` itself.
 *  Used to give a same-file alias precedence over the cross-file registry so a
 *  component's locally-declared union resolves to ITS OWN body, not a
 *  same-named alias exported elsewhere. */
function findLocalTypeAlias(
  sourceFile: ts.SourceFile,
  typeName: string,
): ts.TypeNode | undefined {
  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName) {
      return statement.type;
    }
  }
  return undefined;
}

export function buildAliasRegistry(
  files: ScannedFile[],
  verbose: boolean = false,
): AliasRegistry {
  const registry: AliasRegistry = new Map();

  for (const file of files) {
    let fileContent: string;
    try {
      fileContent = fs.readFileSync(file.absolutePath, "utf-8");
    } catch {
      continue;
    }
    const sourceFile = ts.createSourceFile(
      file.absolutePath,
      fileContent,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const coreImports = collectCoreImports(sourceFile);

    for (const statement of sourceFile.statements) {
      if (!ts.isTypeAliasDeclaration(statement)) continue;
      // Only register EXPORTED type aliases. Non-exported local type aliases
      // (e.g. `type TimelineItem = …` in SubagentTracePanel.tsx) must not
      // pollute the cross-file registry — they would shadow a same-named
      // EXPORTED interface in a different file (aliases are checked before
      // interfaces in mapTypeNode, so a non-exported alias wins and produces
      // the wrong element shape for the consuming Props type).
      const isExported = statement.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (!isExported) continue;
      const name = statement.name.text;
      // Name-scoped type module — see the same guard in `buildInterfaceRegistry`.
      if (file.onlyExports && !file.onlyExports.has(name)) continue;
      if (registry.has(name)) {
        if (verbose) {
          console.log(
            `  [alias-collision] ${name} already registered; skipping ${file.relativePath}`,
          );
        }
        continue;
      }
      registry.set(name, { type: statement.type, sourceFile, coreImports });
    }
  }

  return registry;
}

/**
 * Extract JSDoc description from a node.
 */
function getJSDocDescription(node: ts.Node, sourceFile: ts.SourceFile): string {
  const fullText = sourceFile.getFullText();
  const nodeStart = node.getFullStart();

  // Look for JSDoc comments before this node
  const leadingComments = ts.getLeadingCommentRanges(fullText, nodeStart);
  if (!leadingComments) return "";

  for (const range of leadingComments) {
    const commentText = fullText.slice(range.pos, range.end);
    if (commentText.startsWith("/**")) {
      // Extract the description (first paragraph before any @tags)
      const cleaned = commentText
        .replace(/^\/\*\*\s*/, "")
        .replace(/\s*\*\/$/, "")
        .split("\n")
        .map((line) => line.replace(/^\s*\*\s?/, "").trim())
        .filter((line) => !line.startsWith("@"))
        .join(" ")
        .trim();
      return cleaned;
    }
  }

  return "";
}

/**
 * Extract the component-level `@capabilities` JSDoc tag from a node — the
 * retrieval intent vocabulary (parity with the behaviors `;; @capabilities`
 * line). Continuation lines are joined until the next `@`-tag or a blank line.
 */
function getJSDocCapabilities(node: ts.Node, sourceFile: ts.SourceFile): string {
  const fullText = sourceFile.getFullText();
  const leadingComments = ts.getLeadingCommentRanges(fullText, node.getFullStart());
  if (!leadingComments) return "";
  for (const range of leadingComments) {
    const commentText = fullText.slice(range.pos, range.end);
    if (!commentText.startsWith("/**")) continue;
    const lines = commentText
      .replace(/^\/\*\*\s*/, "")
      .replace(/\s*\*\/$/, "")
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, "").trim());
    const parts: string[] = [];
    let inTag = false;
    for (const line of lines) {
      const m = line.match(/^@capabilities\s+(.+)$/);
      if (m?.[1]) {
        parts.push(m[1].trim());
        inTag = true;
        continue;
      }
      if (inTag) {
        if (line.startsWith("@") || line.length === 0) {
          inTag = false;
          continue;
        }
        parts.push(line);
      }
    }
    if (parts.length > 0) return parts.join(" ");
  }
  return "";
}

/**
 * Extract a single-line component-level JSDoc tag value from a node
 * (e.g. `@fieldsContract form`). Returns "" when absent.
 */
function getJSDocSingleTag(node: ts.Node, sourceFile: ts.SourceFile, tag: string): string {
  const fullText = sourceFile.getFullText();
  const leadingComments = ts.getLeadingCommentRanges(fullText, node.getFullStart());
  if (!leadingComments) return "";
  const re = new RegExp(`^@${tag}\\s+(.+)$`);
  for (const range of leadingComments) {
    const commentText = fullText.slice(range.pos, range.end);
    if (!commentText.startsWith("/**")) continue;
    const lines = commentText
      .replace(/^\/\*\*\s*/, "")
      .replace(/\s*\*\/$/, "")
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, "").trim());
    for (const line of lines) {
      const m = line.match(re);
      if (m?.[1]) return m[1].trim();
    }
  }
  return "";
}

/** True when the node's leading JSDoc carries the bare flag tag `@<tag>`. */
function hasJSDocFlagTag(node: ts.Node, sourceFile: ts.SourceFile, tag: string): boolean {
  const fullText = sourceFile.getFullText();
  const leadingComments = ts.getLeadingCommentRanges(fullText, node.getFullStart());
  if (!leadingComments) return false;
  const re = new RegExp(`^@${tag}$`);
  for (const range of leadingComments) {
    const commentText = fullText.slice(range.pos, range.end);
    if (!commentText.startsWith("/**")) continue;
    const lines = commentText
      .replace(/^\/\*\*\s*/, "")
      .replace(/\s*\*\/$/, "")
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, "").trim());
    if (lines.some((line) => re.test(line))) return true;
  }
  return false;
}

/** A `@minWidth` tag value: a positive whole number of px, else ignored. */
function parseMinWidth(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) {
    if (raw.length > 0) console.warn(`  ! @minWidth must be a positive whole number of px, got "${raw}" — ignored`);
    return undefined;
  }
  const px = Number(raw);
  return px > 0 ? px : undefined;
}

/** Narrow a raw `@fieldsContract` tag value to the declared union. */
function parseFieldsContract(raw: string): 'form' | 'display' | undefined {
  if (raw === 'form' || raw === 'display') return raw;
  if (raw.length > 0) {
    console.warn(`  ! @fieldsContract must be "form" or "display", got "${raw}" — ignored`);
  }
  return undefined;
}

/**
 * Extract JSDoc comment for a specific property.
 */
function getPropJSDoc(member: ts.PropertySignature, sourceFile: ts.SourceFile): string {
  const fullText = sourceFile.getFullText();
  const memberStart = member.getFullStart();

  const leadingComments = ts.getLeadingCommentRanges(fullText, memberStart);
  if (!leadingComments) return "";

  for (const range of leadingComments) {
    const commentText = fullText.slice(range.pos, range.end);
    if (commentText.startsWith("/**") || commentText.startsWith("//")) {
      return commentText
        .replace(/^\/\*\*\s*/, "")
        .replace(/\s*\*\/$/, "")
        .replace(/^\/\/\s*/, "")
        .split("\n")
        .map((line) => line.replace(/^\s*\*\s?/, "").trim())
        .filter((line) => line.length > 0 && !line.startsWith("@"))
        .join(" ")
        .trim();
    }
  }

  return "";
}

function isPropTier(v: string): v is PropTier {
  return v === "domain" || v === "presentation" || v === "internal";
}

/**
 * Parse `@synonyms` + `@tier` + `@offByDefault` tags from a prop's JSDoc —
 * parity with the behaviors knob metadata. `@synonyms a, b, c` feeds the
 * pattern embeddings + the contextual-edit agent's intent→prop mapping;
 * `@tier domain|presentation|internal` marks the prop's facing.
 * `@offByDefault` marks a presence-gated event/callback outlet whose mere
 * binding changes the component's rendering (e.g. Badge's `onRemove` renders
 * the remove ×): it sets the registry default to `""`, so the lolo-ui
 * generator emits an OFF knob (`= ""`, no canonical emit) instead of the
 * default-on event key — the affordance only appears when a call site binds
 * an event explicitly. Function-typed props cannot carry a destructure
 * default in TSX, hence the tag. Absent tags → undefined fields.
 */
function isExtractedDefaultValue(v: unknown): v is ExtractedDefaultValue {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return true;
  if (Array.isArray(v)) return v.every(isExtractedDefaultValue);
  return typeof v === "object" && Object.values(v).every(isExtractedDefaultValue);
}

function exampleValueOf(text: string): ExtractedDefaultValue {
  try {
    const parsed: unknown = JSON.parse(text);
    return isExtractedDefaultValue(parsed) ? parsed : text;
  } catch {
    return text;
  }
}

function getPropJSDocTags(
  member: ts.PropertySignature,
  sourceFile: ts.SourceFile,
): {
  synonyms?: string;
  tier?: PropTier;
  offByDefault?: boolean;
  notification?: boolean;
  example?: ExtractedDefaultValue;
  default?: ExtractedDefaultValue;
  payloadFor?: string;
  changedBy?: string[];
  entityRowField?: string;
  typeWhen?: Array<{ field: string } & PayloadTypeWhen>;
} {
  const fullText = sourceFile.getFullText();
  const leadingComments = ts.getLeadingCommentRanges(fullText, member.getFullStart());
  if (!leadingComments) return {};
  const out: {
    synonyms?: string;
    tier?: PropTier;
    offByDefault?: boolean;
    notification?: boolean;
    example?: ExtractedDefaultValue;
    default?: ExtractedDefaultValue;
    payloadFor?: string;
    changedBy?: string[];
    entityRowField?: string;
    typeWhen?: Array<{ field: string } & PayloadTypeWhen>;
  } = {};
  for (const range of leadingComments) {
    const commentText = fullText.slice(range.pos, range.end);
    if (!commentText.startsWith("/**")) continue;
    const lines = commentText
      .replace(/^\/\*\*\s*/, "")
      .replace(/\s*\*\/$/, "")
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, "").trim());
    for (const line of lines) {
      const syn = line.match(/^@synonyms\s+(.+)$/);
      if (syn?.[1]) out.synonyms = syn[1].trim();
      const tier = line.match(/^@tier\s+(\w+)$/);
      if (tier?.[1] && isPropTier(tier[1])) out.tier = tier[1];
      if (/^@offByDefault\b/.test(line)) out.offByDefault = true;
      // `@notification` — a passive signal (hover, an exit animation ending), not a control a person acts on.
      if (/^@notification\b/.test(line)) out.notification = true;
      // `@example <value>` — what shows the component: JSON when it parses, else the text.
      const ex = line.match(/^@example\s+(.+)$/);
      if (ex?.[1]) out.example = exampleValueOf(ex[1].trim());
      // `@default <TS literal>` — the default of a prop the component does not
      // destructure itself; anything that is not a literal is skipped.
      const df = line.match(/(?:^|\s)@default\s+(.+)$/);
      if (df?.[1]) {
        const value = defaultTagValue(df[1].trim());
        if (value !== undefined) out.default = value;
      }
      // `@payloadFor <prop>` — names the sibling event prop this prop carries
      // the payload for. The pairing is otherwise naming convention only, and
      // inferring it from a `…Payload` suffix would be the text matching the
      // house rules ban.
      const pf = line.match(/^@payloadFor\s+([A-Za-z_$][\w$]*)$/);
      if (pf?.[1]) out.payloadFor = pf[1];
      // `@changedBy <prop>` — names a sibling event prop through which the
      // component reports a new value for this prop; repeatable.
      const cb = line.match(/^@changedBy\s+([A-Za-z_$][\w$]*)$/);
      if (cb?.[1] && !out.changedBy?.includes(cb[1])) out.changedBy = [...(out.changedBy ?? []), cb[1]];
      // `@entityRow <field>` — names the payload field carrying the bound
      // entity's row. The TS type cannot say this: the field is an
      // unconstrained generic, so without the tag it degrades to `object`.
      const er = line.match(/^@entityRow\s+([A-Za-z_$][\w$]*)$/);
      if (er?.[1]) out.entityRowField = er[1];
      // `@payloadTypeWhen <field> <knob>=<literal>-><type>` — repeatable;
      // declares that THIS emit payload field's real type depends on a
      // config knob the consuming trait resolves. Written into the
      // registry's `emitPayloadSchema[*].typeWhen` (below) and evaluated by
      // the compiler's render-ui binding check under the SAME resolved
      // trait config the `.lolo` narrowing pass folds — zero pattern
      // vocabulary in either place, the condition is authored data here.
      const tw = line.match(
        /^@payloadTypeWhen\s+([A-Za-z_$][\w$]*)\s+([A-Za-z_$][\w$]*)=([^\s>]+)->(\S+)$/,
      );
      if (tw?.[1] && tw[2] && tw[3] && tw[4]) {
        (out.typeWhen ??= []).push({
          field: tw[1],
          knob: tw[2],
          equals: tw[3],
          type: tw[4],
        });
      }
    }
  }
  return out;
}

/**
 * Extract event contracts from file-level JSDoc comments.
 *
 * Looks for patterns like:
 *   Event Contract:
 *   - Emits: UI:EVENT_NAME (optional) - description
 *   - Payload: { field1, field2, entity }
 */
function extractEventsFromJSDoc(sourceFile: ts.SourceFile): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];
  const fullText = sourceFile.getFullText();

  // Find all block comments in the file
  const commentRanges = ts.getLeadingCommentRanges(fullText, 0) || [];

  // Also check statements for leading comments
  for (const statement of sourceFile.statements) {
    const stmtComments = ts.getLeadingCommentRanges(fullText, statement.getFullStart());
    if (stmtComments) commentRanges.push(...stmtComments);
  }

  for (const range of commentRanges) {
    const comment = fullText.slice(range.pos, range.end);
    if (!comment.includes("Event Contract") && !comment.includes("Emits:")) continue;

    // Parse "Emits: UI:EVENT_NAME" lines
    const emitRegex = /Emits:\s*(UI:\w+)(?:\s*\((\w+)\))?\s*(?:-\s*(.+))?/g;
    let match;
    while ((match = emitRegex.exec(comment)) !== null) {
      const eventName = match[1];
      const optionalFlag = match[2]; // e.g., "optional"
      const description = match[3]?.trim() || "";

      events.push({
        event: eventName.replace("UI:", ""),
        trigger: "action",
        payload: { type: "object" },
        optional: optionalFlag === "optional" || undefined,
      });
    }
  }

  return events;
}

/**
 * Extract events from useEventBus() calls in the source.
 *
 * Looks for patterns like:
 *   eventBus.emit("UI:SAVE", payload)                        // string literal
 *   eventBus.emit(`UI:${EntityDisplayEvents.SORT}`, payload)  // template literal
 *   eventBus.emit(`UI:${action.event}`, payload)              // dynamic (skipped)
 */
function extractEventsFromCode(sourceFile: ts.SourceFile): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];
  const seen = new Set<string>();

  // Known constant objects for resolving template literal events
  const knownConstants: Record<string, Record<string, string>> = {
    EntityDisplayEvents: {
      SORT: "SORT",
      PAGINATE: "PAGINATE",
      SEARCH: "SEARCH",
      FILTER: "FILTER",
      CLEAR_FILTERS: "CLEAR_FILTERS",
      SELECT: "SELECT",
      DESELECT: "DESELECT",
    },
  };

  function addEvent(eventName: string) {
    if (!seen.has(eventName)) {
      seen.add(eventName);
      events.push({
        event: eventName,
        trigger: "action",
        payload: { type: "object" },
      });
    }
  }

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "emit"
    ) {
      const args = node.arguments;
      if (args.length > 0) {
        // String literal: eventBus.emit("UI:SAVE", ...)
        if (ts.isStringLiteral(args[0])) {
          const eventString = args[0].text;
          if (eventString.startsWith("UI:")) {
            addEvent(eventString.replace("UI:", ""));
          }
        }
        // Template literal: eventBus.emit(`UI:${EntityDisplayEvents.SORT}`, ...)
        else if (ts.isTemplateExpression(args[0])) {
          const tpl = args[0];
          const head = tpl.head.text;
          if (head === "UI:" && tpl.templateSpans.length === 1) {
            const span = tpl.templateSpans[0];
            if (ts.isPropertyAccessExpression(span.expression)) {
              const objName = span.expression.expression.getText(sourceFile);
              const propName = span.expression.name.text;
              const constants = knownConstants[objName];
              if (constants?.[propName]) {
                addEvent(constants[propName]);
              }
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return events;
}

/**
 * Convert a TS Expression node to a JSON-serializable default value.
 *
 * Handles the JSON-subset of TS literal forms (string / number / boolean /
 * null / array / object). Returns `undefined` for anything that can't
 * round-trip cleanly — identifiers (free variables), function literals,
 * template strings with substitutions, JSX, etc. — so callers can
 * distinguish "no default declared in JSON shape" from "default is null".
 */
/** A JSDoc `@default` value read as a TS literal expression; `undefined` when it is not one. */
function defaultTagValue(text: string): ExtractedDefaultValue | undefined {
  const sf = ts.createSourceFile("default.ts", `(${text});`, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const statement = sf.statements[0];
  if (sf.statements.length !== 1 || statement === undefined || !ts.isExpressionStatement(statement)) return undefined;
  const expression = statement.expression;
  if (!ts.isParenthesizedExpression(expression)) return undefined;
  return literalExpressionToValue(expression.expression);
}

function literalExpressionToValue(node: ts.Expression): ExtractedDefaultValue | undefined {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  // `-5` parses as a PrefixUnaryExpression around a NumericLiteral.
  if (
    ts.isPrefixUnaryExpression(node)
    && (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken)
    && ts.isNumericLiteral(node.operand)
  ) {
    const n = Number(node.operand.text);
    return node.operator === ts.SyntaxKind.MinusToken ? -n : n;
  }
  if (ts.isArrayLiteralExpression(node)) {
    const out: ExtractedDefaultValue[] = [];
    for (const el of node.elements) {
      if (ts.isOmittedExpression(el)) {
        out.push(null);
        continue;
      }
      const v = literalExpressionToValue(el);
      if (v === undefined) return undefined;
      out.push(v);
    }
    return out;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, ExtractedDefaultValue> = {};
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) return undefined;
      let key: string | undefined;
      if (ts.isIdentifier(prop.name)) key = prop.name.text;
      else if (ts.isStringLiteral(prop.name)) key = prop.name.text;
      if (key === undefined) return undefined;
      const v = literalExpressionToValue(prop.initializer);
      if (v === undefined) return undefined;
      out[key] = v;
    }
    return out;
  }
  return undefined;
}

/**
 * Walk a destructuring pattern (`{ size = 'md', variant = 'primary', ... }`)
 * and harvest each binding's literal default. Recurses into nested binding
 * patterns so `{ config: { mode = 'edit' } }` produces `config.mode`.
 *
 * For this tool we only need the top-level prop names (the component's
 * Props interface members are flat), so nested binding values are
 * intentionally not flattened into the result — they'd never match a
 * top-level prop and would just be noise.
 */
function collectBindingPatternDefaults(
  bindingPattern: ts.ObjectBindingPattern,
  out: Map<string, ExtractedDefaultValue>,
): void {
  for (const element of bindingPattern.elements) {
    if (ts.isOmittedExpression(element)) continue;
    // `propertyName` is set when the binding renames (e.g. `{ size: s = 'md' }`).
    // Pattern-sync's contract maps registry props 1:1 with destructured names,
    // so renames don't reach the registry — skip them.
    if (element.propertyName) continue;
    if (!ts.isIdentifier(element.name)) continue;
    const propName = element.name.text;
    if (!element.initializer) continue;
    const value = literalExpressionToValue(element.initializer);
    if (value === undefined) continue;
    if (!out.has(propName)) out.set(propName, value);
  }
}

/**
 * Walk the source file looking for the component's parameter destructuring.
 *
 * The component might be declared as:
 *   - `export function Foo(props: FooProps) {...}` with inner destructuring,
 *   - `export const Foo = React.forwardRef<T, FooProps>(({a = 1}, ref) => ...)`,
 *   - `export const Foo: React.FC<FooProps> = ({a = 1}) => {...}`.
 *
 * Rather than coupling to any one form, we walk every `ArrowFunction` /
 * `FunctionExpression` / `FunctionDeclaration` and harvest defaults from
 * any first parameter that's an `ObjectBindingPattern`. The first matching
 * pattern that overlaps with known prop names wins per-prop. This works
 * across the forwardRef wrapper, plain arrow components, and function
 * declarations without special-casing each shape.
 */
function extractDefaultsForProps(
  sourceFile: ts.SourceFile,
  propNames: Set<string>,
): Map<string, ExtractedDefaultValue> {
  const defaults = new Map<string, ExtractedDefaultValue>();
  function visit(node: ts.Node): void {
    if (
      (ts.isArrowFunction(node)
        || ts.isFunctionExpression(node)
        || ts.isFunctionDeclaration(node))
      && node.parameters.length > 0
    ) {
      const firstParam = node.parameters[0];
      if (firstParam.name && ts.isObjectBindingPattern(firstParam.name)) {
        // Only consider this binding pattern if at least one of its names is
        // a known prop. Helpers that happen to destructure look-alike names
        // won't poison the result.
        const localNames = new Set<string>();
        for (const el of firstParam.name.elements) {
          if (!ts.isOmittedExpression(el) && ts.isIdentifier(el.name)) {
            localNames.add(el.name.text);
          }
        }
        let overlap = 0;
        for (const n of localNames) if (propNames.has(n)) overlap++;
        if (overlap > 0) {
          collectBindingPatternDefaults(firstParam.name, defaults);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return defaults;
}

/**
 * Rich prop types a compiled app decodes with the owning package's typed decoder (G-CROSS-131),
 * keyed by the declared type text. A value reaching such a prop is an `EventPayloadValue`; the
 * decoder validates it into the component's type, so the generated JSX needs no cast.
 */
export const RICH_PROP_DECODERS: Readonly<Record<string, { name: string; from: string }>> = {
  OrbitalSchema: { name: 'parseOrbitalSchema', from: '@almadar/core' },
  PreviewNodeData: { name: 'decodePreviewNodeData', from: '@almadar/shell-web/avl' },
  SelectedPattern: { name: 'decodeSelectedPattern', from: '@almadar/shell-web/avl' },
  'Record<string, CanvasNodePlacement>': { name: 'decodeNodePlacements', from: '@almadar/shell-web/avl' },
};

/** The decoder for a prop typed by a `RICH_PROP_DECODERS` type, optionally `| null`/`| undefined`,
 *  or `| string` (then a string value passes through: `acceptsString`). */
export function richPropDecoder(typeNode: ts.TypeNode, sourceFile: ts.SourceFile): PropDecoder | undefined {
  const members = ts.isUnionTypeNode(typeNode) ? [...typeNode.types] : [typeNode];
  const meaningful = members.filter(
    (m) => !(ts.isLiteralTypeNode(m) && m.literal.kind === ts.SyntaxKind.NullKeyword) && m.kind !== ts.SyntaxKind.UndefinedKeyword,
  );
  const acceptsString = meaningful.some((m) => m.kind === ts.SyntaxKind.StringKeyword);
  const rest = meaningful.filter((m) => m.kind !== ts.SyntaxKind.StringKeyword);
  if (rest.length !== 1) return undefined;
  const decoder = RICH_PROP_DECODERS[rest[0].getText(sourceFile).replace(/\s+/g, ' ')];
  if (!decoder) return undefined;
  return acceptsString ? { ...decoder, acceptsString: true } : { ...decoder };
}

/**
 * Map one `PropertySignature` member to an `ExtractedProp`. Shared by the
 * main member-extraction loop and by `Omit<LocalProps, "x">` heritage
 * resolution (a Props interface with no members of its own, e.g.
 * `VStackProps extends Omit<StackProps, "direction"> {}`), so both paths
 * produce identical prop shapes instead of a hand-rolled subset.
 */
function mapPropertySignatureToProp(
  member: ts.PropertySignature,
  sourceFile: ts.SourceFile,
  aliases: AliasRegistry,
  coreImports: ImportedSymbolSet,
  interfaces: InterfaceRegistry,
  genericDefaults: Map<string, ts.TypeNode> = new Map(),
): ExtractedProp | null {
  const propName = member.name ? propNameText(member.name, sourceFile) : undefined;
  if (!propName) return null;

  let mapped: MappedType;
  try {
    mapped = member.type
      ? mapTypeNode(member.type, sourceFile, aliases, coreImports, interfaces, new Set(), genericDefaults)
      : emptyMapped(["unknown"]);
  } catch (err) {
    if (err instanceof UnresolvedTypeError && !err.prop) err.prop = propName;
    throw err;
  }
  const description = getPropJSDoc(member, sourceFile);
  const required = !member.questionToken;
  const tags = getPropJSDocTags(member, sourceFile);

  const extracted: ExtractedProp = { name: propName, types: mapped.types, description, required };
  const decoder = member.type ? richPropDecoder(member.type, sourceFile) : undefined;
  if (decoder) extracted.decoder = decoder;
  if (tags.synonyms) extracted.synonyms = tags.synonyms;
  if (tags.tier) extracted.tier = tags.tier;
  if (tags.payloadFor) extracted.payloadFor = tags.payloadFor;
  if (tags.changedBy) extracted.changedBy = tags.changedBy;
  if (tags.entityRowField) extracted.entityRowField = tags.entityRowField;
  // `""` is the registry's outlet-OFF encoding (cf. TableView's destructured
  // `itemClickEvent = ''`); a real destructure default lifted later wins.
  if (tags.offByDefault) extracted.default = "";
  if (tags.notification) extracted.notification = true;
  if (tags.default !== undefined) extracted.default = tags.default;
  if (tags.example !== undefined) extracted.example = tags.example;
  if (mapped.enumValues && mapped.enumValues.length > 0) extracted.enumValues = mapped.enumValues;
  if (mapped.numericEnumValues && mapped.numericEnumValues.length > 0) {
    extracted.numericEnumValues = mapped.numericEnumValues;
  }
  if (mapped.mapKeyEnum) extracted.mapKeyEnum = mapped.mapKeyEnum;
  if (mapped.tupleItems) extracted.tupleItems = mapped.tupleItems.map(mappedToPropTypeSchema);
  if (mapped.kind) extracted.kind = mapped.kind;
  if (mapped.of) extracted.of = mapped.of;
  if (mapped.eventField) extracted.eventField = mapped.eventField;
  if (mapped.itemKind) extracted.itemKind = mapped.itemKind;
  if (mapped.cardinality) extracted.cardinality = mapped.cardinality;
  if (mapped.requiredFields && mapped.requiredFields.length > 0) {
    extracted.requiredFields = mapped.requiredFields;
  }
  if (mapped.emitPayloadSchema) extracted.emitPayloadSchema = mapped.emitPayloadSchema;
  // Retype the entity-row field in the emit schema so the REGISTRY is the
  // single authority. Applying it only in `lolo-ui` left the render-ui binding
  // checker comparing the registry's `row: object` against the generated
  // trait's `row : @entity` — a mismatch against the shape this tag defines.
  // MUST run after the assignment above: the schema does not exist before it.
  if (tags.entityRowField) {
    for (const f of extracted.emitPayloadSchema ?? []) {
      if (f.name === tags.entityRowField) f.type = '@entity';
    }
  }
  // `@payloadTypeWhen` conditions attach to the NAMED emit payload field —
  // same "registry is the single authority" discipline as `entityRowField`
  // above. A tag naming a field the payload schema doesn't declare is
  // silently inert (no field to attach to); the extractor doesn't invent one.
  if (tags.typeWhen) {
    for (const tw of tags.typeWhen) {
      const field = extracted.emitPayloadSchema?.find((f) => f.name === tw.field);
      if (field) {
        (field.typeWhen ??= []).push({ knob: tw.knob, equals: tw.equals, type: tw.type });
      } else {
        console.warn(
          `  ! @payloadTypeWhen on ${propName} names field "${tw.field}", which isn't declared ` +
            `on this prop's payload schema — condition dropped (was silently inert before this warning)`,
        );
      }
    }
  }
  if (mapped.listenPayloadSchema) extracted.listenPayloadSchema = mapped.listenPayloadSchema;
  if (mapped.callbackArgs) extracted.callbackArgs = mapped.callbackArgs;
  if (mapped.renderCallback) extracted.renderCallback = true;
  if (mapped.nonEmittable) extracted.nonEmittable = true;
  if (mapped.nonAuthorable) extracted.nonAuthorable = true;
  if (mapped.items) extracted.items = mappedToPropTypeSchema(mapped.items);
  if (mapped.variants) extracted.variants = mapped.variants.map(mappedToPropTypeSchema);
  if (mapped.discriminator) extracted.discriminator = mapped.discriminator;
  if (mapped.mapValue) extracted.mapValue = mappedToPropTypeSchema(mapped.mapValue);
  if (mapped.properties) {
    extracted.properties = Object.fromEntries(
      Object.entries(mapped.properties).map(([k, v]) => [k, mappedToPropTypeSchema(v)]),
    );
  }
  if (mapped.required && mapped.required.length > 0) extracted.propertyRequired = mapped.required;
  if (mapped.dateLike) extracted.dateLike = true;
  if (mapped.scenePos) extracted.scenePos = true;
  if (mapped.drawableSlot) extracted.drawableSlot = true;
  if (mapped.controlValue) extracted.controlValue = true;
  if (mapped.eventPayloadBrand) extracted.eventPayloadBrand = true;
  if (mapped.jsonValueBrand) extracted.jsonValueBrand = true;
  if (mapped.skeletonSpec) extracted.skeletonSpec = true;

  return extracted;
}

/**
 * Resolve `Omit<LocalName, "a" | "b">` (or a single string-literal second
 * argument) heritage — returns the target interface's own props (property
 * signatures only, no further heritage recursion) minus the omitted keys.
 * Looks in the same file first (e.g. `VStackProps` / `StackProps` both in
 * `Stack.tsx`), then the cross-file interface registry. Returns `null` when
 * the heritage type isn't an `Omit<...>` of a resolvable interface.
 */
/** Does this interface (or the interface an `Omit<X, …>` base names) extend `A11yProps`? */
function interfaceForwardsA11y(
  decl: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  interfaces: InterfaceRegistry,
): boolean {
  for (const clause of decl.heritageClauses ?? []) {
    for (const typeExpr of clause.types) {
      const name = typeExpr.expression.getText(sourceFile);
      if (name === "A11yProps") return true;
      if (name !== "Omit") continue;
      const targetArg = typeExpr.typeArguments?.[0];
      if (!targetArg || !ts.isTypeReferenceNode(targetArg)) continue;
      const targetName = targetArg.typeName.getText(sourceFile);
      const local = sourceFile.statements.find(
        (st): st is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(st) && st.name.text === targetName,
      );
      const entry = local ? { decl: local, sourceFile } : interfaces.get(targetName);
      if (entry?.decl && interfaceForwardsA11y(entry.decl, entry.sourceFile, interfaces)) return true;
    }
  }
  return false;
}

function resolveOmitHeritageProps(
  typeExpr: ts.ExpressionWithTypeArguments,
  sourceFile: ts.SourceFile,
  aliases: AliasRegistry,
  coreImports: ImportedSymbolSet,
  interfaces: InterfaceRegistry,
): ExtractedProp[] | null {
  if (typeExpr.expression.getText(sourceFile) !== "Omit") return null;
  const [targetArg, omitArg] = typeExpr.typeArguments ?? [];
  if (!targetArg || !ts.isTypeReferenceNode(targetArg)) return null;
  const targetName = targetArg.typeName.getText(sourceFile);

  let targetDecl: ts.InterfaceDeclaration | undefined;
  let targetSourceFile = sourceFile;
  let targetCoreImports = coreImports;
  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement) && statement.name.text === targetName) {
      targetDecl = statement;
      break;
    }
  }
  if (!targetDecl) {
    const entry = interfaces.get(targetName);
    // Alias-registered entries carry members but no `InterfaceDeclaration`;
    // this Omit<>/Pick<> path needs the declaration node itself.
    if (entry?.decl) {
      targetDecl = entry.decl;
      targetSourceFile = entry.sourceFile;
      targetCoreImports = entry.coreImports;
    }
  }
  if (!targetDecl) return null;

  const omitted = new Set<string>();
  const collectLiteral = (node: ts.TypeNode | undefined) => {
    if (node && ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
      omitted.add(node.literal.text);
    }
  };
  if (omitArg && ts.isUnionTypeNode(omitArg)) {
    for (const t of omitArg.types) collectLiteral(t);
  } else {
    collectLiteral(omitArg);
  }

  const props: ExtractedProp[] = [];
  for (const member of targetDecl.members) {
    if (!ts.isPropertySignature(member)) continue;
    const extracted = mapPropertySignatureToProp(
      member,
      targetSourceFile,
      aliases,
      targetCoreImports,
      interfaces,
    );
    if (extracted && !omitted.has(extracted.name)) props.push(extracted);
  }
  return props;
}

/**
 * Resolve a plain `extends Base` / `extends Base<T>` heritage reference on a
 * component's top-level Props interface: the base's own property signatures
 * (mapped exactly like the component's own members) plus, recursively, its
 * own plain and `Omit<>` heritage. Same file first, then the cross-file
 * interface registry — the general path, so a base need not be listed in
 * `KNOWN_BASE_PROPS` to contribute. `null` when the base is not resolvable.
 */
function resolvePlainHeritageProps(
  baseName: string,
  sourceFile: ts.SourceFile,
  aliases: AliasRegistry,
  coreImports: ImportedSymbolSet,
  interfaces: InterfaceRegistry,
  seen: ReadonlySet<string> = new Set(),
): ExtractedProp[] | null {
  if (seen.has(baseName)) return null;
  let decl: ts.InterfaceDeclaration | undefined;
  let declSource = sourceFile;
  let declImports = coreImports;
  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement) && statement.name.text === baseName) {
      decl = statement;
      break;
    }
  }
  if (!decl) {
    const entry = interfaces.get(baseName);
    if (entry?.decl) {
      decl = entry.decl;
      declSource = entry.sourceFile;
      declImports = entry.coreImports;
    }
  }
  if (!decl) return null;
  const nextSeen = new Set(seen).add(baseName);

  const byName = new Map<string, ExtractedProp>();
  for (const clause of decl.heritageClauses ?? []) {
    for (const typeExpr of clause.types) {
      const name = typeExpr.expression.getText(declSource);
      const inherited = name === "Omit"
        ? resolveOmitHeritageProps(typeExpr, declSource, aliases, declImports, interfaces)
        : resolvePlainHeritageProps(name, declSource, aliases, declImports, interfaces, nextSeen);
      for (const p of inherited ?? []) byName.set(p.name, p);
    }
  }
  for (const member of decl.members) {
    if (!ts.isPropertySignature(member)) continue;
    const extracted = mapPropertySignatureToProp(member, declSource, aliases, declImports, interfaces);
    if (extracted) byName.set(extracted.name, extracted);
  }
  return Array.from(byName.values());
}

/**
 * Parse a single component file and extract its interface and events.
 */
export function parseComponent(
  scannedFile: ScannedFile,
  aliases: AliasRegistry = new Map(),
  interfaces: InterfaceRegistry = new Map(),
  overridePropsInterfaceName?: string,
): ParsedComponent | null {
  const fileContent = fs.readFileSync(scannedFile.absolutePath, "utf-8");

  const sourceFile = ts.createSourceFile(
    scannedFile.absolutePath,
    fileContent,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  // Find exported interfaces ending in "Props"
  let propsInterface: ts.InterfaceDeclaration | null = null;
  let componentDescription = "";
  let componentCapabilities = "";
  let componentFieldsContract = "";
  let componentMinWidth = "";
  let componentAccessibleName = "";

  if (overridePropsInterfaceName) {
    // Secondary-component mode: target a specific named interface.
    for (const statement of sourceFile.statements) {
      if (
        ts.isInterfaceDeclaration(statement) &&
        statement.name.text === overridePropsInterfaceName &&
        statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        propsInterface = statement;
        componentDescription = getJSDocDescription(statement, sourceFile);
        componentCapabilities = getJSDocCapabilities(statement, sourceFile);
        componentFieldsContract = getJSDocSingleTag(statement, sourceFile, "fieldsContract");
        componentMinWidth = getJSDocSingleTag(statement, sourceFile, "minWidth");
        componentAccessibleName = getJSDocSingleTag(statement, sourceFile, "accessibleName");
        break;
      }
    }
  } else {
    // Prefer the `*Props` interface that matches the FILE's component name
    // (`<fileName>Props`, e.g. `StepFlowProps` in `StepFlow.tsx`). A file can
    // export several `*Props` interfaces — e.g. `StepFlow.tsx` exports
    // `StepItemProps` (the per-step data shape) BEFORE `StepFlowProps`. Taking
    // the first one registered a phantom `step-item` pattern pointing at a
    // non-existent `StepItem` component (TS2305 in the generated factory). Fall
    // back to the first exported `*Props` only when none matches the file name.
    const expectedPropsName = `${scannedFile.fileName}Props`;
    let fallbackPropsInterface: ts.InterfaceDeclaration | null = null;
    for (const statement of sourceFile.statements) {
      if (
        ts.isInterfaceDeclaration(statement) &&
        statement.name.text.endsWith("Props") &&
        statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        if (statement.name.text === expectedPropsName) {
          propsInterface = statement;
          componentDescription = getJSDocDescription(statement, sourceFile);
          componentCapabilities = getJSDocCapabilities(statement, sourceFile);
          componentFieldsContract = getJSDocSingleTag(statement, sourceFile, "fieldsContract");
          componentMinWidth = getJSDocSingleTag(statement, sourceFile, "minWidth");
          componentAccessibleName = getJSDocSingleTag(statement, sourceFile, "accessibleName");
          break;
        }
        if (!fallbackPropsInterface) fallbackPropsInterface = statement;
      }
    }
    if (!propsInterface && fallbackPropsInterface) {
      propsInterface = fallbackPropsInterface;
      componentDescription = getJSDocDescription(fallbackPropsInterface, sourceFile);
      componentCapabilities = getJSDocCapabilities(fallbackPropsInterface, sourceFile);
      componentFieldsContract = getJSDocSingleTag(fallbackPropsInterface, sourceFile, "fieldsContract");
      componentMinWidth = getJSDocSingleTag(fallbackPropsInterface, sourceFile, "minWidth");
      componentAccessibleName = getJSDocSingleTag(fallbackPropsInterface, sourceFile, "accessibleName");
    }
  }

  if (!propsInterface) return null;

  // Per-file core-import set so `mapTypeNode` can resolve `EventKey` by
  // its module origin, not just by name.
  const coreImports = collectCoreImports(sourceFile);

  // The Props interface's OWN type-parameter defaults/constraints
  // (`CarouselProps<T = CarouselItem>` → `T` → `CarouselItem`'s TypeNode).
  // A constraint (`T extends Foo`) is the tighter bound when both are
  // declared, so it wins; otherwise the default type is the real shape a
  // caller who supplies nothing actually gets. Threaded into every prop's
  // `mapTypeNode` call so a bare `T` reference resolves to its declared
  // shape instead of the ACTIONABLE `genericParam` (unbound, no shape) case.
  const genericDefaults = new Map<string, ts.TypeNode>();
  for (const tp of propsInterface.typeParameters ?? []) {
    const bound = tp.constraint ?? tp.default;
    if (bound) genericDefaults.set(tp.name.text, bound);
  }

  const componentLayoutOnly = hasJSDocFlagTag(propsInterface, sourceFile, "layoutOnly");

  // Derive component name from interface name (e.g., "ButtonProps" → "Button")
  const propsInterfaceName = propsInterface.name.text;
  const componentName = propsInterfaceName.replace(/Props$/, "");

  // If no description from interface, try file-level JSDoc
  if (!componentDescription) {
    componentDescription = getJSDocDescription(sourceFile.statements[0], sourceFile);
  }
  if (!componentCapabilities && sourceFile.statements[0]) {
    componentCapabilities = getJSDocCapabilities(sourceFile.statements[0], sourceFile);
  }
  if (!componentFieldsContract && sourceFile.statements[0]) {
    componentFieldsContract = getJSDocSingleTag(sourceFile.statements[0], sourceFile, "fieldsContract");
  }
  if (!componentAccessibleName && sourceFile.statements[0]) {
    componentAccessibleName = getJSDocSingleTag(sourceFile.statements[0], sourceFile, "accessibleName");
  }
  if (!componentMinWidth && sourceFile.statements[0]) {
    componentMinWidth = getJSDocSingleTag(sourceFile.statements[0], sourceFile, "minWidth");
  }

  // Known base interfaces — when a Props interface extends one of these,
  // inherit its props so the registry has the full contract.
  const KNOWN_BASE_PROPS: Record<string, ExtractedProp[]> = {
    // The non-entity display-state base. Components that show entity data now
    // declare `entity?: EntityRow | readonly EntityRow[]` DIRECTLY (detected via
    // `entityRowCardinality`); this base carries only the loading/error/display
    // hints. (The old `EntityDisplayProps` + its phantom entity brand were
    // removed in the entity-row clean slate.)
    DisplayStateProps: [
      { name: "className", types: ["string"], description: "Additional CSS classes", required: false },
      { name: "isLoading", types: ["boolean"], description: "Loading state indicator", required: false },
      { name: "error", types: ["object"], properties: { message: { types: ["string"] }, name: { types: ["string"] }, code: { types: ["string"] }, stack: { types: ["string"] } }, propertyRequired: ["message"], description: "Error state (UiError)", required: false },
      { name: "sortBy", types: ["string"], description: "Current sort field", required: false },
      { name: "sortDirection", types: ["string"], enumValues: ["asc", "desc"], description: "Current sort direction", required: false },
      { name: "searchValue", types: ["string"], description: "Current search query value", required: false },
      { name: "page", types: ["number"], description: "Current page number", required: false },
      { name: "pageSize", types: ["number"], description: "Number of items per page", required: false },
      { name: "totalCount", types: ["number"], description: "Total number of items", required: false },
      // NOTE: this hardcoded table SHADOWS `components/core/organisms/types.ts`
      // (DisplayStateProps) — keep the two in sync. Values are wire-string
      // filter settings → `Map string string` (the .lolo union limitation
      // rules out `string|number|boolean`; numbers/booleans serialize).
      { name: "activeFilters", types: ["object"], mapValue: { types: ["string"] }, description: "Active filters", required: false },
      { name: "selectedIds", types: ["array"], items: { types: ["string", "number"] }, description: "Currently selected item IDs", required: false },
    ],
    TemplateProps: [
      { name: "entity", types: ["object"], description: "Entity data, the sole source of runtime state", required: true },
      { name: "className", types: ["string"], description: "External styling override", required: false },
    ],
    DataDndProps: [
      { name: "dragGroup", types: ["string"], description: "When set, items in this container are draggable and announce this group as their source", required: false },
      { name: "accepts", types: ["string"], description: "When set, the container accepts drops whose dragGroup matches this value (or '*' for any group)", required: false },
      { name: "sortable", types: ["boolean"], description: "Enable in-container reorder; items can be dragged to new positions among siblings", required: false },
      { name: "dropEvent", types: ["string"], description: "Bus event fired on cross-container drop. Payload: { id, sourceGroup, targetGroup, newIndex }", required: false },
      { name: "reorderEvent", types: ["string"], description: "Bus event fired on in-container reorder. Payload: { id, oldIndex, newIndex }", required: false },
      { name: "positionEvent", types: ["string"], description: "Bus event fired N times per drop (one per item in affected zones) so the trait can persist new positions for the WHOLE zone, not just the moved item. Payload: { id, position }", required: false },
      { name: "dndItemIdField", types: ["string"], description: "Row field used as the @dnd-kit draggable id (default 'id')", required: false },
      { name: "dndRoot", types: ["boolean"], description: "Mark this container as the DnD root for its subtree — descendant zones share one DndContext (cross-container drag). Use on an outer container whose own items are not draggable.", required: false },
    ],
    // Every neutral drawable (draw-sprite/shape/text) extends this. `id` is the
    // source-tagged hit-test handle the canvas host indexes (ScenePos→id) to turn a
    // pointer/raycast at a cell into a unit/entity click; no id → tile click.
    DrawableBase: [
      { name: "id", types: ["string"], description: "Optional source-tagged hit-test handle — the host indexes the drawable's ScenePos→id so a pointer/raycast at that cell resolves to this id (unit/entity click). No id → the host emits only the coordinate (tile click).", required: false },
      { name: "hit", types: ["boolean"], description: "With an `id`, the drawable is a pointer region (its painted bounds, rotation applied); the orbital canvas emits the pointer events for it.", required: false },
      { name: "semantic", types: ["object"], properties: { role: { types: ["string"] }, name: { types: ["string"] }, value: { types: ["string"] }, checked: { types: ["boolean"] }, disabled: { types: ["boolean"] }, order: { types: ["number"] }, focused: { types: ["boolean"] }, caret: { types: ["number"] }, selectionStart: { types: ["number"] }, selectionEnd: { types: ["number"] }, multiline: { types: ["boolean"] } }, propertyRequired: ["role", "name"], description: "Accessibility node for this drawable.", required: false },
      { name: "spring", types: ["object"], properties: { stiffness: { types: ["number"] }, damping: { types: ["number"] } }, propertyRequired: ["stiffness", "damping"], description: "With an `id`: when a repaint changes this drawable's animatable fields, the canvas moves them to the new values by this spring.", required: false },
    ],
  };

  // Extract props — start with inherited props from extends clause
  const props: ExtractedProp[] = [];
  const declaredPropNames = new Set<string>();
  const forwardsA11y = interfaceForwardsA11y(propsInterface, sourceFile, interfaces);

  // Check for extends clause and inject known base props
  if (propsInterface.heritageClauses) {
    for (const clause of propsInterface.heritageClauses) {
      for (const typeExpr of clause.types) {
        const baseName = typeExpr.expression.getText(sourceFile);

        // `extends Omit<LocalProps, "x" | "y">` — the shorthand secondary
        // components (VStack/HStack over Stack.tsx's StackProps) use when
        // their own Props interface body is empty. Not a KNOWN_BASE_PROPS
        // entry — resolve the target interface directly.
        if (baseName === "Omit") {
          const omitProps = resolveOmitHeritageProps(typeExpr, sourceFile, aliases, coreImports, interfaces);
          if (omitProps) {
            for (const p of omitProps) {
              props.push(p);
              declaredPropNames.add(p.name);
            }
          }
          continue;
        }

        // `extends A11yProps` (@almadar/core): the component forwards the
        // accessibility attribute family; the writer expands it (a11y-props.ts).
        if (baseName === "A11yProps") continue;

        const baseProps = KNOWN_BASE_PROPS[baseName];
        if (!baseProps) {
          for (const p of resolvePlainHeritageProps(baseName, sourceFile, aliases, coreImports, interfaces) ?? []) {
            if (declaredPropNames.has(p.name)) continue;
            props.push(p);
            declaredPropNames.add(p.name);
          }
          continue;
        }
        // `TemplateProps<E>`: the `entity` prop's field shape comes from the type
        // argument `E` (a fully-typed page-entity interface). Resolve it so the
        // generated template entity carries every field, not a shapeless `{ id }`.
        const tmplShape =
          baseName === "TemplateProps" && typeExpr.typeArguments?.[0]
            ? mapTypeNode(typeExpr.typeArguments[0], sourceFile, aliases, coreImports, interfaces)
            : undefined;
        for (const baseProp of baseProps) {
          if (
            baseProp.name === "entity" &&
            tmplShape?.properties &&
            Object.keys(tmplShape.properties).length > 0
          ) {
            const entityProp: ExtractedProp = {
              ...baseProp,
              kind: "entity",
              properties: Object.fromEntries(
                Object.entries(tmplShape.properties).map(([k, v]) => [k, mappedToPropTypeSchema(v)]),
              ),
            };
            if (tmplShape.required && tmplShape.required.length > 0) {
              entityProp.requiredFields = tmplShape.required;
            }
            props.push(entityProp);
          } else {
            props.push(baseProp);
          }
          declaredPropNames.add(baseProp.name);
        }
      }
    }
  }

  // Extract directly declared props (override inherited if same name)
  for (const member of propsInterface.members) {
    if (!ts.isPropertySignature(member)) continue;
    const extracted = mapPropertySignatureToProp(member, sourceFile, aliases, coreImports, interfaces, genericDefaults);
    if (!extracted) continue;

    // If prop was inherited, replace it with the local declaration
    if (declaredPropNames.has(extracted.name)) {
      const idx = props.findIndex((p) => p.name === extracted.name);
      if (idx >= 0) props[idx] = extracted;
    } else {
      props.push(extracted);
    }
  }

  // Extract parameter-destructuring defaults (`{ size = 'md' }`) from the
  // component function body. Lifted into each prop's `default` field so
  // the registry carries the implicit values without consumers having to
  // re-parse the .tsx. Only JSON-serializable literals round-trip; function
  // defaults are silently dropped.
  const propNameSet = new Set(props.map((p) => p.name));
  const propDefaults = extractDefaultsForProps(sourceFile, propNameSet);
  for (const prop of props) {
    const dflt = propDefaults.get(prop.name);
    if (dflt !== undefined) prop.default = dflt;
  }

  // Extract events from JSDoc and code
  const jsdocEvents = extractEventsFromJSDoc(sourceFile);
  const codeEvents = extractEventsFromCode(sourceFile);

  // Merge events (prefer JSDoc if same event name exists in both)
  const eventMap = new Map<string, ExtractedEvent>();
  for (const ev of codeEvents) eventMap.set(ev.event, ev);
  for (const ev of jsdocEvents) eventMap.set(ev.event, ev); // JSDoc overrides
  const events = Array.from(eventMap.values());

  const family = deriveComponentFamily(scannedFile);
  const dimension = deriveComponentDimension(scannedFile);

  // `aria-label`/`aria-labelledby` always name an element; the tag lists the
  // component's own naming props. A tag naming only those still declares the need.
  const accessibleName = componentAccessibleName
    .split(/[\s,]+/)
    .filter((name) => name !== "" && name !== "aria-label" && name !== "aria-labelledby");
  for (const name of accessibleName) {
    if (!props.some((p) => p.name === name)) {
      throw new Error(`${componentName}: @accessibleName names '${name}', which is not a declared prop`);
    }
  }

  return {
    relativePath: scannedFile.relativePath,
    componentName,
    propsInterfaceName,
    props,
    description: componentDescription || `${componentName} component`,
    ...(componentCapabilities ? { capabilities: componentCapabilities } : {}),
    ...(parseFieldsContract(componentFieldsContract)
      ? { fieldsContract: parseFieldsContract(componentFieldsContract) }
      : {}),
    ...(parseMinWidth(componentMinWidth) !== undefined
      ? { minUsableWidth: parseMinWidth(componentMinWidth) }
      : {}),
    ...(componentLayoutOnly ? { layoutOnly: true } : {}),
    ...(forwardsA11y ? { forwardsA11y: true } : {}),
    ...(componentAccessibleName ? { accessibleName } : {}),
    events,
    level: scannedFile.level,
    ...(family ? { family } : {}),
    ...(dimension ? { dimension } : {}),
    client: scannedFile.client,
  };
}

/**
 * Component family. In the family-first layout it is the folder under
 * `components/` — `components/<family>/<tier>/…` — which is the authoritative
 * source (mirrors `almadar-std/behaviors/lolo/ui/<family>/<tier>/`). Falls back
 * to the sibling `.stories.tsx` `title` for trees that are NOT family-first
 * (e.g. project `clients/<name>/<tier>/…`). `game`/`avl`/`learning` are
 * explicit; everything else (incl. story-less base primitives) is `core`.
 */
function deriveComponentFamily(scannedFile: ScannedFile): UiFamily {
  const parts = scannedFile.relativePath.split(/[/\\]/);
  const ci = parts.indexOf("components");
  if (ci >= 0 && parts.length > ci + 2) {
    const fam = parts[ci + 1];
    if (fam === "game" || fam === "avl" || fam === "learning") return fam;
    if (fam === "core") return "core";
  }
  return readStorybookFamily(scannedFile.absolutePath);
}

/**
 * For game-family components in the `components/game/<dimension>/<tier>/`
 * layout, extract the dimension segment (`2d` or `3d`). Returns undefined
 * for non-game families or game components that predate the dimension split.
 */
function deriveComponentDimension(scannedFile: ScannedFile): PatternDimension | undefined {
  const parts = scannedFile.relativePath.split(/[/\\]/);
  const ci = parts.indexOf("components");
  if (ci >= 0 && parts[ci + 1] === "game" && parts.length > ci + 3) {
    const dim = parts[ci + 2];
    if (dim === "2d") return "2d";
    if (dim === "3d") return "3d";
  }
  return undefined;
}

/**
 * The storybook family for a component = the FIRST segment of its sibling
 * `.stories.tsx` `title` (`Core/Atoms/Button` → core). Fallback used for
 * non-family-first trees (project clients). No story / non-game/avl/learning
 * prefix → `core`.
 */
function readStorybookFamily(componentAbsPath: string): UiFamily {
  const storyPath = componentAbsPath.replace(/\.tsx?$/, ".stories.tsx");
  let text: string;
  try {
    text = fs.readFileSync(storyPath, "utf-8");
  } catch {
    return "core";
  }
  const m = text.match(/title:\s*['"]([^'"/]+)/);
  const prefix = m?.[1]?.trim().toLowerCase();
  if (prefix === "game" || prefix === "avl" || prefix === "learning") return prefix;
  return "core";
}

/**
 * Parse all scanned files and return parsed components.
 * Files without a Props interface are skipped.
 *
 * `registryFiles` is the broader file list used to build alias/interface
 * registries. It defaults to `files` for backwards compatibility, but
 * callers that pre-filter `files` (e.g. via the G7 public-barrel gate in
 * the `patterns` command) MUST pass the unfiltered scan here so that
 * type-only modules like `components/core/organisms/types.ts`
 * contribute their entity interfaces to the registry. Otherwise the `EntityDisplayProps<T>` shape
 * specialization in `parseComponent` can't resolve T and the
 * ORB_RUI_ELEMENT_SHAPE_MISMATCH validator rule loses element-shape
 * coverage.
 */
/**
 * Scan a source file's text for exported `*Props` interface names without
 * full TS compilation. Used to discover secondary components in multi-component
 * files (e.g. `VStackProps` and `HStackProps` inside `Stack.tsx`).
 */
function collectExportedPropsInterfaceNames(absolutePath: string): string[] {
  const src = fs.readFileSync(absolutePath, "utf-8");
  const re = /export\s+interface\s+(\w+Props)\b/g;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    names.push(m[1]);
  }
  return names;
}

export function parseAllComponents(
  files: ScannedFile[],
  verbose: boolean = false,
  registryFiles: ScannedFile[] = files,
  publicExports?: Set<string>,
): ParsedComponent[] {
  const aliases = buildAliasRegistry(registryFiles, verbose);
  const interfaces = buildInterfaceRegistry(registryFiles, verbose);
  if (verbose) {
    console.log(`  [alias-registry] ${aliases.size} type aliases indexed`);
    console.log(`  [interface-registry] ${interfaces.size} interfaces indexed`);
  }

  const results: ParsedComponent[] = [];
  const refusals: string[] = [];
  const refuse = (file: ScannedFile, err: UnresolvedTypeError): void => {
    refusals.push(`pattern ${toPatternName(file.fileName)} (${file.relativePath}) prop ${err.prop ?? "?"}: unresolved type ${err.typeName}`);
  };

  for (const file of files) {
    try {
      const parsed = parseComponent(file, aliases, interfaces);
      if (parsed) {
        results.push(parsed);
      } else if (verbose) {
        console.log(`  [skip] ${file.relativePath} - no Props interface found`);
      }

      // When the caller supplies the public-exports set, also extract any
      // additional exported `*Props` interfaces from the same file whose
      // derived component name is publicly exported. This covers multi-component
      // files like `Stack.tsx` (exports VStack+HStack alongside Stack) where the
      // filename-match logic only extracts the primary component.
      if (publicExports && file.absolutePath.endsWith(".tsx")) {
        const primaryName = parsed?.componentName ?? null;
        const allPropsNames = collectExportedPropsInterfaceNames(file.absolutePath);
        for (const propsName of allPropsNames) {
          const componentName = propsName.replace(/Props$/, "");
          if (componentName === primaryName) continue;
          if (componentName === file.fileName) continue;
          if (!publicExports.has(componentName)) continue;
          try {
            const secondary = parseComponent(file, aliases, interfaces, propsName);
            if (secondary) {
              results.push(secondary);
              if (verbose) {
                console.log(
                  `  [secondary] ${file.relativePath} → ${componentName} (${propsName})`,
                );
              }
            }
          } catch (err) {
            if (err instanceof UnresolvedTypeError) {
              refuse(file, err);
              continue;
            }
            console.warn(
              `  [warn] Failed to parse secondary ${propsName} in ${file.relativePath}: ${(err as Error).message}`,
            );
          }
        }
      }
    } catch (err) {
      if (err instanceof UnresolvedTypeError) {
        refuse(file, err);
        continue;
      }
      console.warn(
        `  [warn] Failed to parse ${file.relativePath}: ${(err as Error).message}`,
      );
    }
  }

  if (refusals.length > 0) {
    throw new Error(`pattern-sync refused ${refusals.length} unresolved prop type(s):\n  ${refusals.join("\n  ")}`);
  }

  return results;
}
