/**
 * Shared type definitions for the pattern sync tool.
 */

/**
 * Semantic marker on a prop, layered over the structural `types` field.
 * Mirrors `PropKind` from `@almadar/core/patterns`. Emitted when the TS type
 * references a semantic alias (e.g. `EventKey` from `@almadar/core`).
 *
 * - `'event'` — legacy alias retained for back-compat with EventKey-typed props.
 *   Equivalent to `'event-ref'`.
 * - `'event-ref'` — declarative bus-emit prop. The bound string becomes the
 *   bus event name. Set when the TS type is `EventKey` or `EventEmit<P>`. When
 *   the brand is `EventEmit<P>`, the prop also carries `emitPayloadSchema`.
 * - `'event-listen'` — declarative bus-listen prop. Mirror of `event-ref`.
 *   Set for `EventListen<P>`; carries `listenPayloadSchema`.
 * - `'event-list'` — array prop whose elements carry an event-name field.
 *   The element field name is in `eventField`.
 * - `'event-map'` — object-valued prop whose dynamic-key VALUES are declared
 *   event keys (`Record<K, EventKey>` / `Partial<Record<K, EventKey>>`), e.g.
 *   a d-pad's direction→event map or a canvas's keycode→event map. Set when
 *   the Record/index-signature value type resolves to `kind: "event"`
 *   (`mapValue.kind === "event"`) — type-identity derived, not name-matched.
 * - `'callback'` — React callback prop bound at the schema-author site to a
 *   bus event name. Codegen wraps the callback to construct the trait's
 *   declared object payload from the named callback args (see C2 plan).
 *   Carries `callbackArgs`. NEVER set for a render-prop/compute-prop (a
 *   function that RETURNS a value, `renderCallback: true`) — that function is
 *   called to render or compute, not dispatched on the bus, so it carries no
 *   `kind` at all.
 */
export type ExtractedPropKind =
  | 'event'
  | 'event-ref'
  | 'event-listen'
  | 'event-list'
  | 'event-map'
  | 'callback'
  | 'entity'
  /** Universal element-entry prop (`enter`/`enterDelay`): folded into the element's class, never passed to the component. */
  | 'entry'
  /** Injected universal `skeleton` prop on a component that declares none: feeds the awaiting-skeleton prediction, never passed to the component. */
  | 'skeleton';

/** A single field of an emit/listen payload schema, mirroring trait
 * payloadSchema entries so consumers (lolo / validator) can compare the
 * component's documented bus shape against the trait's declared shape. */
export interface ExtractedPayloadField {
  name: string;
  type: string;
  required: boolean;
  /** `event` when the field's TS type is `EventKey`. */
  kind?: "event";
  /** `@payloadFor <sibling>` read off the member: the event-kind sibling this field carries the payload of. */
  payloadFor?: string;
  /**
   * Full recursive shape when the field is structured — an array with a known
   * element type, or an object with known properties. Mirrors
   * {@link ExtractedCallbackArg.schema}.
   *
   * Without it the extractor kept only `types[0]`, so `selectedIds:
   * readonly string[]` was recorded as the bare type `"array"` and the
   * generator, having nothing else to go on, emitted `[object]` — a shapeless
   * array on a field whose element type was never in doubt (1,422 composed
   * warnings from that one prop). `mapTypeNode` already computes the shape;
   * this carries it the last step.
   */
  schema?: PropTypeSchema;
  /** Allowed literal values when the field's TS type is a string-literal
   *  union (directly, or via a type alias) — `type` stays `"string"`.
   *  Mirrors {@link PropTypeSchema.enumValues} / top-level prop `enumValues`. */
  enumValues?: string[];
  /**
   * Declared knob-conditional type list — sourced from the component's
   * `@payloadTypeWhen <field> <knob>=<literal>-><type>` JSDoc tag on the
   * owning prop (e.g. `Input.tsx`'s `action` prop). Written into the
   * registry's `emitPayloadSchema[*].typeWhen` (see `writer.ts`) and
   * consulted by the compiler's render-ui binding check
   * (`orbital-compiler/phases/validation/render_ui/binding.rs`) — the SAME
   * evaluator the `.lolo` narrowing pass uses, so component and trait agree
   * on the resolved type without a hardcoded pattern-specific predicate.
   */
  typeWhen?: PayloadTypeWhen[];
}

