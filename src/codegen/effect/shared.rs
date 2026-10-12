//! Shared effect-codegen helpers: relation hydration + success-emit JS, and
//! the one statement-level effect-tree walker (`walk_effect_block` /
//! `EffectBlockSink`) both client and tick codegen drive.

use super::*;
use crate::backend::server::access_policies::policy_const_name;
use orbital_core::ir::OirBinding;

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
            let mut bound: Vec<String> = Vec::new();
            if let OirExpr::Array { items } = &args[0] {
                for pair in items {
                    if let OirExpr::Array { items: kv } = pair {
                        if kv.len() == 2 {
                            if let OirExpr::String { value: name } = &kv[0] {
                                let ident = TypeScriptBackend::let_ident(name);
                                backend.with_locals(&bound, true, || {
                                    sink.on_let_binding(backend, &ident, &kv[1], indent)
                                });
                                bound.push(name.clone());
                            }
                        }
                    }
                }
            }
            backend.with_locals(&bound, true, || {
                walk_effect_block(backend, &args[1], indent, sink)
            });
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
fn value_reads_now(value: &orbital_core::ir::OirValue) -> bool {
    use orbital_core::ir::OirValue;
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
        orbital_core::ir::render_ui_patterns(effects)
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

/// Any trait of the module reads the dispatch scope, so its hooks carry the dispatch through the bus.
pub(crate) fn module_reads_dispatch_scope(module: &OirModule) -> bool {
    module.traits.iter().any(trait_reads_dispatch_scope)
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

/// Emit cycle-safe relation hydration for `include` fields. Mirrors the
/// interpreter runtime's `populateRelations`: attach SHALLOW CLONES (never the
/// live store rows) and, for a self-referential relation (target == source,
/// e.g. ThreadPost.replies : [ThreadPost]), neutralize the child's own
/// back-pointer field so hydrated children are leaves. Without this, mutual
/// references (A.replies→B, B.replies→A) make the server's JSON serializer
/// throw "Converting circular structure to JSON" → HTTP 500.
///
/// `store_dropdown` additionally stashes the full related list under
/// `data['<target>']` for form dropdowns (fetch path); skipped for
/// self-referential relations so it can't clobber the (possibly filtered)
/// primary result.
/// The include-field → relation-field match (`tag` / `tagId` / `tag`-from-`tagId`)
/// — single owner for both the hydration emitter and the handler-import
/// collector below, so the two can't drift.
fn find_include_relation_field<'a>(
    module: &'a OirModule,
    entity: &str,
    field_name: &str,
) -> Option<&'a orbital_core::ir::OirField> {
    module
        .entities
        .iter()
        .find(|e| e.name == entity)
        .and_then(|e| {
            e.fields.iter().find(|f| {
                f.name == field_name
                    || f.name == format!("{}Id", field_name)
                    || f.name.strip_suffix("Id").is_some_and(|b| b == field_name)
            })
        })
}

/// Entity type names the emitted hydration blocks reference as generic args
/// (`getDataService().list<Category>(…)`) — the handler's shared-type import
/// list must include them or the generated file fails tsc.
pub(crate) fn collect_hydration_target_entities(
    trait_def: &OirTrait,
    module: &OirModule,
) -> std::collections::BTreeSet<String> {
    let mut targets = std::collections::BTreeSet::new();
    for trans in &trait_def.transitions {
        for effect_expr in &trans.effects {
            let OirExpr::Effect { effect } = effect_expr else {
                continue;
            };
            let (entity_type, include) = match effect.as_ref() {
                OirEffect::Fetch {
                    entity_type,
                    include: Some(inc),
                    ..
                }
                | OirEffect::Ref {
                    entity_type,
                    include: Some(inc),
                    ..
                } => (entity_type, inc),
                _ => continue,
            };
            let resolved_entity = if entity_type == "@entity" {
                match &trait_def.linked_entity {
                    Some(l) => l.clone(),
                    None => continue,
                }
            } else {
                entity_type.clone()
            };
            for field_name in include {
                let Some(rel_field) =
                    find_include_relation_field(module, &resolved_entity, field_name)
                else {
                    continue;
                };
                let Some(rel) = rel_field.relation.as_ref() else {
                    continue;
                };
                let target = module
                    .resolve_entity_ref(rel.target_entity_id.as_deref(), &rel.target_entity)
                    .map(|e| e.name.clone())
                    .unwrap_or_else(|| rel.target_entity.clone());
                targets.insert(target);
            }
        }
    }
    targets
}

