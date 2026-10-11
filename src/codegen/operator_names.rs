//! Operator-name detection. Lives here (not under `sexpr_to_ts/`) because both
//! the OirExpr emitter and the render-prop walker depend on it, independent of
//! the legacy SExpression emission tree.

use orbital_core::language::canonical_operators::is_canonical_operator;

/// Check if a string looks like an S-expression operator name.
/// Uses the canonical operator registry as the primary source of truth,
/// with fallbacks for symbolic operators and namespace conventions.
pub fn is_operator_name(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }

    // Single-character symbolic operators (+, -, *, /, <, >, =, etc.)
    if s.len() == 1 {
        return matches!(
            s.chars().next().unwrap(),
            '+' | '-' | '*' | '/' | '%' | '<' | '>' | '=' | '!' | '&' | '|'
        );
    }

    // Multi-character symbolic operators
    if matches!(s, "==" | "!=" | "<>" | "<=" | ">=" | "&&" | "||") {
        return true;
    }

    // Namespace separator means it's an operator (array/map, str/concat, etc.)
    if s.contains('/') {
        return true;
    }

    // Operator-specific punctuation (empty?, assert!)
    if s.contains('?') || s.ends_with('!') {
        return true;
    }

    // Language keywords used as operators (not in canonical registry)
    if matches!(s, "fn" | "lambda" | "let" | "do" | "if" | "when" | "cond") {
        return true;
    }

    // Short-name operators that exist in the compile_operator_call match
    // but aren't in the canonical registry or namespaced
    if matches!(
        s,
        "upper"
            | "uppercase"
            | "lower"
            | "lowercase"
            | "trim"
            | "split"
            | "join"
            | "unique"
            | "keys"
            | "values"
            | "merge"
            | "now"
            | "isBefore"
            | "isAfter"
            | "required"
            | "minLength"
            | "maxLength"
            | "min"
            | "max"
            | "abs"
            | "round"
            | "floor"
            | "ceil"
            | "clamp"
            | "not"
            | "and"
            | "or"
            | "includes"
            | "contains"
            | "first"
            | "last"
            | "sum"
            | "map"
            | "filter"
            | "reduce"
            | "find"
            | "some"
            | "every"
            | "sort"
            | "reverse"
            | "length"
            | "count"
            | "get"
            | "set"
            | "typeof"
            | "toString"
            | "toNumber"
            | "parseInt"
            | "parseFloat"
    ) {
        return true;
    }

    // Canonical operator registry (auto-generated from operators.json)
    is_canonical_operator(s)
}

/// Whether `name` is a substrate operator. Delegates to the canonical
/// `orbital_core::ir::is_substrate_operator` — the single source of truth
/// shared with the compiler and the Python shell (C-EMIT-SUBSTRATE-OPS-MARKER).
pub fn is_substrate_operator(name: &str) -> bool {
    orbital_core::ir::is_substrate_operator(name)
}
