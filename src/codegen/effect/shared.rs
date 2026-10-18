//! Shared effect-codegen helpers: relation hydration + success-emit JS, and
//! the one statement-level effect-tree walker (`walk_effect_block` /
//! `EffectBlockSink`) both client and tick codegen drive.

use super::*;

/// Statement-level shapes `walk_effect_block` hands back to its caller: a
/// `let` binding, an `if`/`when` (open/else/close around the recursed
/// branches), a leaf effect, or an expression this backend cannot lower in
/// effect position. Every implementor decides how each shape renders; there
/// is no default the walker itself can fall back to.
pub(crate) trait EffectBlockSink {
    fn on_let_binding(
        &mut self,
        backend: &TypeScriptBackend,
        name: &str,
        value: &OirExpr,
        indent: &str,
    );
    fn render_condition(
        &mut self,
        backend: &TypeScriptBackend,
        condition: &OirExpr,
        indent: &str,
    ) -> String;
    /// A `let` is its own lexical scope (as in both evaluators): two `let`s in one
    /// transition may bind the same name.
    fn on_scope_open(&mut self, indent: &str);
    fn on_scope_close(&mut self, indent: &str);
    fn on_condition_open(&mut self, cond_ts: &str, indent: &str);
    fn on_condition_else(&mut self, indent: &str);
    fn on_condition_close(&mut self, indent: &str);
    fn on_effect(&mut self, backend: &TypeScriptBackend, effect: &OirEffect, indent: &str);
    fn on_unlowerable(&mut self, expr: &OirExpr, indent: &str);
}

