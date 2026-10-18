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

use orbital_core_base::ir::{
    OirEffect, OirExpr, OirTrait,
};


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

fn is_os(effect: &OirEffect) -> bool {
    matches!(effect, OirEffect::Os { .. })
}

fn is_credential_status(effect: &OirEffect) -> bool {
    matches!(effect, OirEffect::CredentialStatus { .. })
}

fn is_credential_forget(effect: &OirEffect) -> bool {
    matches!(effect, OirEffect::CredentialForget { .. })
}

fn is_oauth_authorize(effect: &OirEffect) -> bool {
    matches!(effect, OirEffect::OAuthAuthorize { .. })
}

fn is_oauth_connection(effect: &OirEffect) -> bool {
    matches!(effect, OirEffect::OAuthConnectionStatus { .. } | OirEffect::OAuthConnectionForget { .. })
}

/// Detect whether any transition runs an `http` effect, at any depth.
pub fn trait_has_http_effects(trait_def: &OirTrait) -> bool {
    trait_has_effect(trait_def, is_http)
}

/// Whether any transition runs `random-bytes`, `credential-status` or `credential-forget`.
pub fn trait_has_host_effects(trait_def: &OirTrait) -> bool {
    trait_has_effect(trait_def, is_random_bytes)
        || trait_has_effect(trait_def, is_os)
        || trait_has_effect(trait_def, is_credential_status)
        || trait_has_effect(trait_def, is_credential_forget)
        || trait_has_effect(trait_def, is_oauth_authorize)
        || trait_has_effect(trait_def, is_oauth_connection)
}

/// Whether any trait of the module needs the kernel's http ports: an `http` effect or a host effect.
pub fn module_has_http_effects(module: &orbital_core_base::ir::OirModule) -> bool {
    module
        .traits
        .iter()
        .any(|t| trait_has_http_effects(t) || trait_has_host_effects(t))
}
















#[cfg(test)]
mod persist_success_emit_tests {
    use super::trait_has_persist_success_emit;
    use orbital_core_base::ir::{
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
            nearest: None,
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
    use orbital_core_base::ir::{OirEffect, OirEmitConfig, OirExpr, OirTrait, OirTransition};

    fn call_service(on_message: Option<&str>) -> OirExpr {
        OirExpr::effect(OirEffect::CallService {
            service: "llm".to_string(),
            method: "call-tools".to_string(),
            args: OirExpr::object(orbital_core_base::ir::OirFields::new()),
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
        let js = runtime_entity_binding("std-service-test", "ServiceTestTest", "ServiceTest");
        assert!(js.contains("const entity = getRuntimeEntity('std-service-test', 'ServiceTestTest', entityId) as ServiceTest;"), "{js}");
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
    use orbital_core_base::ir::{OirEffect, OirExpr, OirTrait, OirTransition};

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
            args: OirExpr::object(orbital_core_base::ir::OirFields::new()),
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
    use orbital_core_base::ir::{OirEffect, OirEmitConfig, OirExpr, OirModule, OirTrait, OirTransition};
    use orbital_core_base::http_wire::HttpMethod;

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
    fn an_os_effect_needs_the_host_os_import() {
        let t = trait_with(OirEffect::os(
            orbital_core_base::os::OsOp::ReadFile,
            vec![OirExpr::string("/data/a")],
            None,
            None,
        ));
        assert!(trait_has_host_effects(&t));
        assert_eq!(
            http_call_import(&t, "../clients.js").expect("import"),
            "import { hostOs } from '../clients.js';\n"
        );
        assert!(http_call_import(&trait_with(http(None, None)), "../clients.js").expect("import").contains("httpCall"));
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
