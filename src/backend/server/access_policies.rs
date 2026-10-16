//! `packages/server/src/access-policies.ts` — the declared `@read`/`@create`/
//! `@update`/`@delete` directives, baked into the generated app as SExpr
//! literals.
//!
//! Why literals rather than compiled TypeScript predicates: the emitted server
//! must reach EXACTLY the same allow/deny verdict as the JS interpreter and the
//! Rust kernel for the same policy, row and viewer. Handing the untouched
//! SExpr to `@almadar/runtime`'s `applyRowAccess` / `checkMutationAccess` — the
//! same two functions `OrbitalServerRuntime` calls — makes that a property of
//! the wiring rather than of two expression compilers agreeing forever.
//! Compiling the policy to inline TS would diverge immediately: the evaluator
//! implements `["=", a, b]` as a deep equality while `compile_guard_to_ts`
//! emits `===`, and `object/get` lowers through an `any`-typed reducer.
//!
//! Emitted only when at least one entity declares at least one directive, so a
//! policy-free corpus produces byte-identical output to before this existed.

use crate::backend::*;

/// The four directives, in the order they are emitted.
const OPS: [(&str, fn(&OirEntity) -> Option<&OirExpr>); 4] = [
    ("READ", |e| e.read_policy.as_ref()),
    ("CREATE", |e| e.create_policy.as_ref()),
    ("UPDATE", |e| e.update_policy.as_ref()),
    ("DELETE", |e| e.delete_policy.as_ref()),
];

/// `Ticket` + `READ` → `TICKET_READ_POLICY`. A named const rather than a map
/// entry so the emitted import lists exactly what a handler uses and a golden
/// test can assert one exact line.
pub(crate) fn policy_const_name(entity_name: &str, op: &str) -> String {
    let mut screaming = String::new();
    for (i, ch) in entity_name.chars().enumerate() {
        if ch.is_uppercase() && i > 0 && !screaming.ends_with('_') {
            screaming.push('_');
        }
        if ch.is_alphanumeric() {
            screaming.push(ch.to_ascii_uppercase());
        } else if !screaming.ends_with('_') {
            screaming.push('_');
        }
    }
    format!("{}_{}_POLICY", screaming, op)
}

/// True when any entity in the module declares any access directive.
pub(crate) fn module_has_access_policies(entities: &[OirEntity]) -> bool {
    entities
        .iter()
        .any(|e| OPS.iter().any(|(_, get)| get(e).is_some()))
}

/// Every `(entity name, op)` pair the module declares a policy for, in a
/// deterministic order — the emitter and the import builder must agree.
pub(crate) fn declared_policies(entities: &[OirEntity]) -> Vec<(String, &'static str)> {
    // `entities` can list the same [shared] entity more than once when it's
    // referenced from multiple orbitals in one multi-orbital app file — dedupe
    // by (name, op) so a shared entity's policy const is never imported twice.
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for entity in entities {
        for (op, get) in OPS.iter() {
            if get(entity).is_some() && seen.insert((entity.name.clone(), *op)) {
                out.push((entity.name.clone(), *op));
            }
        }
    }
    out
}

impl TypeScriptBackend {
    /// The `access-policies.ts` body, or `None` when the module declares no
    /// directive. Public so a golden test can assert the exact emission without
    /// reaching through file assembly.
    pub fn render_access_policies_content(&self, entities: &[OirEntity]) -> Option<String> {
        self.generate_access_policies(entities).map(|f| f.content)
    }

