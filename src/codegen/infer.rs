//! Array element-type inference for lambda parameter typing. Lives here (not
//! under `sexpr_to_ts/`) because the OirExpr path (`expr.rs`, `operator.rs`,
//! `guard.rs`) depends on `infer_oirexpr_element_type_ts`; the SExpression-side
//! `infer_array_element_type_ts` is used only by the legacy emitter and goes
//! away with it.

use crate::codegen::CodegenContext;
use orbital_core_base::ir::{OirEntity, OirType};

/// What the operator table decides an argument's emission from — read off the OIR, never
/// off the emitted text: whether it is never nullish, a definite number / array / string,
/// a boolean or object literal, a lambda (its parameters), or a literal embedding a lambda.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct ArgFacts {
    pub never_nullish: bool,
    pub number: bool,
    pub array: bool,
    pub string: bool,
    pub bool_literal: Option<bool>,
    pub object_literal: bool,
    pub lambda_params: Option<Vec<String>>,
    pub embeds_lambda: bool,
    pub string_value: Option<String>,
}

pub(crate) fn arg_facts(expr: &orbital_core_base::ir::OirExpr) -> ArgFacts {
    use orbital_core_base::ir::{OirBinaryOp, OirBindingRoot, OirExpr, OirUnaryOp};
    let returns = |name: &str, kinds: &[&str]| {
        orbital_core_base::language::canonical_operators::get_canonical_operator(name)
            .is_some_and(|meta| meta.return_semantics.is_none() && kinds.contains(&meta.return_type))
    };
    let number = match expr {
        OirExpr::Number { .. } => true,
        OirExpr::BinaryOp { op, .. } => {
            matches!(op, OirBinaryOp::Add | OirBinaryOp::Sub | OirBinaryOp::Mul | OirBinaryOp::Div | OirBinaryOp::Mod)
        }
        OirExpr::UnaryOp { op: OirUnaryOp::Neg, .. } => true,
        OirExpr::Binding { binding } => matches!(&binding.root, OirBindingRoot::Local(n) if n == "now") && binding.path.is_empty(),
        OirExpr::Call { function, .. } => returns(function, &["number", "integer"]),
        _ => false,
    };
    let array = match expr {
        OirExpr::Array { .. } | OirExpr::Map { .. } | OirExpr::Filter { .. } => true,
        OirExpr::Call { function, .. } => operator_returns_array(function),
        OirExpr::Conditional { then_branch, else_branch, .. } => {
            arg_facts(then_branch).array && arg_facts(else_branch).array
        }
        _ => false,
    };
    let string = match expr {
        OirExpr::String { .. } => true,
        OirExpr::Call { function, .. } => returns(function, &["string"]),
        OirExpr::Binding { binding } => is_locale_binding(binding),
        OirExpr::Conditional { then_branch, else_branch, .. } => {
            arg_facts(then_branch).string && arg_facts(else_branch).string
        }
        _ => false,
    };
    ArgFacts {
        never_nullish: number || oir_expr_ts_never_nullish(expr),
        number,
        array,
        string,
        bool_literal: match expr {
            OirExpr::Bool { value } => Some(*value),
            _ => None,
        },
        object_literal: matches!(expr, OirExpr::Object { .. }),
        lambda_params: match expr {
            OirExpr::Lambda { params, .. } => Some(params.clone()),
            _ => None,
        },
        embeds_lambda: matches!(expr, OirExpr::Array { .. } | OirExpr::Object { .. }) && contains_lambda(expr),
        string_value: match expr {
            OirExpr::String { value } => Some(value.clone()),
            _ => None,
        },
    }
}

/// `@locale` — the viewer's locale, a definite string on every side (the view's
/// `useTranslate()` locale, the server's request locale).
fn is_locale_binding(binding: &orbital_core_base::ir::OirBinding) -> bool {
    matches!(binding.root, orbital_core_base::ir::OirBindingRoot::Locale) && binding.path.is_empty()
}

