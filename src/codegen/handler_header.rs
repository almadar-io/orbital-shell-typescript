//! Shared handler-file header emission.
//!
//! Both backends emit a per-trait handler file with an identical shared
//! block: the `__ORBITAL_SOURCE` source-metadata constant, the
//! `XState` / `XEvent` type/interface declarations, entity-type collection
//! from fetch/persist effects, and agent row-type aliases. The handler's
//! return type is the shared `EventResponse` (`@app/shared`, aliasing
//! `@almadar/core`'s `OrbitalEventResponse`, §156) — no per-trait response
//! interface. Only the framework-specific bits (express vs hono imports,
//! Zod schemas, handler entry point) diverge.
//!
//! Extracted from `backend.rs::generate_trait_event_handler_file` and
//! `backend_hono.rs::generate_trait_event_handler_file_hono` as Phase
//! 3e.7 of the DRY refactor. Call sites retain their framework-specific
//! imports + wiring; this module owns only the shared middle.
//!
//! All helpers push to a `&mut String` so the caller can interleave them
//! with framework-specific output without an intermediate allocation.

use std::collections::BTreeSet;

use orbital_core::ir::{
    OirBindingRoot, OirEffect, OirExpr, OirModule, OirPattern, OirPersistOp, OirTrait,
    OirTransition, OirValue,
};

use crate::codegen::effect::shared::collect_hydration_target_entities;

/// Identifiers that, when used as entity names, would collide with
/// imports the generated code routinely makes from external packages
/// (express's `Request`/`Response`/`NextFunction`, DOM/Web globals like
/// `Event`/`URL`/`Headers`/`Document`/`FormData`, etc.). Importing a
/// user entity under one of these names alongside the framework type
/// produces TS2300 "Duplicate identifier" or surprising shadowing.
///
/// When an entity in this list is imported from `@app/shared`, the
/// codegen aliases it locally to `<Name>Entity` and rewrites every
/// type-position use in the same file. Strings like `entityType: 'X'`
/// are unaffected — only TypeScript type identifiers are rewritten.
const COLLISION_ENTITY_NAMES: &[&str] = &[
    // express
    "Request",
    "Response",
    "NextFunction",
    // Web/DOM globals that survive into Node typings via @types/node
    "Event",
    "URL",
    "Headers",
    "FormData",
    "Blob",
    "File",
    "Document",
    "Node",
    "History",
    "Location",
    "Window",
];

/// Returns the local TypeScript identifier to use when referencing the
/// named entity AS A TYPE inside generated code. For ordinary entity
/// names this is the entity name itself. For names in
/// `COLLISION_ENTITY_NAMES` it is `<Name>Entity` — matching the local
/// alias the import emitter installs via `aliased_shared_imports_clause`.
///
/// Use this everywhere a bare entity-name string is concatenated into a
/// type position (`Partial<X>`, `X[]`, `getById<X>`, payload struct
/// fields, etc.). Do NOT use it for string-literal positions
/// (`entityType: 'X'`, `data['X']`); those keep the original name.
pub fn entity_type_ref(entity_name: &str) -> String {
    if entity_name_collides(entity_name) {
        format!("{}Entity", entity_name)
    } else {
        entity_name.to_string()
    }
}

/// An entity type name that can't be bound bare in a generated file: a global
/// (`COLLISION_ENTITY_NAMES`), or a name in the `<Trait>View` suffix space every
/// generated view component uses.
fn entity_name_collides(name: &str) -> bool {
    COLLISION_ENTITY_NAMES.contains(&name) || name.ends_with("View")
}

/// Build the comma-separated import clause for entity types from
/// `@app/shared`, aliasing collision names so the local file binds them
/// under the safe `<Name>Entity` form (e.g. `Response as ResponseEntity`).
/// Pair this with `entity_type_ref` at every type-position use site.
pub fn aliased_shared_imports_clause(entity_types: &BTreeSet<String>) -> String {
    let parts: Vec<String> = entity_types
        .iter()
        .map(|name| {
            if entity_name_collides(name) {
                format!("{} as {}Entity", name, name)
            } else {
                name.clone()
            }
        })
        .collect();
    parts.join(", ")
}

/// Build a `import type { ... } from '@almadar/core';` statement for the
/// given set of core symbols (sorted, deduped — `BTreeSet` ordering). The
/// single canonical way generated files pull types from `@almadar/core`,
/// replacing the hand-spelled symbol lists scattered across the backends.
/// Returns the statement with a single trailing newline; callers append an
/// extra `\n` for a blank line where they need one.
pub fn core_imports_clause(symbols: &BTreeSet<&str>) -> String {
    let parts: Vec<&str> = symbols.iter().copied().collect();
    format!(
        "import type {{ {} }} from '@almadar/core';\n",
        parts.join(", ")
    )
}

/// Build a `import { ... } from '@almadar/core';` statement (a VALUE import,
/// not `import type`) for the given set of core symbols (sorted, deduped —
/// `BTreeSet` ordering). The single canonical way generated files pull
/// runtime values — functions, not just types — from `@almadar/core`
/// (`normalizeUserContext`, `getNestedValue`, …); pair with
/// `core_imports_clause` when a file needs both a type and a value import.
/// Returns the statement with a single trailing newline.
pub fn core_value_imports_clause(symbols: &BTreeSet<&str>) -> String {
    let parts: Vec<&str> = symbols.iter().copied().collect();
    format!("import {{ {} }} from '@almadar/core';\n", parts.join(", "))
}

/// Build a sorted `import type { A, B } from '<from>';\n` line naming named
/// struct interfaces `types/entities.ts` (`generate_shared_entities`) hoists
/// — the one owner every consumer of a config/entity field's `OirType::TypeRef`
/// (found via `TypeScriptBackend::collect_named_type_refs`) builds its import
/// from, whether the referencing file sits alongside entities.ts (`from:
/// "./entities"` — `generate_shared_schemas`, `generate_shared_trait_configs`)
/// or pulls the package barrel (`from: "@app/shared"` — a per-trait client
/// hook's own `{Name}Config`, which entities.ts re-exports through). No
/// import line (empty string) when `names` is empty, so an unreferenced file
/// never gets an unused `import type {}` that trips `noUnusedLocals`.
pub fn named_struct_type_import_line(names: &BTreeSet<&str>, from: &str) -> String {
    if names.is_empty() {
        return String::new();
    }
    format!(
        "import type {{ {} }} from '{}';\n",
        names.iter().copied().collect::<Vec<_>>().join(", "),
        from
    )
}

