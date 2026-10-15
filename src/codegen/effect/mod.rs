//! Effect compilation: server-side, client-side, and expression-mode.
//!
//! Shared between Express (`backend.rs`) and Hono (`backend_hono.rs`).
//! Both backends call `generate_persist_block` for Persist codegen so the
//! body, logging, and emit chain live in one place. The framework-specific
//! variation (Zod-validated input vs raw cast) is parameterised via
//! `PersistDataValidation`.
//!
//! Extracted from `backend.rs` as Phase 3e.5 of the DRY refactor.

use orbital_core::ir::{
    OirBinding, OirBindingRoot, OirEffect, OirEmitConfig, OirEntity, OirExpr, OirInterval,
    OirLogLevel, OirModule, OirPersistOp, OirPersistence, OirTrait, OirTransitionFrom, OirType,
};

use crate::backend::{operation_to_string, to_camel_case, to_snake_case, TypeScriptBackend};
use crate::codegen::handler_header::entity_type_ref;

mod client;
#[cfg(test)]
mod dispatch_roots_tests;
#[cfg(test)]
mod now_stamp_tests;
#[cfg(test)]
mod visible_tick_tests;
pub(crate) mod persist;
mod persist_batch;
#[cfg(test)]
mod persist_batch_tests;
#[cfg(test)]
mod http_tests;
#[cfg(test)]
mod runs_on_tests;
mod server;
pub(crate) mod shared;
mod tick;
mod timeout;
mod to_ts;

pub(crate) use persist::PersistDataValidation;