/// Coerce compiled TS to a `string` from what the OIR expression IS: a string as is,
/// a never-nullish value through `String(…)`, anything else through `String(… ?? '')`.
pub(crate) fn string_coerce_for(expr: &orbital_core_base::ir::OirExpr, compiled: &str) -> String {
    let facts = arg_facts(expr);
    let t = compiled.trim_start();
    // Folded to a literal at codegen (a literal-knob conditional): already a string.
    if facts.string || t.starts_with('"') || t.starts_with('\'') || t.starts_with('`') {
        compiled.to_string()
    } else if facts.never_nullish {
        format!("String({compiled})")
    } else {
        format!("String({compiled} ?? '')")
    }
}

fn contains_lambda(expr: &orbital_core_base::ir::OirExpr) -> bool {
    use orbital_core_base::ir::OirExpr;
    match expr {
        OirExpr::Lambda { .. } => true,
        OirExpr::Array { items } => items.iter().any(contains_lambda),
        OirExpr::Object { fields } => fields.values().any(contains_lambda),
        _ => false,
    }
}

/// Whether operator `name` is declared (registry `returnType`) to return an array —
/// the one rule for trusting a call as a typed array source of `.map`/`.filter`.
pub(crate) fn operator_returns_array(name: &str) -> bool {
    orbital_core_base::language::canonical_operators::get_canonical_operator(name)
        .is_some_and(|meta| meta.return_type == "array")
}

/// Whether the TypeScript this backend emits for `expr` is syntactically never
/// nullish — TypeScript's own rule (TS2869 flags a `?? fallback` on such a left
/// operand): literals, array/object literals, lambdas, arithmetic/comparison/
/// concat/not/negate, and a conditional whose branches all are. A binding, an
/// `and`/`or`, or a call is not (a call's result is opaque to that rule), except an
/// operator the registry declares as returning a definite number, string or boolean.
pub(crate) fn oir_expr_ts_never_nullish(expr: &orbital_core_base::ir::OirExpr) -> bool {
    use orbital_core_base::ir::{OirBinaryOp, OirExpr};
    match expr {
        OirExpr::Binding { binding } if is_locale_binding(binding) => true,
        OirExpr::Null | OirExpr::Binding { .. } | OirExpr::Effect { .. } => false,
        OirExpr::Bool { .. }
        | OirExpr::Number { .. }
        | OirExpr::String { .. }
        | OirExpr::Array { .. }
        | OirExpr::Object { .. }
        | OirExpr::Lambda { .. }
        | OirExpr::UnaryOp { .. } => true,
        OirExpr::BinaryOp { op, .. } => !matches!(op, OirBinaryOp::And | OirBinaryOp::Or),
        OirExpr::Conditional { then_branch, else_branch, .. } => {
            oir_expr_ts_never_nullish(then_branch) && oir_expr_ts_never_nullish(else_branch)
        }
        OirExpr::Map { .. } | OirExpr::Filter { .. } => true,
        OirExpr::Reduce { .. } => false,
        // `(object/get o k d)` emits `(getNestedValue(o, k) ?? d)`.
        OirExpr::Call { function, args } if function == "object/get" && args.len() == 3 => {
            oir_expr_ts_never_nullish(&args[2])
        }
        OirExpr::Call { function, .. } => {
            orbital_core_base::language::canonical_operators::get_canonical_operator(function)
                .is_some_and(|meta| meta.return_semantics.is_none() && matches!(meta.return_type, "number" | "string" | "boolean"))
        }
    }
}