pub(super) fn emit_relation_hydration(
    resolved_entity: &str,
    include_fields: &[String],
    module: &OirModule,
    store_dropdown: bool,
) -> String {
    let mut code = String::new();
    code.push_str("        // Populate included relation fields (cycle-safe clones)\n");
    for field_name in include_fields {
        let rel_field = find_include_relation_field(module, resolved_entity, field_name);
        let Some(rel_field) = rel_field else { continue };
        let Some(rel) = rel_field.relation.as_ref() else {
            continue;
        };
        let target_node =
            module.resolve_entity_ref(rel.target_entity_id.as_deref(), &rel.target_entity);
        let target_entity = target_node
            .map(|e| e.name.clone())
            .unwrap_or_else(|| rel.target_entity.clone());
        let target_collection = target_node
            .map(|e| e.collection.clone())
            .unwrap_or_else(|| to_snake_case(&target_entity));
        let fk_field = rel_field.name.clone();
        let populated_name = fk_field
            .strip_suffix("Id")
            .map(|b| b.to_string())
            .unwrap_or_else(|| field_name.clone());
        let is_self_ref = target_entity == resolved_entity;
        // Spread-clone; a self-ref single value keeps the child's back-pointer empty.
        let neutralize = if is_self_ref {
            // Typed empty array — a bare `[]` is implicitly `any[]` (TS7018
            // under noImplicitAny) now that the surrounding `.map` is typed.
            format!(", ['{}']: [] as EntityRow[] ", fk_field)
        } else {
            String::new()
        };
        let target_ref = entity_type_ref(&target_entity);

        code.push_str("        {\n");
        code.push_str(&format!(
            "          const relatedItems = await getDataService().list<{}>('{}');\n",
            target_ref, target_collection
        ));
        code.push_str("          const relatedMap = new Map(relatedItems.filter(r => typeof r.id === 'string').map(r => [r.id, r] as const));\n");
        if is_self_ref {
            // Self-reference: hydrate the whole tree of shallow clones; a branch
            // ends where an id repeats one of its ancestors (no shared or
            // circular references reach the JSON serializer).
            code.push_str(&format!(
                "          const __hydrateTree = (id: string, lineage: ReadonlySet<string>): EntityRow => {{ const __r = relatedMap.get(id)!; const __next = new Set(lineage).add(id); const __kids = __r['{fk}']; return {{ ...__r, ['{fk}']: Array.isArray(__kids) ? __kids.map((k) => String(k)).filter((k) => !__next.has(k) && relatedMap.has(k)).map((k) => __hydrateTree(k, __next)) : [] as EntityRow[] }}; }};\n",
                fk = fk_field
            ));
        }
        code.push_str(&format!(
            "          for (const entity of (data['{}'] || [])) {{\n",
            resolved_entity
        ));
        code.push_str(&format!(
            "            const fkVal = entity['{}'];\n",
            fk_field
        ));
        code.push_str("            if (typeof fkVal === 'string' && relatedMap.has(fkVal)) {\n");
        code.push_str(&format!(
            "              const __r = relatedMap.get(fkVal); entity['{}'] = __r ? {{ ...__r{} }} : __r;\n",
            populated_name, neutralize
        ));
        code.push_str("            } else if (Array.isArray(fkVal)) {\n");
        // `String(id)`-coerce each fk to a string key before `relatedMap`
        // lookups. The recursive `FieldValue` element type doesn't narrow
        // reliably through a `typeof`/type-guard filter (leaving `.has(id)` /
        // `.get(id)` arguments wide → TS2345); `String(...)` yields `string`
        // unconditionally. Non-string refs stringify to keys that simply miss
        // the map and drop out at the `.has` filter.
        if is_self_ref {
            code.push_str(&format!(
                "              const __lineage = new Set([String(entity.id)]);\n              entity['{}'] = fkVal.map((id) => String(id)).filter((id) => !__lineage.has(id) && relatedMap.has(id)).map((id) => __hydrateTree(id, __lineage));\n",
                populated_name
            ));
        } else {
            code.push_str(&format!(
                "              entity['{}'] = fkVal.map((id) => String(id)).filter((id) => relatedMap.has(id)).map((id) => {{ const __r = relatedMap.get(id)!; return {{ ...__r{} }}; }});\n",
                populated_name, neutralize
            ));
        }
        code.push_str("            }\n");
        code.push_str("          }\n");
        if store_dropdown && !is_self_ref {
            code.push_str(&format!(
                "          data['{}'] = relatedItems;\n",
                target_entity
            ));
        }
        code.push_str("        }\n");
    }
    code
}

