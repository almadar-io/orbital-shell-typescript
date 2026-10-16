//! TS identifier / member-name helpers. Lives here (not under the deleted
//! `sexpr_to_ts/`) because the OirExpr/backend emitters use `ts_member_name`
//! to quote object-/interface-member names that aren't valid identifiers.

use crate::backend::escape_js_string;

/// Whether `s` is a valid JavaScript identifier.
fn is_valid_identifier(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) if first.is_alphabetic() || first == '_' || first == '$' => {
            chars.all(|c| c.is_alphanumeric() || c == '_' || c == '$')
        }
        _ => false,
    }
}

/// A TS object-/interface-member name: bare when it is a valid identifier,
/// quoted otherwise. The single helper every member-position emission uses
/// (object literals, payload interfaces, inline `as { … }` type literals) so
/// an invalid name — e.g. a dotted `row.category` — can never emit
/// unparseable TS.
pub(crate) fn ts_member_name(name: &str) -> String {
    if is_valid_identifier(name) {
        name.to_string()
    } else {
        format!("\"{}\"", escape_js_string(name))
    }
}

/// One optional-chain step for a binding-path segment (EXEC binding-path): an identifier
/// reads `?.name`; a canonical number indexes (`?.[0]`); anything else (a literal
/// bracket key such as `items[0]`) is one quoted key (`?.["items[0]"]`).
pub(crate) fn opt_step(seg: &str) -> String {
    let canonical_index = !seg.is_empty()
        && seg.bytes().all(|b| b.is_ascii_digit())
        && (seg == "0" || !seg.starts_with('0'));
    if canonical_index {
        format!("?.[{seg}]")
    } else if is_valid_identifier(seg) {
        format!("?.{seg}")
    } else {
        format!("?.[\"{}\"]", escape_js_string(seg))
    }
}

/// [`opt_step`] over every segment of a binding path.
pub(crate) fn opt_path<S: AsRef<str>>(segs: &[S]) -> String {
    segs.iter().map(|s| opt_step(s.as_ref())).collect()
}

/// A TS DECLARATION-position name (interface / type / function), where quoting
/// is not available: bare when already a valid identifier (preserving every
/// existing generated name verbatim), Pascal-collapsed otherwise — so an event
/// key that is not identifier-safe (e.g. an unbound `@config.<knob>` outlet
/// surviving into codegen) still yields a parseable symbol instead of
/// `interface Foo@config.barPayload`.
pub(crate) fn ts_symbol_name(name: &str) -> String {
    if is_valid_identifier(name) {
        name.to_string()
    } else {
        orbital_core_base::str_utils::to_identifier_pascal(name)
    }
}