/// OirExpr-side analog of `infer_array_element_type_ts`. Used by the
/// OirExpr::Call dispatch path (expr.rs) and guard.rs where args are
/// `OirExpr`, not `SExpression`. Resolution rules mirror the
/// SExpression-side function for parity.
pub fn infer_oirexpr_element_type_ts(
    expr: &orbital_core_base::ir::OirExpr,
    ctx: &CodegenContext,
) -> Option<String> {
    use orbital_core_base::ir::{OirBindingRoot, OirExpr};
    match expr {
        OirExpr::Binding { binding } => match &binding.root {
            OirBindingRoot::Entity => {
                if binding.path.is_empty() {
                    ctx.linked_entity_name.clone()
                } else {
                    let linked_name = ctx.linked_entity_name.as_ref()?;
                    let entity = ctx.entity_catalog.get(linked_name)?;
                    let path: Vec<&str> = binding.path.iter().map(|s| s.as_str()).collect();
                    walk_field_path_array_inner(entity, &path, ctx)
                }
            }
            OirBindingRoot::Payload => {
                if binding.path.is_empty() {
                    return None;
                }
                let schema = ctx.current_payload_schema.as_ref()?;
                let head_ty = schema.get(&binding.path[0])?;
                let rest: Vec<&str> = binding.path[1..].iter().map(|s| s.as_str()).collect();
                walk_oirtype_path_array_inner(head_ty, &rest, ctx)
            }
            OirBindingRoot::Config => {
                let head_ty = ctx.current_config_schema.as_ref()?.get(binding.path.first()?)?;
                let rest: Vec<&str> = binding.path[1..].iter().map(|s| s.as_str()).collect();
                walk_oirtype_path_array_inner(head_ty, &rest, ctx)
            }
            OirBindingRoot::Local(name) => {
                if name.chars().next().is_some_and(|c| c.is_uppercase())
                    && ctx.entity_catalog.contains_key(name)
                {
                    Some(name.clone())
                } else {
                    None
                }
            }
            _ => None,
        },
        OirExpr::Filter { source, .. } => infer_oirexpr_element_type_ts(source, ctx),
        OirExpr::Call { function, args } => match function.as_str() {
            "array/filter" | "filter" | "array/sort" | "sort" | "array/reverse" | "reverse"
            | "array/slice" | "slice" | "array/take" | "take" | "array/drop" | "drop"
            | "array/takeLast" | "array/dropLast" | "array/remove" | "array/shuffle"
            | "array/unique" | "unique" | "array/concat"
                if !args.is_empty() =>
            {
                infer_oirexpr_element_type_ts(&args[0], ctx)
            }
            _ => None,
        },
        _ => None,
    }
}

/// Walk a dotted field path through a starting OirEntity, descending into
/// referenced entities, and return the TS element type of the LAST
/// segment if it lands on an `Array { inner }`. Returns `None` if any
/// segment is missing or the terminus isn't an array.
fn walk_field_path_array_inner(
    entity: &OirEntity,
    path: &[&str],
    ctx: &CodegenContext,
) -> Option<String> {
    if path.is_empty() {
        return None;
    }
    let field = entity.find_field(path[0])?;
    if path.len() == 1 {
        return array_inner_ts(&field.field_type, ctx);
    }
    // Descend into a referenced entity
    let next_entity_name = match &field.field_type {
        OirType::Reference { entity } | OirType::Row { entity } => entity.clone(),
        OirType::Array { inner } => match inner.as_ref() {
            OirType::Reference { entity } | OirType::Row { entity } => entity.clone(),
            _ => return None,
        },
        OirType::Optional { inner } => match inner.as_ref() {
            OirType::Reference { entity } | OirType::Row { entity } => entity.clone(),
            _ => return None,
        },
        _ => return None,
    };
    let next_entity = ctx.entity_catalog.get(&next_entity_name)?;
    walk_field_path_array_inner(next_entity, &path[1..], ctx)
}

