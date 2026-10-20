//! Shared handler-file header emission.
//!
//! Both backends emit a per-trait handler file with an identical shared
//! block: the `__ORBITAL_SOURCE` source-metadata constant, the
//! `XState` / `XEvent` type/interface declarations, entity-type collection
//! from fetch/persist effects, and agent row-type aliases. The handler's
//! return type is the shared `EventResponse` (`@app/shared`, aliasing
//! `@almadar/core`'s `OrbitalEventResponse`, §156) — no per-trait response
//! interface. Call sites keep their own imports and wiring; this module owns
//! only the shared middle.
//!
//! All helpers push to a `&mut String` so the caller can interleave them
//! with framework-specific output without an intermediate allocation.

use std::collections::BTreeSet;


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

/// Zod twin of `TRAIT_FIELD_VALUE_DECL` (`map_type_to_zod` emits
/// `TraitFieldValueSchema` for `trait`); needs `FieldValueSchema` from core,
/// which `zod_core_value_imports` adds when this name appears.
pub const TRAIT_FIELD_VALUE_SCHEMA_DECL: &str = "const TraitFieldValueSchema: z.ZodType<TraitFieldRef> = z.union([\n  z.custom<`@trait.${string}`>((v) => typeof v === 'string' && /^@trait\\.[A-Z][a-zA-Z0-9]*$/.test(v)),\n  z.object({ behavior: z.string(), trait: z.string() }).catchall(FieldValueSchema.optional()),\n  z.null(),\n]);\n";

/// An `orbital`-typed entity field or payload member: a stored orbital value
/// `{ behavior, orbital, …§8b body }` or `null` (unbound). Inlined storage shape,
/// same rationale as `TRAIT_FIELD_VALUE_DECL`.
pub const ORBITAL_FIELD_VALUE_DECL: &str = "type OrbitalFieldRef = OrbitalFieldStored | null;\ninterface OrbitalFieldStored {\n  behavior: string;\n  orbital: string;\n  [key: string]: FieldValue | undefined;\n}\n";

/// Zod twin of `ORBITAL_FIELD_VALUE_DECL` (`map_type_to_zod` emits
/// `OrbitalFieldValueSchema` for `orbital`).
pub const ORBITAL_FIELD_VALUE_SCHEMA_DECL: &str = "const OrbitalFieldValueSchema: z.ZodType<OrbitalFieldRef> = z.union([\n  z.object({ behavior: z.string(), orbital: z.string() }).catchall(FieldValueSchema.optional()),\n  z.null(),\n]);\n";

/// A `behavior`-typed entity field or payload member: a stored whole-behavior
/// value `{ behavior }` (`behavior/ref`) or `null` (unbound). Inlined storage
/// shape, same rationale as `TRAIT_FIELD_VALUE_DECL`.
pub const BEHAVIOR_FIELD_VALUE_DECL: &str = "type BehaviorFieldRef = { behavior: string } | null;\n";

/// Zod twin of `BEHAVIOR_FIELD_VALUE_DECL` (`map_type_to_zod` emits
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



/// Zod twins of `PATTERN_VALUE_DECL`'s `PatternValue`/`PatternNode`, inlined
/// beside it wherever a `node`-typed field or payload needs a runtime
/// validator (`map_type_to_zod` emits `PatternValueSchema`).
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