/** One condition of a payload field's `typeWhen` list. Mirrors Rust
 *  `orbital_core::schema::PayloadTypeWhen` / TS `PayloadTypeWhen` in
 *  `@almadar/core`. */
export interface PayloadTypeWhen {
  knob: string;
  equals: string;
  type: string;
}

/** A single positional arg of a React callback prop. Used by L2 to verify
 * name-and-type parity between the callback and the trait's declared event
 * payload (gap #32 in Almadar_Std_Verification.md). */
export interface ExtractedCallbackArg {
  name: string;
  type: string;
  /**
   * Full recursive shape when the arg is a structured object (e.g. a
   * component callback's `(event: CalendarEvent) => void`). Set so the
   * generated factory's `emits { }` payload can declare a concrete struct
   * type, which lowers to a strict inline TypeScript payload type
   * (`OirType::Struct`) instead of the shapeless `EventPayload`. Omitted for
   * scalar args — the `type` string suffices there.
   */
  schema?: PropTypeSchema;
}

/**
 * Recursive type schema for array elements / nested objects. Carries the
 * structural shape of an element so downstream consumers (validator, codegen)
 * can make element-aware decisions instead of falling back to name-list
 * heuristics. Mirrors a tiny subset of JSON Schema.
 *
 * - `types`: same shape as a prop's top-level types (`["string"]`, `["number"]`,
 *   `["object"]`, `["array"]`, etc.).
 * - `items`: when types includes `"array"`, the element-type schema.
 * - `properties` / `required`: when types includes `"object"` AND the source
 *   was a declared interface, the per-key schema for that interface.
 * - `enumValues`: when the element is a bounded string union (e.g.
 *   `'file' | 'dir'` on FileTreeNode.type).
 *
 * The recursion bottom is primitive types with no items/properties.
 */