/// Walk a dotted field path through an OirType, returning the TS element
/// type when the terminus is `Array { inner }`.
fn walk_oirtype_path_array_inner(
    ty: &OirType,
    path: &[&str],
    ctx: &CodegenContext,
) -> Option<String> {
    if path.is_empty() {
        return array_inner_ts(ty, ctx);
    }
    // To descend, the type must be a Struct or a Reference to an entity.
    match ty {
        OirType::Struct { fields } => {
            let field = fields.iter().find(|f| f.name == path[0])?;
            walk_oirtype_path_array_inner(&field.field_type, &path[1..], ctx)
        }
        OirType::Reference { entity } | OirType::Row { entity } => {
            let e = ctx.entity_catalog.get(entity)?;
            walk_field_path_array_inner(e, path, ctx)
        }
        OirType::Optional { inner } | OirType::Array { inner } => {
            walk_oirtype_path_array_inner(inner, path, ctx)
        }
        _ => None,
    }
}

/// If `ty` is `Array { inner }` (or `Optional<Array>`), return the TS element
/// type. Otherwise None. `oirtype_to_ts` (Inferred mode) now widens a `Json`
/// element to `EntityRow` directly, so the former `EventPayloadValue →
/// EntityRow` substitution patch is gone. No field-level enum info is in scope
/// at an array element, so `enum_values` is `None`.
fn array_inner_ts(ty: &OirType, ctx: &CodegenContext) -> Option<String> {
    match ty {
        OirType::Array { inner } => Some(ctx.oirtype_to_ts(inner, None)),
        OirType::Optional { inner } => array_inner_ts(inner, ctx),
        _ => None,
    }
}

#[cfg(test)]
mod never_nullish_tests {
    use super::oir_expr_ts_never_nullish;
    use orbital_core_base::ir::{OirBinding, OirExpr};

    fn bind(s: &str) -> OirExpr {
        OirExpr::binding(OirBinding::parse(s).unwrap())
    }

    #[test]
    fn literals_arithmetic_and_literal_conditionals_are_never_nullish() {
        assert!(oir_expr_ts_never_nullish(&OirExpr::string("a")));
        assert!(oir_expr_ts_never_nullish(&OirExpr::sub(OirExpr::number(600.0), bind("@entity.r"))));
        assert!(oir_expr_ts_never_nullish(&OirExpr::if_then_else(bind("@entity.on"), OirExpr::string("a"), OirExpr::string("b"))));
        assert!(oir_expr_ts_never_nullish(&OirExpr::call("str/concat", vec![bind("@entity.a")])), "a definite-string operator");
    }

    #[test]
    fn bindings_null_branches_and_opaque_calls_may_be_nullish() {
        assert!(!oir_expr_ts_never_nullish(&bind("@entity.r")));
        assert!(!oir_expr_ts_never_nullish(&OirExpr::if_then_else(bind("@entity.on"), OirExpr::string("a"), OirExpr::null())));
        assert!(!oir_expr_ts_never_nullish(&OirExpr::call("object/get", vec![bind("@entity.a"), OirExpr::string("x")])));
        assert!(!oir_expr_ts_never_nullish(&OirExpr::call("array/first", vec![bind("@entity.a")])), "an element-of result may be undefined");
    }
}

#[cfg(test)]
mod arg_facts_tests {
    use super::arg_facts;
    use orbital_core_base::ir::{OirBinding, OirExpr};

    fn bind(s: &str) -> OirExpr {
        OirExpr::binding(OirBinding::parse(s).unwrap())
    }

