/**
 * Shared Intermediate Representation Types
 *
 * Unified IR types used by both the compiler and runtime.
 * This is the single source of truth for IR structures.
 *
 * @packageDocumentation
 */

import type { SExpr } from './expression.js';
import type { Entity, EntityRow, FieldValue } from './entity.js';
import type { JsonValue, RuntimeValue } from './json.js';
import type { ListenSource } from './trait.js';
import type { TraitId, EventId } from './identity.js';
import type { PageAccess, PageIndexing, PageMeta } from './page.js';
import type { AnyPatternConfig } from '../patterns/index.js';
import type { EntityField, RelationConfig } from './field.js';
import { payloadTypeContainer } from './state-machine.js';

// ============================================================================
// Transition Types
// ============================================================================

/**
 * Transition source state specification.
 * - string: Single state name (e.g., 'Idle')
 * - '*': Wildcard - matches any current state
 * - string[]: Array of states - matches any of the listed states
 */
export type TransitionFrom = string | '*' | string[];

// ============================================================================
// Field Types
// ============================================================================

export interface ResolvedField {
  name: string;
  type: string;
  tsType: string;
  description?: string;
  /** Field default — JSON-shaped, mirroring `EntityField.default`. */
  default?: JsonValue;
  required: boolean;
  /** Validation constraints carried from the schema (enum whitelist). */
  validation?: { enum?: string[] };
  /** Enum values for enum or constrained string fields */
  values?: string[];
  /** Enum values (alias for values, for compatibility) */
  enumValues?: string[];
  relation?: RelationConfig;
  intrinsic?: boolean;
  items?: EntityField;
  properties?: Record<string, EntityField>;
}

// ============================================================================
// Entity Types
// ============================================================================

export interface ResolvedEntity {
  name: string;
  description?: string;
  icon?: string;
  collection: string;
  fields: ResolvedField[];

  /** Whether this entity only exists in runtime (not persisted to Firestore) */
  runtime?: boolean;

  /** Whether this entity's state is shared across every bound trait (vs a per-trait copy). Orthogonal to `runtime`. */
  shared?: boolean;

  /** Whether this entity has pre-authored instances in the schema */
  hasInstances?: boolean;

  /** Pre-authored instances from the schema (seed data or static reference data) */
  instances?: EntityRow[];

  /** Default field values from schema (for spawning singletons) */
  defaults?: Record<string, FieldValue>;

  // Cross-references
  usedByTraits: string[];
  usedByPages: string[];
}

export interface ResolvedEntityBinding {
  /** Binding name in code */
  name: string;

  /** Entity being bound */
  entity: ResolvedEntity;

  /** CRUD operations to generate */
  operations: ('list' | 'get' | 'create' | 'update' | 'delete')[];
}

// ============================================================================
// Trait Types
// ============================================================================

export interface ResolvedTraitState {
  name: string;
  isInitial: boolean;
  isFinal: boolean;
}

export interface ResolvedTraitEvent {
  key: string;
  name: string;
  payload?: Record<string, string>;
}

export interface ResolvedTraitTransition {
  /** Source state(s): string, '*' for wildcard, or array of states */
  from: TransitionFrom;
  to: string;
  event: string;
  guard?: SExpr;
  effects: SExpr[];
}

export interface ResolvedTraitGuard {
  name: string;
  condition: SExpr;
}

export interface ResolvedTraitTick {
  name: string;
  /**
   * `number` (ms), `'frame'`, a duration string (`'5s'`/`'1m'`/`'1h'`), or a
   * 5-field cron expression (`'0 9 * * *'`) — `schema-to-ir.ts`'s
   * `interval: tick.interval || 0` passes the source schema's raw
   * `string | number` straight through with no normalization, so this must
   * match that reality rather than the narrower `number | 'frame'` it used
   * to declare (which made every non-'frame' string an unchecked cast at
   * every consumer).
   */
  interval: number | string;
  guard?: SExpr;
  effects: SExpr[];
  priority: number;
  appliesTo: string[];
  /** `[visible]`: pauses while the trait's rendered output is off screen. */
  whileVisible: boolean;
}

export interface ResolvedTraitListener {
  event: string;
  triggers: string;
  guard?: SExpr;
  /** `with { ... }` payload rewrite: `{ targetField: SExpr }`, evaluated against the source payload. */
  payloadMapping?: Record<string, SExpr>;
  /** Source scoping (see `ListenSource` in types/trait). */
  source?: ListenSource;
}

export interface ResolvedTraitDataEntity {
  name: string;
  fields: ResolvedField[];
  runtime: boolean;
  singleton: boolean;
}

/**
 * UI binding for interaction traits - maps states to presentations
 */
export interface ResolvedTraitUIBinding {
  [stateName: string]: {
    /** Presentation type: modal, drawer, popover, inline, confirm-dialog */
    presentation: string;
    /** Content pattern(s) to render */
    content: AnyPatternConfig | AnyPatternConfig[];
    /** Presentation props */
    props?: {
      size?: string;
      position?: string;
      title?: string;
      closable?: boolean;
      width?: string;
      showProgress?: boolean;
      step?: number;
      totalSteps?: number;
    };
  };
}