    /// Emit `access-policies.ts`, or `None` when the module declares none.
    pub(crate) fn generate_access_policies(&self, entities: &[OirEntity]) -> Option<InternalFile> {
        if !module_has_access_policies(entities) {
            return None;
        }

        let mut code = String::new();
        code.push_str("/**\n");
        code.push_str(" * GENERATED — declared entity access directives.\n");
        code.push_str(" *\n");
        code.push_str(" * Each const is the `@read`/`@create`/`@update`/`@delete` S-expression\n");
        code.push_str(" * exactly as authored. The generated handlers hand them to\n");
        code.push_str(" * `@almadar/evaluator/entityAccess`, which is the same evaluator the\n");
        code.push_str(
            " * interpreter uses — so both paths reach the same verdict by construction.\n",
        );
        code.push_str(" *\n");
        code.push_str(
            " * Do not edit: change the `@read`/`@create`/`@update`/`@delete` directive\n",
        );
        code.push_str(" * on the entity in the `.lolo` source and recompile.\n");
        code.push_str(" */\n\n");
        code.push_str("import type { SExpr } from '@almadar/core';\n\n");

        for entity in entities {
            for (op, get) in OPS.iter() {
                let Some(expr) = get(entity) else { continue };
                let name = policy_const_name(&entity.name, op);
                match expr.to_sexpression() {
                    Some(sexpr) => {
                        // Sorted object keys: `SExpression::Object` is a HashMap,
                        // whose iteration order is randomly seeded per process, so
                        // a plain serialization would differ between builds.
                        let json = serde_json::to_string(&sexpr.to_canonical_json())
                            .unwrap_or_else(|_| "false".to_string());
                        code.push_str(&format!("export const {}: SExpr = {};\n", name, json));
                    }
                    None => {
                        // Unreachable for a validated program — `validate_entity_access`
                        // rejects any directive that is not a lowerable expression.
                        // Deny-all rather than allow-all if it ever happens.
                        eprintln!(
                            "[orbital] entity '{}' @{} could not be lowered to an s-expression; emitting deny-all",
                            entity.name,
                            op.to_lowercase()
                        );
                        code.push_str(&format!(
                            "// UNLOWERABLE POLICY — denying all access for safety.\nexport const {}: SExpr = false;\n",
                            name
                        ));
                    }
                }
            }
        }

        Some(InternalFile::new(
            "packages/server/src/access-policies.ts",
            code,
            GeneratedFileType::Route,
        ))
    }
}

/// The entity's OWNER COLUMNS: fields a declared policy compares to `@user.id`.
///
/// The program already states which field carries the viewer — `@read` on a
/// personal entity is literally `["==", ["object/get","@entity","authorId"],
/// "@user.id"]`. Before this, the mock seeder learned owner columns only from
/// the `ALMADAR_PERSONA_OWNS` environment variable, which nothing in codegen or
/// in a generated app ever set: every owner column fell through to a RANDOM
/// relation pick, the booted viewer owned a random ~1-in-N share (often zero),
/// and an ownership-scoped list rendered "No items" while every request
/// succeeded (S-SEED-OWNER-COLUMN-NEVER-STAMPED, §57). Emitting the pairs the
/// policy already declares removes the duplicated fact rather than adding a
/// second source of truth.
///
/// READ/UPDATE/DELETE only — `@create` compares the row being written, which
/// says nothing about what the fixture should own. Deterministic order, deduped.
///
/// Bridges each `OirExpr` policy to its canonical `SExpression` form
/// (`OirExpr::to_sexpression` — the same bridge that lets one evaluator run
/// both representations) and hands it to `orbital_core::runtime::
/// owner_columns_from_policy`, the ONE policy-expression reader
/// `orbital-core/src/runtime/seed.rs::owner_fields_from_schema`'s
/// policy-derived arm also calls — converging what used to be two separate
/// walkers (this file's own `OirExpr` walker, and seed.rs's self-identity-only
/// `SExpression` walker) onto one. A policy that fails to bridge (none does,
/// for a validated program — `render_access_policies_content` above already
/// requires it) contributes no owner columns rather than panicking.
#[cfg(test)]
pub(crate) fn owner_fields(entity: &OirEntity) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for policy in [
        entity.read_policy.as_ref(),
        entity.update_policy.as_ref(),
        entity.delete_policy.as_ref(),
    ]
    .into_iter()
    .flatten()
    {
        let Some(sexpr) = policy.to_sexpression() else {
            continue;
        };
        for field in orbital_core::runtime::owner_columns_from_policy(&sexpr) {
            if !out.contains(&field) {
                out.push(field);
            }
        }
    }
    out
}