/// The inlined `TraitFieldRef` template-literal type alias (`type
/// TraitFieldRef = `@trait.${string}`;` + trailing `\n`). Inlined rather
/// than imported from `@almadar/core` so the generated file doesn't depend
/// on the symbol being exported by the (possibly older) scaffold-pinned core
/// version, and to avoid a types-module import cycle in `configs.ts`. One
/// canonical spelling for the ~3 emission sites; callers add a blank line
/// where they need one.
pub const TRAIT_FIELD_REF_DECL: &str = "type TraitFieldRef = `@trait.${string}`;\n";

/// A `trait`-typed entity field or event payload member (language trio): a
/// local embed `@trait.X`, a stored trait value `{ behavior, trait, …overrides }`,
/// or `null` (unbound). Inlined storage shape, same pin-safety rationale as
/// `PATTERN_VALUE_DECL`; every stored value is assignable to core's `TraitValue`
/// wire form. Config-only files keep `TRAIT_FIELD_REF_DECL`.
pub const TRAIT_FIELD_VALUE_DECL: &str = "type TraitFieldRef = `@trait.${string}` | TraitFieldStored | null;\ninterface TraitFieldStored {\n  behavior: string;\n  trait: string;\n  [key: string]: FieldValue | undefined;\n}\n";

/// Zod twin of `TRAIT_FIELD_VALUE_DECL` (`map_type_to_zod_with_refs` emits
/// `TraitFieldValueSchema` for `trait`); needs `FieldValueSchema` from core,
/// which `zod_core_value_imports` adds when this name appears.
pub const TRAIT_FIELD_VALUE_SCHEMA_DECL: &str = "const TraitFieldValueSchema: z.ZodType<TraitFieldRef> = z.union([\n  z.custom<`@trait.${string}`>((v) => typeof v === 'string' && /^@trait\\.[A-Z][a-zA-Z0-9]*$/.test(v)),\n  z.object({ behavior: z.string(), trait: z.string() }).catchall(FieldValueSchema.optional()),\n  z.null(),\n]);\n";

/// An `orbital`-typed entity field or payload member: a stored orbital value
/// `{ behavior, orbital, …§8b body }` or `null` (unbound). Inlined storage shape,
/// same rationale as `TRAIT_FIELD_VALUE_DECL`.
pub const ORBITAL_FIELD_VALUE_DECL: &str = "type OrbitalFieldRef = OrbitalFieldStored | null;\ninterface OrbitalFieldStored {\n  behavior: string;\n  orbital: string;\n  [key: string]: FieldValue | undefined;\n}\n";

/// Zod twin of `ORBITAL_FIELD_VALUE_DECL` (`map_type_to_zod_with_refs` emits
/// `OrbitalFieldValueSchema` for `orbital`).
pub const ORBITAL_FIELD_VALUE_SCHEMA_DECL: &str = "const OrbitalFieldValueSchema: z.ZodType<OrbitalFieldRef> = z.union([\n  z.object({ behavior: z.string(), orbital: z.string() }).catchall(FieldValueSchema.optional()),\n  z.null(),\n]);\n";

/// A `behavior`-typed entity field or payload member: a stored whole-behavior
/// value `{ behavior }` (`behavior/ref`) or `null` (unbound). Inlined storage
/// shape, same rationale as `TRAIT_FIELD_VALUE_DECL`.
pub const BEHAVIOR_FIELD_VALUE_DECL: &str = "type BehaviorFieldRef = { behavior: string } | null;\n";

/// Zod twin of `BEHAVIOR_FIELD_VALUE_DECL` (`map_type_to_zod_with_refs` emits
/// `BehaviorFieldValueSchema` for `behavior`).
pub const BEHAVIOR_FIELD_VALUE_SCHEMA_DECL: &str = "const BehaviorFieldValueSchema: z.ZodType<BehaviorFieldRef> = z.union([z.object({ behavior: z.string() }).strict(), z.null()]);\n";

/// Inlined renderable-content value types for `node`-typed fields/knobs.
/// Inlined for the same reason as `TraitFieldRef` (no dependency on the
/// scaffold-pinned core exporting the symbol) — and deliberately the
/// STORAGE shape, not core's authoring-side `PatternValue`: no `undefined`
/// array elements and no `readonly` arrays (JSON can carry neither), which
/// is exactly what keeps the type assignable under `EntityRow`'s
/// `FieldValue | undefined` index signature (TS2411). Every value of this
/// type is assignable to core's wider `PatternValue`, so rows flow into
/// core APIs without casts.
pub const PATTERN_VALUE_DECL: &str = "type PatternValue =\n  | string\n  | number\n  | boolean\n  | Date\n  | null\n  | PatternNode\n  | PatternValue[];\ninterface PatternNode {\n  type?: string;\n  children?: PatternNode[];\n  [prop: string]: PatternValue | undefined;\n}\n";

/// Inlined twin of `@almadar/core`'s `getNestedValue` (single Rust-side
/// source: `packages/almadar-core/src/lib/get-nested-value.ts`) — backs
/// `object/get` / `str/template`'s dot-path codegen (`codegen/operator.rs`).
/// Inlined for the SAME reason as `TRAIT_FIELD_REF_DECL`/`PATTERN_VALUE_DECL`
/// above: the symbol isn't safely importable from every scaffold-pinned core
/// version yet (verified 2026-09-06 — `getNestedValue` landed in the
/// workspace source this session but the latest PUBLISHED `@almadar/core` on
/// the npm registry is still 10.86.0, without it, so a fresh `orb verify`
/// temp app's installed copy 404s on the import). Drop this inline and
/// import the real export once a published core carries it — core stays the
/// single canonical owner of the algorithm; this is a compile-safety mirror,
/// not a second implementation to maintain in parallel.
pub const GET_NESTED_VALUE_DECL: &str = "function getNestedValue(obj: EventPayload | EventPayloadValue | FieldValue | Record<string, FieldValue | undefined> | null | undefined, path: string): FieldValue | undefined {\n  if (obj === null || obj === undefined || !path) return undefined;\n  if (typeof obj !== 'object') return undefined;\n  if (!path.includes('.') && !Array.isArray(obj)) {\n    return (obj as Record<string, FieldValue | undefined>)[path];\n  }\n  let value: EventPayload | EventPayloadValue | FieldValue | Record<string, FieldValue | undefined> | null | undefined = obj;\n  for (const part of path.split('.')) {\n    if (value === null || value === undefined || typeof value !== 'object') return undefined;\n    if (Array.isArray(value)) {\n      if (!/^\\d+$/.test(part)) return undefined;\n      value = (value as readonly (EventPayloadValue | FieldValue | null | undefined)[])[Number(part)];\n      continue;\n    }\n    value = (value as Record<string, FieldValue | undefined>)[part];\n  }\n  return value as FieldValue | undefined;\n}\n";