export interface PropTypeSchema {
  types: string[];
  /** A runtime handle (`EntityData`, an injected brand) — the generator omits an optional one. */
  nonAuthorable?: boolean;
  enumValues?: string[];
  /**
   * Numeric-literal-union members (e.g. `1 | 2 | 3`). `.lolo` keeps the prop as
   * `number`; the generator seeds the default from the first member so the
   * emitted literal satisfies the component's numeric-union prop type.
   */
  numericEnumValues?: number[];
  items?: PropTypeSchema;
  /**
   * For a dynamic-key typed map (`Record<string, V>` / `Map<K,V>` with a
   * CONCRETE value type): the schema of the uniform value V. Drives the
   * generator to emit `.lolo` `Map string V` (→ `Record<string, V>`). Mirrors
   * `items` for arrays. Unset for opaque `Record<string, unknown>` maps.
   */
  mapValue?: PropTypeSchema;
  properties?: Record<string, PropTypeSchema>;
  /** A struct member typed `T | null` without `?`: absent in `.orb` data, `null` in the TS type. */
  nullable?: boolean;
  /** A map's closed key vocabulary (`Record<'up' | 'down', V>` → `['up', 'down']`). */
  mapKeyEnum?: string[];
  /** A tuple's slot schemas (`[number, number, number]`); `items` is their union. */
  tupleItems?: PropTypeSchema[];
  required?: string[];
  /**
   * Set when this object is a self-referential interface reference (a tree
   * node's recursive child). The shape is fully captured at the parent level,
   * so the `json` fallback here is accepted, not an actionable loose-source gap.
   */
  cyclic?: boolean;
  /** The declared TS interface name the self-reference is BACK TO (e.g.
   *  `ReplyNodeRow`). Lets the generator emit a named `.lolo` `type` alias
   *  for the recursing shape and reference it by name (`[ReplyNodeRow]`)
   *  instead of falling back to `opaque` — set alongside {@link cyclic}. */
  cyclicTypeName?: string;
  /**
   * Set when the source type is `Date`. Mapping it to a primitive breaks the
   * baked orbital validator (needs a Rust rebuild), so the fix is deferred —
   * bucketed separately from actionable rather than forced to a wrong shape.
   */
  dateLike?: boolean;
  /**
   * Set when the source type is core `ScenePos` (a logical scene coordinate).
   * The value is still an authorable `{x,y,z}` object; this marker records the
   * TYPE IDENTITY so the entry-level `drawable` capability can be derived from
   * it (mirrors how `Asset`/`AssetUrl` are type-tagged). Propagates through
   * array `items`, so a `-layer` molecule whose element carries a `ScenePos`
   * position is detected too.
   */
  scenePos?: boolean;
  /**
   * Set when the source type is the `DrawableNode` union (@almadar/shell-web's drawable
   * lib) — i.e. this prop is a canvas draw-host's children slot. Records the TYPE
   * IDENTITY so the entry-level `drawHost` capability can be derived (mirrors
   * `scenePos` → `drawable`). Propagates through array `items`.
   */
  drawableSlot?: boolean;
  /**
   * Set when the source type is `FieldValue` or `ControlValue` from
   * `@almadar/core` — the form-control transport union (`string | number |
   * boolean | [string] | FileValue`). Drives the generator to emit the shared
   * `ControlValue` alias (+ `FileValue` sibling decl) instead of `opaque`.
   */
  controlValue?: boolean;
  /**
   * Set when the source type is `EventPayload` from `@almadar/core` — a
   * string-keyed recursive bag of `EventPayloadValue`s. Drives the generator
   * to emit `Map string EventPayloadValue`, backed by the declared recursive
   * `EventPayloadValue` alias.
   */
  eventPayloadBrand?: boolean;
  /**
   * Set when the source type is `JsonObject`/`ToolArgs`/`JsonValue` from
   * `@almadar/core` — the recursive "data crossed a boundary" JSON union.
   * Drives the generator to emit the declared recursive `JsonValue` alias
   * (or `Map string JsonValue` for the `JsonObject`/`ToolArgs` bag form).
   */
  jsonValueBrand?: boolean;
  /**
   * A TAGGED UNION: every arm is a struct carrying the same single-literal
   * `discriminator` field. One schema per arm, in source order.
   */
  variants?: PropTypeSchema[];
  /** The field naming which `variants` arm a value is. */
  discriminator?: string;
  /**
   * Set when the source type is an unbound generic type parameter (`T`) with
   * no declared default/constraint the extractor could resolve to a real
   * shape. Its actual shape comes from the consumer's instantiation — not
   * necessarily object-shaped — so it's ACTIONABLE (fix upstream by giving
   * the TS generic a default/constraint, or using the `.lolo` trait-level
   * type-parameter instrument), never widened to a guessed shape.
   */
  genericParam?: boolean;
  /**
   * Set when the member's type is the `EventKey` semantic alias — the
   * struct-member twin of `ExtractedProp.kind: "event"`. Unlike most of
   * `mappedToPropTypeSchema`'s allowlist (deliberately narrow: `kind` is
   * usually already surfaced on the parent `ExtractedProp` for a TOP-LEVEL
   * prop), a struct member declared INSIDE an array-item interface
   * (`FloatingToolbarItem.action`, `SwipeAction.event`) has no such parent —
   * the struct itself is the element type of an array knob, never a prop in
   * its own right. Drives the generator to emit `.lolo` `event` for the
   * member instead of the structural `string` `resolveType` would otherwise
   * produce, and lets `payloadFor` below name it as an `event`-typed
   * sibling.
   */
  kind?: ExtractedPropKind;
  /**
   * Set when this member is an `EventPayload`-brand field carrying a
   * `@payloadFor <sibling>` JSDoc pairing — the SIBLING member's name, a key
   * on the SAME `properties` map. Same "no parent to surface on" reasoning
   * as {@link kind}. Drives the generator to emit the dependent type
   * `@payload <sibling>` instead of routing an `eventPayloadBrand` member to
   * the actionable gap.
   */
  payloadFor?: string;
}