    /// What `call_to_ts_typed` decides from — read off the OIR, never off emitted text.
    #[test]
    fn facts_come_from_the_expression() {
        let n = arg_facts(&OirExpr::sub(OirExpr::number(600.0), bind("@entity.r")));
        assert!(n.number && n.never_nullish && !n.array && !n.string);
        let now = arg_facts(&bind("@now"));
        assert!(now.number && now.never_nullish, "`now` is a number");
        let arr = arg_facts(&OirExpr::call("object/keys", vec![bind("@entity.a")]));
        assert!(arr.array && !arr.number);
        assert!(arg_facts(&OirExpr::array(vec![OirExpr::number(1.0)])).array);
        let s = arg_facts(&OirExpr::string("a.b"));
        assert!(s.string && s.never_nullish);
        assert_eq!(arg_facts(&OirExpr::bool(true)).bool_literal, Some(true));
        assert_eq!(s.string_value.as_deref(), Some("a.b"));
        let defaulted = arg_facts(&OirExpr::call("object/get", vec![bind("@entity.a"), OirExpr::string("xs"), OirExpr::array(vec![])]));
        assert!(defaulted.never_nullish, "an object/get with a never-nullish default");
        assert!(!arg_facts(&OirExpr::call("object/get", vec![bind("@entity.a"), OirExpr::string("xs")])).never_nullish);
        let obj = arg_facts(&OirExpr::object(orbital_core_base::ir::OirFields::from([("done".to_string(), OirExpr::bool(true))])));
        assert!(obj.object_literal && !obj.embeds_lambda);
        let lam = arg_facts(&OirExpr::lambda(vec!["row".to_string()], bind("@row.x")));
        assert_eq!(lam.lambda_params, Some(vec!["row".to_string()]));
        let with_fn = arg_facts(&OirExpr::array(vec![OirExpr::object(orbital_core_base::ir::OirFields::from([(
            "filter".to_string(),
            OirExpr::lambda(vec!["r".to_string()], OirExpr::bool(true)),
        )]))]));
        assert!(with_fn.embeds_lambda, "a literal embedding a lambda");
    }

    #[test]
    fn control_an_opaque_binding_has_no_facts() {
        let f = arg_facts(&bind("@entity.items"));
        assert!(!f.never_nullish && !f.number && !f.array && !f.string && f.lambda_params.is_none() && f.bool_literal.is_none());
    }
}

#[cfg(test)]
mod never_nullish_coercion_tests {
    use super::*;
    use orbital_core_base::ir::{OirBinding, OirBindingRoot, OirExpr};

    fn s(v: &str) -> OirExpr {
        OirExpr::String { value: v.into() }
    }
    fn cond(a: OirExpr, b: OirExpr) -> OirExpr {
        OirExpr::Conditional { condition: Box::new(OirExpr::Bool { value: true }), then_branch: Box::new(a), else_branch: Box::new(b) }
    }
    fn binding(root: OirBindingRoot) -> OirExpr {
        OirExpr::Binding { binding: OirBinding { root, path: vec![] } }
    }

    /// G-ORB-189(b): `(navigate (if c "/a" "/b"))` and `@locale` are definite strings, so
    /// a `?? ''` on them is TS2869.
    #[test]
    fn a_conditional_of_strings_and_the_locale_coerce_without_a_nullish_guard() {
        assert_eq!(string_coerce_for(&cond(s("/"), s("/ar")), "(c ? \"/\" : \"/ar\")"), "(c ? \"/\" : \"/ar\")");
        assert_eq!(string_coerce_for(&binding(OirBindingRoot::Locale), "__locale"), "__locale");
        assert!(arg_facts(&cond(OirExpr::Array { items: vec![] }, OirExpr::Array { items: vec![s("x")] })).array);
    }

    /// std-board's `dragGroup: (if @config.draggable @col.key "")` with a literal `false`
    /// knob compiles to `""`: the expression is not string-typed, the compiled text is.
    #[test]
    fn a_conditional_compiled_to_a_string_literal_is_left_alone() {
        assert_eq!(string_coerce_for(&cond(binding(OirBindingRoot::Payload), s("")), "\"\""), "\"\"");
    }

    #[test]
    fn control_a_payload_read_keeps_the_guard() {
        assert_eq!(string_coerce_for(&binding(OirBindingRoot::Payload), "payloadObj"), "String(payloadObj ?? '')");
        assert_eq!(string_coerce_for(&cond(s("/"), binding(OirBindingRoot::Payload)), "x"), "String(x ?? '')");
        assert!(!arg_facts(&cond(OirExpr::Array { items: vec![] }, binding(OirBindingRoot::Payload))).array);
    }
}