/// Inline `__toEntityRow` — narrows a bus-payload value to a row at the
/// boundary where a `@payload.<key>` binding feeds a row-typed pattern prop
/// (`initialData?: EntityRow`). Payload values arrive as the wide
/// `EventPayloadValue` union; only a plain object (non-array, non-Date) is a
/// row. Inlined (not imported from @almadar/core) for the same
/// older-lockfile reason as `TRAIT_FIELD_REF_DECL` — the emitted app may
/// resolve a published core that predates any such export.
/// Inline `entityId` resolution from the event payload: accepts both
/// `entityId` (config-injected ids) and `id` (`actionPayload`-surfaced ids),
/// widened through `EventPayload` and `typeof`-narrowed to string. One
/// declaration for the Express and Hono handlers.
pub const ENTITY_ID_FROM_PAYLOAD_DECL: &str = "  const __payloadWide = payload as EventPayload | undefined;\n  const __payloadEntityId = __payloadWide?.entityId;\n  const __payloadId = __payloadWide?.id;\n  const __payloadRow = __payloadWide?.row;\n  const __payloadRowId = __payloadRow !== null && typeof __payloadRow === 'object' && !Array.isArray(__payloadRow) ? (__payloadRow as EventPayload).id : undefined;\n  const entityId: string | undefined =\n    typeof __payloadEntityId === 'string' ? __payloadEntityId\n    : typeof __payloadId === 'string' ? __payloadId\n    : typeof __payloadRowId === 'string' ? __payloadRowId\n    : undefined;\n";

/// Zod twins of `PATTERN_VALUE_DECL`'s `PatternValue`/`PatternNode`, inlined
/// beside it wherever a `node`-typed field or payload needs a runtime
/// validator (`map_type_to_zod_with_refs` emits `PatternValueSchema`).
pub const PATTERN_VALUE_SCHEMA_DECL: &str = "const PatternNodeSchema: z.ZodType<PatternNode> = z.lazy(() =>\n  z.object({ type: z.string().optional(), children: z.array(PatternNodeSchema).optional() }).catchall(PatternValueSchema.optional()),\n);\nconst PatternValueSchema: z.ZodType<PatternValue> = z.lazy(() =>\n  z.union([z.string(), z.number(), z.boolean(), z.date(), z.null(), PatternNodeSchema, z.array(PatternValueSchema)]),\n);\n";

/// Value imports from `@almadar/core` that a block of emitted zod text needs
/// (`FieldValueSchema` for `json`, `SExprSchema` for `sexpr`), keyed on the
/// text itself so the import list can never drift from the schemas.
pub fn zod_core_value_imports(zod_text: &str) -> String {
    let mut syms: BTreeSet<&str> = ["FieldValueSchema", "SExprSchema"]
        .into_iter()
        .filter(|s| zod_text.contains(s))
        .collect();
    if zod_text.contains("TraitFieldValueSchema") || zod_text.contains("OrbitalFieldValueSchema") {
        syms.insert("FieldValueSchema");
    }
    if syms.is_empty() {
        String::new()
    } else {
        core_value_imports_clause(&syms)
    }
}

pub const TO_ENTITY_ROW_DECL: &str = "const __toEntityRow = (value: EventPayloadValue | undefined): EntityRow | undefined =>\n  value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)\n    ? (value as EntityRow)\n    : undefined;\n";

/// Emit `const __ORBITAL_SOURCE = { orbital: '<orbital>', trait: '<trait>' } as const;\n\n`.
///
/// The server event bus stamps every `emit(...)` with this constant so
/// source-scoped listeners (`TraitName EVENT -> TRIGGER`) can filter by
/// origin. Uses `trait_def.orbital_name` (set by `resolve_trait` per
/// gap #13) — NOT `module.name`, which is the App scope. The qualified
/// bus key downstream subscribers listen for is
/// `UI:${trait.orbital_name}.${trait.name}.${event}`; emitting the
/// matching `source.orbital` here keeps the round-trip consistent.
pub fn emit_orbital_source_const(code: &mut String, _module: &OirModule, trait_def: &OirTrait) {
    code.push_str(&format!(
        "const __ORBITAL_SOURCE = {{ orbital: '{}', trait: '{}' }} as const;\n\n",
        trait_def.orbital_name, trait_def.name
    ));
}

/// Emit `type XState = 's1' | 's2' | ...;\n\n` where X is `trait_def.name`.
pub fn emit_state_union(code: &mut String, trait_def: &OirTrait) {
    code.push_str(&format!("type {}State = ", trait_def.name));
    let states: Vec<String> = trait_def
        .states
        .iter()
        .map(|s| format!("'{}'", s.name))
        .collect();
    code.push_str(&states.join(" | "));
    code.push_str(";\n\n");
}

/// Emit `type XEvent = 'A' | 'B' | ...;\n\n` including both declared events
/// AND listened events (cross-orbital / cross-trait listens).
pub fn emit_event_union(code: &mut String, trait_def: &OirTrait) {
    let mut event_keys: Vec<String> = trait_def.events.iter().map(|e| e.key.clone()).collect();
    for listener in &trait_def.listeners {
        if !event_keys.contains(&listener.event_pattern) {
            event_keys.push(listener.event_pattern.clone());
        }
        if !event_keys.contains(&listener.triggers) {
            event_keys.push(listener.triggers.clone());
        }
    }
    code.push_str(&format!("type {}Event = ", trait_def.name));
    let events: Vec<String> = event_keys.iter().map(|e| format!("'{}'", e)).collect();
    code.push_str(&events.join(" | "));
    code.push_str(";\n\n");
}