/**
 * One emit contract on a resolved trait — the minimal shape the
 * emit-source stamp needs (`eventId` lookup by event name, parity with
 * `OrbitalServerRuntime`'s `emitContract?.eventId`).
 */
export interface ResolvedTraitEmit {
  event: string;
  eventId?: EventId;
}

/**
 * Fully resolved trait - expanded from schema OR library.
 * The compiler generates code from this structure universally,
 * without knowing which specific trait it is.
 */
export interface ResolvedTrait {
  /** Unique trait identifier */
  name: string;

  /**
   * V4 dual-carry id sibling of `name` — preserved from the source trait
   * when the schema carries ids. The emit-source stamp needs it: an
   * id-scoped `listens` matcher (`buildSourceMatcher`, `@almadar/runtime`)
   * compares ids ONLY, so a name-only stamp never matches a `traitId`-carrying
   * listen (the chat SAVE → DO_CREATE relay died on the stateful path,
   * 2026-09-22).
   */
  id?: TraitId;

  /**
   * The trait's emit contracts, preserved from the source trait when the
   * schema carries them. The emit-source stamp reads `eventId` from the
   * matching contract — parity with `OrbitalServerRuntime`'s emit stamp.
   */
  emits?: ResolvedTraitEmit[];

  /** Human-readable description */
  description?: string;

  /** Where this trait came from */
  source: 'schema' | 'library' | 'inline';

  /** Category for organizing traits */
  category?: 'lifecycle' | 'temporal' | 'validation' | 'notification' | 'integration' | 'interaction' | 'agent' |
  'game-core' | 'game-character' | 'game-ai' | 'game-combat' | 'game-items' | 'game-cards' | 'game-board' | 'game-puzzle';

  // State Machine (all optional - not all traits have state machines)
  states: ResolvedTraitState[];
  events: ResolvedTraitEvent[];
  transitions: ResolvedTraitTransition[];
  guards: ResolvedTraitGuard[];

  // Behavior
  ticks: ResolvedTraitTick[];

  // Communication
  listens: ResolvedTraitListener[];

  // Data
  dataEntities: ResolvedTraitDataEntity[];

  /**
   * Atom-declared linked entity. The atom (e.g. std-pagination)
   * declares which entity its `@entity.X` bindings resolve against
   * (e.g. `PagedItem`). Distinct from the call-site rebind on
   * `ResolvedTraitBinding.linkedEntity`, which a molecule may use
   * to override the atom's default. Either side may be undefined
   * for traits that don't bind any entity (pure interaction).
   */
  linkedEntity?: string;

  /**
   * The trait's DECLARED `config { }` schema (per-field
   * `{ type, default? }`). Drives `@config.X` substitution: each
   * field's `default` seeds the binding context behind any caller-
   * supplied call-site `config: { ... }` override on the trait
   * reference. Authored on the atom; flows through verbatim from
   * `Trait.config`.
   *
   * (Caller-supplied call-site overrides live on the page-trait
   * binding's `config: TraitConfig` — see `ResolvedTraitBinding`.)
   */
  config?: import('./trait.js').DeclaredTraitConfig;

  // UI Bindings for interaction traits
  ui?: ResolvedTraitUIBinding;
}

/**
 * Trait binding on a page - links a resolved trait to the page
 */
export interface ResolvedTraitBinding {
  /** Reference name */
  ref?: string;

  /** Fully resolved trait */
  trait: ResolvedTrait;

  /** Entity this trait operates on (if any) */
  linkedEntity?: string;

  /** Instance configuration */
  config?: import('./trait.js').TraitConfig;
}

// ============================================================================
// Pattern & Section Types
// ============================================================================

export interface ResolvedPattern {
  /** Pattern type (e.g., 'page-header', 'data-list', 'game-canvas') */
  type: string;

  /** Pattern configuration */
  config: AnyPatternConfig;

  /** Shell component to use */
  shellComponent?: string;
}

export interface ResolvedSectionEvent {
  event: string;
  action: string;
  target?: string;
}

export interface ResolvedSection {
  /** Section identifier */
  id: string;

  /** Resolved pattern */
  pattern: ResolvedPattern;

  /** Events emitted by this section */
  events: ResolvedSectionEvent[];

  /** Position in page layout */
  position?: number;

  /** Entity binding for this section */
  binding?: ResolvedEntityBinding;
}

// ============================================================================
// Page Types
// ============================================================================

export interface ResolvedNavigation {
  event?: string;
  from?: string;
  to: string;
  trigger?: string;
  params?: Record<string, string>;
  label?: string;
  path?: string;
  icon?: string;
}

export interface ResolvedPage {
  /** Page identifier */
  name: string;

  /** URL path */
  path: string;

  /** Feature folder name */
  featureName: string;

  /** Layout component */
  layout?: string;