/** A single prop extracted from a TypeScript interface */
/** The owning package's typed decoder for a rich prop (G-CROSS-131). */
export interface PropDecoder {
  name: string;
  from: string;
  /** The prop also takes a string (`T | string`): a string value passes through undecoded. */
  acceptsString?: boolean;
}

export interface ExtractedProp {
  /** Typed decoder the compiled app applies to a value reaching this prop. */
  decoder?: PropDecoder;
  /** An event prop that is a passive signal (`@notification`), not a control a person acts on. */
  notification?: boolean;
  name: string;
  types: string[];
  description: string;
  required: boolean;
  /**
   * Element / nested-object type info, mirroring JSON Schema's `items` and
   * `properties`. Populated by `mapTypeNode` when the TS type is an array
   * (recurse into elementType) or a reference to a known interface (walk
   * interface members). Without this, consumers like the validator can only
   * see "array" without knowing element shape; the codegen falls back to
   * heuristics.
   */
  items?: PropTypeSchema;
  /** For a typed-map prop (`Record<string, V>`): schema of the uniform value V
   *  → generator emits `.lolo` `Map string V`. Mirrors `items` for arrays. */
  mapValue?: PropTypeSchema;
  properties?: Record<string, PropTypeSchema>;
  propertyRequired?: string[];
  /**
   * Set when the prop's type is `Date` (or `T | Date`). The fix is deferred
   * pending a baked-validator rebuild; bucketed separately from actionable.
   */
  dateLike?: boolean;
  /** Set when the prop's type is core `ScenePos` — the source-tagged signal that
   *  grounds the pattern's `drawable` capability (see {@link PropTypeSchema.scenePos}). */
  scenePos?: boolean;
  /** Set when the prop's type is the `DrawableNode` union — the source-tagged signal
   *  that grounds the pattern's `drawHost` capability (see {@link PropTypeSchema.drawableSlot}). */
  drawableSlot?: boolean;
  /** Set when the prop's type is `FieldValue`/`ControlValue` — the source-tagged
   *  signal the generator uses to emit the shared `ControlValue` alias
   *  (see {@link PropTypeSchema.controlValue}). */
  controlValue?: boolean;
  /** Set when the prop's type is `EventPayload` — the source-tagged signal the
   *  generator uses to emit `Map string EventPayloadValue` (see {@link PropTypeSchema.eventPayloadBrand}). */
  eventPayloadBrand?: boolean;
  /** Set when the prop's type is `JsonObject`/`ToolArgs`/`JsonValue` — the
   *  source-tagged signal the generator uses to emit the declared recursive
   *  `JsonValue` alias (see {@link PropTypeSchema.jsonValueBrand}). */
  jsonValueBrand?: boolean;
  /**
   * A TAGGED UNION: every arm is a struct carrying the same single-literal
   * `discriminator` field. One schema per arm, in source order.
   */
  variants?: PropTypeSchema[];
  /** The field naming which `variants` arm a value is. */
  discriminator?: string;
  /** Set when the prop's type is core `SkeletonSpec` — the type-identity signal for the universal `skeleton` prop. */
  skeletonSpec?: boolean;
  /**
   * When the prop's type is a union of string literals (directly or via a
   * resolved type alias like `StackJustify`), this holds the set of valid
   * string values. Downstream validators (orbital-rust) reject prop values
   * that aren't in this set. Omitted when the type isn't a bounded string
   * enum.
   */
  enumValues?: string[];
  /**
   * Numeric-literal-union members (e.g. `cols?: 1 | 2 | 3`). `.lolo` has no
   * numeric-union type, so the generated knob stays `number`; the generator
   * seeds its default from the first member (a plain `0` default is rejected
   * by the component's literal-union prop type).
   */
  /** A map's closed key vocabulary (`Record<'up' | 'down', V>` → `['up', 'down']`). */
  mapKeyEnum?: string[];
  /** A tuple's slot schemas (`[number, number, number]`); `items` is their union. */
  tupleItems?: PropTypeSchema[];
  numericEnumValues?: number[];
  /**
   * Set when the prop carries semantic meaning beyond its structural JSON
   * shape. Drives consumers that need to know "this string is a declared
   * event key" (etc.) without inferring from the prop name.
   */
  kind?: ExtractedPropKind;
  /**
   * For `kind: "event-list"`: which field inside each array item holds the
   * event key. Default is `"event"` — set explicitly when the descriptor
   * type uses a different field name.
   */
  eventField?: string;
  /** Sibling event prop this prop carries the payload for (`@payloadFor`). */
  payloadFor?: string;
  /**
   * The callback ARG (or emit-payload field) that carries the bound entity's
   * ROW, declared by an `@entityRow <field>` JSDoc tag on the prop. The named
   * field is retyped `@entity`, so it resolves at compose time to whatever
   * entity the consuming trait is rebound to — which is exactly what a list's
   * row IS. Without it a row-carrying callback published a shapeless `object`.
   */
  entityRowField?: string;
  /**
   * For `kind: "entity"` (the data inlet): single record (`"record"`) vs a
   * collection (`"collection"`). Derived from the prop's `EntityRow` type:
   * bare `EntityRow` → record; an array (`EntityRow[]` / `readonly EntityRow[]`
   * / a union containing one) → collection.
   */
  cardinality?: 'record' | 'collection';
  /**
   * For `kind: "entity"`: fields the component declared REQUIRED via
   * `EntityWith<K>` (or an `EntityRow & {…}` intersection). The
   * `ORB_X_ENTITY_PROP_CONTRACT` validator rejects a behavior binding an entity
   * that doesn't provide these (accounting for `.lolo` field-remaps).
   */
  requiredFields?: string[];
  /**
   * For `kind: "event-ref"` whose source is `EventEmit<P>`: the structural
   * shape of `P`, as the bus payload the component fires when the prop is
   * bound. Validator compares this against the trait's declared
   * `emits { EVENT { ... } }` payload.
   */
  emitPayloadSchema?: ExtractedPayloadField[];
  /**
   * For `kind: "event-listen"` whose source is `EventListen<P>`: the
   * structural shape of `P`, as the payload the component subscribes to.
   * Validator compares against the trait's declared payload at the source
   * emit site.
   */
  listenPayloadSchema?: ExtractedPayloadField[];
  /**
   * For `kind: "callback"`: positional parameter list of the function type.
   * Validator uses these names to build the param-name → payload-field map
   * that codegen + runtime use to wrap the callback into a bus emit (gap
   * #32 / C2 plan).
   */
  callbackArgs?: ExtractedCallbackArg[];
  /**
   * A `kind: "callback"` function prop that RETURNS a value (render-prop /
   * compute-prop) rather than `=> void`. It's called to render or compute, not
   * to emit on the bus — so the factory generator skips it instead of minting a
   * spurious emit payload.
   */
  renderCallback?: boolean;
  /**
   * A `=> void` callback whose argument type is non-serializable (a DOM
   * `File[]`/`Event`/`Blob`/element). It cannot become a bus payload
   * (`EventPayloadValue`), so the factory generator skips minting an emit —
   * the component's own declarative `action`/`actionPayload` event handles
   * any serializable signal.
   */
  nonEmittable?: boolean;
  /**
   * A prop whose type is non-authorable as a `.lolo` config knob (injected
   * `EventBusContextType`, structural `OrbitalSchema`/`Trait`, native
   * `Map`/`Set`). The generator omits an optional one; the component uses its
   * hook/default — it is not a data shape a config knob could carry at all.
   */
  nonAuthorable?: boolean;
  /**
   * Default value extracted from the component's parameter destructuring
   * (e.g. `({ size = 'md', variant = 'primary' })`). Lifted into the
   * registry's `PatternPropDef.default` so consumers (Studio drop
   * pipeline, Inspector) can seed/show sensible values without
   * re-inspecting the component source.
   *
   * Only JSON-serializable scalars / arrays / objects are extracted —
   * function-valued defaults (lambdas, callbacks) are intentionally
   * omitted because they don't round-trip through a JSON registry.
   */
  default?: ExtractedDefaultValue;
  /**
   * A value that shows the component (`@example` in the prop's JSDoc) — the config default
   * of the generated `ui-*` atom, so its INIT renders something. Never the runtime default.
   */
  example?: ExtractedDefaultValue;
  /**
   * Comma-separated intent words for this prop, from a `@synonyms` JSDoc tag
   * (parity with behaviors' knob `@synonyms`). Feeds the pattern embeddings +
   * the contextual-edit agent's intent→prop mapping. Absent when untagged.
   */
  synonyms?: string;
  /**
   * The prop's facing, from a `@tier` JSDoc tag — same enum as behaviors:
   * `domain` (user-meaningful), `presentation` (styling), `internal` (wiring).
   * Lets consumers prioritize the props a user is likely to edit. Absent when
   * untagged.
   */
  tier?: PropTier;
}