/// The server-side `@entity` binding for a persisted linked entity (§87,
/// reworked §88): the row named by the payload id (when there is one) with
/// the dispatching trait's request frame layered on top through
/// `resolveEntityView` — the SAME `@almadar/core` primitive the JS
/// interpreter uses, so `defaults < row < frame` (with an explicit id
/// always winning) can't drift between the two execution paths. The frame
/// may only contribute keys the linked entity actually declares
/// `@intrinsic` (`OirEntity::frame_fields`) — `__FRAME_KEYS` is that
/// allow-list, so an untrusted client `fields` payload can never smuggle a
/// real persisted column past the row it just fetched. Shared verbatim by
/// the Express and Hono handler generators so the two backends cannot
/// drift here again.
pub fn entity_frame_binding(entity_ty: &str, collection: &str, frame_fields: &[&str]) -> String {
    let keys = frame_fields
        .iter()
        .map(|f| format!("'{}'", f))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "  const __FRAME_KEYS: readonly string[] = [{keys}];\n  const __row: {ty} | null = entityId ? await getDataService().getById<{ty}>('{coll}', entityId) : null;\n  const entity: {ty} = resolveEntityView({{ frame: entityFrame, row: __row, id: entityId, allowedFrameKeys: __FRAME_KEYS }}) as {ty};\n\n",
        keys = keys,
        ty = entity_ty,
        coll = collection,
    )
}

/// The `[runtime]` counterpart of [`entity_frame_binding`]: `entity` is the long-lived held row
/// (`getRuntimeEntity`, so `(set @entity.X)` accumulates across requests), with the client's frame
/// folded over it each request. A `[runtime]` entity has no authoritative store — the client's
/// round-trip IS the source of truth, so the frame wins in full (JS twin: `evaluateOrbitalEvent`'s
/// `entityByTrait` seeding). Shared by both backends.
pub fn runtime_entity_binding(orbital: &str, trait_name: &str, entity_ty: &str) -> String {
    format!(
        "  const entity = getRuntimeEntity('{orbital}', '{trait_name}', entityId) as {entity_ty};\n  if (entityFrame) Object.assign(entity, entityFrame);\n\n",
    )
}

/// Top-level `@entity` fields a transition's `set` effects write, in source
/// order, deduplicated — the keys the handler echoes back as `fields`.
pub fn entity_set_fields(trans: &OirTransition) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for e in &trans.effects {
        if let OirExpr::Effect { effect } = e {
            if let OirEffect::Set { target, .. } = effect.as_ref() {
                if matches!(target.root, OirBindingRoot::Entity) {
                    if let Some(first) = target.path.first() {
                        if !out.iter().any(|f| f == first) {
                            out.push(first.clone());
                        }
                    }
                }
            }
        }
    }
    out
}

/// Detect whether the trait has any `call-service` effect.
pub fn has_call_service_effects(trait_def: &OirTrait) -> bool {
    trait_def.transitions.iter().any(|t| {
        t.effects.iter().any(|e| {
            if let OirExpr::Effect { effect } = e {
                matches!(effect.as_ref(), OirEffect::CallService { .. })
            } else {
                false
            }
        })
    })
}

/// Whether any transition runs an effect `matches`, at any depth.
fn trait_has_effect(trait_def: &OirTrait, matches: fn(&OirEffect) -> bool) -> bool {
    fn visit(e: &OirExpr, matches: fn(&OirEffect) -> bool) -> bool {
        if let OirExpr::Effect { effect } = e {
            if matches(effect.as_ref()) {
                return true;
            }
        }
        e.child_exprs().into_iter().any(|child| visit(child, matches))
    }
    trait_def
        .transitions
        .iter()
        .any(|t| t.effects.iter().any(|e| visit(e, matches)))
}

fn is_http(effect: &OirEffect) -> bool {
    matches!(effect, OirEffect::Http { .. })
}

fn is_random_bytes(effect: &OirEffect) -> bool {
    matches!(effect, OirEffect::RandomBytes { .. })
}

fn is_credential_status(effect: &OirEffect) -> bool {
    matches!(effect, OirEffect::CredentialStatus { .. })
}

fn is_credential_forget(effect: &OirEffect) -> bool {
    matches!(effect, OirEffect::CredentialForget { .. })
}

/// Detect whether any transition runs an `http` effect, at any depth.
pub fn trait_has_http_effects(trait_def: &OirTrait) -> bool {
    trait_has_effect(trait_def, is_http)
}

/// Whether any transition runs `random-bytes`, `credential-status` or `credential-forget`.
pub fn trait_has_host_effects(trait_def: &OirTrait) -> bool {
    trait_has_effect(trait_def, is_random_bytes)
        || trait_has_effect(trait_def, is_credential_status)
        || trait_has_effect(trait_def, is_credential_forget)
}

/// Whether any trait of the module needs the kernel's http ports: an `http` effect or a host effect.
pub fn module_has_http_effects(module: &orbital_core::ir::OirModule) -> bool {
    module
        .traits
        .iter()
        .any(|t| trait_has_http_effects(t) || trait_has_host_effects(t))
}

/// The `services/clients` import line a trait's handlers need for `http` and host
/// effects; `None` when the trait runs none.
pub fn http_call_import(trait_def: &OirTrait, module_path: &str) -> Option<String> {
    let mut symbols: Vec<&str> = Vec::new();
    if trait_has_http_effects(trait_def) {
        symbols.extend(["httpCall", "HttpCallError"]);
    }
    if trait_has_effect(trait_def, is_random_bytes) {
        symbols.push("hostRandomBytes");
    }
    if trait_has_effect(trait_def, is_credential_status) {
        symbols.push("hostCredentialStatus");
    }
    if trait_has_effect(trait_def, is_credential_forget) {
        symbols.push("hostCredentialForget");
    }
    (!symbols.is_empty()).then(|| format!("import {{ {} }} from '{}';\n", symbols.join(", "), module_path))
}

/// Whether any transition runs a `call-service` or `http` carrying a `key`
/// (registered so `cancel-call` can abort it), at any depth.
pub fn trait_has_keyed_call_service(trait_def: &OirTrait) -> bool {
    fn visit(e: &OirExpr) -> bool {
        if let OirExpr::Effect { effect } = e {
            if let OirEffect::CallService { key: Some(_), .. }
            | OirEffect::Http { key: Some(_), .. } = effect.as_ref()
            {
                return true;
            }
        }
        e.child_exprs().into_iter().any(visit)
    }
    trait_def
        .transitions
        .iter()
        .any(|t| t.effects.iter().any(visit))
}

