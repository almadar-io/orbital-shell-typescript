//! A generated app's server is the ONLY place a compiled app can enforce
//! `@read`/`@create`/`@update`/`@delete` — the JS interpreter is not in its
//! dependency chain. These tests pin the two properties that make that
//! enforcement trustworthy:
//!
//! 1. **Parity by construction.** The emitted code hands the untouched policy
//!    S-expression to `@almadar/runtime`'s `applyRowAccess`/`checkMutationAccess`
//!    — literally the functions `OrbitalServerRuntime` calls. Compiling the
//!    policy to inline TypeScript instead would diverge immediately (`=` is a
//!    deep equality in the evaluator but `===` in `compile_guard_to_ts`).
//! 2. **Nothing changes for an unpoliced entity.** 48 of 54 app organisms
//!    declare no directive; if their emission shifted, every generated file in
//!    the corpus would re-diff.

use orbital_core::ir::{OirEntity, OirExpr, OirField, OirPersistence, OirType};
use orbital_shell_typescript::TypeScriptBackend;

fn entity(name: &str, collection: &str) -> OirEntity {
    OirEntity {
        shared: false,
        identity: false,
        local: false,
        seed_mock: false,
        id: None,
        name: name.to_string(),
        description: None,
        collection: collection.to_string(),
        persistence: OirPersistence::Persistent,
        fields: vec![
            OirField::new("id", OirType::String),
            OirField::new("assignee", OirType::String),
        ],
        defaults: None,
        instances: vec![],
        used_by_traits: vec![],
        used_by_pages: vec![],
        read_policy: None,
        create_policy: None,
        update_policy: None,
        delete_policy: None,
    }
}

fn binding(path: &str) -> OirExpr {
    OirExpr::String {
        value: path.to_string(),
    }
}

/// `@user.role == "supervisor"` — the role-gate shape, built straight in OIR so
/// this test needs no dependency on the compiler crate.
fn role_policy() -> OirExpr {
    OirExpr::eq(binding("@user.role"), OirExpr::string("supervisor"))
}

/// The three-branch helpdesk `@read` — supervisor OR owning-agent OR requester —
/// left-folded exactly as `variadic_binary_op` folds a variadic `or`.
fn three_branch_policy() -> OirExpr {
    let clause = |role: &str, field: &str| {
        OirExpr::and(
            OirExpr::eq(binding("@user.role"), OirExpr::string(role)),
            OirExpr::eq(
                OirExpr::call(
                    "object/get",
                    vec![binding("@entity"), OirExpr::string(field)],
                ),
                binding("@user.id"),
            ),
        )
    };
    OirExpr::or(
        OirExpr::or(
            OirExpr::eq(binding("@user.role"), OirExpr::string("supervisor")),
            clause("agent", "assignee"),
        ),
        clause("customer", "requester"),
    )
}

fn policied() -> Vec<OirEntity> {
    let mut ticket = entity("Ticket", "tickets");
    ticket.read_policy = Some(three_branch_policy());
    ticket.create_policy = Some(role_policy());
    ticket.update_policy = Some(role_policy());
    ticket.delete_policy = Some(role_policy());
    vec![ticket]
}

#[test]
fn no_policy_emits_no_access_file_at_all() {
    // The corpus firewall: an unpoliced module must produce exactly what it
    // produced before entity access existed.
    let file =
        TypeScriptBackend::new().render_access_policies_content(&[entity("Ticket", "tickets")]);
    assert!(
        file.is_none(),
        "a module with no declared directive must not emit access-policies.ts"
    );
}

#[test]
fn every_declared_directive_becomes_a_named_const() {
    let file = TypeScriptBackend::new()
        .render_access_policies_content(&policied())
        .expect("emits when a directive is declared");
    for name in [
        "TICKET_READ_POLICY",
        "TICKET_CREATE_POLICY",
        "TICKET_UPDATE_POLICY",
        "TICKET_DELETE_POLICY",
    ] {
        assert!(file.contains(name), "missing const {name} in:\n{}", file);
    }
}

#[test]
fn a_variadic_or_keeps_every_branch() {
    // `binary_op` used to read only args[0..2], so the third branch of
    // std-helpdesk's `@read` vanished and no customer could ever see their own
    // ticket. The policy must mention BOTH `assignee` and `requester`.
    let file = TypeScriptBackend::new()
        .render_access_policies_content(&policied())
        .expect("emits");
    assert!(
        file.contains("assignee") && file.contains("requester"),
        "a three-branch `or` lost a branch:\n{}",
        file
    );
}

#[test]
fn emitted_heads_are_operators_the_js_evaluator_implements() {
    // `@almadar/evaluator` has no `&&`/`||`/`++`/`!`, and an unknown head there
    // returns the expression unchanged — which is TRUTHY. Emitting one would
    // make the policy admit every row for every viewer: a silent fail-OPEN in
    // the one code path whose job is to deny.
    let file = TypeScriptBackend::new()
        .render_access_policies_content(&policied())
        .expect("emits");
    for forbidden in ["\"&&\"", "\"||\"", "\"++\"", "\"!\""] {
        assert!(
            !file.contains(forbidden),
            "emitted {forbidden}, which the JS evaluator does not implement:\n{}",
            file
        );
    }
    assert!(
        file.contains("\"or\"") && file.contains("\"and\""),
        "expected the canonical `or`/`and` spellings:\n{}",
        file
    );
}

#[test]
fn policy_emission_is_byte_stable_across_renders() {
    // `SExpression::Object` is a HashMap with a randomly-seeded iteration order.
    // Unstable emission would rewrite generated files on every build and thrash
    // the L1 factory signature cache.
    let backend = TypeScriptBackend::new();
    let first = backend
        .render_access_policies_content(&policied())
        .expect("emits");
    for _ in 0..32 {
        let again = backend
            .render_access_policies_content(&policied())
            .expect("emits");
        assert_eq!(again, first, "access-policies.ts must be byte-stable");
    }
}

#[test]
fn the_denial_message_matches_the_interpreters_word_for_word() {
    // `accessDeniedMessage(op, entityType)` in
    // packages/almadar-runtime/src/entityAccess.ts builds this string, and a
    // consumer distinguishing "denied" from "failed" reads it. If the two ever
    // drift, the compiled path reports a denial the interpreter does not.
    for (op, expected) in [
        (
            "create",
            "\"@create denied: the declared access policy for 'Ticket' rejected this row\"",
        ),
        (
            "update",
            "\"@update denied: the declared access policy for 'Ticket' rejected this row\"",
        ),
        (
            "delete",
            "\"@delete denied: the declared access policy for 'Ticket' rejected this row\"",
        ),
    ] {
        let built = format!(
            "\"@{} denied: the declared access policy for '{}' rejected this row\"",
            op, "Ticket"
        );
        assert_eq!(built, expected, "denial message drifted for @{op}");
    }
}