/** The prop facing enum shared with behaviors' `@tier` (domain/presentation/internal). */
export type PropTier = 'domain' | 'presentation' | 'internal';

/**
 * Storybook family a pattern belongs to — the top segment of its `.stories.tsx`
 * `title` (`Core/…`, `Game/…`, `Avl/…`, `Learning/…`). Distinct from the
 * semantic `category` (display/form/navigation/…). Drives the generated UI
 * factory layout `functions/ui/<family>/<tier>/`.
 */
export type UiFamily = 'core' | 'game' | 'avl' | 'learning';

/** Atomic design tier — the component's level. */
export type UiTier = 'atoms' | 'molecules' | 'organisms' | 'templates';

/** Render dimension for game-family components — the subdirectory under
 *  `components/game/` (`2d` or `3d`). Undefined for non-game families. */
export type PatternDimension = '2d' | '3d';

/**
 * Recursive JSON-serializable shape for prop defaults extracted from
 * component source. Mirrors `EventPayloadValue` in `@almadar/core` so the
 * value round-trips through the registry JSON without further widening.
 */
export type ExtractedDefaultValue =
  | string
  | number
  | boolean
  | null
  | ExtractedDefaultValue[]
  | { [key: string]: ExtractedDefaultValue };

/** An event emission extracted from JSDoc or useEventBus calls */
export interface ExtractedEvent {
  event: string;
  trigger: string;
  payload: { type: string; shape?: Record<string, string> };
  optional?: boolean;
}