/// Whether any transition runs a `cancel-call`, at any depth.
pub fn trait_has_cancel_call(trait_def: &OirTrait) -> bool {
    fn visit(e: &OirExpr) -> bool {
        if let OirExpr::Effect { effect } = e {
            if matches!(effect.as_ref(), OirEffect::CancelCall { .. }) {
                return true;
            }
        }
        e.child_exprs().into_iter().any(visit)
    }
    trait_def
        .transitions
        .iter()
        .any(|t| t.effects.iter().any(visit))
}

/// The `services/host` import line a trait's handlers need: `servicePorts`
/// for `call-service`, the registry's begin/end for a keyed one, and
/// `cancelKeyedCall` for `cancel-call`. `None` when the trait needs none.
pub fn service_host_import(trait_def: &OirTrait, module_path: &str) -> Option<String> {
    let mut symbols: Vec<&str> = Vec::new();
    if has_call_service_effects(trait_def) {
        symbols.push("servicePorts");
    }
    if trait_has_keyed_call_service(trait_def) {
        symbols.extend(["beginKeyedCall", "endKeyedCall"]);
    }
    if trait_has_cancel_call(trait_def) {
        symbols.push("cancelKeyedCall");
    }
    if symbols.is_empty() {
        return None;
    }
    Some(format!(
        "import {{ {} }} from '{}';\n",
        symbols.join(", "),
        module_path
    ))
}

/// Detect whether any of `transitions`' effects emit an event — a standalone
/// `(emit X)` OR a V2 data-op `emit:` config on fetch/persist/call-service/ref.
/// Both backends gate the `getServerEventBus` import and the per-handler
/// `const emittedEvents: EmittedEvent[]` declaration on this. Previously
/// copy-pasted in three places (Express + Hono trait-file headers + the
/// Hono per-event handler).
pub fn transitions_have_emit_effects<'a>(
    transitions: impl IntoIterator<Item = &'a OirTransition>,
) -> bool {
    transitions.into_iter().any(|t| {
        t.effects.iter().any(|e| {
            if let OirExpr::Effect { effect } = e {
                match effect.as_ref() {
                    OirEffect::Emit { .. } => true,
                    OirEffect::Fetch { emit, .. } => emit.is_some(),
                    OirEffect::Persist { emit, .. } => emit.is_some(),
                    OirEffect::PersistBatch { emit, .. } => emit.is_some(),
                    OirEffect::CallService { emit, .. } => emit.is_some(),
                    OirEffect::Http { emit, .. } => emit.is_some(),
                    OirEffect::RandomBytes { emit, .. }
                    | OirEffect::CredentialStatus { emit, .. }
                    | OirEffect::CredentialForget { emit, .. } => emit.is_some(),
                    OirEffect::Ref { emit, .. } => emit.is_some(),
                    _ => false,
                }
            } else {
                false
            }
        })
    })
}

/// Trait-wide convenience over [`transitions_have_emit_effects`].
pub fn trait_has_emit_effects(trait_def: &OirTrait) -> bool {
    transitions_have_emit_effects(&trait_def.transitions)
}

/// True when an `OirValue` (a render-ui pattern's config value, walked
/// recursively) contains a live `@`-binding string anywhere — the §A7
/// `pattern_value_to_ts_server` cast site (`codegen/expr.rs`) casts every
/// such value `as SExpr`, so a trait with one needs the `SExpr` type import.
fn oir_value_has_binding(value: &OirValue) -> bool {
    match value {
        OirValue::String(s) => s.starts_with('@'),
        OirValue::Array(items) => items.iter().any(oir_value_has_binding),
        OirValue::Object(obj) => obj.values().any(oir_value_has_binding),
        OirValue::Number(_) | OirValue::Bool(_) | OirValue::Null => false,
    }
}

/// True when any transition's `render-ui` effect carries a live `@`-binding
/// in its pattern config — gates the `SExpr` import the §A7 client-effect-
/// tuple cast (`pattern_value_to_ts_server`) needs. `navigate`'s own casts
/// (`String(...)`, `as Record<string, string>`) need no extra import.
pub fn trait_needs_sexpr_import(trait_def: &OirTrait) -> bool {
    // A handler's payload parameter is typed from the event's schema.
    let payload_uses_sexpr = trait_def
        .events
        .iter()
        .filter_map(|e| e.payload_schema.as_ref())
        .flat_map(|schema| schema.values())
        .any(crate::backend::oir_type_uses_sexpr);
    payload_uses_sexpr || trait_def.transitions.iter().any(|t| {
        t.effects.iter().any(|e| {
            if let OirExpr::Effect { effect } = e {
                matches!(
                    effect.as_ref(),
                    OirEffect::RenderUi { pattern, .. } if render_ui_pattern_has_binding(pattern)
                )
            } else {
                false
            }
        })
    })
}

fn render_ui_pattern_has_binding(pattern: &OirPattern) -> bool {
    pattern.config.values().any(oir_value_has_binding)
}

/// Detect whether any transition's `persist` effect declares an
/// `emit: { success }` envelope — the ONLY effect class whose success emit
/// is cross-client broadcast over SSE (see `Almadar_Live_Push.md`). Keyed
/// on the effect variant, never on the event's name — gates the
/// `broadcastBusEvent` import and the handler-file `clientId` threading.
pub fn trait_has_persist_success_emit(trait_def: &OirTrait) -> bool {
    trait_def.transitions.iter().any(|t| {
        t.effects.iter().any(|e| {
            if let OirExpr::Effect { effect } = e {
                matches!(
                    effect.as_ref(),
                    OirEffect::Persist { emit: Some(cfg), .. }
                        | OirEffect::PersistBatch { emit: Some(cfg), .. } if cfg.success.is_some()
                )
            } else {
                false
            }
        })
    })
}

/// Whether any transition runs a `call-service` declaring `emit: { onMessage }`
/// (live messages to the requesting tab) — gates the `pushToOrigin` import.
pub fn trait_has_call_service_message(trait_def: &OirTrait) -> bool {
    fn visit(e: &OirExpr) -> bool {
        if let OirExpr::Effect { effect } = e {
            if let OirEffect::CallService {
                emit: Some(cfg), ..
            }
            | OirEffect::Http {
                emit: Some(cfg), ..
            } = effect.as_ref()
            {
                if cfg.on_message.is_some() {
                    return true;
                }
            }
        }
        e.child_exprs().into_iter().any(visit)
    }
    trait_def
        .transitions
        .iter()
        .any(|t| t.effects.iter().any(visit))
}