/// Pins `owner_fields`' output for the exact policy shapes committed in
/// `std-time-tracking.orb`'s `Employee`/`Timesheet` and `std-notes.orb`'s
/// `Note` (verified against `orb emit ts` output BEFORE the bridge-to-
/// `owner_columns_from_policy` convergence: `ownerFields: ['id']` /
/// `['employeeId']` / `['authorId']` respectively) — the OIR-walker →
/// bridge refactor must not change what a real generated app seeds.
#[cfg(test)]
mod owner_fields_tests {
    use super::*;
    use orbital_core::ir::{OirBinaryOp, OirBinding, OirEntity};

    fn binding(s: &str) -> OirExpr {
        OirExpr::Binding {
            binding: OirBinding::parse(s).expect("valid binding string"),
        }
    }

    fn eq(left: OirExpr, right: OirExpr) -> OirExpr {
        OirExpr::BinaryOp {
            op: OirBinaryOp::Eq,
            left: Box::new(left),
            right: Box::new(right),
        }
    }

    fn or(left: OirExpr, right: OirExpr) -> OirExpr {
        OirExpr::BinaryOp {
            op: OirBinaryOp::Or,
            left: Box::new(left),
            right: Box::new(right),
        }
    }

    /// `@read (or (= @user.role "approver") (= @entity.id @user.id))` — self-identity.
    #[test]
    fn self_identity_policy_yields_the_rows_own_id() {
        let mut entity = OirEntity::new("Employee");
        let policy = or(
            eq(binding("@user.role"), OirExpr::string("approver")),
            eq(binding("@entity.id"), binding("@user.id")),
        );
        entity.read_policy = Some(policy.clone());
        entity.update_policy = Some(policy);
        entity.delete_policy = Some(eq(binding("@user.role"), OirExpr::string("approver")));
        assert_eq!(owner_fields(&entity), vec!["id".to_string()]);
    }

    /// `@read (or (= @user.role "approver") (= @entity.employeeId @user.id))` —
    /// a relation column, not self-identity.
    #[test]
    fn relation_policy_yields_the_relation_column() {
        let mut entity = OirEntity::new("Timesheet");
        let policy = or(
            eq(binding("@user.role"), OirExpr::string("approver")),
            eq(binding("@entity.employeeId"), binding("@user.id")),
        );
        entity.read_policy = Some(policy.clone());
        entity.update_policy = Some(policy);
        entity.delete_policy = Some(eq(binding("@user.role"), OirExpr::string("approver")));
        assert_eq!(owner_fields(&entity), vec!["employeeId".to_string()]);
    }

    /// `@read (= @entity.authorId @user.id)` — `std-notes.orb`'s `Note`, all
    /// four directives the same non-relation comparison.
    #[test]
    fn a_non_relation_field_policy_still_yields_the_field() {
        let mut entity = OirEntity::new("Note");
        let policy = eq(binding("@entity.authorId"), binding("@user.id"));
        entity.read_policy = Some(policy.clone());
        entity.update_policy = Some(policy.clone());
        entity.delete_policy = Some(policy);
        assert_eq!(owner_fields(&entity), vec!["authorId".to_string()]);
    }

    /// Role-only directives (no `@entity.*` comparison anywhere) declare no
    /// owner column — `std-time-tracking.orb`'s `TimeEntry`.
    #[test]
    fn role_only_policy_yields_no_owner_column() {
        let mut entity = OirEntity::new("TimeEntry");
        let policy = or(
            eq(binding("@user.role"), OirExpr::string("employee")),
            eq(binding("@user.role"), OirExpr::string("approver")),
        );
        entity.update_policy = Some(policy.clone());
        entity.delete_policy = Some(policy.clone());
        entity.create_policy = Some(policy);
        assert!(owner_fields(&entity).is_empty());
    }

    /// `@create` is excluded — it compares the incoming row, not an existing
    /// one, so it says nothing about what a fixture should already own.
    #[test]
    fn create_only_policy_yields_no_owner_column() {
        let mut entity = OirEntity::new("Ticket");
        entity.create_policy = Some(eq(binding("@entity.authorId"), binding("@user.id")));
        assert!(owner_fields(&entity).is_empty());
    }
}