/** A fully parsed component */
export interface ParsedComponent {
  /** File path relative to design-system root */
  relativePath: string;
  /** Component name (e.g., "DataTable", "TrustMeter") */
  componentName: string;
  /** Props interface name (e.g., "DataTableProps") */
  propsInterfaceName: string;
  /** Extracted props from the interface */
  props: ExtractedProp[];
  /** JSDoc description of the component or interface */
  description: string;
  /** Component-level `@capabilities` JSDoc tag — retrieval intent vocabulary.
   *  Its presence marks the component as curated-at-source: sync takes the
   *  JSDoc description verbatim (no registry stickiness) and lolo-ui emits
   *  the curated behavior header. */
  capabilities?: string;
  /** Component-level `@fieldsContract` JSDoc tag — declares how the
   *  component's `fields` prop consumes entity-bound field lists:
   *  `form` = editable SchemaFields (schema enrichment + relationsData);
   *  `display` = read-only display fields ({key, header} + typed meta).
   *  THE declared capability every enrichment consumer keys on — never a
   *  hardcoded pattern-name list. */
  fieldsContract?: 'form' | 'display';
  /** Component-level `@minWidth <px>` JSDoc tag — the narrowest rendered
   *  width at which the component stays usable. */
  minUsableWidth?: number;
  /** Props extend `A11yProps` (@almadar/core): the component forwards the
   *  accessibility attribute family to its element. */
  forwardsA11y?: boolean;
  /** Component-level `@accessibleName <props>` JSDoc tag: the props that give
   *  it an accessible name (ORB_A11Y_UNNAMED requires one of them). */
  accessibleName?: string[];
  /** Events emitted by the component */
  events: ExtractedEvent[];
  /** Atomic design level */
  level: "atoms" | "molecules" | "organisms" | "templates";
  /** Storybook family from the sibling `.stories.tsx` `title` (core/game/avl/learning). */
  family?: UiFamily;
  /** Render dimension for game-family components (`2d` or `3d`). Derived from
   *  `components/game/<dimension>/<tier>/` path segment. Undefined for non-game families. */
  dimension?: PatternDimension;
  /** Client name if this is a client component, undefined for core */
  client?: string;
}