/// Collected entity types referenced by fetch / persist / ref / deref /
/// swap effects on a trait. The linked entity is always included.
/// `@entity` in an effect's `entity_type` is resolved to `trait_def.linked_entity`.
///
/// Used by both backends to build the `import type { A, B, C } from '@app/shared'`
/// declaration.
pub fn collect_effect_entity_types(trait_def: &OirTrait, module: &OirModule) -> BTreeSet<String> {
    let mut entity_types: BTreeSet<String> = BTreeSet::new();
    if let Some(linked_entity) = &trait_def.linked_entity {
        entity_types.insert(linked_entity.clone());
    }
    for trans in &trait_def.transitions {
        for effect_expr in &trans.effects {
            if let OirExpr::Effect { effect } = effect_expr {
                match effect.as_ref() {
                    OirEffect::Fetch { entity_type, .. }
                    | OirEffect::Ref { entity_type, .. }
                    | OirEffect::Deref { entity_type, .. }
                    | OirEffect::Swap { entity_type, .. }
                    | OirEffect::Persist { entity_type, .. } => {
                        if entity_type == "@entity" {
                            if let Some(linked) = &trait_def.linked_entity {
                                entity_types.insert(linked.clone());
                            }
                        } else {
                            entity_types.insert(entity_type.clone());
                        }
                    }
                    OirEffect::PersistBatch { entities, .. } => {
                        entity_types.extend(entities.iter().cloned());
                    }
                    _ => {}
                }
            }
        }
    }
    // Also collect entity references that appear in event payload schemas.
    // The dispatcher narrows each event's `payload` to a literal shape via
    // `map_type_aliased`, which emits bare entity-type identifiers (e.g.
    // `row: Course`). Without including these in the imports clause, the
    // handler file references `Course` without an import → TS2304.
    for event in &trait_def.events {
        if let Some(schema) = &event.payload_schema {
            for oir_type in schema.values() {
                collect_entity_refs_in_type(oir_type, &mut entity_types);
                crate::TypeScriptBackend::collect_named_type_refs(oir_type, &mut entity_types);
            }
        }
    }
    // Also collect the target entity of every `fetch`/`ref` `include:`
    // relation hydration — `emit_relation_hydration` emits
    // `getDataService().list<Target>(...)` for each one, so the handler
    // file references `Target` as a bare type even when no effect ever
    // fetches/persists it directly. Without this, an included relation
    // whose target entity isn't otherwise touched by the trait references
    // an unimported type → TS2304.
    entity_types.extend(collect_hydration_target_entities(trait_def, module));
    // Only local entities and the named struct types `entities.ts` declares have an
    // `@app/shared` export; non-local refs lower to `EntityRow`.
    entity_types.retain(|name| {
        module.entities.iter().any(|e| &e.name == name) || module.named_types.contains_key(name)
    });
    entity_types
}

/// Walk an `OirType` and add every `Reference { entity }` name into `out`.
/// Mirrors what `map_type_aliased` would emit at the type position so the
/// import set is the exact set of entity identifiers the handler text
/// references.
fn collect_entity_refs_in_type(t: &orbital_core::ir::OirType, out: &mut BTreeSet<String>) {
    use orbital_core::ir::OirType;
    match t {
        OirType::Reference { entity } | OirType::Row { entity } => {
            out.insert(entity.clone());
        }
        OirType::Array { inner } | OirType::Optional { inner } => {
            collect_entity_refs_in_type(inner, out);
        }
        OirType::Struct { fields } => {
            for f in fields {
                collect_entity_refs_in_type(&f.field_type, out);
            }
        }
        _ => {}
    }
}