/// Local identifier the hoisted `const __issuerFrame = entity;` binds — the
/// filter lambda's own `entity` param shadows the issuing trait's `entity`,
/// so a frame-ref leaf needs its own name to reach the OUTER frame.
const ISSUER_FRAME_LOCAL: &str = "__issuerFrame";

/// The row-scoped read form `["object/get", "@entity", …]` — its first arg
/// is the bare (empty-path) entity binding.
fn is_bare_entity_binding(expr: &OirExpr) -> bool {
    matches!(
        expr,
        OirExpr::Binding {
            binding: OirBinding {
                root: OirBindingRoot::Entity,
                path,
            },
        } if path.is_empty()
    )
}

/// Rewrite `@entity`/`@entity.*` leaves in a fetch filter to read the ISSUING
/// trait's frame (`__issuerFrame`) instead of the `.filter()` lambda's row
/// param — mirrors the JS runtime's `interpolateFilterTraitRefs`
/// (`packages/almadar-runtime/src/EffectExecutor.ts`). The row-scoped
/// `["object/get", "@entity", …]` form is preserved verbatim, not descended
/// into; object literal fields pass through unrewritten (JS parity — that
/// function never recurses into objects either). Returns the rewritten
/// expression plus whether anything actually changed.
fn rewrite_filter_issuer_frame_refs(expr: &OirExpr) -> (OirExpr, bool) {
    match expr {
        OirExpr::Binding {
            binding:
                OirBinding {
                    root: OirBindingRoot::Entity,
                    path,
                },
        } => (
            OirExpr::Binding {
                binding: OirBinding {
                    root: OirBindingRoot::Local(ISSUER_FRAME_LOCAL.to_string()),
                    path: path.clone(),
                },
            },
            true,
        ),
        OirExpr::Call { function, args }
            if function == "object/get" && args.first().is_some_and(is_bare_entity_binding) =>
        {
            (expr.clone(), false)
        }
        OirExpr::Call { function, args } => {
            let mut changed = false;
            let new_args = args
                .iter()
                .map(|a| {
                    let (na, c) = rewrite_filter_issuer_frame_refs(a);
                    changed = changed || c;
                    na
                })
                .collect();
            (
                OirExpr::Call {
                    function: function.clone(),
                    args: new_args,
                },
                changed,
            )
        }
        OirExpr::Array { items } => {
            let mut changed = false;
            let new_items = items
                .iter()
                .map(|i| {
                    let (ni, c) = rewrite_filter_issuer_frame_refs(i);
                    changed = changed || c;
                    ni
                })
                .collect();
            (OirExpr::Array { items: new_items }, changed)
        }
        OirExpr::BinaryOp { op, left, right } => {
            let (nl, cl) = rewrite_filter_issuer_frame_refs(left);
            let (nr, cr) = rewrite_filter_issuer_frame_refs(right);
            (
                OirExpr::BinaryOp {
                    op: *op,
                    left: Box::new(nl),
                    right: Box::new(nr),
                },
                cl || cr,
            )
        }
        OirExpr::UnaryOp { op, operand } => {
            let (no, c) = rewrite_filter_issuer_frame_refs(operand);
            (
                OirExpr::UnaryOp {
                    op: *op,
                    operand: Box::new(no),
                },
                c,
            )
        }
        OirExpr::Conditional {
            condition,
            then_branch,
            else_branch,
        } => {
            let (nc, c1) = rewrite_filter_issuer_frame_refs(condition);
            let (nt, c2) = rewrite_filter_issuer_frame_refs(then_branch);
            let (ne, c3) = rewrite_filter_issuer_frame_refs(else_branch);
            (
                OirExpr::Conditional {
                    condition: Box::new(nc),
                    then_branch: Box::new(nt),
                    else_branch: Box::new(ne),
                },
                c1 || c2 || c3,
            )
        }
        // Object literal fields pass through untouched — mirrors the JS
        // `interpolateFilterTraitRefs`, which never recurses into objects.
        _ => (expr.clone(), false),
    }
}