  /** View type (dashboard, list, detail, create, edit) */
  viewType?: 'dashboard' | 'list' | 'detail' | 'create' | 'edit';

  /** Resolved sections */
  sections: ResolvedSection[];

  /** Resolved trait bindings */
  traits: ResolvedTraitBinding[];

  /** Entity data bindings */
  entityBindings: ResolvedEntityBinding[];

  /** Navigation wiring */
  navigation: ResolvedNavigation[];

  /** Singleton entities to spawn on this page (runtime singletons) */
  singletonEntities: ResolvedEntity[];

  /** `access:` page modifier; absent = no gate. */
  access?: PageAccess;

  /** `indexing:` page modifier. */
  indexing?: PageIndexing;
  /** The upstream page this one was imported from; see `OrbitalPage.sourcePage`. */
  sourcePage?: string;
  /** `translationOf:` page modifier; see `OrbitalPage.translationOf`. */
  translationOf?: string;

  /** `title:` page modifier. */
  title?: PageMeta;

  /** `description:` page modifier. */
  description?: PageMeta;
}

// ============================================================================
// IR Types
// ============================================================================

/**
 * Complete resolved IR - all references expanded
 */
export interface ResolvedIR {
  /** App name */
  appName: string;

  /** App description */
  description?: string;

  /** App version */
  version?: string;

  /** All resolved entities (Map for lookup) */
  entities: Map<string, ResolvedEntity>;

  /** All resolved traits (Map for lookup) */
  traits: Map<string, ResolvedTrait>;

  /** All resolved pages (Map for lookup) */
  pages: Map<string, ResolvedPage>;

  /** Entity bindings (used for data hook generation) */
  entityBindings: ResolvedEntityBinding[];

  /** Raw data entities (used for instance data generation) */
  rawEntities?: Entity[];

  /** Generation timestamp */
  generatedAt: string;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an empty resolved trait with defaults
 */
export function createEmptyResolvedTrait(name: string, source: 'schema' | 'library' | 'inline'): ResolvedTrait {
  return {
    name,
    source,
    states: [],
    events: [],
    transitions: [],
    guards: [],
    ticks: [],
    listens: [],
    dataEntities: [],
  };
}

/**
 * Create an empty resolved page with defaults
 */
export function createEmptyResolvedPage(name: string): ResolvedPage {
  return {
    name,
    path: `/${name.toLowerCase()}`,
    featureName: name.toLowerCase(),
    sections: [],
    traits: [],
    entityBindings: [],
    navigation: [],
    singletonEntities: [],
  };
}

/**
 * Infer TypeScript type from schema type
 */
export function inferTsType(schemaType: string): string {
  const typeMap: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    date: 'Date',
    datetime: 'Date',
    timestamp: 'number',
    array: 'unknown[]',
    object: 'Record<string, unknown>',
    any: 'unknown',
    // Renderable UI content — the canonical pattern-tree type from
    // render-ui-edit.ts. Without this entry the raw tag `node` would leak
    // out as a (nonexistent) TS type name.
    node: 'PatternNode | PatternNode[]',
  };

  // Handle array types like "string[]"
  if (schemaType.endsWith('[]')) {
    const baseType = schemaType.slice(0, -2);
    return `${typeMap[baseType] || baseType}[]`;
  }

  const container = payloadTypeContainer(schemaType);
  if (container.kind === 'map') {
    return `Record<${inferTsType(container.key)}, ${inferTsType(container.value)}>`;
  }

  return typeMap[schemaType] || schemaType;
}

/**
 * Create a resolved field with TypeScript type inference
 */
export function createResolvedField(field: {
  name: string;
  type: string;
  description?: string;
  default?: JsonValue;
  required?: boolean;
  validation?: { enum?: string[] };
  values?: string[];
  relation?: RelationConfig;
  intrinsic?: boolean;
  items?: EntityField;
  properties?: Record<string, EntityField>;
}): ResolvedField {
  return {
    name: field.name,
    type: field.type,
    tsType: inferTsType(field.type),
    description: field.description,
    default: field.default,
    required: field.required ?? false,
    validation: field.validation,
    values: field.values,
    relation: field.relation,
    intrinsic: field.intrinsic,
    items: field.items,
    properties: field.properties,
  };
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if an object is a ResolvedIR.
 * 
 * Validates that an unknown value conforms to the ResolvedIR structure.
 * Checks for required properties and correct types. Used for runtime
 * type checking and validation.
 * 
 * @param {unknown} ir - Value to check
 * @returns {boolean} True if value is ResolvedIR, false otherwise
 * 
 * @example
 * if (isResolvedIR(schema)) {
 *   // Type-safe access to ResolvedIR properties
 *   console.log('Valid IR:', schema.appName);
 * }
 */
export function isResolvedIR(ir: RuntimeValue): ir is ResolvedIR {
  if (!ir || typeof ir !== 'object') return false;
  const r = ir as ResolvedIR;
  return typeof r.appName === 'string' && r.traits instanceof Map && r.pages instanceof Map;
}