/// Hono-specific extension of entity-type collection: same entity-type set
/// as [`collect_effect_entity_types`] (payload-schema refs + hydration
/// targets included — converged onto the one walk so the two backends'
/// import lists can't drift), plus which entities are targets of
/// Persist::Create vs Persist::Update so the caller can emit the right Zod
/// `{X}InputSchema` / `{X}UpdateSchema` imports. Returns `(entity_types,
/// create_entities, update_entities)`.
pub fn collect_entity_types_with_persist_ops(
    trait_def: &OirTrait,
    module: &OirModule,
) -> (BTreeSet<String>, BTreeSet<String>, BTreeSet<String>) {
    let entity_types = collect_effect_entity_types(trait_def, module);
    let mut create: BTreeSet<String> = BTreeSet::new();
    let mut update: BTreeSet<String> = BTreeSet::new();
    for trans in &trait_def.transitions {
        for effect_expr in &trans.effects {
            if let OirExpr::Effect { effect } = effect_expr {
                if let OirEffect::Persist {
                    operation,
                    entity_type,
                    ..
                } = effect.as_ref()
                {
                    let resolved = if entity_type == "@entity" {
                        trait_def.linked_entity.clone()
                    } else {
                        Some(entity_type.clone())
                    };
                    if let Some(r) = resolved {
                        match operation {
                            OirPersistOp::Create | OirPersistOp::Upsert => {
                                create.insert(r);
                            }
                            OirPersistOp::Update => {
                                update.insert(r);
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }
    (entity_types, create, update)
}

#[cfg(test)]
mod persist_success_emit_tests {
    use super::trait_has_persist_success_emit;
    use orbital_core::ir::{
        OirEffect, OirEmitConfig, OirExpr, OirPersistOp, OirTrait, OirTransition,
    };

    #[test]
    fn persist_with_success_emit_is_detected() {
        let mut trait_def = OirTrait::new("PatientCrud");
        let mut trans = OirTransition::new("idle", "idle", "SAVE");
        trans.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Update,
            entity_type: "@entity".to_string(),
            data: OirExpr::string("@entity"),
            emit: Some(OirEmitConfig {
                success: Some("PATIENT_SAVED".to_string()),
                failure: None,
                on_change: None,
                on_message: None,
                cancelled: None,
            }),
        }));
        trait_def.transitions.push(trans);

        assert!(trait_has_persist_success_emit(&trait_def));
    }

    #[test]
    fn persist_without_emit_is_not_detected() {
        let mut trait_def = OirTrait::new("PatientCrud");
        let mut trans = OirTransition::new("idle", "idle", "SAVE");
        trans.effects.push(OirExpr::effect(OirEffect::Persist {
            operation: OirPersistOp::Update,
            entity_type: "@entity".to_string(),
            data: OirExpr::string("@entity"),
            emit: None,
        }));
        trait_def.transitions.push(trans);

        assert!(!trait_has_persist_success_emit(&trait_def));
    }

    #[test]
    fn fetch_with_success_emit_is_not_detected() {
        // Positional: fetch's emit.success looks identical to persist's at
        // the event-name level, but only persist crosses the SSE channel.
        let mut trait_def = OirTrait::new("PatientCrud");
        let mut trans = OirTransition::new("idle", "idle", "INIT");
        trans.effects.push(OirExpr::effect(OirEffect::Fetch {
            entity_type: "@entity".to_string(),
            id: None,
            filter: None,
            order_by: None,
            offset: None,
            limit: None,
            include: None,
            emit: Some(OirEmitConfig {
                success: Some("PATIENT_LOADED".to_string()),
                failure: None,
                on_change: None,
                on_message: None,
                cancelled: None,
            }),
        }));
        trait_def.transitions.push(trans);

        assert!(!trait_has_persist_success_emit(&trait_def));
    }
}

#[cfg(test)]
mod call_service_message_tests {
    use super::trait_has_call_service_message;
    use orbital_core::ir::{OirEffect, OirEmitConfig, OirExpr, OirTrait, OirTransition};

    fn call_service(on_message: Option<&str>) -> OirExpr {
        OirExpr::effect(OirEffect::CallService {
            service: "llm".to_string(),
            method: "call-tools".to_string(),
            args: OirExpr::object(orbital_core::ir::OirFields::new()),
            key: None,
            emit: Some(OirEmitConfig {
                success: Some("ANSWERED".to_string()),
                failure: None,
                on_change: None,
                on_message: on_message.map(str::to_string),
                cancelled: None,
            }),
        })
    }

    #[test]
    fn call_service_with_on_message_is_detected() {
        let mut trait_def = OirTrait::new("AssistantLoop");
        let mut trans = OirTransition::new("idle", "thinking", "CONVERSE");
        trans.effects.push(call_service(Some("STEP")));
        trait_def.transitions.push(trans);
        assert!(trait_has_call_service_message(&trait_def));
    }

    #[test]
    fn call_service_without_on_message_is_not_detected() {
        let mut trait_def = OirTrait::new("AssistantLoop");
        let mut trans = OirTransition::new("idle", "thinking", "CONVERSE");
        trans.effects.push(call_service(None));
        trait_def.transitions.push(trans);
        assert!(!trait_has_call_service_message(&trait_def));
    }
}

#[cfg(test)]
mod runtime_entity_binding_tests {
    //! A `[runtime]` entity's held server row takes the client's frame each request. A
    //! `runtimeOptimistic` trait commits `SET_*` on the client and posts its frame with the
    //! event; reading only the held row sent a service atom's call with every field blank
    //! (arxiv `query: ""`, live 2026-09-24). Same fold as the JS runtime's `entityByTrait`.
    use super::runtime_entity_binding;

    #[test]
    fn the_client_frame_is_folded_over_the_held_row() {
        let js = runtime_entity_binding("std-service-arxiv", "ServiceArxivArxiv", "ServiceArxiv");
        assert!(js.contains("const entity = getRuntimeEntity('std-service-arxiv', 'ServiceArxivArxiv', entityId) as ServiceArxiv;"), "{js}");
        assert!(
            js.contains("if (entityFrame) Object.assign(entity, entityFrame);"),
            "{js}"
        );
    }

    #[test]
    fn the_held_row_object_is_kept_so_sets_accumulate() {
        let js = runtime_entity_binding("o", "T", "E");
        // `entity` is the held object itself (mutated in place), never a copy or a view.
        assert!(!js.contains("resolveEntityView"), "{js}");
        assert!(!js.contains("{ ...entity"), "{js}");
    }
}

#[cfg(test)]
mod service_host_import_tests {
    use super::service_host_import;
    use orbital_core::ir::{OirEffect, OirExpr, OirTrait, OirTransition};

    fn trait_with(effects: Vec<OirExpr>) -> OirTrait {
        let mut t = OirTrait::new("Runner");
        let mut trans = OirTransition::new("idle", "idle", "RUN");
        trans.effects = effects;
        t.transitions.push(trans);
        t
    }

    fn call(key: Option<&str>) -> OirExpr {
        OirExpr::effect(OirEffect::CallService {
            service: "llm".to_string(),
            method: "generate".to_string(),
            args: OirExpr::object(orbital_core::ir::OirFields::new()),
            key: key.map(OirExpr::string),
            emit: None,
        })
    }

    #[test]
    fn an_unkeyed_call_imports_only_the_host_ports() {
        let t = trait_with(vec![call(None)]);
        assert_eq!(
            service_host_import(&t, "../h.js").as_deref(),
            Some("import { servicePorts } from '../h.js';\n")
        );
    }

    #[test]
    fn a_keyed_call_adds_the_registry_begin_and_end() {
        let t = trait_with(vec![call(Some("k"))]);
        assert_eq!(
            service_host_import(&t, "../h.js").as_deref(),
            Some("import { servicePorts, beginKeyedCall, endKeyedCall } from '../h.js';\n")
        );
    }

    #[test]
    fn a_cancel_call_alone_imports_only_cancel() {
        let t = trait_with(vec![OirExpr::effect(OirEffect::cancel_call(
            OirExpr::string("k"),
        ))]);
        assert_eq!(
            service_host_import(&t, "../h.js").as_deref(),
            Some("import { cancelKeyedCall } from '../h.js';\n")
        );
    }

    #[test]
    fn a_trait_with_no_service_effects_imports_nothing() {
        let t = trait_with(vec![OirExpr::effect(OirEffect::emit("X"))]);
        assert_eq!(service_host_import(&t, "../h.js"), None);
    }
}

#[cfg(test)]
mod view_suffix_collision_tests {
    use super::*;

    /// Every trait's view component is `<Trait>View`, so an entity named `<Trait>View`
    /// (orb.almadar.io's `PostView` beside a `Post` trait) shares that identifier space:
    /// importing both into one view file was TS2300 (duplicate) + TS2693 (type as value).
    #[test]
    fn an_entity_in_the_view_component_suffix_space_is_aliased() {
        assert_eq!(
            entity_type_ref("OrbPostARPostView"),
            "OrbPostARPostViewEntity"
        );
        let clause = aliased_shared_imports_clause(&BTreeSet::from([
            "OrbPostARPostView".to_string(),
            "Note".to_string(),
        ]));
        assert_eq!(clause, "Note, OrbPostARPostView as OrbPostARPostViewEntity");
    }

    #[test]
    fn control_an_ordinary_entity_keeps_its_name() {
        assert_eq!(entity_type_ref("Note"), "Note");
        assert_eq!(entity_type_ref("Overview"), "Overview");
    }
}

/// `object/get` indexes arrays by a numeric segment in both evaluators; the compiled
/// helper must too (std-graphs reads an `object/entries` pair as `"0"` / `"1"`).
#[cfg(test)]
mod get_nested_value_decl_tests {
    use super::GET_NESTED_VALUE_DECL;

    #[test]
    fn an_array_is_indexed_by_a_numeric_segment() {
        assert!(
            GET_NESTED_VALUE_DECL.contains("if (Array.isArray(value)) {"),
            "{GET_NESTED_VALUE_DECL}"
        );
        assert!(
            GET_NESTED_VALUE_DECL.contains(r"if (!/^\d+$/.test(part)) return undefined;"),
            "{GET_NESTED_VALUE_DECL}"
        );
    }

    #[test]
    fn control_a_non_object_still_bails() {
        assert!(
            GET_NESTED_VALUE_DECL.contains("if (typeof obj !== 'object') return undefined;"),
            "{GET_NESTED_VALUE_DECL}"
        );
    }
}

#[cfg(test)]
mod http_detection_tests {
    use super::{http_call_import, trait_has_host_effects, module_has_http_effects, trait_has_call_service_message, trait_has_keyed_call_service, trait_has_emit_effects, trait_has_http_effects, service_host_import};
    use orbital_core::ir::{OirEffect, OirEmitConfig, OirExpr, OirModule, OirTrait, OirTransition};
    use orbital_core::runtime::http_request::HttpMethod;

    fn trait_with(effect: OirEffect) -> OirTrait {
        let mut t = OirTrait::new("Fetcher");
        let mut tr = OirTransition::new("idle", "idle", "GO");
        tr.effects.push(OirExpr::effect(effect));
        t.transitions.push(tr);
        t
    }

    fn http(key: Option<OirExpr>, emit: Option<OirEmitConfig>) -> OirEffect {
        OirEffect::Http {
            method: HttpMethod::Get,
            origin: OirExpr::string("https://api.example.com"),
            path: OirExpr::string("/x"),
            request: None,
            key,
            emit,
        }
    }

    #[test]
    fn an_http_effect_needs_the_http_call_import_and_nothing_else_does() {
        let t = trait_with(http(None, None));
        assert!(trait_has_http_effects(&t));
        let import = http_call_import(&t, "../../../services/clients.js").expect("import");
        assert_eq!(import, "import { httpCall, HttpCallError } from '../../../services/clients.js';\n");
        assert!(service_host_import(&t, "../../../services/host.js").is_none());
        let other = trait_with(OirEffect::cancel_call(OirExpr::string("k")));
        assert!(!trait_has_http_effects(&other));
        assert!(http_call_import(&other, "x").is_none());
    }

    #[test]
    fn host_effects_import_exactly_the_host_functions_they_call() {
        let random = trait_with(OirEffect::random_bytes(OirExpr::number(8.0), None));
        assert!(trait_has_host_effects(&random) && !trait_has_http_effects(&random));
        assert_eq!(
            http_call_import(&random, "../c.js").unwrap(),
            "import { hostRandomBytes } from '../c.js';\n"
        );
        let both = {
            let mut t = trait_with(OirEffect::credential_status(OirExpr::string("k"), None));
            let mut tr = OirTransition::new("idle", "idle", "STOP");
            tr.effects.push(OirExpr::effect(OirEffect::credential_forget(OirExpr::string("k"), None)));
            tr.effects.push(OirExpr::effect(http(None, None)));
            t.transitions.push(tr);
            t
        };
        assert_eq!(
            http_call_import(&both, "../c.js").unwrap(),
            "import { httpCall, HttpCallError, hostCredentialStatus, hostCredentialForget } from '../c.js';\n"
        );
        assert!(http_call_import(&trait_with(OirEffect::cancel_call(OirExpr::string("k"))), "x").is_none());
    }

    #[test]
    fn a_module_with_only_host_effects_still_gets_the_http_ports() {
        let mut m = OirModule::new("App", "0.1.0");
        m.traits.push(trait_with(OirEffect::credential_forget(OirExpr::string("k"), None)));
        assert!(module_has_http_effects(&m));
    }

    #[test]
    fn host_effect_emit_is_detected() {
        let emit = OirEmitConfig { success: Some("OK".to_string()), ..Default::default() };
        assert!(trait_has_emit_effects(&trait_with(OirEffect::random_bytes(OirExpr::number(8.0), Some(emit)))));
        assert!(!trait_has_emit_effects(&trait_with(OirEffect::random_bytes(OirExpr::number(8.0), None))));
    }

    #[test]
    fn a_keyed_http_registers_in_the_keyed_call_registry() {
        let t = trait_with(http(Some(OirExpr::string("k")), None));
        assert!(trait_has_keyed_call_service(&t));
        assert!(service_host_import(&t, "../../../services/host.js").unwrap().contains("beginKeyedCall, endKeyedCall"));
        assert!(!trait_has_keyed_call_service(&trait_with(http(None, None))));
    }

    #[test]
    fn http_emit_and_on_message_are_detected() {
        let emit = OirEmitConfig { success: Some("OK".to_string()), on_message: Some("MSG".to_string()), ..Default::default() };
        let t = trait_with(http(None, Some(emit)));
        assert!(trait_has_emit_effects(&t));
        assert!(trait_has_call_service_message(&t));
        assert!(!trait_has_emit_effects(&trait_with(http(None, None))));
    }

    #[test]
    fn module_detection_walks_every_trait() {
        let mut m = OirModule::new("App", "0.1.0");
        m.traits.push(trait_with(OirEffect::cancel_call(OirExpr::string("k"))));
        assert!(!module_has_http_effects(&m));
        m.traits.push(trait_with(http(None, None)));
        assert!(module_has_http_effects(&m));
    }
}