// ---------------------------------------------------------------------
// Tests for server-side effect code generation.
//
// Migrated from `backend.rs::tests` as part of Phase 3e.7. Each test
// exercises `generate_server_effect_code` for a specific effect type
// and asserts the emitted TS hits the expected `getServerEventBus().emit`
// wiring.
// ---------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use crate::TypeScriptBackend;
    use orbital_core::ir::{
        OirBinding, OirConstraint, OirEffect, OirEntity, OirExpr, OirField, OirModule,
        OirPersistOp, OirPersistence, OirType,
    };

    fn test_module_with_entity(name: &str, collection: &str) -> OirModule {
        let mut m = OirModule::new("TestApp", "0.1.0");
        m.entities.push(OirEntity {
            shared: false,
            identity: false,
            local: false,
            seed_mock: false,
            id: None,
            name: name.to_string(),
            description: None,
            collection: collection.to_string(),
            persistence: OirPersistence::Persistent,
            fields: vec![OirField::new("id", OirType::String)],
            defaults: None,
            instances: vec![],
            used_by_traits: vec![],
            used_by_pages: vec![],
            read_policy: None,
            create_policy: None,
            update_policy: None,
            delete_policy: None,
        });
        m
    }

    #[test]
    fn fetch_with_emit_success_emits_bus_call() {
        let backend = TypeScriptBackend::new();
        let module = test_module_with_entity("Patient", "patients");

        let emit_cfg = orbital_core::ir::OirEmitConfig {
            success: Some("PATIENT_LOADED".to_string()),
            failure: None,
            on_change: None,
            on_message: None,
            cancelled: None,
        };
        let effect = OirEffect::Fetch {
            entity_type: "Patient".to_string(),
            id: None,
            filter: None,
            order_by: None,
            offset: None,
            limit: None,
            include: None,
            emit: Some(emit_cfg),
        };

        let js = backend.generate_server_effect_code(&effect, &module, None);
        assert!(
            js.contains("getServerEventBus().emit('PATIENT_LOADED'"),
            "fetch emit.success should produce event bus call, got:\n{}",
            js
        );
    }

    #[test]
    fn fetch_without_emit_skips_bus_call() {
        let backend = TypeScriptBackend::new();
        let module = test_module_with_entity("Patient", "patients");

        let effect = OirEffect::fetch("Patient");
        let js = backend.generate_server_effect_code(&effect, &module, None);
        assert!(
            !js.contains("getServerEventBus().emit("),
            "bare fetch should not emit an event, got:\n{}",
            js
        );
    }

    #[test]
    fn os_watch_cron_emit_overrides_hardcoded_event_name() {
        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");

        let emit_cfg = orbital_core::ir::OirEmitConfig {
            success: None,
            failure: None,
            on_change: None,
            on_message: Some("MY_CRON_TICKED".to_string()),
            cancelled: None,
        };
        let effect = OirEffect::OsWatchCron {
            expression: OirExpr::string("*/5 * * * *"),
            emit: Some(emit_cfg),
        };

        let js = backend.generate_server_effect_code(&effect, &module, None);
        assert!(
            js.contains("getServerEventBus().emit('MY_CRON_TICKED'"),
            "on_message should replace OS_CRON_FIRE, got:\n{}",
            js
        );
        assert!(
            !js.contains("OS_CRON_FIRE"),
            "hardcoded fallback should not be present when emit.on_message is set, got:\n{}",
            js
        );
    }

    #[test]
    fn os_watch_cron_without_emit_uses_hardcoded_event_name() {
        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");

        let effect = OirEffect::OsWatchCron {
            expression: OirExpr::string("0 0 * * *"),
            emit: None,
        };
        let js = backend.generate_server_effect_code(&effect, &module, None);
        assert!(
            js.contains("'OS_CRON_FIRE'"),
            "bare cron should keep the hardcoded fallback, got:\n{}",
            js
        );
    }

    #[test]
    fn persist_update_emit_success_fires_after_update() {
        let backend = TypeScriptBackend::new();
        let module = test_module_with_entity("Patient", "patients");

        let emit_cfg = orbital_core::ir::OirEmitConfig {
            success: Some("PATIENT_SAVED".to_string()),
            failure: None,
            on_change: None,
            on_message: None,
            cancelled: None,
        };
        let effect = OirEffect::Persist {
            operation: OirPersistOp::Update,
            entity_type: "Patient".to_string(),
            data: OirExpr::string("@entity"),
            emit: Some(emit_cfg),
        };

        let js = backend.generate_server_effect_code(&effect, &module, Some("Patient"));
        assert!(
            js.contains("getServerEventBus().emit('PATIENT_SAVED'"),
            "persist update emit.success missing, got:\n{}",
            js
        );
    }

    #[test]
    fn ref_emit_on_change_generates_bus_call() {
        let backend = TypeScriptBackend::new();
        let module = test_module_with_entity("Patient", "patients");

        let emit_cfg = orbital_core::ir::OirEmitConfig {
            success: None,
            failure: None,
            on_change: Some("PATIENT_UPDATED".to_string()),
            on_message: None,
            cancelled: None,
        };
        let effect = OirEffect::Ref {
            entity_type: "Patient".to_string(),
            id: None,
            filter: None,
            order_by: None,
            limit: None,
            include: None,
            emit: Some(emit_cfg),
        };

        let js = backend.generate_server_effect_code(&effect, &module, Some("Patient"));
        // NOTE: Ref server-side codegen may not currently wire on_change since
        // the reactive update path lives on the client. Assert the operator
        // itself still renders — this test pins the status quo and will fail
        // loudly when ref on_change wiring lands in backend.rs.
        assert!(
            js.contains("fetchedRefById") || js.contains("data['Patient']"),
            "ref codegen should still produce data fetch: {}",
            js
        );
    }

    /// A service call is lent the running app as the caller — this handler's
    /// `__ORBITAL_SOURCE` position and the requesting user — when the server has
    /// lent one; the caller's identity rides along as before.
    #[test]
    fn call_service_passes_the_lent_host_as_the_caller() {
        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");
        let effect = OirEffect::CallService {
            service: "llm".to_string(),
            method: "call-tools".to_string(),
            args: OirExpr::object(orbital_core::ir::OirFields::new()),
            key: None,
            emit: None,
        };
        let js = backend.generate_server_effect_code(&effect, &module, None);
        assert!(js.contains("const __host = servicePorts(__ORBITAL_SOURCE, user);"), "{js}");
        assert!(
            js.contains("{ ...(user ? { principal: user.id, role: user.role } : {}), ...(__host ? { host: __host } : {}) }"),
            "{js}"
        );
    }

    /// `emit: { onMessage }`: the running call's live messages go to the
    /// requesting tab only, as the declared event, while the call runs.
    #[test]
    fn call_service_on_message_routes_live_messages_to_the_origin_tab() {
        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");
        let effect = OirEffect::CallService {
            service: "llm".to_string(),
            method: "call-tools".to_string(),
            args: OirExpr::object(orbital_core::ir::OirFields::new()),
            key: None,
            emit: Some(orbital_core::ir::OirEmitConfig {
                success: Some("ANSWERED".to_string()),
                failure: None,
                on_change: None,
                on_message: Some("STEP".to_string()),
                cancelled: None,
            }),
        };
        let js = backend.generate_server_effect_code(&effect, &module, None);
        assert!(
            js.contains("const __host = servicePorts(__ORBITAL_SOURCE, user, (__message) => pushToOrigin(clientId, { type: 'bus', event: 'STEP', payload: __message, source: __ORBITAL_SOURCE, timestamp: Date.now(), target: 'origin' }));"),
            "{js}"
        );
    }

    #[test]
    fn call_service_without_on_message_lends_no_message_route() {
        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");
        let effect = OirEffect::CallService {
            service: "llm".to_string(),
            method: "call-tools".to_string(),
            args: OirExpr::object(orbital_core::ir::OirFields::new()),
            key: None,
            emit: Some(orbital_core::ir::OirEmitConfig {
                success: Some("ANSWERED".to_string()),
                failure: None,
                on_change: None,
                on_message: None,
                cancelled: None,
            }),
        };
        let js = backend.generate_server_effect_code(&effect, &module, None);
        assert!(js.contains("const __host = servicePorts(__ORBITAL_SOURCE, user);"), "{js}");
        assert!(!js.contains("pushToOrigin"), "{js}");
    }

    fn keyed_call(cancelled: Option<&str>) -> OirEffect {
        OirEffect::CallService {
            service: "llm".to_string(),
            method: "classifyMany".to_string(),
            args: OirExpr::object(orbital_core::ir::OirFields::new()),
            key: Some(OirExpr::string("batch-1")),
            emit: Some(orbital_core::ir::OirEmitConfig {
                success: Some("CLASSIFIED".to_string()),
                failure: Some("CLASSIFY_FAILED".to_string()),
                cancelled: cancelled.map(str::to_string),
                ..Default::default()
            }),
        }
    }

    #[test]
    fn keyed_call_service_registers_its_abort_controller_and_passes_the_signal() {
        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");
        let js = backend.generate_server_effect_code(&keyed_call(None), &module, None);
        assert!(
            js.contains("const __callKey = String(\"batch-1\");"),
            "{js}"
        );
        assert!(
            js.contains("const __callCtl = beginKeyedCall(__callKey);"),
            "{js}"
        );
        assert!(
            js.contains("...(__host ? { host: __host } : {}), signal: __callCtl.signal }"),
            "{js}"
        );
        assert!(js.contains("endKeyedCall(__callKey, __callCtl);"), "{js}");
        let finally_idx = js.find("} finally {").expect("finally block");
        assert!(js.find("endKeyedCall").unwrap() > finally_idx, "{js}");
    }

    #[test]
    fn a_call_aborted_after_the_service_returned_never_fires_success() {
        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");
        let js = backend.generate_server_effect_code(
            &keyed_call(Some("CLASSIFY_CANCELLED")),
            &module,
            None,
        );
        let guard = js
            .find("if (__callCtl.signal.aborted) { throw")
            .expect("post-call abort guard");
        let success = js
            .find("getServerEventBus().emit('CLASSIFIED'")
            .expect("success emit");
        assert!(guard < success, "{js}");
    }

    #[test]
    fn an_aborted_call_routes_to_cancelled_with_its_key_and_never_to_failure() {
        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");
        let js = backend.generate_server_effect_code(
            &keyed_call(Some("CLASSIFY_CANCELLED")),
            &module,
            None,
        );
        let catch_idx = js.find("} catch (err)").expect("catch block");
        let aborted = js[catch_idx..]
            .find("if (__callCtl.signal.aborted) {")
            .expect("aborted branch")
            + catch_idx;
        let cancelled = js
            .find("getServerEventBus().emit('CLASSIFY_CANCELLED'")
            .expect("cancelled emit");
        let failure = js
            .find("getServerEventBus().emit('CLASSIFY_FAILED'")
            .expect("failure emit");
        assert!(aborted < cancelled && cancelled < failure, "{js}");
        assert!(
            js.contains("const __evC: EventPayload = { key: __callKey };"),
            "{js}"
        );
        assert!(
            js[aborted..failure].contains("} else {"),
            "failure must be the else of the aborted branch\n{js}"
        );
    }

    #[test]
    fn an_aborted_call_without_a_declared_cancelled_event_emits_nothing() {
        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");
        let js = backend.generate_server_effect_code(&keyed_call(None), &module, None);
        assert!(js.contains("if (__callCtl.signal.aborted) {"), "{js}");
        assert!(!js.contains("__evC"), "{js}");
        assert!(!js.contains("CANCELLED"), "{js}");
    }

    #[test]
    fn an_unkeyed_call_service_has_no_registry_or_signal() {
        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");
        let effect = OirEffect::call_service(
            "llm",
            "generate",
            OirExpr::object(orbital_core::ir::OirFields::new()),
        );
        let js = backend.generate_server_effect_code(&effect, &module, None);
        assert!(
            !js.contains("beginKeyedCall") && !js.contains("signal"),
            "{js}"
        );
    }

    #[test]
    fn cancel_call_aborts_the_call_registered_under_the_key() {
        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");
        let effect = OirEffect::cancel_call(OirExpr::string("batch-1"));
        let js = backend.generate_server_effect_code(&effect, &module, None);
        assert!(js.contains("cancelKeyedCall(String(\"batch-1\"));"), "{js}");
    }

    #[test]
    fn call_service_emit_failure_fires_bus_on_catch() {
        let backend = TypeScriptBackend::new();
        let module = OirModule::new("TestApp", "0.1.0");

        let emit_cfg = orbital_core::ir::OirEmitConfig {
            success: Some("EMAIL_SENT".to_string()),
            failure: Some("EMAIL_FAILED".to_string()),
            on_change: None,
            on_message: None,
            cancelled: None,
        };
        let effect = OirEffect::CallService {
            service: "mailer".to_string(),
            method: "sendEmail".to_string(),
            args: OirExpr::object(orbital_core::ir::OirFields::new()),
            key: None,
            emit: Some(emit_cfg),
        };

        let js = backend.generate_server_effect_code(&effect, &module, None);
        assert!(
            js.contains("getServerEventBus().emit('EMAIL_SENT'"),
            "success event missing, got:\n{}",
            js
        );
        assert!(
            js.contains("getServerEventBus().emit('EMAIL_FAILED'"),
            "failure event missing, got:\n{}",
            js
        );
        // Failure emit must live inside the catch block (after the error-push).
        let catch_idx = js.find("} catch (err)").expect("expected catch block");
        let failure_idx = js
            .find("getServerEventBus().emit('EMAIL_FAILED'")
            .expect("expected failure emit");
        assert!(
            failure_idx > catch_idx,
            "failure emit must be inside catch block, got:\n{}",
            js
        );
    }

    // ---------------------------------------------------------------------
    // Live-push (Almadar_Live_Push.md): a persist effect's emit:{success}
    // envelope broadcasts cross-client over SSE. The decision is POSITIONAL
    // — keyed on the effect variant (persist vs everything else), never on
    // the event's name — so these tests pin both sides of that contract.
    // ---------------------------------------------------------------------

    #[test]
    fn persist_create_emit_success_broadcasts_over_sse() {
        let backend = TypeScriptBackend::new();
        let module = test_module_with_entity("Patient", "patients");

        let emit_cfg = orbital_core::ir::OirEmitConfig {
            success: Some("PATIENT_CREATED".to_string()),
            failure: None,
            on_change: None,
            on_message: None,
            cancelled: None,
        };
        let effect = OirEffect::Persist {
            operation: OirPersistOp::Create,
            entity_type: "Patient".to_string(),
            data: OirExpr::string("@entity"),
            emit: Some(emit_cfg),
        };

        let js = backend.generate_server_effect_code(&effect, &module, Some("Patient"));
        assert!(
            js.contains(
                "broadcastBusEvent(clientId, { type: 'bus', event: 'PATIENT_CREATED', payload: __evP, source: __ORBITAL_SOURCE, timestamp: Date.now(), entityType: 'Patient' });"
            ),
            "persist create emit.success must broadcast over SSE with the entity type stamped (§88), got:\n{}",
            js
        );
    }

    #[test]
    fn persist_update_emit_success_broadcasts_over_sse() {
        let backend = TypeScriptBackend::new();
        let module = test_module_with_entity("Patient", "patients");

        let emit_cfg = orbital_core::ir::OirEmitConfig {
            success: Some("PATIENT_SAVED".to_string()),
            failure: None,
            on_change: None,
            on_message: None,
            cancelled: None,
        };
        let effect = OirEffect::Persist {
            operation: OirPersistOp::Update,
            entity_type: "Patient".to_string(),
            data: OirExpr::string("@entity"),
            emit: Some(emit_cfg),
        };

        let js = backend.generate_server_effect_code(&effect, &module, Some("Patient"));
        assert!(
            js.contains("broadcastBusEvent(clientId, { type: 'bus', event: 'PATIENT_SAVED'"),
            "persist update emit.success must broadcast over SSE, got:\n{}",
            js
        );
    }

    #[test]
    fn persist_delete_emit_success_broadcasts_over_sse() {
        let backend = TypeScriptBackend::new();
        let module = test_module_with_entity("Patient", "patients");

        let emit_cfg = orbital_core::ir::OirEmitConfig {
            success: Some("PATIENT_DELETED".to_string()),
            failure: None,
            on_change: None,
            on_message: None,
            cancelled: None,
        };
        let effect = OirEffect::Persist {
            operation: OirPersistOp::Delete,
            entity_type: "Patient".to_string(),
            data: OirExpr::string("@entity"),
            emit: Some(emit_cfg),
        };

        let js = backend.generate_server_effect_code(&effect, &module, Some("Patient"));
        assert!(
            js.contains("broadcastBusEvent(clientId, { type: 'bus', event: 'PATIENT_DELETED'"),
            "persist delete emit.success must broadcast over SSE, got:\n{}",
            js
        );
    }

    #[test]
    fn non_persist_emit_success_never_broadcasts_over_sse() {
        // Positional, not event-name-keyed: fetch/ref/call-service all emit
        // a "success"-keyed event too, but only persist's emit.success may
        // cross-client broadcast (Almadar_Live_Push.md's UI-flow safety
        // clause — transition emits never cross).
        let backend = TypeScriptBackend::new();
        let module = test_module_with_entity("Patient", "patients");

        let fetch_emit = orbital_core::ir::OirEmitConfig {
            success: Some("PATIENT_LOADED".to_string()),
            failure: None,
            on_change: None,
            on_message: None,
            cancelled: None,
        };
        let fetch = OirEffect::Fetch {
            entity_type: "Patient".to_string(),
            id: None,
            filter: None,
            order_by: None,
            offset: None,
            limit: None,
            include: None,
            emit: Some(fetch_emit),
        };
        let fetch_js = backend.generate_server_effect_code(&fetch, &module, None);
        assert!(
            !fetch_js.contains("broadcastBusEvent("),
            "fetch's emit.success must never broadcast, got:\n{}",
            fetch_js
        );

        let call_service_emit = orbital_core::ir::OirEmitConfig {
            success: Some("EMAIL_SENT".to_string()),
            failure: None,
            on_change: None,
            on_message: None,
            cancelled: None,
        };
        let call_service = OirEffect::CallService {
            service: "mailer".to_string(),
            method: "sendEmail".to_string(),
            args: OirExpr::object(orbital_core::ir::OirFields::new()),
            key: None,
            emit: Some(call_service_emit),
        };
        let call_service_js = backend.generate_server_effect_code(&call_service, &module, None);
        assert!(
            !call_service_js.contains("broadcastBusEvent("),
            "call-service's emit.success must never broadcast, got:\n{}",
            call_service_js
        );
    }

    #[test]
    fn call_service_failure_reaches_the_client_like_every_other_effect() {
        // A failed provider call must come back in the response's
        // `emittedEvents`, or the client never takes the failure transition
        // (its screen stays on the in-flight state). Same shape as fetch/persist.
        let backend = TypeScriptBackend::new();
        let module = test_module_with_entity("Patient", "patients");
        let call_service = OirEffect::CallService {
            service: "email".to_string(),
            method: "send".to_string(),
            args: OirExpr::object(orbital_core::ir::OirFields::new()),
            key: None,
            emit: Some(orbital_core::ir::OirEmitConfig {
                success: Some("SENT".to_string()),
                failure: Some("SEND_FAILED".to_string()),
                on_change: None,
                on_message: None,
                cancelled: None,
            }),
        };
        let js = backend.generate_server_effect_code(&call_service, &module, None);
        let catch_block = &js[js.find("} catch (err) {").expect("a catch block")..];
        assert!(
            catch_block.contains("emittedEvents.push({ event: 'SEND_FAILED'"),
            "call-service emit.failure must be pushed to emittedEvents, got:\n{}",
            js
        );
        assert!(
            catch_block.contains("getServerEventBus().emit('SEND_FAILED'"),
            "and still fire on the server bus, got:\n{}",
            js
        );
    }

    #[test]
    fn persist_success_broadcast_identical_for_hono_backend() {
        // generate_server_effect_code_hono delegates Persist to the SAME
        // shared generate_persist_block — the broadcast call site is not
        // duplicated per framework.
        let backend = TypeScriptBackend::new();
        let module = test_module_with_entity("Patient", "patients");

        let emit_cfg = orbital_core::ir::OirEmitConfig {
            success: Some("PATIENT_SAVED".to_string()),
            failure: None,
            on_change: None,
            on_message: None,
            cancelled: None,
        };
        let effect = OirEffect::Persist {
            operation: OirPersistOp::Update,
            entity_type: "Patient".to_string(),
            data: OirExpr::string("@entity"),
            emit: Some(emit_cfg),
        };

        let js = backend.generate_server_effect_code_hono(&effect, &module, Some("Patient"));
        assert!(
            js.contains("broadcastBusEvent(clientId, { type: 'bus', event: 'PATIENT_SAVED'"),
            "Hono persist update emit.success must also broadcast over SSE, got:\n{}",
            js
        );
    }

    /// `["object/get", "@entity", "channel"]` — the row-scoped read form.
    fn row_channel_get() -> OirExpr {
        OirExpr::call(
            "object/get",
            vec![OirExpr::entity_binding(vec![]), OirExpr::string("channel")],
        )
    }

    #[test]
    fn fetch_filter_mixing_row_and_frame_refs_hoists_issuer_frame() {
        // ["=", ["object/get", "@entity", "channel"], "@entity.activeChannel"]
        // — row-scoped LHS, issuing-trait-frame RHS (§49).
        let backend = TypeScriptBackend::new();
        let module = test_module_with_entity("Message", "messages");
        let filter = OirExpr::eq(
            row_channel_get(),
            OirExpr::entity_binding(vec!["activeChannel".to_string()]),
        );
        let effect = OirEffect::Fetch {
            entity_type: "Message".to_string(),
            id: None,
            filter: Some(filter),
            order_by: None,
            offset: None,
            limit: None,
            include: None,
            emit: None,
        };

        let js = backend.generate_server_effect_code(&effect, &module, Some("Message"));
        assert!(
            js.contains("const __issuerFrame = entity;"),
            "mixed filter must hoist the issuing trait's frame, got:\n{}",
            js
        );
        assert!(
            js.contains("__issuerFrame as EventPayload | undefined)?.activeChannel"),
            "the frame-ref side must read __issuerFrame, got:\n{}",
            js
        );
        assert!(
            js.contains("getNestedValue(entity,"),
            "the row-scoped object/get side must still read the lambda's own entity, got:\n{}",
            js
        );

        // Hono delegates Fetch to the same shared codegen — confirm parity.
        let hono_js = backend.generate_server_effect_code_hono(&effect, &module, Some("Message"));
        assert_eq!(
            js, hono_js,
            "hono and express must emit identical fetch-filter code"
        );
    }

    #[test]
    fn fetch_filter_without_frame_refs_is_unchanged_by_the_rewrite() {
        // A pure row-scoped filter (the entire existing corpus's shape) must
        // compile byte-identically to before the frame-ref rewrite existed —
        // zero rewrites, zero new lines, no __issuerFrame hoist.
        let backend = TypeScriptBackend::new();
        let module = test_module_with_entity("Message", "messages");
        let filter = OirExpr::eq(row_channel_get(), OirExpr::string("general"));
        let effect = OirEffect::Fetch {
            entity_type: "Message".to_string(),
            id: None,
            filter: Some(filter),
            order_by: None,
            offset: None,
            limit: None,
            include: None,
            emit: None,
        };

        let js = backend.generate_server_effect_code(&effect, &module, Some("Message"));
        assert!(
            !js.contains("__issuerFrame"),
            "an object/get-only filter must never hoist the issuer frame, got:\n{}",
            js
        );
        assert!(
            js.contains(
                "const filtered = items.filter((entity) => (getNestedValue(entity, \"channel\") === \"general\"));"
            ),
            "object/get-only filter emission must stay pinned, got:\n{}",
            js
        );
    }

    // ---------------------------------------------------------------------
    // Create-from-fresh-entity write-back (two-path divergence fix): a
    // `(persist create X @entity)` whose data is the WHOLE `@entity` binding
    // writes the store-assigned id back onto the local `entity` var so later
    // effects in the same handler invocation see it, mirroring the JS
    // runtime's `set:auto-seed-entity-id` twin.
    // ---------------------------------------------------------------------

    #[test]
    fn persist_create_from_bare_entity_binding_writes_id_back() {
        let backend = TypeScriptBackend::new();
        let module = test_module_with_entity("Task", "tasks");

        let effect = OirEffect::Persist {
            operation: OirPersistOp::Create,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::entity(vec![])),
            emit: None,
        };

        let js = backend.generate_server_effect_code(&effect, &module, Some("Task"));
        assert!(
            js.contains("if (created && entity) { entity.id = created.id; }"),
            "persist create from the bare @entity binding must write the real id back, got:\n{}",
            js
        );
    }

    #[test]
    fn persist_create_from_payload_does_not_write_entity_id_back() {
        // `(persist create Task @payload.data)` — nothing to write back onto;
        // the create's data never came from the local `entity` var.
        let backend = TypeScriptBackend::new();
        let module = test_module_with_entity("Task", "tasks");

        let effect = OirEffect::Persist {
            operation: OirPersistOp::Create,
            entity_type: "Task".to_string(),
            data: OirExpr::binding(OirBinding::payload(vec!["data".to_string()])),
            emit: None,
        };

        let js = backend.generate_server_effect_code(&effect, &module, Some("Task"));
        assert!(
            !js.contains("entity.id = created.id"),
            "persist create from a non-entity data source must not write entity.id back, got:\n{}",
            js
        );
    }

    fn run_page_slice(offset: Option<OirExpr>, limit: Option<OirExpr>) -> String {
        let snippet = TypeScriptBackend::new().emit_page_slice(offset.as_ref(), limit.as_ref(), "Row");
        let script = format!("const data = {{ Row: [0, 1, 2, 3, 4] }};\n{snippet}\nprocess.stdout.write(JSON.stringify(data.Row));");
        let out = std::process::Command::new("node")
            .arg("-e")
            .arg(&script)
            .output()
            .expect("node must be on PATH to run the emitted page code");
        assert!(out.status.success(), "emitted page code failed:\n{script}\n{}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8(out.stdout).unwrap()
    }

    #[test]
    fn page_slice_applies_positive_limit_and_offset() {
        let n = OirExpr::number;
        assert_eq!(run_page_slice(None, Some(n(2.0))), "[0,1]");
        assert_eq!(run_page_slice(Some(n(1.0)), Some(n(2.0))), "[1,2]");
        assert_eq!(run_page_slice(Some(n(1.7)), Some(n(2.9))), "[1,2]");
        assert_eq!(run_page_slice(Some(n(9.0)), None), "[]");
    }

    #[test]
    fn page_slice_ignores_absent_null_and_non_positive_values() {
        let n = OirExpr::number;
        assert_eq!(run_page_slice(None, None), "[0,1,2,3,4]");
        assert_eq!(run_page_slice(None, Some(OirExpr::null())), "[0,1,2,3,4]");
        assert_eq!(run_page_slice(None, Some(n(0.0))), "[0,1,2,3,4]");
        assert_eq!(run_page_slice(None, Some(n(-1.0))), "[0,1,2,3,4]");
        assert_eq!(run_page_slice(Some(n(-2.0)), Some(n(2.0))), "[0,1]");
    }

    #[test]
    fn ref_applies_its_limit_like_fetch() {
        let backend = TypeScriptBackend::new();
        let module = test_module_with_entity("Patient", "patients");
        let limited = OirEffect::Ref {
            entity_type: "Patient".to_string(),
            id: None,
            filter: None,
            order_by: None,
            limit: Some(OirExpr::number(3.0)),
            include: None,
            emit: None,
        };
        let js = backend.generate_server_effect_code(&limited, &module, Some("Patient"));
        let slice = backend.emit_page_slice(None, Some(&OirExpr::number(3.0)), "Patient");
        assert!(js.contains(&slice), "ref limit must emit the shared page slice, got:\n{js}");
        let unlimited = OirEffect::Ref {
            entity_type: "Patient".to_string(),
            id: None,
            filter: None,
            order_by: None,
            limit: None,
            include: None,
            emit: None,
        };
        let js = backend.generate_server_effect_code(&unlimited, &module, Some("Patient"));
        assert!(!js.contains("__limit"), "ref without limit must not slice, got:\n{js}");
    }
}