/// The one generic descent for effect trees in statement position: unwraps
/// `let`/`do`, and BOTH `if` shapes the resolver produces — `when` and a
/// 2-arg `if` stay `Call{"if"|"when"}`, but a 3-arg `(if c a b)` lowers to
/// `OirExpr::Conditional` (`resolve.rs` ~1509) — so a resolved conditional in
/// effect position is never silently dropped, which the four hand-rolled
/// walkers this replaces only did for the `Call` form. A literal is "no effect"
/// (the kernel's `parse_effect` finds none); anything else hits
/// `on_unlowerable`: no arm here swallows an unrecognized shape.
pub(crate) fn walk_effect_block(
    backend: &TypeScriptBackend,
    expr: &OirExpr,
    indent: &str,
    sink: &mut dyn EffectBlockSink,
) {
    match expr {
        OirExpr::Call { function, args } if function == "let" && args.len() == 2 => {
            sink.on_scope_open(indent);
            backend.with_operand_locals(
                std::slice::from_ref(expr),
                crate::codegen::expr::BindingFlavor::Client,
                &[],
                || {
                    backend.with_local_scope(|| {
                        if let OirExpr::Array { items } = &args[0] {
                            for pair in items {
                                if let OirExpr::Array { items: kv } = pair {
                                    if kv.len() == 2 {
                                        if let OirExpr::String { value: name } = &kv[0] {
                                            backend.bind_local_after(name, true, |ident| {
                                                sink.on_let_binding(backend, ident, &kv[1], indent)
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        walk_effect_block(backend, &args[1], indent, sink)
                    })
                },
            );
            sink.on_scope_close(indent);
        }
        OirExpr::Call { function, args } if function == "do" => {
            for sub in args {
                walk_effect_block(backend, sub, indent, sink);
            }
        }
        OirExpr::Call { function, args }
            if (function == "if" || function == "when") && args.len() >= 2 =>
        {
            let cond_ts = sink.render_condition(backend, &args[0], indent);
            sink.on_condition_open(&cond_ts, indent);
            let inner = format!("{indent}  ");
            walk_effect_block(backend, &args[1], &inner, sink);
            if function == "if" && args.len() == 3 {
                sink.on_condition_else(indent);
                walk_effect_block(backend, &args[2], &inner, sink);
            }
            sink.on_condition_close(indent);
        }
        OirExpr::Conditional {
            condition,
            then_branch,
            else_branch,
        } => {
            let cond_ts = sink.render_condition(backend, condition, indent);
            sink.on_condition_open(&cond_ts, indent);
            let inner = format!("{indent}  ");
            walk_effect_block(backend, then_branch, &inner, sink);
            sink.on_condition_else(indent);
            walk_effect_block(backend, else_branch, &inner, sink);
            sink.on_condition_close(indent);
        }
        OirExpr::Effect { effect } => sink.on_effect(backend, effect, indent),
        // `(if c (emit X) null)`: a literal is "no effect" — the kernel runs nothing for it.
        OirExpr::Null | OirExpr::Bool { .. } | OirExpr::Number { .. } | OirExpr::String { .. } => {}
        other => sink.on_unlowerable(other, indent),
    }
}

/// Does any `Effect` leaf under `expr` satisfy `pred`? Descends via
/// `OirExpr::child_exprs` — `orbital-core`'s one exhaustive generic walk —
/// rather than a hand-matched subset of shapes, so a control form this
/// module doesn't special-case is still found instead of silently stopping
/// the scan.
pub(crate) fn any_effect_leaf(expr: &OirExpr, pred: &dyn Fn(&OirEffect) -> bool) -> bool {
    if let OirExpr::Effect { effect } = expr {
        return pred(effect);
    }
    expr.child_exprs().iter().any(|e| any_effect_leaf(e, pred))
}

/// Does a `let` value or an `if`/`when` condition that `walk_effect_block` emits as a
/// statement read `root`? Those compile outside any effect leaf, so leaf scans miss them.
pub(crate) fn effect_block_control_reads_root(expr: &OirExpr, root: &OirBindingRoot) -> bool {
    let reads = |e: &OirExpr| e.collect_bindings().iter().any(|b| b.root == *root);
    match expr {
        OirExpr::Call { function, args } if function == "let" && args.len() == 2 => {
            let in_values = matches!(&args[0], OirExpr::Array { items } if items.iter().any(|pair| {
                matches!(pair, OirExpr::Array { items: kv } if kv.len() == 2 && reads(&kv[1]))
            }));
            in_values || effect_block_control_reads_root(&args[1], root)
        }
        OirExpr::Call { function, args } if function == "do" => args
            .iter()
            .any(|sub| effect_block_control_reads_root(sub, root)),
        OirExpr::Call { function, args }
            if (function == "if" || function == "when") && args.len() >= 2 =>
        {
            reads(&args[0])
                || args[1..]
                    .iter()
                    .any(|branch| effect_block_control_reads_root(branch, root))
        }
        OirExpr::Conditional {
            condition,
            then_branch,
            else_branch,
        } => {
            reads(condition)
                || effect_block_control_reads_root(then_branch, root)
                || effect_block_control_reads_root(else_branch, root)
        }
        _ => false,
    }
}

/// Operators whose compiled form reads the dispatch's `now` stamp.
const NOW_OPERATORS: [&str; 6] = [
    "time/now",
    "time/today",
    "time/isPast",
    "time/isFuture",
    "time/isToday",
    "time/relative",
];

/// True when `expr` reads the dispatch's `now` stamp: the `@now` binding or a time operator.
pub(crate) fn expr_reads_now(expr: &OirExpr) -> bool {
    expr.collect_bindings()
        .iter()
        .any(|b| matches!(&b.root, OirBindingRoot::Local(name) if name == "now"))
        || NOW_OPERATORS.iter().any(|op| expr.calls_function(op))
}

/// A render-ui pattern value reads `now`: render-ui configs are data, so `expr_reads_now` never sees them.
fn value_reads_now(value: &orbital_core_base::ir::OirValue) -> bool {
    use orbital_core_base::ir::OirValue;
    match value {
        OirValue::String(s) => s == "@now",
        OirValue::Array(items) => {
            matches!(items.first(), Some(OirValue::String(op)) if NOW_OPERATORS.contains(&op.as_str()))
                || items.iter().any(value_reads_now)
        }
        OirValue::Object(map) => map.values().any(value_reads_now),
        _ => false,
    }
}

/// True when any guard, effect, tick or listener expression of the trait, or a render-ui it draws, reads `now`.
pub(crate) fn trait_reads_now(trait_def: &OirTrait) -> bool {
    let transitions = trait_def
        .transitions
        .iter()
        .flat_map(|t| t.guard.iter().chain(t.effects.iter()));
    let ticks = trait_def
        .ticks
        .iter()
        .flat_map(|t| t.guard.iter().chain(t.effects.iter()));
    let listeners = trait_def.listeners.iter().flat_map(|l| {
        l.guard
            .iter()
            .chain(l.payload_mapping.iter().flat_map(|m| m.values()))
    });
    let render_ui = |effects: &[OirExpr]| {
        orbital_core_base::ir::render_ui_patterns(effects)
            .iter()
            .any(|p| p.config.values().any(value_reads_now))
    };
    transitions
        .chain(ticks)
        .chain(listeners)
        .any(expr_reads_now)
        || trait_def.transitions.iter().any(|t| render_ui(&t.effects))
        || trait_def.ticks.iter().any(|t| render_ui(&t.effects))
}

/// A dynamic read compiles to `EventPayloadValue | undefined`, too wide for a `string` slot: wrap
/// it in `String(… ?? '')`. A string literal or template already typechecks and is left untouched
/// (wrapping would make `?? ''` unreachable, TS2869); `@toState` and a committed `state` compile to one.
pub(crate) fn string_coerce_ts(compiled: &str) -> String {
    let t = compiled.trim_start();
    if t.starts_with('"') || t.starts_with('\'') || t.starts_with('`') {
        compiled.to_string()
    } else {
        format!("String({} ?? '')", compiled)
    }
}

/// True when an expression reads `@event`, `@prevEvents` or `@prevStates`, which need the dispatch scope in reach.
pub(crate) fn expr_reads_dispatch_scope(expr: &OirExpr) -> bool {
    expr.collect_bindings().iter().any(|b| {
        matches!(
            b.root,
            OirBindingRoot::Event | OirBindingRoot::PrevEvents | OirBindingRoot::PrevStates
        )
    })
}

/// True when any guard, effect or listen `when` of the trait reads the dispatch scope.
pub(crate) fn trait_reads_dispatch_scope(trait_def: &OirTrait) -> bool {
    trait_def
        .transitions
        .iter()
        .flat_map(|t| t.guard.iter().chain(t.effects.iter()))
        .chain(trait_def.listeners.iter().flat_map(|l| l.guard.iter()))
        .any(expr_reads_dispatch_scope)
}


/// Tag an expression `walk_effect_block` couldn't lower — a `Call`'s
/// function name, or the bare variant name otherwise — so the `throw`
/// `on_unlowerable` emits names what actually got dropped.
pub(crate) fn unlowerable_expr_label(expr: &OirExpr) -> String {
    match expr {
        OirExpr::Call { function, .. } => function.clone(),
        OirExpr::Null => "Null".to_string(),
        OirExpr::Bool { .. } => "Bool".to_string(),
        OirExpr::Number { .. } => "Number".to_string(),
        OirExpr::String { .. } => "String".to_string(),
        OirExpr::Array { .. } => "Array".to_string(),
        OirExpr::Object { .. } => "Object".to_string(),
        OirExpr::Binding { .. } => "Binding".to_string(),
        OirExpr::BinaryOp { .. } => "BinaryOp".to_string(),
        OirExpr::UnaryOp { .. } => "UnaryOp".to_string(),
        OirExpr::Conditional { .. } => "Conditional".to_string(),
        OirExpr::Map { .. } => "Map".to_string(),
        OirExpr::Filter { .. } => "Filter".to_string(),
        OirExpr::Reduce { .. } => "Reduce".to_string(),
        OirExpr::Lambda { .. } => "Lambda".to_string(),
        OirExpr::Effect { .. } => "Effect".to_string(),
    }
}







impl TypeScriptBackend {







}

#[cfg(test)]
mod v4_rename_equivalence {
    //! V4 Phase 4 payoff: two schemas identical except a node's DISPLAY NAME
    //! changed (curName differs, id unchanged, ledger records the rename) must
    //! produce equivalent generated wiring — the trait→entity / page→trait joins
    //! resolve to the SAME node in both, with no broken join.
    use crate::backend::TypeScriptBackend;
    use orbital_core_base::ir::{OirEntity, OirModule, OirTrait};

    fn entity(name: &str, id: Option<&str>, collection: &str) -> OirEntity {
        let mut e = OirEntity::new(name);
        e.id = id.map(String::from);
        e.collection = collection.to_string();
        e
    }

    #[test]
    fn entity_rename_preserves_join_target() {
        // Schema A: entity "Course" (id ent_1); consistent baked names.
        let mut a = OirModule::new("app", "1.0.0");
        a.entities.push(entity("Course", Some("ent_1"), "courses"));

        // Schema B: SAME node id, renamed display name + collection. The
        // trait's linkedEntity reference still carries the STALE baked name
        // ("Course") plus the durable id — exactly what a call-site rename
        // leaves behind under dual-carry.
        let mut b = OirModule::new("app", "1.0.0");
        b.entities
            .push(entity("PotteryClass", Some("ent_1"), "pottery_classes"));

        let stale_name = Some("Course");
        let durable_id = Some("ent_1");

        let (name_a, coll_a, _) = TypeScriptBackend::resolve_entity_collection(
            "@entity", &a, stale_name, durable_id, None,
        );
        let (name_b, coll_b, _) = TypeScriptBackend::resolve_entity_collection(
            "@entity", &b, stale_name, durable_id, None,
        );

        // A resolves to the node as-named; B resolves by ID to the RENAMED node
        // — the wiring follows the entity, it does not break on the stale name.
        assert_eq!((name_a.as_str(), coll_a.as_str()), ("Course", "courses"));
        assert_eq!(
            (name_b.as_str(), coll_b.as_str()),
            ("PotteryClass", "pottery_classes")
        );

        // The join TARGET is the same node (id ent_1) in both schemas.
        assert_eq!(
            a.resolve_entity_ref(durable_id, "Course").map(|e| &e.id),
            b.resolve_entity_ref(durable_id, "Course").map(|e| &e.id),
        );
        // In B the id join beats the now-stale name — a bare NAME join breaks.
        assert_eq!(
            b.resolve_entity_ref(durable_id, "Course").unwrap().name,
            "PotteryClass"
        );
        assert!(
            b.find_entity("Course").is_none(),
            "stale name must NOT resolve by name — proving id carried the join"
        );
    }

    #[test]
    fn trait_rename_preserves_join_target() {
        let mut m = OirModule::new("app", "1.0.0");
        let mut t = OirTrait::new("CoursePlayer");
        t.id = Some("trt_1".to_string());
        m.traits.push(t);

        // Page trait-binding / listens source referencing the trait by its
        // durable id survives a rename of the trait's display name.
        assert_eq!(
            m.resolve_trait_ref(Some("trt_1"), "LessonPlayer")
                .unwrap()
                .name,
            "CoursePlayer"
        );
        assert!(m.find_trait("LessonPlayer").is_none());
        // Slice-level join helper agrees (id beats stale name; name fallback).
        assert!(m.traits[0].matches_ref(Some("trt_1"), "LessonPlayer"));
        assert!(m.traits[0].matches_ref(None, "CoursePlayer"));
        assert!(!m.traits[0].matches_ref(None, "LessonPlayer"));
    }

    #[test]
    fn nonlinked_token_follows_entity_ref_ids_side_map() {
        // A NON-linked positional entity token (e.g. `(persist create Product ...)`
        // or `(fetch Product)`) keeps its STALE authored name after the entity
        // declaration is renamed Product→Item (id ent_9 stable). The trait's
        // `entity_ref_ids` side-map {Product: ent_9} lets codegen follow the id.
        let mut renamed = OirModule::new("app", "1.0.0");
        renamed
            .entities
            .push(entity("Item", Some("ent_9"), "items"));

        let mut side_map = orbital_core_base::ir::OirIdMap::new();
        side_map.insert("Product".to_string(), "ent_9".to_string());

        // WITH the side-map: the stale token resolves by id to the renamed
        // declaration — collection + type follow "Item"/"items".
        let (name, coll, _) = TypeScriptBackend::resolve_entity_collection(
            "Product",
            &renamed,
            None,
            None,
            Some(&side_map),
        );
        assert_eq!((name.as_str(), coll.as_str()), ("Item", "items"));

        // Name-consistent baseline: a schema where the token IS "Item" resolves
        // to exactly the same target — proving the id path is byte-identical to
        // the name-consistent case.
        let (name_ok, coll_ok, _) =
            TypeScriptBackend::resolve_entity_collection("Item", &renamed, None, None, None);
        assert_eq!(
            (name.as_str(), coll.as_str()),
            (name_ok.as_str(), coll_ok.as_str())
        );
    }

    #[test]
    fn nonlinked_token_no_side_map_is_name_join() {
        // No side-map (or a token absent from it) → the exact pre-flip name
        // join: the token resolves by name, and a stale name that matches
        // nothing falls through to the snake_case default. Byte-identical.
        let mut m = OirModule::new("app", "1.0.0");
        m.entities.push(entity("Order", Some("ent_3"), "orders"));

        // Token present by name, no map → name join hits "Order".
        let (name, coll, _) =
            TypeScriptBackend::resolve_entity_collection("Order", &m, None, None, None);
        assert_eq!((name.as_str(), coll.as_str()), ("Order", "orders"));

        // Token missing from a present map → name fallback (here to the
        // snake_case default, matching pre-V4 behavior for an unknown name).
        let empty = orbital_core_base::ir::OirIdMap::new();
        let (miss_name, miss_coll, _) =
            TypeScriptBackend::resolve_entity_collection("Ghost", &m, None, None, Some(&empty));
        assert_eq!((miss_name.as_str(), miss_coll.as_str()), ("Ghost", "ghost"));
    }

    #[test]
    fn id_free_schema_is_byte_identical_name_join() {
        // No ids anywhere → resolution is exactly the legacy exact-name join.
        let mut m = OirModule::new("app", "1.0.0");
        m.entities.push(entity("Course", None, "courses"));

        let (name, coll, _) =
            TypeScriptBackend::resolve_entity_collection("@entity", &m, Some("Course"), None, None);
        assert_eq!((name.as_str(), coll.as_str()), ("Course", "courses"));

        // A name that matches nothing falls through to the snake_case default —
        // identical to the pre-V4 behavior.
        let (miss_name, miss_coll, _) = TypeScriptBackend::resolve_entity_collection(
            "@entity",
            &m,
            Some("Missing"),
            None,
            None,
        );
        assert_eq!(
            (miss_name.as_str(), miss_coll.as_str()),
            ("Missing", "missing")
        );
    }
}

#[cfg(test)]
mod self_relation_hydration {
    //! A self-referential `include` (ThreadPost.replies : [ThreadPost]) hydrates
    //! the whole reply tree, ending a branch where an id repeats an ancestor —
    //! twin of the runtime's `populate-self-relation-depth.test.ts`.
    use super::emit_relation_hydration;
    use orbital_core_base::ir::{OirCardinality, OirEntity, OirField, OirModule, OirRelation, OirType};

    fn module() -> OirModule {
        let mut m = OirModule::new("app", "1.0.0");
        let mut note = OirEntity::new("Note");
        note.collection = "notes".to_string();
        let mut replies = OirField::new(
            "replies",
            OirType::Array {
                inner: Box::new(OirType::String),
            },
        );
        replies.relation = Some(OirRelation {
            target_entity: "Note".to_string(),
            target_entity_id: None,
            cardinality: OirCardinality::OneToMany,
            foreign_key: None,
        });
        note.fields = vec![
            OirField::new("id", OirType::String),
            OirField::new("content", OirType::String),
            replies,
        ];
        m.entities.push(note);
        m
    }

    /// Runs the emitted hydration over `rows` and returns the hydrated rows.
    fn hydrate(rows: &str) -> serde_json::Value {
        let code = emit_relation_hydration("Note", &["replies".to_string()], &module(), true);
        let script = format!(
            "type EntityRow = Record<string, unknown>;\ntype Note = EntityRow;\nconst rows: Note[] = {rows};\nconst getDataService = () => ({{ list: async <T,>(_c: string): Promise<T[]> => rows.map((r) => ({{ ...r }})) as T[] }});\nconst data: Record<string, Note[]> = {{ Note: rows.map((r) => ({{ ...r }})) }};\n(async () => {{\n{code}\nprocess.stdout.write(JSON.stringify(data.Note));\n}})();\n"
        );
        let out = std::process::Command::new("node")
            .arg("--input-type=commonjs-typescript")
            .arg("-e")
            .arg(&script)
            .output()
            .expect("node must be on PATH to run the emitted hydration code");
        assert!(
            out.status.success(),
            "emitted hydration failed:\n{script}\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        serde_json::from_slice(&out.stdout).expect("hydrated rows are JSON")
    }

    /// `content` of `row`, with its replies' trees, as nested `[content, [children]]`.
    fn tree(row: &serde_json::Value) -> serde_json::Value {
        let kids: Vec<serde_json::Value> = row["replies"]
            .as_array()
            .map(|a| a.iter().filter(|c| c.is_object()).map(tree).collect())
            .unwrap_or_default();
        serde_json::json!([row["content"], kids])
    }

    fn find<'a>(rows: &'a serde_json::Value, content: &str) -> &'a serde_json::Value {
        rows.as_array()
            .unwrap()
            .iter()
            .find(|r| r["content"] == content)
            .expect("row present")
    }

    #[test]
    fn a_reply_to_a_reply_is_loaded_under_its_parent() {
        let rows = hydrate(
            r#"[{"id":"t","content":"top","replies":["c"]},{"id":"c","content":"child","replies":["g"]},{"id":"g","content":"grandchild","replies":[]}]"#,
        );
        assert_eq!(
            tree(find(&rows, "top")),
            serde_json::json!(["top", [["child", [["grandchild", []]]]]])
        );
    }

    #[test]
    fn control_a_one_level_reply_is_loaded_as_before() {
        let rows = hydrate(
            r#"[{"id":"t","content":"top","replies":["c"]},{"id":"c","content":"child","replies":[]}]"#,
        );
        assert_eq!(
            tree(find(&rows, "top")),
            serde_json::json!(["top", [["child", []]]])
        );
    }

    #[test]
    fn a_cycle_stops_at_the_repeated_ancestor() {
        let rows = hydrate(
            r#"[{"id":"a","content":"a","replies":["b"]},{"id":"b","content":"b","replies":["a"]}]"#,
        );
        assert_eq!(
            tree(find(&rows, "a")),
            serde_json::json!(["a", [["b", []]]])
        );
    }

    #[test]
    fn a_post_listing_itself_hydrates_no_replies() {
        let rows = hydrate(r#"[{"id":"a","content":"a","replies":["a"]}]"#);
        assert_eq!(tree(find(&rows, "a")), serde_json::json!(["a", []]));
    }
}

fn value_uses_messages(value: &orbital_core_base::ir::OirValue) -> bool {
    use orbital_core_base::ir::OirValue;
    match value {
        OirValue::String(s) => s == "@locale",
        OirValue::Array(items) => {
            matches!(items.first(), Some(OirValue::String(op)) if op == orbital_core_base::messages::TRANSLATE_OP)
                || items.iter().any(value_uses_messages)
        }
        OirValue::Object(map) => map.values().any(value_uses_messages),
        _ => false,
    }
}

/// True when the trait's logic hook evaluates a message (`i18n/t`) or reads
/// `@locale` — in a guard, effect, tick, listener or config default — and so
/// needs `useTranslate()` in scope.
pub(crate) fn trait_uses_messages(trait_def: &OirTrait) -> bool {
    let uses = |expr: &OirExpr| {
        expr.calls_function(orbital_core_base::messages::TRANSLATE_OP)
            || expr
                .collect_bindings()
                .iter()
                .any(|b| matches!(b.root, OirBindingRoot::Locale))
    };
    let transitions = trait_def
        .transitions
        .iter()
        .flat_map(|t| t.guard.iter().chain(t.effects.iter()));
    let ticks = trait_def
        .ticks
        .iter()
        .flat_map(|t| t.guard.iter().chain(t.effects.iter()));
    let listeners = trait_def.listeners.iter().flat_map(|l| {
        l.guard
            .iter()
            .chain(l.payload_mapping.iter().flat_map(|m| m.values()))
    });
    transitions.chain(ticks).chain(listeners).any(uses)
        || trait_def
            .declared_config_defaults
            .iter()
            .flat_map(|d| d.values())
            .any(value_uses_messages)
}
