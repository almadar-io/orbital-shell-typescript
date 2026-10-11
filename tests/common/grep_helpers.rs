//! Grep-gate helpers shared by `gate_grepwall.rs` and orbital-rust's
//! `orbital-integration-tests/tests/workspace_grepwall.rs`.
#![allow(dead_code)]

/// Count non-overlapping occurrences of `needle` in `hay`.
pub fn count(hay: &str, needle: &str) -> usize {
    hay.matches(needle).count()
}

/// Strip `#[cfg(test)]` blocks from a Rust source string.
///
/// Finds each `#[cfg(test)]` annotation, then erases everything from that point
/// until the matching closing brace (tracked by a depth counter), replacing the
/// block with a blank placeholder so line offsets are roughly preserved.
pub fn strip_test_blocks(src: &str) -> String {
    // Brace counting must ignore braces inside string literals, char
    // literals and comments — a test fixture such as `"z.object({\n"` would
    // otherwise leave the counter unbalanced and erase the rest of the input.
    let b = src.as_bytes();
    let marker = b"#[cfg(test)]";
    let mut out = String::with_capacity(src.len());
    let mut i = 0;
    while i < b.len() {
        if !b[i..].starts_with(marker) {
            out.push(b[i] as char);
            i += 1;
            continue;
        }
        let start = i;
        i += marker.len();
        while i < b.len() && b[i] != b'{' {
            i += 1;
        }
        let mut depth = 0usize;
        while i < b.len() {
            let c = b[i];
            if c == b'/' && i + 1 < b.len() && b[i + 1] == b'/' {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            } else if c == b'/' && i + 1 < b.len() && b[i + 1] == b'*' {
                i += 2;
                while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                    i += 1;
                }
                i += 2;
            } else if c == b'\'' {
                if i + 1 < b.len() && b[i + 1] == b'\\' {
                    let mut j = i + 2;
                    while j < b.len() && b[j] != b'\'' {
                        j += 1;
                    }
                    i = j + 1;
                } else if i + 2 < b.len() && b[i + 2] == b'\'' {
                    i += 3;
                } else {
                    i += 1;
                }
            } else if c == b'"' {
                // raw string? look back for r / r# prefix
                let mut hashes = 0;
                let mut k = i;
                while k > 0 && b[k - 1] == b'#' {
                    hashes += 1;
                    k -= 1;
                }
                let raw = k > 0 && b[k - 1] == b'r';
                i += 1;
                if raw {
                    loop {
                        if i >= b.len() {
                            break;
                        }
                        if b[i] == b'"' {
                            let mut m = 0;
                            while m < hashes && i + 1 + m < b.len() && b[i + 1 + m] == b'#' {
                                m += 1;
                            }
                            if m == hashes {
                                i += 1 + hashes;
                                break;
                            }
                        }
                        i += 1;
                    }
                } else {
                    while i < b.len() && b[i] != b'"' {
                        if b[i] == b'\\' {
                            i += 1;
                        }
                        i += 1;
                    }
                    i += 1;
                }
            } else if c == b'{' {
                depth += 1;
                i += 1;
            } else if c == b'}' {
                depth -= 1;
                i += 1;
                if depth == 0 {
                    break;
                }
            } else {
                i += 1;
            }
        }
        // Emit blanks for the erased region so character offsets stay sane.
        out.push_str(&" ".repeat(i - start));
    }
    out
}

/// Positions where `unknown` / `any` is used as a TypeScript TYPE inside
/// `text` (a type annotation, generic argument, cast target, or array
/// element), as opposed to prose. The classification is positional, not a
/// word list: the token is a type when it is preceded by `:` `<` `,` `(`
/// `|` `&` `=` or the word `as`, or followed by `>` `)` `;` `[` `|` `,`
/// `&` `}` or the end of the text.
pub fn ts_escape_hatch_uses(text: &str) -> Vec<String> {
    let b = text.as_bytes();
    let is_ident = |c: u8| c.is_ascii_alphanumeric() || c == b'_' || c == b'$';
    let mut uses = Vec::new();
    for tok in ["unknown", "any"] {
        let mut from = 0;
        while let Some(off) = text[from..].find(tok) {
            let s = from + off;
            let e = s + tok.len();
            from = e;
            if (s > 0 && is_ident(b[s - 1])) || (e < b.len() && is_ident(b[e])) {
                continue;
            }
            let before: String = text[..s]
                .trim_end()
                .chars()
                .rev()
                .take(2)
                .collect::<String>()
                .chars()
                .rev()
                .collect();
            let after = text[e..].trim_start().chars().next();
            let prev = before.chars().last();
            let prev_is_type_ctx =
                matches!(prev, Some(':' | '<' | ',' | '(' | '|' | '&' | '=')) || before == "as";
            let next_is_type_ctx = matches!(
                after,
                None | Some('>' | ')' | ';' | '[' | '|' | ',' | '&' | '}')
            );
            if prev_is_type_ctx || next_is_type_ctx {
                let lo = s.saturating_sub(40);
                let hi = (e + 40).min(text.len());
                uses.push(format!("`{tok}` in …{}…", &text[lo..hi].replace('\n', "⏎")));
            }
        }
    }
    uses
}