/** A pattern entry for registry.json */
export interface PatternEntry {
  type: string;
  category: string;
  description: string;
  geometry?: {
    unit: number;
    variants: Record<string, {
      height: number;
      elements: Array<{
        kind: string;
        d?: string;
        cx?: number;
        cy?: number;
        r?: number;
        filled?: boolean;
        opacity?: number;
      }>;
    }>;
  };
  /** The `@almadar/shell-web` component file this pattern was scanned from, relative
   *  to the design-system root (e.g. `components/core/molecules/Carousel.tsx`)
   *  — `component.relativePath` at write time. Lets a downstream ACTIONABLE
   *  type-gap failure name the exact upstream file to fix, not just the
   *  pattern name. */
  sourceFile?: string;
  /** Retrieval intent vocabulary from the component's `@capabilities` JSDoc
   *  tag. Present only for curated-at-source components. */
  capabilities?: string;
  /** Declared fields-consumption contract from the component's
   *  `@fieldsContract` JSDoc tag (`form` | `display`). Consumed by the
   *  runtime enrichment (UISlotRenderer), the server relation-option
   *  injection, and orbital-rust codegen — replaces hardcoded
   *  pattern-name lists everywhere. */
  fieldsContract?: 'form' | 'display';
  /** Narrowest usable rendered width in px, from `@minWidth`. The layout
   *  check reports a rendered instance narrower than this as squished. */
  minUsableWidth?: number;
  /** Props that give the pattern its accessible name (`@accessibleName`). */
  accessibleName?: string[];
  suggestedFor: string[];
  typicalSize: string;
  propsSchema: Record<
    string,
    {
      types: string[];
      description: string;
      required?: boolean;
      enumValues?: string[];
      /** Numeric-literal-union members (`1 | 2 | 3`) — seeds the generator's valid numeric default. */
      mapKeyEnum?: string[];
      tupleItems?: PropTypeSchema[];
      numericEnumValues?: number[];
      kind?: ExtractedPropKind;
      eventField?: string;
      /** Sibling event prop this prop carries the payload for (`@payloadFor`). */
      payloadFor?: string;
      /** Callback arg carrying the bound entity's row (`@entityRow <field>`). */
      entityRowField?: string;
      cardinality?: 'record' | 'collection';
      decoder?: PropDecoder;
      notification?: boolean;
      requiredFields?: string[];
      emitPayloadSchema?: ExtractedPayloadField[];
      listenPayloadSchema?: ExtractedPayloadField[];
      callbackArgs?: ExtractedCallbackArg[];
      renderCallback?: boolean;
      /** A `=> void` callback with a non-serializable arg (`File[]`, DOM `Event`)
       *  — not a bus outlet; the generator skips minting an emit. */
      nonEmittable?: boolean;
      /** Non-authorable knob type (injected/structural brand, native Map/Set) —
       *  the generator omits it when optional. */
      nonAuthorable?: boolean;
      /** Element schema for array-typed props (mirrors JSON Schema's `items`). */
      items?: PropTypeSchema;
      /** Uniform value schema for a typed-map prop (`Record<string, V>`). */
      mapValue?: PropTypeSchema;
      /** Per-key schemas for object-typed props sourced from a declared interface. */
      properties?: Record<string, PropTypeSchema>;
      /** Required keys for object-typed props. */
      propertyRequired?: string[];
      /** Set when the prop's type is `Date` (or `T | Date`) — deferred pending a baked-validator rebuild. */
      dateLike?: boolean;
      /** Set when the prop's type is core `ScenePos` — the type-identity signal that grounds `drawable`. */
      scenePos?: boolean;
      /** Set when the prop's type is the `DrawableNode` union — the type-identity signal that grounds `drawHost`. */
      drawableSlot?: boolean;
      /** Set when the prop's type is `FieldValue`/`ControlValue` — the type-identity signal that drives the shared `ControlValue` alias. */
      controlValue?: boolean;
      /** Set when the prop's type is `EventPayload` — the type-identity signal that drives `Map string EventPayloadValue`. */
      eventPayloadBrand?: boolean;
      /** Set when the prop's type is `JsonObject`/`ToolArgs`/`JsonValue` — the type-identity signal that drives the declared recursive `JsonValue` alias. */
      jsonValueBrand?: boolean;
      /** Tagged-union arms (see {@link PropTypeSchema.variants}). */
      variants?: PropTypeSchema[];
      discriminator?: string;
      /** Default value extracted from the component's parameter destructuring. */
      default?: ExtractedDefaultValue;
      /** `@example`: the generated atom's config default (shows the component in its INIT). */
      example?: ExtractedDefaultValue;
      /** Comma-separated intent words from `@synonyms` (feeds embeddings + intent→prop mapping). */
      synonyms?: string;
      /** Prop facing from `@tier` (domain/presentation/internal). */
      tier?: PropTier;
    }
  >;
  client?: string;
  /** Exported component name in the design system library (e.g. "MoleculesTraitIcon") */
  component?: string;
  /** Storybook family (core/game/avl/learning) — from the `.stories.tsx` `title`. */
  family?: UiFamily;
  /** Atomic design tier (atoms/molecules/organisms/templates). */
  tier?: UiTier;
  /** Render dimension for game-family patterns (`2d` or `3d`). Drives the
   *  lolo/registry/functions output sub-path: `ui/game/<dimension>/<tier>/`.
   *  Undefined for non-game families; undefined game entries fall back to
   *  the legacy `ui/game/<tier>/` path for backward compatibility. */
  dimension?: PatternDimension;
  /** True when the pattern is a neutral DRAWABLE — its props are grounded in core
   *  `ScenePos` (a `position: ScenePos`, or a `-layer` whose items are). Derived
   *  by type identity, not name/signal; read by the orbital-rust validator to
   *  gate what may compose under a draw-host canvas's `children`. */
  drawable?: boolean;
  /** True when the pattern is a canvas DRAW-HOST — it declares a slot of drawables
   *  (`drawables: DrawableNode[]`). Derived from the `drawableSlot` type-identity
   *  tag, not name/signal; UISlotRenderer reads it to route authored `children` into
   *  the host's `drawables` prop (painted) instead of DOM-wrapping them. */
  drawHost?: boolean;
}

/** A component mapping entry for component-mapping.json */
export interface MappingEntry {
  component: string;
  importPath: string;
  category: string;
  client?: string;
}

/** An event contract entry for event-contracts.json */
export interface EventContractEntry {
  emits: ExtractedEvent[];
  requires: string[];
  entityAware: boolean;
  configDriven?: boolean;
}

/** Summary of sync changes */
export interface SyncReport {
  scanned: {
    total: number;
    core: { atoms: number; molecules: number; organisms: number; templates: number };
    clients: Record<string, number>;
  };
  registry: {
    added: string[];
    updated: string[];
    unchanged: string[];
    orphaned: string[];
  };
  mapping: {
    added: string[];
    updated: string[];
  };
  contracts: {
    added: string[];
    updated: string[];
  };
}