impl TypeScriptBackend {
    /// Resolve `@entity` to the trait's linked entity and look up its
    /// collection name. Shared by every DB-touching effect (fetch/ref/deref/
    /// swap) so the resolution rule lives in one place.
    /// Returns `(display name, collection, resolved node)`. The node is handed
    /// back rather than re-looked-up by name because the id-join may land on a
    /// renamed entity — and every read site needs it to reach `read_policy`.
    pub(crate) fn resolve_entity_collection<'a>(
        entity_type: &str,
        module: &'a OirModule,
        linked_entity: Option<&str>,
        linked_entity_id: Option<&str>,
        entity_ref_ids: Option<&orbital_core::ir::OirIdMap>,
    ) -> (String, String, Option<&'a OirEntity>) {
        // `@entity` resolves via the trait's linkedEntity + its id sibling; a
        // NON-linked entity token (positional `fetch`/`ref`/`deref`/`swap` arg)
        // carries its stable id in the trait's `entity_ref_ids` side-map, so a
        // renamed entity is followed by id (id-first, name-fallback). A missing
        // side-map key → `None` → the exact name join used before the V4 flip.
        let (resolved_entity, resolved_id) = if entity_type == "@entity" {
            (linked_entity.unwrap_or("Entity"), linked_entity_id)
        } else {
            (
                entity_type,
                entity_ref_ids.and_then(|m| m.get(entity_type).map(String::as_str)),
            )
        };
        let entity = module.resolve_entity_ref(resolved_id, resolved_entity);
        // Resolve the display name from the joined node (id-join may land on a
        // renamed entity whose current name differs from the stale reference).
        let resolved_name = entity
            .map(|e| e.name.clone())
            .unwrap_or_else(|| resolved_entity.to_string());
        let collection = entity
            .map(|e| e.collection.clone())
            .unwrap_or_else(|| to_snake_case(&resolved_name));
        (resolved_name, collection, entity)
    }

    /// Emit the shared entity-loading prelude for `fetch`/`ref`: a `getById`
    /// single-row load when `id` is present, otherwise a `list` followed by an
    /// optional client-side `filter`. Result lands in `data['<entity>']`.
    /// `order_by` / pagination / `include` hydration / emit are layered on by
    /// the caller since they diverge between fetch and ref.
    pub(crate) fn emit_entity_load_block(
        &self,
        resolved_entity: &str,
        collection: &str,
        entity_node: Option<&OirEntity>,
        id: &Option<OirExpr>,
        filter: &Option<OirExpr>,
        has_issuer_entity: bool,
    ) -> String {
        // Present only when the entity declares `@read`. Absent → the emitted
        // code is byte-identical to before entity access existed, which is what
        // keeps the policy-free corpus from re-diffing.
        let read_policy = entity_node
            .and_then(|e| e.read_policy.as_ref())
            .map(|_| policy_const_name(resolved_entity, "READ"));

        let mut code = String::new();
        if let Some(id_expr) = id {
            let id_ts = self.compile_guard_to_ts(id_expr);
            // `id_ts` reads through `@payload`/`@entity`, both wide optional
            // chains (`EventPayloadValue | undefined` / `string | undefined`).
            // A `typeof` narrow, not an `as string` assertion, decides whether
            // `getById` runs at all — an absent id is a legitimate "nothing to
            // load" (mirrors persist.rs's typed-guard id resolution), not a
            // cast-past mistake.
            code.push_str(&format!("        const __fetchByIdArg = {};\n", id_ts));
            code.push_str(&format!(
                "        const fetchedById = typeof __fetchByIdArg === 'string' ? await getDataService().getById<{}>('{}', __fetchByIdArg) : null;\n",
                entity_type_ref(resolved_entity),
                collection
            ));
            match &read_policy {
                // Reading one row by id is still a read, so `@read` applies. The
                // call-site `filter:` does not — there is nothing to narrow.
                Some(policy) => code.push_str(&format!(
                    "        data['{}'] = fetchedById ? applyRowAccess([fetchedById], {}, undefined, {{ user, now }}) : [];\n",
                    resolved_entity, policy
                )),
                None => code.push_str(&format!(
                    "        data['{}'] = fetchedById ? [fetchedById] : [];\n",
                    resolved_entity
                )),
            }
        } else {
            code.push_str(&format!(
                "        const items = await getDataService().list<{}>('{}');\n",
                entity_type_ref(resolved_entity),
                collection
            ));
            // The rows the policy admits. Everything downstream — the call-site
            // filter, pagination, and the caller's `__totalCount_*` capture —
            // reads from here, so a scoped view never reports a global count.
            let source = match &read_policy {
                Some(policy) => {
                    code.push_str(&format!(
                        "        const scoped_{} = applyRowAccess(items, {}, undefined, {{ user, now }});\n",
                        resolved_entity, policy
                    ));
                    format!("scoped_{}", resolved_entity)
                }
                None => "items".to_string(),
            };
            if let Some(filter_expr) = filter {
                // The frame-ref rewrite only applies when the issuing trait
                // actually declares a local `entity` for `__issuerFrame` to
                // capture — an unlinked trait's handler never binds one, so a
                // bare `@entity.X` filter leaf there keeps reading the row (as
                // before) rather than emitting an undeclared identifier.
                let (rewritten_filter, filter_rewritten) = if has_issuer_entity {
                    rewrite_filter_issuer_frame_refs(filter_expr)
                } else {
                    (filter_expr.clone(), false)
                };
                let filter_code = self.compile_guard_to_ts(&rewritten_filter);
                if filter_rewritten {
                    code.push_str(&format!(
                        "          const {} = entity;\n",
                        ISSUER_FRAME_LOCAL
                    ));
                }
                code.push_str(&format!(
                    "          const filtered = {}.filter((entity) => {});\n",
                    source,
                    filter_code.replace("@entity", "entity")
                ));
                code.push_str(&format!(
                    "          data['{}'] = filtered;\n",
                    resolved_entity
                ));
            } else {
                code.push_str(&format!(
                    "          data['{}'] = {};\n",
                    resolved_entity, source
                ));
            }
        }
        code
    }

    pub(crate) fn emit_success_js(
        &self,
        emit: &Option<orbital_core::ir::OirEmitConfig>,
        event_key: &str,
        result_var: &str,
        indent: &str,
    ) -> String {
        self.emit_success_js_impl(emit, event_key, result_var, indent, None)
    }

    /// `emit_success_js` plus a cross-client SSE broadcast of the same emit —
    /// used ONLY by `generate_persist_block`'s create/update/delete success
    /// sites (see `Almadar_Live_Push.md`). `broadcast_entity_type` is
    /// `Some(<entity>)` (never inferred, always the CALLER's own
    /// `resolved_entity`) when the caller's effect variant is a persist —
    /// `None` for fetch/ref/call-service/set, per the no-heuristics rule.
    /// Stamped onto the broadcast item's `entityType` so `sse.ts`'s
    /// `broadcastBusEvent` (§88) can look up that entity's `@read` policy
    /// per connection before relaying the row.
    pub(crate) fn emit_success_js_impl(
        &self,
        emit: &Option<orbital_core::ir::OirEmitConfig>,
        event_key: &str,
        result_var: &str,
        indent: &str,
        broadcast_entity_type: Option<&str>,
    ) -> String {
        let Some(cfg) = emit else {
            return String::new();
        };
        let event_name = match event_key {
            "success" => cfg.success.as_deref(),
            "on_change" => cfg.on_change.as_deref(),
            "on_message" => cfg.on_message.as_deref(),
            _ => None,
        };
        match event_name {
            // The result_var (e.g. `serviceResult` from callService) may be
            // typed as `unknown` by the surrounding lowering. Cast to the
            // typed payload slots inline so consumers don't have to worry
            // about the source type. EventPayload is the bus's payload
            // type; both the `payload:` field and the bus.emit second arg
            // expect it.
            // Normalize the result value at the wire boundary: object
            // shapes pass through (already EventPayload-compatible);
            // arrays/primitives wrap in `{ result: v }` so the
            // EventPayload `{ [key]: EventPayloadValue }` constraint
            // holds without an `as unknown as` cast. Same runtime
            // semantics — consumers reading `@payload.X` from object
            // results keep working; array/primitive results gain a
            // single `result` key.
            Some(name) => {
                // Broadcast reuses `__evP` — computed once, inside the same
                // block — so origin-excluded peers see the identical payload
                // the response cascade delivers to the origin client.
                let broadcast_stmt = if let Some(entity_type) = broadcast_entity_type {
                    format!(
                        "broadcastBusEvent(clientId, {{ type: 'bus', event: '{n}', payload: __evP, source: __ORBITAL_SOURCE, timestamp: Date.now(), entityType: '{et}' }}); ",
                        n = name,
                        et = entity_type,
                    )
                } else {
                    String::new()
                };
                format!(
                    "{i}{{ const __evV: EventPayloadValue | undefined = ({v}) as EventPayloadValue | undefined; const __evP: EventPayload = (__evV !== null && __evV !== undefined && typeof __evV === 'object' && !Array.isArray(__evV) && !(__evV instanceof Date)) ? (__evV as EventPayload) : ({{ result: __evV }} as EventPayload); emittedEvents.push({{ event: '{n}', payload: __evP, source: __ORBITAL_SOURCE }}); getServerEventBus().emit('{n}', __evP, __ORBITAL_SOURCE); {broadcast}}}\n{i}effectsLog.debug('emit:push', {{ event: '{n}', cumulativeEmittedCount: emittedEvents.length, sourceTrait: __ORBITAL_SOURCE.trait, sourceOrbital: __ORBITAL_SOURCE.orbital }});\n",
                    i = indent,
                    n = name,
                    v = result_var,
                    broadcast = broadcast_stmt,
                )
            }
            None => String::new(),
        }
    }

    /// Emit the declared `emit.cancelled` event for a keyed `call-service`
    /// that was aborted: payload `{ key }`, same wire mechanics as the other
    /// emits. Nothing when no `cancelled` event is declared.
    pub(crate) fn emit_cancelled_js(
        &self,
        emit: &Option<orbital_core::ir::OirEmitConfig>,
        indent: &str,
    ) -> String {
        let Some(name) = emit.as_ref().and_then(|c| c.cancelled.as_deref()) else {
            return String::new();
        };
        format!(
            "{i}{{ const __evC: EventPayload = {{ key: __callKey }}; emittedEvents.push({{ event: '{n}', payload: __evC, source: __ORBITAL_SOURCE }}); getServerEventBus().emit('{n}', __evC, __ORBITAL_SOURCE); }}\n{i}effectsLog.debug('emit:push', {{ event: '{n}', cumulativeEmittedCount: emittedEvents.length, sourceTrait: __ORBITAL_SOURCE.trait, sourceOrbital: __ORBITAL_SOURCE.orbital }});\n",
            i = indent,
            n = name,
        )
    }

    /// Emit the configured `emit.failure` event for a persist effect that did
    /// NOT land (access denied, resolved-but-missing row, or an unresolved
    /// row key). Mirrors `emit_success_js_impl`'s wire mechanics — pushed
    /// onto `emittedEvents` (the response's client-bridge echo) AND fired on
    /// `getServerEventBus()` — so a declared failure event reaches the same
    /// places a declared success event would. Never broadcasts over SSE: a
    /// failure is per-request, not a state change worth relaying to peers.
    /// `error_expr` is a TS expression producing the message (a string
    /// literal or template literal); `extra_fields_js` is inserted verbatim
    /// after `error: <error_expr>` (e.g. `", code: 'not-found'"`, or `""`).
    pub(crate) fn emit_failure_js_impl(
        &self,
        emit: &Option<orbital_core::ir::OirEmitConfig>,
        error_expr: &str,
        extra_fields_js: &str,
        indent: &str,
    ) -> String {
        let Some(cfg) = emit else {
            return String::new();
        };
        let Some(name) = cfg.failure.as_deref() else {
            return String::new();
        };
        format!(
            "{i}{{ const __evF: EventPayload = {{ error: {e}{extra} }}; emittedEvents.push({{ event: '{n}', payload: __evF, source: __ORBITAL_SOURCE }}); getServerEventBus().emit('{n}', __evF, __ORBITAL_SOURCE); }}\n{i}effectsLog.debug('emit:push', {{ event: '{n}', cumulativeEmittedCount: emittedEvents.length, sourceTrait: __ORBITAL_SOURCE.trait, sourceOrbital: __ORBITAL_SOURCE.orbital }});\n",
            i = indent,
            e = error_expr,
            extra = extra_fields_js,
            n = name,
        )
    }
}

#[cfg(test)]
mod v4_rename_equivalence {
    //! V4 Phase 4 payoff: two schemas identical except a node's DISPLAY NAME
    //! changed (curName differs, id unchanged, ledger records the rename) must
    //! produce equivalent generated wiring — the trait→entity / page→trait joins
    //! resolve to the SAME node in both, with no broken join.
    use crate::backend::TypeScriptBackend;
    use orbital_core::ir::{OirEntity, OirModule, OirTrait};

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

        let mut side_map = orbital_core::ir::OirIdMap::new();
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
        let empty = orbital_core::ir::OirIdMap::new();
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
    use orbital_core::ir::{OirCardinality, OirEntity, OirField, OirModule, OirRelation, OirType};

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

fn value_uses_messages(value: &orbital_core::ir::OirValue) -> bool {
    use orbital_core::ir::OirValue;
    match value {
        OirValue::String(s) => s == "@locale",
        OirValue::Array(items) => {
            matches!(items.first(), Some(OirValue::String(op)) if op == orbital_core::messages::TRANSLATE_OP)
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
        expr.calls_function(orbital_core::messages::TRANSLATE_OP)
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
