//! S-expression operator → TypeScript translation table.
//!
//! Shared by Express (`backend.rs`) and Hono (`backend_hono.rs`):
//! operator translation is framework-agnostic. Covers the full
//! `packages/almadar-operators/operators.json` set of std-* operators
//! (arithmetic, collection, string, time, validate, format, etc.).
//!
//! Extracted from `backend.rs` as Phase 3e.3 of the DRY refactor.

use crate::backend::TypeScriptBackend;

pub(crate) struct CoreOperatorDependencies {
    pub(crate) operator: &'static str,
    pub(crate) imports: &'static [&'static str],
    pub(crate) intrinsics: &'static [&'static str],
    pub(crate) arity: usize,
    pub(crate) max_arity: usize,
    pub(crate) arity_constructor: &'static str,
}

impl CoreOperatorDependencies {
    pub(crate) fn accepts(&self, count: usize) -> bool {
        (self.arity..=self.max_arity).contains(&count)
    }

    fn arity_error(&self) -> String {
        let expected = match self.arity {
            1 => "one argument",
            2 => "two arguments",
            3 => "three arguments",
            _ => unreachable!(),
        };
        let expected = if self.max_arity > self.arity {
            format!("between {} and {} arguments", self.arity, self.max_arity)
        } else {
            format!("exactly {expected}")
        };
        format!(
            "((): never => {{ throw new {}('Invalid argument: {}: expected {expected}'); }})()",
            self.arity_constructor, self.operator
        )
    }
}

const TIME_PARSE_TS: &str = "((__v: EventPayloadValue | undefined): number => { if (typeof __v !== 'string') throw new TypeError('Type mismatch: expected string, got ' + (__v == null ? 'null' : Array.isArray(__v) ? 'array' : typeof __v)); const __m = /^(\\d{4})-(\\d{2})-(\\d{2})(?:T(\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d+))?)?(Z|[+-]\\d{2}:\\d{2})?)?$/.exec(__v); if (__m === null) throw new Error('time/parse: \"' + __v + '\" is not an ISO 8601 date or date-time'); const __y = Number(__m[1]); const __mo = Number(__m[2]); const __dy = Number(__m[3]); const __d = new Date(0); __d.setUTCFullYear(__y, __mo - 1, __dy); __d.setUTCHours(0, 0, 0, 0); if (__d.getUTCFullYear() !== __y || __d.getUTCMonth() !== __mo - 1 || __d.getUTCDate() !== __dy) throw new Error('time/parse: \"' + __v + '\" is not a calendar date'); const __h = Number(__m[4] ?? 0); const __mi = Number(__m[5] ?? 0); const __s = Number(__m[6] ?? 0); const __ms = Number((__m[7] ?? '0').slice(0, 3).padEnd(3, '0')); if (__h > 23 || __mi > 59 || __s > 59) throw new Error('time/parse: \"' + __v + '\" has a time of day out of range'); let __off = 0; const __z = __m[8]; if (__z !== undefined && __z !== 'Z') { const __oh = Number(__z.slice(1, 3)); const __om = Number(__z.slice(4, 6)); if (__oh > 23 || __om > 59) throw new Error('time/parse: \"' + __v + '\" has an offset out of range'); __off = (__z[0] === '-' ? -1 : 1) * (__oh * 60 + __om); } return __d.getTime() + ((__h * 60 + __mi - __off) * 60 + __s) * 1000 + __ms; })";

pub(crate) const CORE_OPERATOR_IMPORTS: [CoreOperatorDependencies; 13] = [
    CoreOperatorDependencies {
        operator: "str/to-number",
        imports: &[],
        intrinsics: &["Number", "TypeError", "Array"],
        arity: 1,
        max_arity: 1,
        arity_constructor: "Error",
    },
    CoreOperatorDependencies {
        operator: "json/valid",
        imports: &[],
        intrinsics: &["JSON", "TypeError", "Array"],
        arity: 1,
        max_arity: 1,
        arity_constructor: "Error",
    },
    CoreOperatorDependencies {
        operator: "xml/parse",
        imports: &["parseXml"],
        intrinsics: &["TypeError", "Array"],
        arity: 2,
        max_arity: 3,
        arity_constructor: "Error",
    },
    CoreOperatorDependencies {
        operator: "xml/valid",
        imports: &["xmlValid"],
        intrinsics: &["TypeError", "Array"],
        arity: 1,
        max_arity: 1,
        arity_constructor: "Error",
    },
    CoreOperatorDependencies {
        operator: "str/encode-uri-component",
        imports: &["encodeUriComponent"],
        intrinsics: &["TypeError", "Array"],
        arity: 1,
        max_arity: 1,
        arity_constructor: "Error",
    },
    CoreOperatorDependencies {
        operator: "str/decode-uri-component",
        imports: &["decodeUriComponent"],
        intrinsics: &["TypeError", "Array"],
        arity: 1,
        max_arity: 1,
        arity_constructor: "Error",
    },
    CoreOperatorDependencies {
        operator: "str/uri-component-valid",
        imports: &["decodeUriComponent", "CodecError"],
        intrinsics: &["TypeError", "Array"],
        arity: 1,
        max_arity: 1,
        arity_constructor: "Error",
    },
    CoreOperatorDependencies {
        operator: "base64/encode",
        imports: &["encodeBase64"],
        intrinsics: &["TypeError", "Array"],
        arity: 1,
        max_arity: 1,
        arity_constructor: "Error",
    },
    CoreOperatorDependencies {
        operator: "base64/decode",
        imports: &["decodeBase64"],
        intrinsics: &["TypeError", "Array"],
        arity: 1,
        max_arity: 1,
        arity_constructor: "Error",
    },
    CoreOperatorDependencies {
        operator: "base64/valid",
        imports: &["decodeBase64", "CodecError"],
        intrinsics: &["TypeError", "Array"],
        arity: 1,
        max_arity: 1,
        arity_constructor: "Error",
    },
    CoreOperatorDependencies {
        operator: "hash/sha256",
        imports: &["utf8Bytes", "sha256Bytes", "encodeDigest", "CodecError"],
        intrinsics: &["TypeError", "Array"],
        arity: 2,
        max_arity: 2,
        arity_constructor: "Error",
    },
    CoreOperatorDependencies {
        operator: "hash/md5",
        imports: &[
            "base64DecodeBytes",
            "md5Bytes",
            "encodeDigest",
            "CodecError",
        ],
        intrinsics: &["TypeError", "Array"],
        arity: 2,
        max_arity: 2,
        arity_constructor: "Error",
    },
    CoreOperatorDependencies {
        operator: "hmac/sha256",
        imports: &["utf8Bytes", "hmacSha256Bytes", "encodeDigest", "CodecError"],
        intrinsics: &["TypeError", "Array"],
        arity: 3,
        max_arity: 3,
        arity_constructor: "Error",
    },
];

pub(crate) fn core_operator_dependencies(
    operator: &str,
) -> Option<&'static CoreOperatorDependencies> {
    CORE_OPERATOR_IMPORTS
        .iter()
        .find(|dependencies| dependencies.operator == operator)
}

/// Inline TS cosine core, twin of the interpreter's `cosine_similarity`
/// (`orbital-core/src/evaluator/operators/array.rs`) — same math, same three
/// error conditions, byte-identical messages. One Rust-side definition so
/// `array/cosine` and `array/nearest` cannot drift from each other.
/// The numbers `array/max` / `array/min` fold — twin of orbital-core `numbers_of` and the
/// JS evaluator's `numbersOf`: each element (or its `key` field) read like
/// `Value::to_number` (numbers, booleans as 1/0, null as 0, numeric strings); an element or
/// absent field that reads as none is skipped.
const NUMBERS_OF_TS: &str = "((vs: readonly EventPayloadValue[], key: string | undefined): number[] => { const isRecord = (x: EventPayloadValue): x is Readonly<Record<string, EventPayloadValue>> => x !== null && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Date); return vs.flatMap((e) => { const v = key === undefined ? e : isRecord(e) && key in e ? e[key] : undefined; return typeof v === 'number' ? [v] : typeof v === 'boolean' ? [v ? 1 : 0] : v === null ? [0] : typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) ? [Number(v)] : []; }); })";
/// `csv/parse` — the kernel's contract (orbital-core `operators/csv.rs`): RFC 4180 records keyed by the header row; a non-string, empty or header-only text is `[]`.
const CSV_PARSE_TS: &str = r##"((s: EventPayloadValue | undefined): Array<{ [k: string]: string }> => { if (typeof s !== 'string') return []; const recs: string[][] = []; let r: string[] = []; let f = ''; let q = false; let iq = false; const end = (): void => { if (r.length > 0 || f !== '' || q) { r.push(f); recs.push(r); r = []; f = ''; q = false; } }; for (let i = s.charCodeAt(0) === 0xfeff ? 1 : 0; i < s.length; i++) { const c = s[i]; if (iq) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else { iq = false; } } else { f += c; } } else if (c === '"' && f === '') { iq = true; q = true; } else if (c === ',') { r.push(f); f = ''; q = false; } else if (c === '\r' || c === '\n') { if (c === '\r' && s[i + 1] === '\n') i++; end(); } else { f += c; } } end(); const [h, ...rows] = recs; if (h === undefined) return []; return rows.map((cells) => { const o: { [k: string]: string } = {}; h.forEach((n, i) => { o[n] = cells[i] ?? ''; }); return o; }); })"##;
/// `path/astar` — twin of orbital-core `operators/path.rs`: linear-scan open set, tie-break lower f, lower h, earliest insertion; `[]` when unreachable.
const PATH_ASTAR_TS: &str = r##"((s0: EventPayloadValue | undefined, g0: EventPayloadValue | undefined, bl: EventPayloadValue | undefined, w0: EventPayloadValue | undefined, h0: EventPayloadValue | undefined, d0: EventPayloadValue | undefined): Array<{ x: number; y: number }> => { const cell = (v: EventPayloadValue | undefined): { x: number; y: number } => { const o = v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) ? (v as { readonly [k: string]: EventPayloadValue }) : {}; return { x: Math.trunc(typeof o.x === 'number' ? o.x : 0), y: Math.trunc(typeof o.y === 'number' ? o.y : 0) }; }; const key = (c: { x: number; y: number }): string => `${c.x},${c.y}`; const blocked = new Set(Array.isArray(bl) ? bl.map((b) => key(cell(b))) : []); const start = cell(s0); const goal = cell(g0); const w = Math.trunc(Number(w0)); const h = Math.trunc(Number(h0)); const diag = d0 === true; const offs: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]]; if (diag) offs.push([1, -1], [1, 1], [-1, 1], [-1, -1]); const heur = (c: { x: number; y: number }): number => { const dx = Math.abs(c.x - goal.x); const dy = Math.abs(c.y - goal.y); return diag ? Math.max(dx, dy) : dx + dy; }; type N = { cell: { x: number; y: number }; g: number; h: number; f: number; order: number }; let counter = 0; const open: N[] = []; const came = new Map<string, { x: number; y: number }>(); const gs = new Map<string, number>(); const closed = new Set<string>(); const hs = heur(start); open.push({ cell: start, g: 0, h: hs, f: hs, order: counter++ }); gs.set(key(start), 0); while (open.length > 0) { let best = 0; for (let i = 1; i < open.length; i++) { const n = open[i]; const b = open[best]; if (n.f < b.f || (n.f === b.f && n.h < b.h) || (n.f === b.f && n.h === b.h && n.order < b.order)) best = i; } const cur = open[best]; open[best] = open[open.length - 1]; open.pop(); if (cur.cell.x === goal.x && cur.cell.y === goal.y) { const path = [goal]; let k = key(goal); let prev = came.get(k); while (prev !== undefined) { path.push(prev); k = key(prev); prev = came.get(k); } return path.reverse().map((c) => ({ x: c.x, y: c.y })); } closed.add(key(cur.cell)); for (const [dx, dy] of offs) { const nb = { x: cur.cell.x + dx, y: cur.cell.y + dy }; if (nb.x < 0 || nb.x >= w || nb.y < 0 || nb.y >= h) continue; const nk = key(nb); if (blocked.has(nk) || closed.has(nk)) continue; const t = cur.g + 1; const known = gs.get(nk); if (known === undefined || t < known) { came.set(nk, cur.cell); gs.set(nk, t); const hh = heur(nb); open.push({ cell: nb, g: t, h: hh, f: t + hh, order: counter++ }); } } } return []; })"##;
/// `array/sort` total order: twin of orbital-core `sort_order` / almadar-evaluator `compareSortValues`.
const SORT_COMPARE_TS: &str = "const r = (v: EventPayloadValue | undefined): number => v === null || v === undefined ? 0 : typeof v === 'boolean' ? 1 : typeof v === 'number' ? 2 : typeof v === 'string' ? 3 : Array.isArray(v) ? 4 : 5; const cmp = (x: EventPayloadValue | undefined, y: EventPayloadValue | undefined): number => { const rx = r(x), ry = r(y); if (rx !== ry) return rx - ry; if (rx === 1) return Number(x) - Number(y); if (rx === 2) { const nx = Number.isNaN(x as number), ny = Number.isNaN(y as number); if (nx || ny) return Number(nx) - Number(ny); } if (rx === 3) { const sx = x as string, sy = y as string; let i = 0, j = 0; while (i < sx.length && j < sy.length) { const ca = sx.codePointAt(i) ?? 0, cb = sy.codePointAt(j) ?? 0; if (ca !== cb) return ca < cb ? -1 : 1; i += ca > 0xffff ? 2 : 1; j += cb > 0xffff ? 2 : 1; } return i < sx.length ? 1 : j < sy.length ? -1 : 0; } if (rx === 2) { if ((x as number) < (y as number)) return -1; if ((x as number) > (y as number)) return 1; } return 0; };";

/// `path/reachable` — twin of orbital-core `operators/path.rs`: BFS within `steps`, start included, sorted row-major (y, then x).
const PATH_REACHABLE_TS: &str = r##"((s0: EventPayloadValue | undefined, st: EventPayloadValue | undefined, bl: EventPayloadValue | undefined, w0: EventPayloadValue | undefined, h0: EventPayloadValue | undefined, d0: EventPayloadValue | undefined): Array<{ x: number; y: number }> => { const cell = (v: EventPayloadValue | undefined): { x: number; y: number } => { const o = v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) ? (v as { readonly [k: string]: EventPayloadValue }) : {}; return { x: Math.trunc(typeof o.x === 'number' ? o.x : 0), y: Math.trunc(typeof o.y === 'number' ? o.y : 0) }; }; const key = (c: { x: number; y: number }): string => `${c.x},${c.y}`; const blocked = new Set(Array.isArray(bl) ? bl.map((b) => key(cell(b))) : []); const start = cell(s0); const steps = Math.trunc(Number(st)); const w = Math.trunc(Number(w0)); const h = Math.trunc(Number(h0)); const offs: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]]; if (d0 === true) offs.push([1, -1], [1, 1], [-1, 1], [-1, -1]); const visited = new Set([key(start)]); const result = [start]; const frontier: Array<[{ x: number; y: number }, number]> = [[start, 0]]; for (let i = 0; i < frontier.length; i++) { const [c, dist] = frontier[i]; if (dist >= steps) continue; for (const [dx, dy] of offs) { const nb = { x: c.x + dx, y: c.y + dy }; if (nb.x < 0 || nb.x >= w || nb.y < 0 || nb.y >= h) continue; const nk = key(nb); if (blocked.has(nk) || visited.has(nk)) continue; visited.add(nk); result.push(nb); frontier.push([nb, dist + 1]); } } return result.sort((p, q) => p.y - q.y || p.x - q.x); })"##;
/// `src ?? []` for an array operand. A source that is the literal `undefined` (a residual
/// binding the server cannot read) is `[]` itself: `undefined ?? []` is TS2871.
fn or_empty(src: &str) -> String {
    if src == "undefined" {
        "[]".to_string()
    } else {
        format!("({src} ?? [])")
    }
}

const COSINE_TS: &str = "((a: readonly number[], b: readonly number[]) => { if (a.length !== b.length) throw new Error(`array/cosine: vector length mismatch (${a.length} vs ${b.length})`); if (a.length === 0) throw new Error('array/cosine: empty vector has no defined similarity'); let dot = 0; let na = 0; let nb = 0; for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } if (na === 0 || nb === 0) throw new Error('array/cosine: zero-magnitude vector has no defined direction to compare'); return dot / (Math.sqrt(na) * Math.sqrt(nb)); })";

/// `time/format`'s 2-arg (timestamp, token-string) form: moment/dayjs-style
/// token replacement, twin of `@almadar/evaluator`'s `evalTimeFormat`
/// (packages/almadar-evaluator/std/time.ts) — same token map, same
/// longest-token-first regex (so `MM` can't consume the head of `MMM`), same
/// single-pass replace (so a substituted value like "July" can't be
/// re-matched). `__TS__`/`__FMT__` are placeholders substituted by the
/// caller, not Rust `format!` braces — every literal `{`/`}` below is real
/// TS/JS syntax.
const TIME_FORMAT_TOKEN_TEMPLATE: &str = "(() => { const __d = new Date(__TS__); const __tokens: Record<string, string> = { YYYY: String(__d.getFullYear()), YY: String(__d.getFullYear()).slice(-2), MM: String(__d.getMonth() + 1).padStart(2, '0'), M: String(__d.getMonth() + 1), DD: String(__d.getDate()).padStart(2, '0'), D: String(__d.getDate()), HH: String(__d.getHours()).padStart(2, '0'), H: String(__d.getHours()), mm: String(__d.getMinutes()).padStart(2, '0'), m: String(__d.getMinutes()), ss: String(__d.getSeconds()).padStart(2, '0'), s: String(__d.getSeconds()), ddd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][__d.getDay()], dddd: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][__d.getDay()], MMM: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][__d.getMonth()], MMMM: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][__d.getMonth()] }; const __pattern = new RegExp(Object.keys(__tokens).sort((a, b) => b.length - a.length).join('|'), 'g'); return String(__FMT__).replace(__pattern, (t) => __tokens[t]); })()";

/// Time-unit prelude for the compiled `time/*` operators — a line-for-line twin
/// of `@almadar/evaluator` `std/time.ts` (compiled apps do not depend on the
/// evaluator): the one unit vocabulary (incl. `quarter`), UTC calendar-month
/// arithmetic that clamps the day, Monday weeks, whole-unit differences.
/// Pinned by `compiled_time_operators_match_the_evaluator` (G-ORB-026).
const TIME_TS_PRELUDE: &str = "const __U: Record<string, string> = { ms: 'ms', millisecond: 'ms', milliseconds: 'ms', s: 'second', second: 'second', seconds: 'second', m: 'minute', minute: 'minute', minutes: 'minute', h: 'hour', hour: 'hour', hours: 'hour', d: 'day', day: 'day', days: 'day', w: 'week', week: 'week', weeks: 'week', month: 'month', months: 'month', quarter: 'quarter', quarters: 'quarter', year: 'year', years: 'year' }; const __unit = (u: string): string => { const k = __U[u]; if (k === undefined) throw new TypeError('Type mismatch: expected time unit (ms|millisecond(s), s|second(s), m|minute(s), h|hour(s), d|day(s), w|week(s), month(s), quarter(s), year(s)), got ' + u); return k; }; const __FIXED: Record<string, number> = { ms: 1, second: 1000, minute: 60000, hour: 3600000, day: 86400000, week: 604800000 }; const __PER: Record<string, number> = { month: 1, quarter: 3, year: 12 }; const __addMonths = (ts: number, months: number): number => { const d = new Date(ts); const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months; const ny = Math.floor(total / 12); const nm = ((total % 12) + 12) % 12; const nd = Math.min(d.getUTCDate(), new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()); const s = new Date(ts); s.setUTCFullYear(ny, nm, nd); return s.getTime(); }; const __shift = (ts: number, n: number, k: string): number => (k in __FIXED ? ts + n * __FIXED[k] : __addMonths(ts, Math.trunc(n) * __PER[k])); const __startOf = (ts: number, k: string): number => { const day = 86400000; switch (k) { case 'ms': return Math.floor(ts); case 'second': return Math.floor(ts / 1000) * 1000; case 'minute': return Math.floor(ts / 60000) * 60000; case 'hour': return Math.floor(ts / 3600000) * 3600000; case 'day': return Math.floor(ts / day) * day; case 'week': { const ds = Math.floor(ts / day); const dow = (((ds + 3) % 7) + 7) % 7; return (ds - dow) * day; } case 'month': { const d = new Date(ts); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); } case 'quarter': { const d = new Date(ts); return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1); } default: return Date.UTC(new Date(ts).getUTCFullYear(), 0, 1); } }; const __wholeMonths = (from: number, to: number): number => { const lo = new Date(Math.min(from, to)); const hi = new Date(Math.max(from, to)); let m = (hi.getUTCFullYear() - lo.getUTCFullYear()) * 12 + (hi.getUTCMonth() - lo.getUTCMonth()); const lr = lo.getTime() - __startOf(lo.getTime(), 'day'); const hr = hi.getTime() - __startOf(hi.getTime(), 'day'); if (hi.getUTCDate() < lo.getUTCDate() || (hi.getUTCDate() === lo.getUTCDate() && hr < lr)) m -= 1; return to < from ? -m : m; };";

/// A compiled time operator: `params` are the IIFE's typed parameters, `body` its
/// return expression over the prelude, `args` the compiled operands.
fn time_iife(params: &str, body: &str, args: &[String]) -> String {
    format!(
        "(({params}) => {{ {TIME_TS_PRELUDE} return {body}; }})({})",
        args.join(", ")
    )
}

/// Rewrite every `getNestedValue(<param>, …)` call in a compiled lambda
/// `body` to narrow `<param>` down to `Record<string, FieldValue |
/// undefined>` first. Only called when `embeds_predicate_fn` found a
/// function-valued property on the literal `body`'s own source array —
/// `<param>`'s natural inferred type then structurally contains that
/// function on one union branch, which `getNestedValue`'s declared `obj`
/// union rejects (TS2345). The cast is a plain `as` in both directions
/// (Record index-signature types are comparable), never `unknown`.
/// Word-boundary safe: matches the literal call-site text
/// `getNestedValue(<param>, `, so `metricValue`/`oldMetric` etc. can never
/// false-positive.
fn narrow_get_nested_value_calls(body: &str, param: &str) -> String {
    let needle = format!("getNestedValue({}, ", param);
    // Two-step cast, not a direct `as Record<string, FieldValue |
    // undefined>`: when EVERY literal element carries the predicate
    // function (not just one — e.g. std-cms' hub-stats, every card has a
    // `filter`), a single-step cast fails too (TS2352 — the union's
    // narrowest member still has `filter: Function` on the SAME index-sig
    // slot the target declares `FieldValue | undefined`, so `param`'s
    // whole type isn't comparable to the target at all). Widen FIRST to an
    // index signature that explicitly ADMITS the function
    // (`Record<string, FieldValue | undefined | ((row: EntityRow) =>
    // boolean)>` — comparable, since it's a superset), then narrow that
    // widened type down to what `getNestedValue` declares — both legs are
    // plain `as` (Record index-signature types are mutually comparable
    // once the function member is present), never `unknown`.
    let replacement = format!(
        "getNestedValue(({} as Record<string, FieldValue | undefined | ((row: EntityRow) => boolean)>) as Record<string, FieldValue | undefined>, ",
        param
    );
    let mut out = String::with_capacity(body.len());
    let mut rest = body;
    while let Some(pos) = rest.find(&needle) {
        out.push_str(&rest[..pos]);
        out.push_str(&replacement);
        rest = &rest[pos + needle.len()..];
    }
    out.push_str(rest);
    out
}

impl TypeScriptBackend {
    /// Translate an S-expression operator call to idiomatic JavaScript/TypeScript.
    ///
    /// Maps operator names from `packages/almadar-operators/operators.json` to their
    /// JavaScript equivalents. Only operators that reach `OirExpr::Call` need translation —
    /// arithmetic, comparison, logic, and control flow are already handled by dedicated
    /// `OirExpr` variants (BinaryOp, UnaryOp, Conditional, Map, Filter, Reduce, Effect).
    /// Translate an operator call. `element_type` is the inferred TS type
    /// of the source array's elements (for array operators); pass `None`
    /// when unknown — the templates fall back to `any`-equivalent
    /// behavior (`as readonly any[]`, `(v: any)`) so existing callers
    /// see no semantic change.
    /// `never_nullish[i]`: whether argument `i`'s emitted TS is never nullish
    /// (`infer::oir_expr_ts_never_nullish`) — its coercion then takes no `?? fallback`
    /// (TS2869 otherwise). Shorter than `args` (or empty) means unknown → keep the fallback.
    pub(crate) fn call_to_ts_typed(
        &self,
        function: &str,
        args: &[String],
        facts: &[crate::codegen::infer::ArgFacts],
        element_type: Option<&str>,
    ) -> String {
        if let Some(dependencies) = core_operator_dependencies(function) {
            if !dependencies.accepts(args.len()) {
                return dependencies.arity_error();
            }
        }
        // What each argument IS, read off its OIR by the caller — never off its text.
        let fact = |i: usize| facts.get(i).cloned().unwrap_or_default();
        let nn = |i: usize| fact(i).never_nullish;
        // Default to `EntityRow` (carries an index signature so lambda
        // bodies can do dynamic `row.<field>` reads) instead of `any`
        // or the literal `EventPayloadValue`. The `almadar/no-as-any`
        // ESLint rule rejects bare `as any`; `EventPayloadValue` lacks
        // an index signature so lambda field reads trip TS2339; both
        // are bad defaults. EntityRow is the canonical "loose object
        // row" shape and is safe to cast TO from any payload-read
        // source AND assignable FROM by typed entities (covariant).
        let elem = element_type.unwrap_or("EntityRow");
        let elem_arr = element_type
            .map(|t| format!("readonly {}[]", crate::backend::array_element_ts(t)))
            .unwrap_or_else(|| "readonly EntityRow[]".to_string());
        let a = |i: usize| args.get(i).map(|s| s.as_str()).unwrap_or("undefined");
        // String-op receiver: `(x ?? '')` guards runtime nullish but does NOT
        // narrow the wide EventPayloadValue union for tsc — `.replace` etc.
        // trip TS2339 when the receiver is an un-narrowed payload read. Wrap
        // in String(...) (identity for strings). Literal receivers skip both
        // the wrap and the `??` (never nullish → TS2869), mirroring str/join.
        let sr = |i: usize| {
            let src = a(i);
            if fact(i).string {
                src.to_string()
            } else if nn(i) {
                format!("String({})", src)
            } else {
                format!("String({} ?? '')", src)
            }
        };
        // Same coercion for string-typed ARGUMENT positions (search term,
        // separator, needle) — a string-typed receiver makes tsc check them,
        // so an un-narrowed payload read trips TS2345 there instead.
        let sa = sr;
        // A dot-path argument for `getNestedValue`: a string as is, else `String(…)`
        // (a wide payload/field read lowers to `EventPayloadValue | undefined`).
        let string_path = |i: usize| {
            if fact(i).string {
                a(i).to_string()
            } else {
                format!("String({})", a(i))
            }
        };
        // Read `.x`/`.y` off a `{x,y}` cell/point arg with a `0` default —
        // mirrors orbital-core `vget(&c, "x")`. Typed cast (no `as any`).
        let gx = |i: usize| {
            format!(
                "((({}) as {{ readonly x?: number; readonly y?: number }} | undefined)?.x ?? 0)",
                a(i)
            )
        };
        let gy = |i: usize| {
            format!(
                "((({}) as {{ readonly x?: number; readonly y?: number }} | undefined)?.y ?? 0)",
                a(i)
            )
        };
        // `.z`/`.w`/`.h`/`.r` off a struct arg with a `0` default — same
        // shape as `gx`/`gy`, for `vec/*` (z) and `geo/*` (w/h/r) ops.
        let gz = |i: usize| {
            format!(
                "((({}) as {{ readonly z?: number }} | undefined)?.z ?? 0)",
                a(i)
            )
        };
        let gw = |i: usize| {
            format!(
                "((({}) as {{ readonly w?: number }} | undefined)?.w ?? 0)",
                a(i)
            )
        };
        let gh = |i: usize| {
            format!(
                "((({}) as {{ readonly h?: number }} | undefined)?.h ?? 0)",
                a(i)
            )
        };
        let gr = |i: usize| {
            format!(
                "((({}) as {{ readonly r?: number }} | undefined)?.r ?? 0)",
                a(i)
            )
        };
        // A numeric scalar arg with a `0` default — mirrors orbital-core
        // `require_number!`, and keeps `<`/`*`/`/` off `number | undefined`.
        let gn = |i: usize| {
            let src = a(i);
            if fact(i).number || nn(i) {
                format!("({})", src)
            } else {
                format!("(({}) ?? 0)", src)
            }
        };
        // `gn`'s twin for a target position typed exactly `number`
        // (not `number | undefined`) — `array/nth`'s index param, the
        // `time/add`/`time/subtract` unit-multiplier amount. `?? 0` alone
        // only drops `undefined`, leaving the source's OTHER wide-union
        // members (`EventPayloadValue`/`FieldValue`); `Number(...)`
        // forces the real `number` the target position declares.
        let nc = |i: usize| {
            let src = a(i);
            if fact(i).number {
                format!("({})", src)
            } else {
                format!("Number({} ?? 0)", src)
            }
        };
        // A `new Date(x)` operand read through `getNestedValue`/a raw
        // `@payload.`/`@entity.` binding is honestly `FieldValue |
        // undefined` / `EventPayloadValue | undefined` — both wider than
        // `tn`'s `?? 0` handles (they also admit `boolean` and nested
        // arrays/objects, neither constructible into a `Date`). `dt` is
        // `tn`'s twin for that WIDER source: a `typeof` narrow to `string |
        // number` covers every value `new Date()` actually accepts, with
        // `undefined`/`boolean`/array/object all falling back to `0`.
        // Bound through an IIFE param (`v`), not inlined 3×, because TS
        // narrowing only follows a STABLE reference — `typeof f() ===
        // 'string' ? f() : 0` does NOT narrow the second `f()` call (a
        // fresh, unrelated expression to the checker even when textually
        // identical and `f` happens to be pure), so `getNestedValue(...)`
        // repeated across the ternary stayed `FieldValue | undefined`
        // (TS2769 on `new Date(...)`, no overload matches).
        let dt = |i: usize| {
            let src = a(i);
            if fact(i).number {
                format!("({})", src)
            } else {
                format!(
                    "((__v) => typeof __v === 'string' || typeof __v === 'number' ? __v : 0)({})",
                    src
                )
            }
        };
        // A temporal operand for ARITHMETIC (`time/add`/`time/subtract`/
        // `time/diff`): built on `dt`'s wide-source narrow (excludes
        // `boolean`/array/object, the values `new Date()` rejects with
        // TS2769), then `.getTime()` for the epoch-ms number `+`/`-` need.
        // Known-number sources skip the wrap (identical short-circuit to
        // `dt`) so `now + …` stays a plain number expression instead
        // of round-tripping through `new Date(now)`.
        let tn = |i: usize| {
            let src = a(i);
            if fact(i).number {
                format!("({})", src)
            } else {
                format!("(new Date({}).getTime())", dt(i))
            }
        };
        // `array/sort`'s comparator param annotation. A known-array source
        // (syntactically detected by `is_known_array`, e.g. a `.map(...)`
        // chain) has a concrete but not always INFERRED element type: when
        // the caller resolved one (`element_type`, from
        // `infer_oirexpr_element_type_ts`) it is exact and safe to spell
        // out; when it did not (e.g. the source is itself an `array/map`
        // call producing a fresh object-literal shape — `infer_*` does not
        // trace `array/map`'s lambda return type), falling back to `elem`'s
        // "EntityRow" default is a GUESS that can mismatch the real literal
        // shape (TS2345, the std-task-manager family). Emitting no
        // annotation there lets TS infer `a`/`b` contextually from the
        // array's real (concrete) element type instead of guessing — the
        // body's own `(a as EntityRow)` cast is unaffected either way. A
        // non-known array keeps its explicit `EventPayloadValue` annotation
        // (array_arg's `?? []` cast there is not otherwise inferable as a
        // useful comparator param without loosening to `any`).
        let sort_comparator_params = |i: usize| -> String {
            if fact(i).array {
                match element_type {
                    Some(t) => format!("a: {0}, b: {0}", t),
                    None => "a, b".to_string(),
                }
            } else {
                "a: EventPayloadValue, b: EventPayloadValue".to_string()
            }
        };
        let array_arg = |i: usize| -> String {
            let src = a(i);
            if fact(i).array {
                format!("({})", src)
            } else if src == "undefined" {
                // The literal `undefined` guarded by `??` is TS2871 (always nullish).
                "([] as readonly EventPayloadValue[])".to_string()
            } else {
                // Cast to the nullable union FIRST, then guard: the `??`
                // stays reachable on TS-known arrays (`never[]` reduce
                // accumulators — TS2869), and the result is a concrete
                // array type even when the source is a wide
                // `FieldValue | undefined` entity read (TS2339 on
                // `.some`/`.filter`/… method access).
                format!(
                    "(({} as readonly EventPayloadValue[] | undefined) ?? [])",
                    src
                )
            }
        };
        // A lambda op's source when the caller resolved its element type (the lambda's
        // own element, e.g. `EntityRow` for one reading fields off its parameter): cast
        // to that element so the lambda body typechecks; otherwise `array_arg`.
        let elem_array_arg = |i: usize| -> String {
            match element_type {
                Some(t) if !fact(i).array => {
                    format!(
                        "(({} as readonly {}[] | undefined) ?? [])",
                        a(i),
                        crate::backend::array_element_ts(t)
                    )
                }
                _ => array_arg(i),
            }
        };
        match function {
            // --- General ---
            // Use `{ readonly length: number }` to access `.length` on
            // the wide payload-read shape without `as any` (rejected by
            // the `almadar/no-as-any` ESLint rule). Both array AND
            // string branches of `EventPayloadValue` carry a `length`
            // property structurally, so this cast lands on both.
            "length" | "len" => format!(
                "((({} as {{ readonly length: number }} | undefined) ?? {{ length: 0 }}).length)",
                a(0)
            ),
            "not-empty" | "notEmpty" => format!(
                "(({0}) != null && (({0}) as {{ readonly length: number }}).length !== 0)",
                a(0)
            ),
            "type-of" | "typeof" => format!("typeof ({})", a(0)),
            "to-string" | "toString" => format!("String({})", a(0)),
            "to-number" | "toNumber" => format!("Number({})", a(0)),
            "coalesce" => format!("({})", args.join(" ?? ")),

            // --- Arithmetic ---
            // Every position below is a strict `number` (Math.* signatures,
            // or an operand of `%`/`*`/`+`/`-`), so it needs `nc`'s twin of
            // `time/add`'s amount coercion — a wide payload/field read
            // (`EventPayloadValue`/`FieldValue`) is not assignable to
            // `number`, and `?? 0` alone only drops `undefined`, leaving the
            // other union members. `nc` short-circuits on already-known-number
            // sources (literals, nested `Math.*` calls), so this is a no-op
            // for every currently-typechecking call site.
            "abs" | "math/abs" => format!("Math.abs({})", nc(0)),
            "min" | "math/min" => format!(
                "Math.min({})",
                (0..args.len()).map(nc).collect::<Vec<_>>().join(", ")
            ),
            "max" | "math/max" => format!(
                "Math.max({})",
                (0..args.len()).map(nc).collect::<Vec<_>>().join(", ")
            ),
            "floor" | "math/floor" => format!("Math.floor({})", nc(0)),
            "ceil" | "math/ceil" => format!("Math.ceil({})", nc(0)),
            "round" if args.len() <= 1 => format!("Math.round({})", nc(0)),
            "math/round" if args.len() <= 1 => format!("Math.round({})", nc(0)),
            "round" | "math/round" => format!("+(({}).toFixed({}))", nc(0), nc(1)),
            "clamp" | "math/clamp" => {
                format!("Math.min(Math.max({}, {}), {})", nc(0), nc(1), nc(2))
            }
            "math/pow" => format!("Math.pow({}, {})", nc(0), nc(1)),
            "math/sqrt" => format!("Math.sqrt({})", nc(0)),
            "math/log10" => format!("Math.log10({})", nc(0)),
            "math/ln" => format!("Math.log({})", nc(0)),
            "math/mod" => format!(
                "((({}) % ({})) + ({})) % ({})",
                nc(0), nc(1), nc(1), nc(1)
            ),
            "math/sign" => format!("Math.sign({})", nc(0)),
            "math/lerp" => format!("({} + ({} - {}) * {})", nc(0), nc(1), nc(0), nc(2)),
            "math/map" => format!(
                "({3} + ({0} - {1}) * ({4} - {3}) / ({2} - {1}))",
                nc(0), nc(1), nc(2), nc(3), nc(4)
            ),
            "math/random" => "Math.random()".to_string(),
            "math/randomInt" => format!(
                "(Math.floor(Math.random() * ({1} - {0} + 1)) + {0})",
                nc(0), nc(1)
            ),
            "math/default" => format!("(Number.isFinite({}) ? {} : {})", nc(0), nc(0), nc(1)),
            // Trig + angle conversions (mirror @almadar/evaluator std/math.ts).
            "math/sin" => format!("Math.sin({})", nc(0)),
            "math/cos" => format!("Math.cos({})", nc(0)),
            "math/tan" => format!("Math.tan({})", nc(0)),
            "math/asin" => format!("Math.asin({})", nc(0)),
            "math/acos" => format!("Math.acos({})", nc(0)),
            "math/atan" => format!("Math.atan({})", nc(0)),
            "math/atan2" => format!("Math.atan2({}, {})", nc(0), nc(1)),
            "math/hypot" => format!("Math.hypot({}, {})", nc(0), nc(1)),
            "math/deg-rad" => format!("({} * (Math.PI / 180))", nc(0)),
            "math/rad-deg" => format!("({} * (180 / Math.PI))", nc(0)),
            "math/approach" => format!(
                "(Math.abs({1} - {0}) <= {2} ? {1} : {0} + Math.sign({1} - {0}) * {2})",
                nc(0), nc(1), nc(2)
            ),
            "math/wrap" => format!(
                "(((): number => {{ const _min = {1}; const _r = {2} - _min; if (_r <= 0) return _min; const _v = {0}; return _min + (((_v - _min) % _r) + _r) % _r; }})())",
                nc(0), nc(1), nc(2)
            ),

            // --- Collection ---
            "count" | "array/len" => {
                let src = a(0);
                if fact(0).array {
                    // A definite array — no `?? []` guard (TS2869).
                    format!("({}).length", src)
                } else if nn(0) {
                    // Never nullish (an `object/get` with a default) — a `?? []` is TS2869.
                    format!("(({}) as {{ readonly length: number }}).length", src)
                } else {
                    format!("({} as {{ readonly length: number }}).length", or_empty(src))
                }
            }
            // Cast the array source to `readonly EventPayloadValue[]` so
            // TS accepts `[0]` indexing when the source resolves to an
            // EventPayloadValue (the wide payload union from
            // `@payload.data` & co). Without the cast,
            // `(lastPayload?.data ?? [])[0]` trips TS7053 — the union
            // includes primitive branches (string/number/boolean) that
            // can't be indexed. The lolo author already wrote
            // `(array/first @payload.data)` expecting an array; the cast
            // documents that runtime invariant for tsc.
            "first" | "array/first" => format!(
                "({} as readonly EventPayloadValue[])[0]",
                array_arg(0)
            ),
            "last" | "array/last" => format!(
                "({} as readonly EventPayloadValue[]).at(-1)",
                array_arg(0)
            ),
            // Accept the wide payload-read shape (`EventPayloadValue |
            // undefined` from `@payload.X`) without an explicit cast at
            // the call site; `Array.isArray` narrows safely at runtime.
            // Typing the helper arg directly as `EventPayloadValue |
            // undefined` instead of `unknown` satisfies the
            // `almadar/no-unknown-type` ESLint rule.
            "nth" | "array/nth" => format!(
                "((__a: EventPayloadValue | undefined, __i: number | undefined) => Array.isArray(__a) ? __a[__i ?? 0] : undefined)({}, {})",
                a(0), nc(1)
            ),
            // Cast to `readonly any[]` so an inline-substituted empty literal
            // (e.g. `@config.visibleRoles = []` defaulted at atom-scope) typed
            // as `never[]` doesn't reject the runtime needle. Mirrors the
            // `array/nth` widening above.
            // Cast haystack + needle to `readonly EventPayloadValue[]` /
            // `EventPayloadValue` when the element type isn't inferred.
            // EventPayloadValue is the wide payload union — every
            // FieldValue branch (string, number, boolean, …) AND EntityRow
            // (via the EventPayload object branch) fits, so a heterogeneous
            // lolo like `(array/includes [...string-array] @user.role)`
            // typechecks both ways. When element_type IS inferred (e.g.
            // from `@entity.<field>` with declared `[string]` type), use
            // the typed elem_arr / elem directly.
            "includes" | "contains" | "array/includes" => {
                if element_type.is_some() {
                    format!(
                        "({} as {}).includes({} as {})",
                        array_arg(0), elem_arr, a(1), elem
                    )
                } else {
                    format!(
                        "({} as readonly EventPayloadValue[]).includes({} as EventPayloadValue)",
                        array_arg(0), a(1)
                    )
                }
            },
            "in" if args.len() == 2 => format!("({} as {}).includes({} as {})", or_empty(a(1)), elem_arr, a(0), elem),
            "empty" => format!("(!({})) || Object.keys({} ?? {{}}).length === 0", a(0), a(0)),
            "merge" | "object/merge" => format!("Object.assign({{}}, {})", args.join(", ")),
            "average" => format!("((arr) => arr.length ? arr.reduce((s: number, v: number) => s + v, 0) / arr.length : 0)({})", or_empty(a(0))),

            // Literal-array constructor (`["list", e1, e2, …]`) — see
            // `mark_literal_list_in_place`. Lowers to a JS array literal;
            // without it the fallback emits an undefined `list(...)` call.
            "list" | "array/of" => format!("[{}]", args.join(", ")),

            // --- std-codec ---
            "str/encode-uri-component" | "base64/encode" | "base64/decode" => {
                let helper = match function {
                    "str/encode-uri-component" => "encodeUriComponent",
                    "base64/encode" => "encodeBase64",
                    "base64/decode" => "decodeBase64",
                    _ => unreachable!(),
                };
                self.with_generated_locals(&["__v"], |names| {
                    let value = &names[0];
                    format!(
                        "(({value}: EventPayloadValue | undefined): string => {{ if (typeof {value} !== 'string') throw new TypeError('Type mismatch: expected string, got ' + ({value} == null ? 'null' : Array.isArray({value}) ? 'array' : typeof {value})); return {helper}({value}); }})({})",
                        a(0)
                    )
                })
            },
            "str/decode-uri-component" => self.with_generated_locals(&["__v"], |names| {
                let value = &names[0];
                format!(
                    "(({value}: EventPayloadValue | undefined): string | null => {{ if ({value} == null) return null; if (typeof {value} !== 'string') throw new TypeError('Type mismatch: expected string, got ' + (Array.isArray({value}) ? 'array' : typeof {value})); return decodeUriComponent({value}); }})({})",
                    a(0)
                )
            }),
            "str/uri-component-valid" => self.with_generated_locals(&["__v"], |names| {
                let value = &names[0];
                format!(
                    "(({value}: EventPayloadValue | undefined): boolean => {{ if ({value} == null) return false; if (typeof {value} !== 'string') throw new TypeError('Type mismatch: expected string, got ' + (Array.isArray({value}) ? 'array' : typeof {value})); try {{ decodeUriComponent({value}); return true; }} catch (__e) {{ if (__e instanceof CodecError) return false; throw __e; }} }})({})",
                    a(0)
                )
            }),
            "base64/valid" => self.with_generated_locals(&["__v"], |names| {
                let value = &names[0];
                format!(
                    "(({value}: EventPayloadValue | undefined): boolean => {{ if ({value} == null) return false; if (typeof {value} !== 'string') throw new TypeError('Type mismatch: expected string, got ' + (Array.isArray({value}) ? 'array' : typeof {value})); try {{ decodeBase64({value}); return true; }} catch (__e) {{ if (__e instanceof CodecError) return false; throw __e; }} }})({})",
                    a(0)
                )
            }),
            "hash/sha256" => self.with_generated_locals(&["__message", "__digest", "__encoding"], |names| {
                let message = &names[0];
                let digest = &names[1];
                let encoding = &names[2];
                format!(
                    "(({message}: EventPayloadValue | undefined): string => {{ if (typeof {message} !== 'string') throw new TypeError('Type mismatch: expected string, got ' + ({message} == null ? 'null' : Array.isArray({message}) ? 'array' : typeof {message})); const {digest} = sha256Bytes(utf8Bytes({message})); return (({encoding}: EventPayloadValue | undefined): string => {{ if (typeof {encoding} !== 'string') throw new TypeError('Type mismatch: expected string, got ' + ({encoding} == null ? 'null' : Array.isArray({encoding}) ? 'array' : typeof {encoding})); if ({encoding} !== 'hex' && {encoding} !== 'base64') throw new CodecError('encoding must be \"hex\" or \"base64\", got \"' + {encoding} + '\"'); return encodeDigest({digest}, {encoding}); }})({}); }})({})",
                    a(1), a(0)
                )
            }),
            "hash/md5" => self.with_generated_locals(&["__data", "__digest", "__encoding"], |names| {
                let data = &names[0];
                let digest = &names[1];
                let encoding = &names[2];
                format!(
                    "(({data}: EventPayloadValue | undefined): string => {{ if (typeof {data} !== 'string') throw new TypeError('Type mismatch: expected string, got ' + ({data} == null ? 'null' : Array.isArray({data}) ? 'array' : typeof {data})); const {digest} = md5Bytes(base64DecodeBytes({data})); return (({encoding}: EventPayloadValue | undefined): string => {{ if (typeof {encoding} !== 'string') throw new TypeError('Type mismatch: expected string, got ' + ({encoding} == null ? 'null' : Array.isArray({encoding}) ? 'array' : typeof {encoding})); if ({encoding} !== 'hex' && {encoding} !== 'base64') throw new CodecError('encoding must be \"hex\" or \"base64\", got \"' + {encoding} + '\"'); return encodeDigest({digest}, {encoding}); }})({}); }})({})",
                    a(1), a(0)
                )
            }),
            "hmac/sha256" => self.with_generated_locals(&["__key", "__keyBytes", "__message", "__digest", "__encoding"], |names| {
                let key = &names[0];
                let key_bytes = &names[1];
                let message = &names[2];
                let digest = &names[3];
                let encoding = &names[4];
                format!(
                    "(({key}: EventPayloadValue | undefined): string => {{ if (typeof {key} !== 'string') throw new TypeError('Type mismatch: expected string, got ' + ({key} == null ? 'null' : Array.isArray({key}) ? 'array' : typeof {key})); const {key_bytes} = utf8Bytes({key}); return (({message}: EventPayloadValue | undefined): string => {{ if (typeof {message} !== 'string') throw new TypeError('Type mismatch: expected string, got ' + ({message} == null ? 'null' : Array.isArray({message}) ? 'array' : typeof {message})); const {digest} = hmacSha256Bytes({key_bytes}, utf8Bytes({message})); return (({encoding}: EventPayloadValue | undefined): string => {{ if (typeof {encoding} !== 'string') throw new TypeError('Type mismatch: expected string, got ' + ({encoding} == null ? 'null' : Array.isArray({encoding}) ? 'array' : typeof {encoding})); if ({encoding} !== 'hex' && {encoding} !== 'base64') throw new CodecError('encoding must be \"hex\" or \"base64\", got \"' + {encoding} + '\"'); return encodeDigest({digest}, {encoding}); }})({}); }})({}); }})({})",
                    a(2), a(1), a(0)
                )
            }),

            // --- std-json --- (the kernel contract: parse never throws, stringify always a string)
            "json/valid" => format!(
                "((__v: EventPayloadValue | undefined): boolean => {{ if (typeof __v !== 'string') throw new TypeError('Type mismatch: expected string, got ' + (__v == null ? 'null' : Array.isArray(__v) ? 'array' : typeof __v)); try {{ JSON.parse(__v); return true; }} catch {{ return false; }} }})({})",
                a(0)
            ),
            "json/parse" => format!(
                "((s: EventPayloadValue | undefined): EventPayloadValue => {{ if (typeof s !== 'string') return null; try {{ return JSON.parse(s) as EventPayloadValue; }} catch {{ return null; }} }})({})",
                a(0)
            ),
            "json/stringify" if nn(0) => format!("(JSON.stringify({}) ?? 'null')", a(0)),
            "json/stringify" => format!("(JSON.stringify({} ?? null) ?? 'null')", a(0)),

            // --- std-xml ---
            "xml/parse" if args.len() > 2 => format!(
                "((__v: EventPayloadValue | undefined): EventPayloadValue => {{ if (__v == null) return null; if (typeof __v !== 'string') throw new TypeError('Type mismatch: expected string, got ' + (Array.isArray(__v) ? 'array' : typeof __v)); return parseXml(__v, {}); }})({})",
                a(2),
                a(0)
            ),
            "xml/parse" => format!(
                "((__v: EventPayloadValue | undefined): EventPayloadValue => {{ if (__v == null) return null; if (typeof __v !== 'string') throw new TypeError('Type mismatch: expected string, got ' + (Array.isArray(__v) ? 'array' : typeof __v)); return parseXml(__v); }})({})",
                a(0)
            ),
            "xml/valid" => format!(
                "((__v: EventPayloadValue | undefined): boolean => {{ if (typeof __v !== 'string') throw new TypeError('Type mismatch: expected string, got ' + (__v == null ? 'null' : Array.isArray(__v) ? 'array' : typeof __v)); return xmlValid(__v); }})({})",
                a(0)
            ),

            // --- std-csv ---
            "csv/parse" => format!("{}({})", CSV_PARSE_TS, a(0)),

            // --- std-path ---
            "path/astar" => format!("{}({}, {}, {}, {}, {}, {})", PATH_ASTAR_TS, a(0), a(1), a(2), a(3), a(4), a(5)),
            "path/reachable" => format!("{}({}, {}, {}, {}, {}, {})", PATH_REACHABLE_TS, a(0), a(1), a(2), a(3), a(4), a(5)),

            // --- std-str ---
            "str/to-number" => format!(
                "((__v: EventPayloadValue | undefined): number => {{ if (typeof __v !== 'string') throw new TypeError('Type mismatch: expected string, got ' + (__v == null ? 'null' : Array.isArray(__v) ? 'array' : typeof __v)); return Number(__v); }})({})",
                a(0)
            ),
            "str/len" => format!("{}.length", sr(0)),
            "str/concat" => format!("[{}].join('')", args.join(", ")),
            "str/upper" => format!("{}.toUpperCase()", sr(0)),
            "str/lower" => format!("{}.toLowerCase()", sr(0)),
            "str/trim" => format!("{}.trim()", sr(0)),
            "str/slice" if args.len() == 2 => format!("{}.slice({})", sr(0), a(1)),
            "str/slice" => format!("{}.slice({}, {})", sr(0), a(1), a(2)),
            "str/split" => format!("{}.split({})", sr(0), sa(1)),
            // Reads its operand like every array operator (`array_arg`): a known array as is, an
            // unknown one cast to the array union first (a bare `?? []` leaves a union with no `.join`).
            "str/join" => format!("{}.join({})", array_arg(0), a(1)),
            "str/includes" => format!("{}.includes({})", sr(0), sa(1)),
            "str/startsWith" => format!("{}.startsWith({})", sr(0), sa(1)),
            "str/endsWith" => format!("{}.endsWith({})", sr(0), sa(1)),
            "str/replace" => format!("{}.replace({}, {})", sr(0), sa(1), sa(2)),
            "str/replaceAll" => format!("{}.replaceAll({}, {})", sr(0), sa(1), sa(2)),
            "str/capitalize" => format!("({0}.charAt(0).toUpperCase() + {0}.slice(1))", sr(0)),
            "str/reverse" => format!("[...{}].reverse().join('')", sr(0)),
            "str/repeat" => format!("{}.repeat({})", sr(0), a(1)),
            "str/truncate" if args.len() == 2 => format!("({0}.length <= {1} ? {0} : {0}.slice(0, {1}) + '...')", sr(0), a(1)),
            "str/truncate" => format!("({0}.length <= {1} ? {0} : {0}.slice(0, {1}) + ({2} ?? '...'))", sr(0), a(1), a(2)),
            // Contract (matches the native evaluator's StrDefaultOp and the JS
            // runtime's evalStrDefault): fall back on null/undefined AND the
            // empty string — a bare `??` keeps "" and diverges.
            "str/default" => format!(
                "((v) => (v == null || (typeof v === 'string' && v === '') ? {} : v))({})",
                a(1),
                a(0)
            ),
            // B5 twin survivor: support nested `{{a.b}}` paths via
            // `getNestedValue` (mirrors `object/get`), where the old regex
            // only matched `\w+` (flat keys). Flat keys behave the same.
            // `k` is the regex capture group TS already types as `string`
            // (the `.replace(regex, (_, k) => …)` overload), so it needs no
            // `String(…)`/`as string` wrap — only the source object arg does
            // (a wide payload read lowers to `EventPayloadValue | undefined`,
            // and `getNestedValue`'s first param isn't `unknown`).
            "str/template" => format!(
                "({}).replace(/\\{{\\{{([\\w.]+)\\}}\\}}/g, (_, k) => String(getNestedValue({}, k) ?? ''))",
                a(0), a(1)
            ),

            // --- std-array ---
            // Drop the `?? []` guard when arg 0 is already a literal array —
            // TS narrows array literals to non-nullish and emits TS2869
            // ("right operand of ?? is unreachable") otherwise. The molecule
            // inline phase substitutes `@config.metrics` (an array literal)
            // directly into the `array/map` first arg, so this path matters.
            "array/map" => {
                let src = a(0);
                // std-stats-style literal array embedding a compiled
                // predicate fn (`filter`/`baselineFilter` author-only
                // SExpr slots — see `embeds_predicate_fn`'s doc): narrow
                // every `getNestedValue(<param>, …)` read in the mapped
                // body back to `Record<string, FieldValue | undefined>`
                // at its own call site, since the param's natural
                // inferred type structurally carries that function on one
                // union branch (TS2345 otherwise, not just on the
                // predicate key's own read).
                let body = match (fact(0).embeds_lambda, fact(1).lambda_params.as_deref()) {
                    (true, Some([param])) => narrow_get_nested_value_calls(a(1), param),
                    _ => a(1).to_string(),
                };
                if fact(0).array {
                    format!("({}).map({})", src, body)
                } else {
                    // Cast to `readonly <Element>[]` so TS doesn't reject
                    // `.map` on the wide payload-data union. Element type
                    // comes from the OirExpr-level inference when known;
                    // falls back to `readonly EntityRow[]` for opaque
                    // sources (chosen for index-signature compatibility).
                    format!("({} as {}).map({})", or_empty(src), elem_arr, body)
                }
            }
            // Cast to `readonly any[]` so TS doesn't reject `.filter` on the
            // wide payload-data union (`string | number | EventPayload | …`).
            // Same reasoning as array/sum / array/avg below — the runtime
            // value is always an array, but EventPayloadValue is wider.
            //
            // Constant-fold a literal `true`/`false` predicate so post-
            // unroll cases like `(array/filter X (object/get @metric "filter" true))`
            // — where the metric had no `filter` and the default `true`
            // substituted in — don't compile to `.filter(true)` (which
            // TypeErrors at runtime; `.filter` wants a callback).
            "array/filter" => {
                // Known-array sources (literals, `.map`/`.filter` chains)
                // drop the `?? []` guard — same TS2869 rule as array/map.
                let known = fact(0).array;
                if fact(1).bool_literal == Some(true) {
                    if known {
                        format!("({})", a(0))
                    } else {
                        format!("({} as {})", or_empty(a(0)), elem_arr)
                    }
                } else if fact(1).bool_literal == Some(false) {
                    format!("([] as {})", elem_arr)
                } else if fact(1).object_literal {
                    // Object-form predicate `{ key: value, ... }`. Source
                    // cast routes through `ReadonlyArray<EntityRow>` so
                    // the index signature admits `__row[__k]` regardless
                    // of the inferred element type — entity-shaped rows
                    // are a strict subset of EntityRow.
                    if known {
                        format!(
                            "(({0}) as ReadonlyArray<EntityRow>).filter((__row) => Object.entries({1}).every(([__k, __v]) => __row[__k] === __v))",
                            a(0), a(1)
                        )
                    } else {
                        format!(
                            "(({0} ?? []) as ReadonlyArray<EntityRow>).filter((__row) => Object.entries({1}).every(([__k, __v]) => __row[__k] === __v))",
                            a(0), a(1)
                        )
                    }
                } else if fact(1).lambda_params.is_some() {
                    if known {
                        format!("({}).filter({})", a(0), a(1))
                    } else {
                        format!("({} as {}).filter({})", or_empty(a(0)), elem_arr, a(1))
                    }
                } else {
                    // A bare VALUE expression (not a lambda) used as the
                    // predicate — std-stats' author-only SExpr predicate
                    // slot convention (`(object/get @metric "filter"
                    // true)`, compiled to `getNestedValue(metric,
                    // "filter") ?? true`): the runtime value may be a
                    // genuine per-row predicate FUNCTION (author supplied
                    // one) or a plain boolean default. `getNestedValue`
                    // can't declare a function-typed return (`FieldValue`
                    // has none), and `.filter` needs an actual function —
                    // duck-type at runtime: call it per-row when it IS a
                    // function, else treat the value as a row-independent
                    // keep/drop decision. Fixes both the TS2345 (a
                    // `FieldValue` passed where `.filter` wants a
                    // predicate) and a real runtime bug (`.filter(true)`
                    // throws — `true` isn't callable).
                    let wrapped_pred = format!(
                        "((__row: {0}) => {{ const __pred = {1}; return typeof __pred === 'function' ? (__pred as (row: {0}) => boolean)(__row) : Boolean(__pred); }})",
                        elem, a(1)
                    );
                    if known {
                        format!("({}).filter({})", a(0), wrapped_pred)
                    } else {
                        format!("({} as {}).filter({})", or_empty(a(0)), elem_arr, wrapped_pred)
                    }
                }
            }
            "array/count" if args.len() >= 2 => format!("{}.filter({}).length", elem_array_arg(0), a(1)),
            "array/count" => format!("({} as {{ readonly length: number }}).length", or_empty(a(0))),
            "array/find" | "find" => format!("{}.find({})", elem_array_arg(0), a(1)),
            // JS `arr.reduce(fn, initial)` — the lolo arg order is
            // (array, initial, fn) (orbital-core evaluator `["reduce", …]`).
            // The explicit `EventPayloadValue` type param is required: with a
            // literal initial (`[]`/`0`) TS would otherwise pin U to the
            // literal's narrow type (`never[]`) and reject the widening
            // callback (TS2769). EventPayloadValue is the one wide value type
            // the whole client write path already uses.
            "array/reduce" => format!("{}.reduce<EventPayloadValue>({}, {})", array_arg(0), a(2), a(1)),
            "array/every" => format!("{}.every({})", elem_array_arg(0), a(1)),
            "array/some" => format!("{}.some({})", elem_array_arg(0), a(1)),
            "array/slice" if args.len() == 2 => format!("{}.slice({})", elem_array_arg(0), a(1)),
            "array/slice" => format!("{}.slice({}, {})", elem_array_arg(0), a(1), a(2)),
            "array/concat" => {
                let spreads: Vec<String> = args.iter().enumerate().map(|(i, a)| {
                    // Known non-nullish arrays (literals, `.map`/`.filter`/
                    // `.slice` chains, Array.from) must not get the `?? []`
                    // guard — TS2869 right-operand-unreachable.
                    if fact(i).array || fact(i).string || fact(i).object_literal {
                        format!("...({})", a)
                    } else if a.as_str() == "undefined" {
                        "...([])".to_string()
                    } else {
                        // Cast first: an unknown operand (a reducer accumulator) is the
                        // wide `EventPayloadValue`, not iterable as typed (TS2488).
                        format!("...(({} as readonly EventPayloadValue[] | undefined) ?? [])", a)
                    }
                }).collect();
                format!("[{}]", spreads.join(", "))
            }
            "array/reverse" => format!("[...{}].reverse()", elem_array_arg(0)),
            // Twin of @almadar/evaluator `evalArraySort(arr, key?, dir?)` and orbital-core `ArraySortOp`:
            // a null/empty key sorts the elements themselves, `dir` is "asc" (default) or else descending,
            // `<`/`>` ordering, stable.
            "array/sort" => {
                // Widen the key and direction to `string` so TS doesn't constant-fold the literal comparison
                // (TS2367) when the lolo passes a string literal. Params: see `sort_comparator_params`.
                let key = if args.len() > 1 { a(1) } else { "null" };
                let dir = if args.len() > 2 { a(2) } else { "\"asc\"" };
                format!(
                    "[...{0}].sort(({3}) => {{ {4} const k = ({1}) as string | null | undefined; const av = k ? (a as EntityRow)?.[k] : (a as EventPayloadValue), bv = k ? (b as EntityRow)?.[k] : (b as EventPayloadValue); const ord = cmp(av as EventPayloadValue | undefined, bv as EventPayloadValue | undefined); return (({2}) as string) === 'asc' ? ord : -ord; }})",
                    array_arg(0), key, dir, sort_comparator_params(0), SORT_COMPARE_TS
                )
            }
            "array/unique" => format!("[...new Set({})]", array_arg(0)),
            "array/flatten" if args.len() == 1 => format!("{}.flat()", or_empty(a(0))),
            "array/flatten" => format!("{}.flat({})", or_empty(a(0)), a(1)),
            // Bare `join` is the .lolo-era short name (operator_names.rs).
            // `.join` always returns a string, so no `?? ''` tail (same as
            // str/join above).
            "join" | "array/join" => format!("{}.join({})", array_arg(0), sa(1)),
            // ES2024 `Object.groupBy` would be the natural emission, but
            // the shell template targets ES2022. Inline a manual reduce so
            // the generated code runs on every consumer regardless of
            // their tsconfig target.
            "array/groupBy" => format!(
                "((({0} ?? []) as {2}).reduce((acc: Record<string, {3}[]>, item: {3}) => {{ const __k = String((item as EntityRow)?.[{1}] ?? ''); (acc[__k] ??= []).push(item); return acc; }}, {{}}))",
                a(0), a(1), elem_arr, elem
            ),
            // Field-name 2-arg form: the second arg is a STRING property
            // key on each row, not a callback. The reducer extracts
            // `Number(v?.[field]) || 0` per row, matching the runtime path's
            // `array/sum`/`avg`/`min`/`max` semantics in @almadar/std/modules/array.
            // Field-name arg goes through `sr` (String-coerce unless
            // already a quoted literal): a dynamic field name sourced from
            // config (e.g. `(object/get @metric "field" "")`, std-stats'
            // per-metric aggregation key) is honestly `FieldValue |
            // undefined` — `?? ""` alone only drops `undefined`, leaving
            // Date/array/object/boolean, none of which TS accepts as an
            // index type (TS2538) on `(v as EntityRow)?.[…]`.
            "sum" | "array/sum" if args.len() == 2 => format!("({} as {}).reduce((s: number, v: {}) => s + (Number((v as EntityRow)?.[{}]) || 0), 0)", array_arg(0), elem_arr, elem, sr(1)),
            // orbital-core `to_number`: numbers, numeric strings, booleans, null as 0; the rest adds 0.
            "sum" | "array/sum" => format!("{}.reduce((s: number, v) => s + (Number(v) || 0), 0)", array_arg(0)),
            // Cosine core shared by array/cosine + array/nearest — one Rust-side
            // definition (COSINE_TS), twin of the interpreter's
            // `cosine_similarity` (orbital-core evaluator) and the JS
            // evaluator's std/array.ts: identical results AND error conditions.
            "array/cosine" => format!(
                "(({cos})({0} as readonly number[], {1} as readonly number[]))",
                a(0), a(1), cos = COSINE_TS
            ),
            "array/nearest" => format!(
                "(((q: readonly number[], cs: readonly (readonly number[])[]) => {{ if (cs.length === 0) throw new Error('array/nearest: candidates array is empty, no nearest match exists'); const cos = {cos}; const scores = cs.map((c) => cos(q, c)); let bestIdx = 0; let bestScore = scores[0]; for (let i = 1; i < scores.length; i++) {{ if (scores[i] > bestScore) {{ bestScore = scores[i]; bestIdx = i; }} }} let second = -Infinity; for (let i = 0; i < scores.length; i++) {{ if (i !== bestIdx && scores[i] > second) second = scores[i]; }} return {{ index: bestIdx, score: bestScore, margin: scores.length === 1 ? 0 : bestScore - second }}; }})({0} as readonly number[], {1} as readonly (readonly number[])[]))",
                a(0), a(1), cos = COSINE_TS
            ),
            // Shared pure implementation imported from @almadar/core — the SAME
            // function the JS runtime path's contract/* operators call, so the
            // two paths cannot drift. Import wired per-hook via
            // `trait_calls_function` (effect/client.rs).
            "contract/validate-output" | "contract/validate-input" => format!(
                "validateContract({}, {} as ContractSpec)",
                a(0), a(1)
            ),
            "array/avg" if args.len() == 2 => format!("((arr: {0}) => arr.length ? arr.reduce((s: number, v: {1}) => s + (Number((v as EntityRow)?.[{2}]) || 0), 0) / arr.length : 0)(({3} as {0}))", elem_arr, elem, sr(1), array_arg(0)),
            "array/avg" => format!("((arr: {0}) => arr.length ? arr.reduce((s: number, v: {1}) => s + (Number(v) || 0), 0) / arr.length : 0)(({2} as {0}))", elem_arr, elem, array_arg(0)),
            "array/min" if args.len() == 2 => format!("((ns: readonly number[]) => (ns.length ? Math.min(...ns) : null))({NUMBERS_OF_TS}({}, {}))", array_arg(0), sr(1)),
            "array/min" => format!("((ns: readonly number[]) => (ns.length ? Math.min(...ns) : null))({NUMBERS_OF_TS}({}, undefined))", array_arg(0)),
            "array/max" if args.len() == 2 => format!("((ns: readonly number[]) => (ns.length ? Math.max(...ns) : null))({NUMBERS_OF_TS}({}, {}))", array_arg(0), sr(1)),
            "array/max" => format!("((ns: readonly number[]) => (ns.length ? Math.max(...ns) : null))({NUMBERS_OF_TS}({}, undefined))", array_arg(0)),
            "array/take" => format!("{}.slice(0, {})", elem_array_arg(0), a(1)),
            "array/takeLast" => format!("{}.slice(-({}))", elem_array_arg(0), a(1)),
            "array/drop" => format!("{}.slice({})", elem_array_arg(0), a(1)),
            "array/dropLast" => format!("{}.slice(0, -({}))", elem_array_arg(0), a(1)),
            "array/append" => format!("[...{}, {}]", array_arg(0), a(1)),
            "array/prepend" => format!("[{}, ...{}]", a(1), array_arg(0)),
            "array/insert" => format!("[...{0}.slice(0, {1}), {2}, ...{0}.slice({1})]", array_arg(0), a(1), a(2)),
            "array/remove" => format!("{}.filter((_, idx) => idx !== {})", elem_array_arg(0), a(1)),
            "array/removeItem" => format!(
                "((xs: readonly EventPayloadValue[], x: EventPayloadValue): EventPayloadValue[] => {{ const out = [...xs]; const k = out.indexOf(x); if (k >= 0) out.splice(k, 1); return out; }})({} as readonly EventPayloadValue[], {} as EventPayloadValue)",
                array_arg(0), a(1)
            ),
            "array/findIndex" => format!("{}.findIndex({})", elem_array_arg(0), a(1)),
            "array/indexOf" => format!("{}.indexOf({})", array_arg(0), a(1)),
            "array/shuffle" => format!("[...{}].sort(() => Math.random() - 0.5)", elem_array_arg(0)),
            "array/partition" => format!("[{0}.filter({1}), {0}.filter((x: {2}) => !({1})(x))]", array_arg(0), a(1), elem),
            "array/reject" => format!("{}.filter((x: {}) => !({})(x))", array_arg(0), elem, a(1)),
            "array/range" if args.len() == 1 => format!("Array.from({{ length: Math.ceil({0}) }}, (_, i) => i)", nc(0)),
            "array/range" if args.len() == 2 => format!("Array.from({{ length: Math.ceil(({1} - {0})) }}, (_, i) => {0} + i)", nc(0), nc(1)),
            "array/range" => {
                let step = if fact(2).number { format!("({})", a(2)) } else { format!("Number({} ?? 1)", a(2)) };
                format!("Array.from({{ length: Math.ceil(({1} - {0}) / {2}) }}, (_, i) => {0} + i * {2})", nc(0), nc(1), step)
            }
            "array/repeat" => format!("Array({}).fill({})", a(1), a(0)),

            // --- std-object ---
            "object/keys" => format!("Object.keys({} ?? {{}})", a(0)),
            "object/values" => format!("Object.values({} ?? {{}})", a(0)),
            "object/entries" if nn(0) => format!("Object.entries({})", a(0)),
            "object/entries" => format!("Object.entries({} ?? {{}})", a(0)),
            "object/fromEntries" => format!("Object.fromEntries({})", or_empty(a(0))),
            "object/deepMerge" => format!("structuredClone(Object.assign({{}}, {}, {}))", a(0), a(1)),
            // `getNestedValue` (from `@almadar/core`) owns the dot-path
            // walk — one typed implementation shared with the runtime path
            // instead of an inline untyped `reduce`. Its second param is a
            // real `string`; wrap a non-literal path arg in `String(…)`
            // (a wide payload/field read lowers to `EventPayloadValue |
            // undefined`) but pass an already-quoted literal path straight
            // through — `String("a.b")` would be redundant, and TS treats
            // it identically either way.
            "object/get" if args.len() == 2 => {
                format!("getNestedValue({}, {})", a(0), string_path(1))
            }
            // Wrap the whole `?? default` form in parens so consumer
            // expressions like `(object/get @x "k" "count") === "sum"` lower
            // to `(... ?? "count") === "sum"` instead of `... ?? "count" === "sum"`
            // (`???` has lower precedence than `===`, which would otherwise
            // make TS read `"count" === "sum"` as a literal-vs-literal
            // comparison and trip TS2367).
            "object/get" => format!(
                "(getNestedValue({}, {}) ?? {})",
                a(0),
                string_path(1),
                a(2)
            ),
            // Immutable set-by-(dot-)path: deep-clone the object, walk/create
            // intermediate nodes, assign the leaf, return the clone. Parity with
            // `object/get`'s dot-path read. Generic over the source row type so
            // the result keeps the caller's type; the walk cursor is the
            // widest record both `EntityRow` and `EventPayload` satisfy. The
            // nullish source is absorbed by the parameter type, so the `??`
            // inside is never an unreachable right operand (TS2869). The
            // cursor step narrows through a type predicate because
            // `Array.isArray` alone does not exclude `readonly` arrays.
            "object/set" if args.len() == 3 => format!(
                "(((__src: EntityRow | EventPayload | FieldValue | EventPayloadValue | null | undefined, __path: string, __value: FieldValue | EventPayloadValue) => {{ type __Rec = Record<string, FieldValue | EventPayloadValue | undefined>; const __isRec = (__x: EntityRow | EventPayload | FieldValue | EventPayloadValue | undefined): __x is __Rec => __x !== null && typeof __x === 'object' && !Array.isArray(__x) && !(__x instanceof Date); if (__src !== null && __src !== undefined && !__isRec(__src)) {{ throw new Error('object/set: expected object, got ' + typeof __src); }} const __o: __Rec = __src === null || __src === undefined ? {{}} : structuredClone(__src); let __c: __Rec = __o; const __ks = __path.split('.'); for (let __i = 0; __i < __ks.length - 1; __i += 1) {{ const __n = __c[__ks[__i]]; const __next: __Rec = __isRec(__n) ? __n : {{}}; __c[__ks[__i]] = __next; __c = __next; }} __c[__ks[__ks.length - 1]] = __value; return __o; }})({0}, String({1}), {2}))",
                a(0), a(1), a(2)
            ),
            "object/has" => format!("Object.prototype.hasOwnProperty.call(Object({}), String({}))", a(0), a(1)),
            // Both operands are bound as parameters first, so no name inside can capture one
            // of the caller's (a lambda parameter `k`, G-ORB-152).
            "object/pick" => format!(
                "((__o: EventPayloadValue | undefined, __keys: EventPayloadValue | undefined): Readonly<Record<string, EventPayloadValue>> => {{ const __src: Readonly<Record<string, EventPayloadValue>> = __o !== null && __o !== undefined && typeof __o === 'object' && !Array.isArray(__o) && !(__o instanceof Date) ? (__o as Readonly<Record<string, EventPayloadValue>>) : {{}}; return Object.fromEntries((Array.isArray(__keys) ? __keys : []).filter((__key): __key is string => typeof __key === 'string' && __key in __src).map((__key) => [__key, __src[__key]])); }})({}, {})",
                a(0), a(1)
            ),
            "object/omit" => format!(
                "((__o: EventPayloadValue | undefined, __keys: EventPayloadValue | undefined): Readonly<Record<string, EventPayloadValue>> => {{ const __drop: readonly EventPayloadValue[] = Array.isArray(__keys) ? __keys : []; return Object.fromEntries(Object.entries(__o !== null && __o !== undefined && typeof __o === 'object' && !Array.isArray(__o) && !(__o instanceof Date) ? (__o as Readonly<Record<string, EventPayloadValue>>) : {{}}).filter(([__key]) => !__drop.includes(__key))); }})({}, {})",
                a(0), a(1)
            ),
            "object/clone" => format!("({{ ...({} ?? {{}}) }})", a(0)),
            "object/equals" => format!("(JSON.stringify({}) === JSON.stringify({}))", a(0), a(1)),
            "object/filter" => format!("Object.fromEntries(Object.entries({} ?? {{}}).filter({}))", a(0), a(1)),

            // --- std-time ---
            "time/now" => "now".to_string(),
            "time/today" => "new Date(now).toISOString().slice(0, 10)".to_string(),
            "time/format" if args.len() == 1 => format!("new Date({}).toLocaleDateString()", dt(0)),
            // The 2-arg form takes a moment/dayjs-style TOKEN string
            // ("MMM D, YYYY"), not a BCP-47 locale — `toLocaleDateString`
            // threw `RangeError: Invalid language tag` when the format
            // string was passed as its locale argument (C-TIME-FORMAT-
            // TOKEN-AS-LOCALE). Mirrors `@almadar/evaluator`'s
            // `evalTimeFormat` (std/time.ts) token-for-token — that
            // function is the runtime path's only implementation, and a
            // compiled app doesn't depend on `@almadar/evaluator`, so the
            // token map is intentionally re-emitted here rather than
            // imported; keep the two in sync by hand.
            "time/format" => TIME_FORMAT_TOKEN_TEMPLATE
                .replace("__TS__", &dt(0))
                .replace("__FMT__", &a(1)),
            // Same semantics as orbital-core `TimeParseOp` and `@almadar/evaluator` `evalTimeParse`
            // (shared vectors `time-vectors.json`): RFC 3339 / ISO 8601, a date is midnight UTC, no
            // offset reads as UTC, anything else throws. Emitted inline: generated apps do not import
            // the evaluator, and `new Date(str)` reads an offset-less date-time as local time.
            "time/parse" => format!("{}({})", TIME_PARSE_TS, a(0)),
            // time/valid is time/parse's own emission with the failure mapped to false; null is false.
            "time/valid" => format!(
                "((__x: EventPayloadValue | undefined): boolean => {{ if (__x == null) return false; if (typeof __x !== 'string') throw new TypeError('Type mismatch: expected string, got ' + (Array.isArray(__x) ? 'array' : typeof __x)); try {{ {TIME_PARSE_TS}(__x); return true; }} catch (__e) {{ if (__e instanceof TypeError) throw __e; return false; }} }})({})",
                a(0)
            ),
            // Same buckets as `@almadar/evaluator` `evalTimeRelative` and orbital-core `TimeRelativeOp`.
            "time/relative" => format!(
                "((__ts: number): string => {{ const __d = __ts - now; const __ms = Math.abs(__d); const __M = 60000; const __H = 3600000; const __D = 86400000; if (__ms < __M) return 'just now'; const __pick: [number, string] = __ms < __H ? [Math.round(__ms / __M), 'minute'] : __ms < __D ? [Math.round(__ms / __H), 'hour'] : __ms < 7 * __D ? [Math.round(__ms / __D), 'day'] : __ms < 30 * __D ? [Math.round(__ms / (7 * __D)), 'week'] : __ms < 365 * __D ? [Math.round(__ms / (30 * __D)), 'month'] : [Math.round(__ms / (365 * __D)), 'year']; const __w = __pick[0] === 1 ? __pick[1] : __pick[1] + 's'; return __d < 0 ? `${{__pick[0]}} ${{__w}} ago` : `in ${{__pick[0]}} ${{__w}}`; }})({})",
                tn(0)
            ),
            // Amount operand goes through `nc` — a bare payload read is the
            // wide EventPayloadValue union and trips TS2362 on `*` (§25/§30 family).
            "time/add" => time_iife("__ts: number, __n: number, __u: string", "__shift(__ts, __n, __unit(__u))", &[tn(0), nc(1), sa(2)]),
            "time/subtract" => time_iife("__ts: number, __n: number, __u: string", "__shift(__ts, -__n, __unit(__u))", &[tn(0), nc(1), sa(2)]),
            "time/diff" if args.len() < 3 => format!("({} - {})", tn(0), tn(1)),
            "time/diff" => time_iife(
                "__a: number, __b: number, __u: string",
                "((__k: string, __d: number) => (__k in __FIXED ? Math.trunc(__d / __FIXED[__k]) : ((__m: number) => (__k === 'year' ? Math.trunc(__m / 12) : __k === 'quarter' ? Math.trunc(__m / 3) : __m))(__wholeMonths(__b, __a))))(__unit(__u), __a - __b)",
                &[tn(0), tn(1), sa(2)],
            ),
            // Mirrors `start_of` (orbital-core system.rs) and std/time.ts:
            // UTC buckets, ISO-8601 weeks start Monday, month/year via
            // Date.UTC; an unknown unit throws like parseTimeUnit.
            "time/startOf" => time_iife("__ts: number, __u: string", "__startOf(__ts, __unit(__u))", &[tn(0), sa(1)]),
            "time/endOf" => time_iife("__ts: number, __u: string", "((__k: string) => (__k === 'ms' ? Math.floor(__ts) : __shift(__startOf(__ts, __k), 1, __k) - 1))(__unit(__u))", &[tn(0), sa(1)]),
            "time/isBefore" => format!("({} < {})", a(0), a(1)),
            "time/isAfter" => format!("({} > {})", a(0), a(1)),
            "time/isPast" => format!("({} < now)", a(0)),
            "time/isFuture" => format!("({} > now)", a(0)),
            "time/year" => format!("new Date({}).getFullYear()", dt(0)),
            "time/month" => format!("(new Date({}).getMonth() + 1)", dt(0)),
            "time/day" => format!("new Date({}).getDate()", dt(0)),
            "time/hour" => format!("new Date({}).getHours()", dt(0)),
            "time/minute" => format!("new Date({}).getMinutes()", dt(0)),
            "time/weekday" => format!("new Date({}).getDay()", dt(0)),

            // --- std-validate ---
            "validate/required" => format!("({0} != null && {0} !== '')", a(0)),
            "validate/email" => format!("/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test({})", a(0)),
            // Mirrors `evalValidateUrl`: a non-string is not a URL.
            "validate/url" => format!("((__v: EventPayloadValue | undefined) => {{ if (typeof __v !== 'string') return false; try {{ new URL(__v); return true; }} catch {{ return false; }} }})({})", a(0)),
            "validate/phone" => format!("/^\\+?[\\d\\s()-]{{7,}}$/.test({})", a(0)),
            "validate/uuid" => format!("/^[0-9a-f]{{8}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{12}}$/i.test({})", a(0)),
            "validate/pattern" => format!("new RegExp({}).test({})", a(1), a(0)),
            "validate/min" => format!("({} >= {})", a(0), a(1)),
            "validate/max" => format!("({} <= {})", a(0), a(1)),
            "validate/range" => format!("({0} >= {1} && {0} <= {2})", a(0), a(1), a(2)),
            "validate/minLength" => format!("(({} ?? '').length >= {})", a(0), a(1)),
            "validate/maxLength" => format!("(({} ?? '').length <= {})", a(0), a(1)),
            "validate/length" if args.len() == 2 => format!("(({} ?? '').length >= {})", a(0), a(1)),
            "validate/length" => format!("(({0} ?? '').length >= {1} && ({0} ?? '').length <= {2})", a(0), a(1), a(2)),
            "validate/equals" => format!("({} === {})", a(0), a(1)),
            "validate/oneOf" => format!("{}.includes({})", or_empty(a(1)), a(0)),

            // --- std-format ---
            // Mirror `evalFormatNumber`/`evalFormatCurrency`: `en-US` unless a locale is given,
            // `{ decimals }` fixes the fraction digits. `Number(…)` types the value as
            // the runtime passes it (a missing one formats as NaN on both paths).
            "format/number" if args.len() == 1 => format!("new Intl.NumberFormat('en-US').format(Number({}))", a(0)),
            "format/number" => format!("((__o: {{ decimals?: number; locale?: string }} | undefined) => new Intl.NumberFormat(__o?.locale ?? 'en-US', __o?.decimals !== undefined ? {{ minimumFractionDigits: __o.decimals, maximumFractionDigits: __o.decimals }} : {{}}))({}).format(Number({}))", a(1), a(0)),
            "format/currency" if args.len() == 2 => format!("new Intl.NumberFormat('en-US', {{ style: 'currency', currency: String({}) }}).format(Number({}))", a(1), a(0)),
            "format/currency" => format!("new Intl.NumberFormat(String({}), {{ style: 'currency', currency: String({}) }}).format(Number({}))", a(2), a(1), a(0)),
            // Mirrors `evalFormatPercent`: `en-US`, the decimals fix both fraction-digit bounds (default 0).
            "format/percent" if args.len() == 1 => format!("new Intl.NumberFormat('en-US', {{ style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 0 }}).format(Number({}))", a(0)),
            "format/percent" => format!("((__d: number) => new Intl.NumberFormat('en-US', {{ style: 'percent', minimumFractionDigits: __d, maximumFractionDigits: __d }}))(Number({})).format(Number({}))", a(1), a(0)),
            "format/list" if args.len() == 1 => format!("new Intl.ListFormat().format({})", a(0)),
            "format/list" => format!("new Intl.ListFormat(undefined, {}).format({})", a(1), a(0)),
            "format/plural" => format!("({} === 1 ? {} : {})", a(0), a(1), a(2)),
            "format/ordinal" => format!("({0} + (['th','st','nd','rd'][({0} % 100 - 20) % 10] ?? ['th','st','nd','rd'][{0} % 100] ?? 'th'))", a(0)),

            // --- G-CROSS-041: the encoded quote body decodes to the quoted data ---
            "quote" => format!("JSON.parse({})", a(0)),
            // --- Language trio: the shared @almadar/core helpers the JS runtime
            // path calls (imported where `trait_calls_function` sees them) ---
            "quasiquote" => {
                let holes: Vec<String> = (1..args.len())
                    .map(|i| format!("toProgramData({})", a(i)))
                    .collect();
                format!("instantiateQuasiquote({}, [{}])", a(0), holes.join(", "))
            }
            "behavior/apply" => format!(
                "toProgramData(applyBehaviorOverrides(BehaviorValueSchema.parse({}), JsonValueSchema.parse({})))",
                a(0),
                a(1)
            ),
            "behavior/ref" => format!("behaviorRef(String({}))", a(0)),

            // --- Pipeline-1 parity superset (B1): canonical expression
            // operators the older `compile_operator_call` handled but this
            // table lacked. Ported verbatim (string-arg form) so this is the
            // single emitter — without them P2 fell through to the broken
            // `op/name(args)` default. ---
            "str/trimStart" => format!("({}).trimStart()", sr(0)),
            "str/trimEnd" => format!("({}).trimEnd()", sr(0)),
            "str/padStart" if args.len() > 2 => format!("({}).padStart({}, {})", sr(0), a(1), sa(2)),
            "str/padStart" => format!("({}).padStart({})", sr(0), a(1)),
            "str/padEnd" if args.len() > 2 => format!("({}).padEnd({}, {})", sr(0), a(1), sa(2)),
            "str/padEnd" => format!("({}).padEnd({})", sr(0), a(1)),
            "str/titleCase" => format!(
                "({}).split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')",
                sr(0)
            ),
            "str/camelCase" => format!(
                "({}).split(/[-_\\s]+/).map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('')",
                sr(0)
            ),
            "str/kebabCase" => format!(
                "({}).replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[\\s_]+/g, '-').toLowerCase()",
                sr(0)
            ),
            "str/snakeCase" => format!(
                "({}).replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[\\s-]+/g, '_').toLowerCase()",
                sr(0)
            ),

            "time/second" => format!("new Date({}).getSeconds()", dt(0)),
            "time/isBetween" => format!("({0} >= {1} && {0} <= {2})", a(0), a(1), a(2)),
            "time/isSame" if args.len() < 3 => format!("({} === {})", tn(0), tn(1)),
            "time/isSame" => time_iife("__a: number, __b: number, __u: string", "((__k: string) => __startOf(__a, __k) === __startOf(__b, __k))(__unit(__u))", &[tn(0), tn(1), sa(2)]),
            "time/isToday" => format!(
                "(new Date({}).setHours(0,0,0,0) === new Date(now).setHours(0,0,0,0))",
                dt(0)
            ),
            "time/duration" => format!("formatDuration({})", a(0)),

            "validate/string" => format!("typeof ({}) === 'string'", a(0)),
            "validate/number" => format!("typeof ({0}) === 'number' && !isNaN({0})", a(0)),
            "validate/boolean" => format!("typeof ({}) === 'boolean'", a(0)),
            "validate/array" => format!("Array.isArray({})", a(0)),
            "validate/object" => format!(
                "typeof ({0}) === 'object' && {0} !== null && !Array.isArray({0})",
                a(0)
            ),
            "validate/date" => format!("!isNaN(Date.parse({}))", a(0)),
            "validate/creditCard" => format!("validateCreditCard({})", a(0)),
            "validate/noneOf" => format!("!({}).includes({})", a(1), a(0)),
            "validate/check" => format!("({})({})", a(1), a(0)),

            "object/deepClone" => format!("JSON.parse(JSON.stringify({}))", a(0)),
            // Mirror `evalObjectMapValues`/`evalObjectMapKeys`: the lambda gets the value
            // (resp. the key) alone, and a new key is `String(…)`.
            "object/mapValues" => format!(
                "Object.fromEntries(Object.entries({}).map(([key, value]) => [key, ({})(value)]))",
                a(0), a(1)
            ),
            "object/mapKeys" => format!(
                "Object.fromEntries(Object.entries({}).map(([key, value]) => [String(({})(key)), value]))",
                a(0), a(1)
            ),

            "array/zip" => format!("({0}).map((v, i) => [v, ({1})[i]])", a(0), a(1)),

            // OS triggers are server-side; on the client they're inert.
            "os/watch-files" | "os/watch-process" | "os/watch-port" | "os/watch-http"
            | "os/watch-cron" | "os/watch-signal" | "os/watch-env" | "os/debounce" => {
                format!("/* server-side: {} ({}) */", function, args.join(", "))
            }

            // --- Grid / tilemap (std-grid) — inline, mirroring
            // orbital-core::evaluator::operators::grid (cells are `{x,y}`). ---
            "grid/in-bounds" => format!(
                "({0} >= 0 && {0} < {2} && {1} >= 0 && {1} < {3})",
                gx(0), gy(0), gn(1), gn(2)
            ),
            "grid/manhattan-distance" => format!(
                "(Math.abs({} - {}) + Math.abs({} - {}))",
                gx(0), gx(1), gy(0), gy(1)
            ),
            "grid/distance" => format!(
                "Math.max(Math.abs({} - {}), Math.abs({} - {}))",
                gx(0), gx(1), gy(0), gy(1)
            ),
            "grid/to-world" => format!(
                "({{ x: ({0} + 0.5) * {2}, y: ({1} + 0.5) * {2} }})",
                gx(0), gy(0), gn(1)
            ),
            "grid/from-world" => format!(
                "({{ x: Math.floor({0} / {2}), y: Math.floor({1} / {2}) }})",
                gx(0), gy(0), gn(1)
            ),
            "grid/iso-to-screen" => format!(
                "({{ x: ({0} - {1}) * {2} / 2, y: ({0} + {1}) * {3} / 2 }})",
                gx(0), gy(0), gn(1), gn(2)
            ),
            "grid/screen-to-iso" => format!(
                "({{ x: ({0} / ({2} / 2) + {1} / ({3} / 2)) / 2, y: ({1} / ({3} / 2) - {0} / ({2} / 2)) / 2 }})",
                gx(0), gy(0), gn(1), gn(2)
            ),
            "grid/neighbors" => format!(
                "((): Array<{{ x: number; y: number }}> => {{ const _x = {0}; const _y = {1}; const _o: Array<{{ x: number; y: number }}> = [{{ x: _x, y: _y - 1 }}, {{ x: _x + 1, y: _y }}, {{ x: _x, y: _y + 1 }}, {{ x: _x - 1, y: _y }}]; if ({2}) {{ _o.push({{ x: _x + 1, y: _y - 1 }}, {{ x: _x + 1, y: _y + 1 }}, {{ x: _x - 1, y: _y + 1 }}, {{ x: _x - 1, y: _y - 1 }}); }} return _o; }})()",
                gx(0), gy(0), a(1)
            ),
            "grid/cells-in-radius" => format!(
                "((): Array<{{ x: number; y: number }}> => {{ const _x = {0}; const _y = {1}; const _r = {2}; const _ri = Math.floor(_r); const _r2 = _r * _r; const _o: Array<{{ x: number; y: number }}> = []; for (let _dy = -_ri; _dy <= _ri; _dy++) {{ for (let _dx = -_ri; _dx <= _ri; _dx++) {{ if (_dx * _dx + _dy * _dy <= _r2) _o.push({{ x: _x + _dx, y: _y + _dy }}); }} }} return _o; }})()",
                gx(0), gy(0), gn(1)
            ),
            "grid/line" => format!(
                "((): Array<{{ x: number; y: number }}> => {{ let _x0 = Math.trunc({0}); let _y0 = Math.trunc({1}); const _x1 = Math.trunc({2}); const _y1 = Math.trunc({3}); const _dx = Math.abs(_x1 - _x0); const _dy = -Math.abs(_y1 - _y0); const _sx = _x0 < _x1 ? 1 : -1; const _sy = _y0 < _y1 ? 1 : -1; let _err = _dx + _dy; const _o: Array<{{ x: number; y: number }}> = []; for (;;) {{ _o.push({{ x: _x0, y: _y0 }}); if (_x0 === _x1 && _y0 === _y1) break; const _e2 = 2 * _err; if (_e2 >= _dy) {{ _err += _dy; _x0 += _sx; }} if (_e2 <= _dx) {{ _err += _dx; _y0 += _sy; }} }} return _o; }})()",
                gx(0), gy(0), gx(1), gy(1)
            ),

            // --- Geometry (std-geo) — inline, mirroring
            // @almadar/evaluator std/geo.ts. Rects `{x,y,w,h}`, circles
            // `{x,y,r}`, points `{x,y}`. ---
            "geo/aabb-overlap" => {
                let (ax, ay, aw, ah) = (gx(0), gy(0), gw(0), gh(0));
                let (bx, by, bw, bh) = (gx(1), gy(1), gw(1), gh(1));
                format!("({ax} < {bx} + {bw} && {ax} + {aw} > {bx} && {ay} < {by} + {bh} && {ay} + {ah} > {by})")
            }
            "geo/circle-overlap" => {
                let (ax, ay, ar) = (gx(0), gy(0), gr(0));
                let (bx, by, br) = (gx(1), gy(1), gr(1));
                let dx = format!("({ax} - {bx})");
                let dy = format!("({ay} - {by})");
                format!("(Math.sqrt({dx} * {dx} + {dy} * {dy}) <= {ar} + {br})")
            }
            "geo/point-in-rect" => {
                let (px, py) = (gx(0), gy(0));
                let (rx, ry, rw, rh) = (gx(1), gy(1), gw(1), gh(1));
                format!("({px} >= {rx} && {px} <= {rx} + {rw} && {py} >= {ry} && {py} <= {ry} + {rh})")
            }
            "geo/point-in-circle" => {
                let (px, py) = (gx(0), gy(0));
                let (cx, cy, cr) = (gx(1), gy(1), gr(1));
                let dx = format!("({px} - {cx})");
                let dy = format!("({py} - {cy})");
                format!("({dx} * {dx} + {dy} * {dy} <= {cr} * {cr})")
            }
            "geo/rect-circle-overlap" => {
                let (rx, ry, rw, rh) = (gx(0), gy(0), gw(0), gh(0));
                let (cx, cy, cr) = (gx(1), gy(1), gr(1));
                format!(
                    "(((): boolean => {{ const _ccx = Math.min(Math.max({cx}, {rx}), {rx} + {rw}); const _ccy = Math.min(Math.max({cy}, {ry}), {ry} + {rh}); const _dx = {cx} - _ccx; const _dy = {cy} - _ccy; return _dx * _dx + _dy * _dy <= {cr} * {cr}; }})())"
                )
            }
            "geo/reflect" => {
                let (vx, vy, vz) = (gx(0), gy(0), gz(0));
                let (nx, ny, nz) = (gx(1), gy(1), gz(1));
                let a0 = a(0);
                format!(
                    "(((): {{ x: number; y: number; z?: number }} => {{ const _d = {vx} * {nx} + {vy} * {ny} + {vz} * {nz}; const _rx = {vx} - {nx} * 2 * _d; const _ry = {vy} - {ny} * 2 * _d; const _rz = {vz} - {nz} * 2 * _d; return (typeof ({a0})?.z === 'number') ? {{ x: _rx, y: _ry, z: _rz }} : {{ x: _rx, y: _ry }}; }})())"
                )
            }
            "geo/segment-intersect" => {
                let sf = |i: usize, k: &str| {
                    let arg = a(i);
                    format!("((({arg}) as {{ readonly {k}?: number }} | undefined)?.{k} ?? 0)")
                };
                let (s1x1, s1y1, s1x2, s1y2) = (sf(0, "x1"), sf(0, "y1"), sf(0, "x2"), sf(0, "y2"));
                let (s2x1, s2y1, s2x2, s2y2) = (sf(1, "x1"), sf(1, "y1"), sf(1, "x2"), sf(1, "y2"));
                format!(
                    "(((): {{ x: number; y: number }} | null => {{ const _rx = {s1x2} - {s1x1}; const _ry = {s1y2} - {s1y1}; const _sx = {s2x2} - {s2x1}; const _sy = {s2y2} - {s2y1}; const _denom = _rx * _sy - _ry * _sx; if (_denom === 0) return null; const _qpx = {s2x1} - {s1x1}; const _qpy = {s2y1} - {s1y1}; const _t = (_qpx * _sy - _qpy * _sx) / _denom; const _u = (_qpx * _ry - _qpy * _rx) / _denom; if (_t < 0 || _t > 1 || _u < 0 || _u > 1) return null; return {{ x: {s1x1} + _t * _rx, y: {s1y1} + _t * _ry }}; }})())"
                )
            }

            // --- Vectors (std-vector) — inline, mirroring
            // @almadar/evaluator std/vector.ts. Vectors are `{x,y[,z]}`; a
            // result carries `z` only when the FIRST operand has one. ---
            "vec/add" => {
                let (ax, ay, az) = (gx(0), gy(0), gz(0));
                let (bx, by, bz) = (gx(1), gy(1), gz(1));
                let a0 = a(0);
                format!("({{ x: {ax} + {bx}, y: {ay} + {by}, ...(typeof ({a0})?.z === 'number' ? {{ z: {az} + {bz} }} : {{}}) }})")
            }
            "vec/sub" => {
                let (ax, ay, az) = (gx(0), gy(0), gz(0));
                let (bx, by, bz) = (gx(1), gy(1), gz(1));
                let a0 = a(0);
                format!("({{ x: {ax} - {bx}, y: {ay} - {by}, ...(typeof ({a0})?.z === 'number' ? {{ z: {az} - {bz} }} : {{}}) }})")
            }
            "vec/scale" => {
                let (ax, ay, az) = (gx(0), gy(0), gz(0));
                let k = a(1);
                let a0 = a(0);
                format!("({{ x: {ax} * ({k}), y: {ay} * ({k}), ...(typeof ({a0})?.z === 'number' ? {{ z: {az} * ({k}) }} : {{}}) }})")
            }
            "vec/dot" => format!(
                "({ax} * {bx} + {ay} * {by} + {az} * {bz})",
                ax = gx(0), ay = gy(0), az = gz(0), bx = gx(1), by = gy(1), bz = gz(1)
            ),
            "vec/cross" => {
                let (ax, ay, az) = (gx(0), gy(0), gz(0));
                let (bx, by, bz) = (gx(1), gy(1), gz(1));
                let a0 = a(0);
                format!(
                    "(typeof ({a0})?.z === 'number' ? {{ x: {ay} * {bz} - {az} * {by}, y: {az} * {bx} - {ax} * {bz}, z: {ax} * {by} - {ay} * {bx} }} : ({ax} * {by} - {ay} * {bx}))"
                )
            }
            "vec/length" => {
                let (ax, ay, az) = (gx(0), gy(0), gz(0));
                format!("Math.sqrt({ax} * {ax} + {ay} * {ay} + {az} * {az})")
            }
            "vec/length-sq" => {
                let (ax, ay, az) = (gx(0), gy(0), gz(0));
                format!("({ax} * {ax} + {ay} * {ay} + {az} * {az})")
            }
            "vec/distance" => {
                let dx = format!("({} - {})", gx(0), gx(1));
                let dy = format!("({} - {})", gy(0), gy(1));
                let dz = format!("({} - {})", gz(0), gz(1));
                format!("Math.sqrt({dx} * {dx} + {dy} * {dy} + {dz} * {dz})")
            }
            "vec/distance-sq" => {
                let dx = format!("({} - {})", gx(0), gx(1));
                let dy = format!("({} - {})", gy(0), gy(1));
                let dz = format!("({} - {})", gz(0), gz(1));
                format!("({dx} * {dx} + {dy} * {dy} + {dz} * {dz})")
            }
            "vec/normalize" => {
                let (ax, ay, az) = (gx(0), gy(0), gz(0));
                let a0 = a(0);
                format!(
                    "(((): {{ x: number; y: number; z?: number }} => {{ const _len = Math.sqrt({ax} * {ax} + {ay} * {ay} + {az} * {az}); if (_len === 0) return (typeof ({a0})?.z === 'number') ? {{ x: 0, y: 0, z: 0 }} : {{ x: 0, y: 0 }}; return {{ x: {ax} / _len, y: {ay} / _len, ...(typeof ({a0})?.z === 'number' ? {{ z: {az} / _len }} : {{}}) }}; }})())"
                )
            }
            "vec/lerp" => {
                let (ax, ay, az) = (gx(0), gy(0), gz(0));
                let (bx, by, bz) = (gx(1), gy(1), gz(1));
                let t = a(2);
                let a0 = a(0);
                format!("({{ x: {ax} + ({bx} - {ax}) * ({t}), y: {ay} + ({by} - {ay}) * ({t}), ...(typeof ({a0})?.z === 'number' ? {{ z: {az} + ({bz} - {az}) * ({t}) }} : {{}}) }})")
            }
            "vec/angle" if args.len() <= 1 => format!("Math.atan2({}, {})", gy(0), gx(0)),
            "vec/angle" => {
                let (ax, ay, az) = (gx(0), gy(0), gz(0));
                let (bx, by, bz) = (gx(1), gy(1), gz(1));
                format!(
                    "(((): number => {{ const _la = Math.sqrt({ax} * {ax} + {ay} * {ay} + {az} * {az}); const _lb = Math.sqrt({bx} * {bx} + {by} * {by} + {bz} * {bz}); if (_la * _lb === 0) return 0; const _d = ({ax} * {bx} + {ay} * {by} + {az} * {bz}) / (_la * _lb); return Math.acos(Math.min(Math.max(_d, -1), 1)); }})())"
                )
            }
            "vec/rotate" => {
                let (ax, ay, az) = (gx(0), gy(0), gz(0));
                let rad = a(1);
                let a0 = a(0);
                format!(
                    "(((): {{ x: number; y: number; z?: number }} => {{ const _c = Math.cos({rad}); const _s = Math.sin({rad}); return {{ x: {ax} * _c - {ay} * _s, y: {ax} * _s + {ay} * _c, ...(typeof ({a0})?.z === 'number' ? {{ z: {az} }} : {{}}) }}; }})())"
                )
            }
            "vec/clamp-length" => {
                let (ax, ay, az) = (gx(0), gy(0), gz(0));
                let max = a(1);
                let a0 = a(0);
                format!(
                    "(((): {{ x: number; y: number; z?: number }} => {{ const _len = Math.sqrt({ax} * {ax} + {ay} * {ay} + {az} * {az}); const _max = {max}; if (_len > _max) {{ if (_len === 0) return (typeof ({a0})?.z === 'number') ? {{ x: 0, y: 0, z: 0 }} : {{ x: 0, y: 0 }}; const _k = _max / _len; return {{ x: {ax} * _k, y: {ay} * _k, ...(typeof ({a0})?.z === 'number' ? {{ z: {az} * _k }} : {{}}) }}; }} return {{ x: {ax}, y: {ay}, ...(typeof ({a0})?.z === 'number' ? {{ z: {az} }} : {{}}) }}; }})())"
                )
            }

            // Render-time message lookup: the view takes `__t` from
            // `useTranslate()`; params reach it as strings.
            "i18n/t" if args.len() > 1 && nn(1) => format!(
                "__t({}, Object.fromEntries(Object.entries({}).map(([k, v]) => [k, String(v)])))",
                a(0),
                a(1)
            ),
            "i18n/t" if args.len() > 1 => format!(
                "__t({}, Object.fromEntries(Object.entries({} ?? {{}}).map(([k, v]) => [k, String(v)])))",
                a(0),
                a(1)
            ),
            "i18n/t" => format!("__t({})", a(0)),

            // --- Fallback ---
            // No explicit inline arm. The emitted app is standalone — it does
            // NOT import @almadar/runtime or @almadar/evaluator — so a bare
            // `opName(args)` pass-through is always wrong for a namespaced op:
            // `geo/aabb-overlap(a,b)` parses as JS division/subtraction and
            // silently corrupts the output. Mark EVERY armless op with the
            // shared sentinel so generate.rs hard-fails loudly before shipping
            // a broken stub (C-EMIT-NAMESPACED-FALLBACK). Service-bridge ops
            // (llm/*, workspace/*, session/*, …) are provided by the
            // almadar-shell substrate and get real arms in a follow-up; until
            // then they fail loud, never silent.
            _ => format!(
                "undefined /* {} */",
                orbital_core::unsupported_operator_marker(function)
            ),
        }
    }
}

#[cfg(test)]
mod twin_survivor_tests {
    use crate::codegen::infer::ArgFacts;

    /// What an argument IS — the caller reads it off the OIR; these tests state it.
    fn arr() -> ArgFacts {
        ArgFacts {
            array: true,
            never_nullish: true,
            ..Default::default()
        }
    }
    fn num() -> ArgFacts {
        ArgFacts {
            number: true,
            never_nullish: true,
            ..Default::default()
        }
    }
    fn st(v: &str) -> ArgFacts {
        ArgFacts {
            string: true,
            never_nullish: true,
            string_value: Some(v.to_string()),
            ..Default::default()
        }
    }
    fn never_null() -> ArgFacts {
        ArgFacts {
            never_nullish: true,
            ..Default::default()
        }
    }
    fn opaque() -> ArgFacts {
        ArgFacts::default()
    }

    /// std-prob-galton: `(array/reduce (array/range 5) [] (fn acc r (array/concat @acc …)))`.
    /// The accumulator is the wide `EventPayloadValue`; spreading `acc ?? []` is TS2488.
    /// An unknown operand is cast to an array first, as every other array operand is.
    #[test]
    fn array_concat_casts_an_unknown_operand_before_spreading() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed(
            "array/concat",
            &["acc".into(), "[1]".into()],
            &[opaque(), arr()],
            None,
        );
        assert!(
            ts.contains("...((acc as readonly EventPayloadValue[] | undefined) ?? [])"),
            "{ts}"
        );
        assert!(
            ts.contains("...([1])"),
            "control: a literal spreads as is: {ts}"
        );
    }

    /// kflow-import stringifies `{ summary: …, items: … }`: an object literal is never nullish,
    /// so `?? null` after it is unreachable (TS2869).
    #[test]
    fn json_stringify_of_a_never_nullish_operand_takes_no_fallback() {
        let b = TypeScriptBackend::new();
        let lit = ArgFacts {
            object_literal: true,
            never_nullish: true,
            ..Default::default()
        };
        let ts = b.call_to_ts_typed("json/stringify", &["{ a: 1 }".into()], &[lit], None);
        assert_eq!(ts, "(JSON.stringify({ a: 1 }) ?? 'null')");
        let wide = b.call_to_ts_typed("json/stringify", &["x".into()], &[], None);
        assert_eq!(
            wide, "(JSON.stringify(x ?? null) ?? 'null')",
            "control: a nullable operand keeps it"
        );
    }

    /// `(array/range @entity.totalItems)`: a field read is `EventPayloadValue`, which
    /// `Math.ceil` rejects (TS2345); every bound is coerced to a number, as the evaluator does.
    #[test]
    fn array_range_coerces_a_wide_bound_to_a_number() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed("array/range", &["fields?.totalItems".into()], &[], None);
        assert!(
            ts.contains("Math.ceil(Number(fields?.totalItems ?? 0))"),
            "{ts}"
        );
        let known = b.call_to_ts_typed("array/range", &["192".into()], &[num()], None);
        assert!(
            known.contains("Math.ceil((192))"),
            "control: a known number is not re-coerced: {known}"
        );
        let two = b.call_to_ts_typed("array/range", &["lo".into(), "hi".into()], &[], None);
        assert!(two.contains("(_, i) => Number(lo ?? 0) + i"), "{two}");
    }

    /// `array/sum` adds what orbital-core's `to_number` accepts (numbers, numeric strings,
    /// booleans, null as 0): a mapped field read is `FieldValue | undefined`, and a bare
    /// `s + v` both mistypes (TS2365) and concatenates a string.
    #[test]
    fn array_sum_coerces_each_element_like_the_core_evaluator() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed("array/sum", &["xs".into()], &[], None);
        assert!(
            ts.contains(".reduce((s: number, v) => s + (Number(v) || 0), 0)"),
            "{ts}"
        );
        let keyed = b.call_to_ts_typed("array/sum", &["xs".into(), "\"n\"".into()], &[], None);
        assert!(
            keyed.contains("(Number((v as EntityRow)?.["),
            "control: the keyed form is unchanged: {keyed}"
        );
    }

    /// std-agent-session casts `@entity.entries` to its declared element, a union of message
    /// shapes: `readonly A | B[]` binds `[]` to B alone (TS1354), so the element is parenthesized.
    #[test]
    fn a_union_element_array_cast_parenthesizes_the_element() {
        let b = TypeScriptBackend::new();
        let union = "{ role: string } | { tool: string }";
        let ts = b.call_to_ts_typed(
            "array/map",
            &["src".into(), "((x) => x)".into()],
            &[],
            Some(union),
        );
        assert!(
            ts.contains("as readonly ({ role: string } | { tool: string })[]"),
            "{ts}"
        );
        let plain = b.call_to_ts_typed(
            "array/map",
            &["src".into(), "((x) => x)".into()],
            &[],
            Some("EntityRow"),
        );
        assert!(
            plain.contains("as readonly EntityRow[]"),
            "control: a single element stays bare: {plain}"
        );
    }

    /// `time/relative` emits the same buckets as the runtime evaluator and orbital-core
    /// (just now / minutes / hours / days / weeks / 30-day months / 365-day years), measured
    /// from the app's `now` — never an UNSUPPORTED marker.
    #[test]
    fn time_relative_emits_the_shared_buckets() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed("time/relative", &["stamp".into()], &[], None);
        assert!(!ts.contains("UNSUPPORTED"), "{ts}");
        assert!(ts.contains("- now") && ts.contains("'just now'"), "{ts}");
        for unit in ["'minute'", "'hour'", "'day'", "'week'", "'month'", "'year'"] {
            assert!(ts.contains(unit), "{unit}: {ts}");
        }
        assert!(ts.contains(" ago") && ts.contains("in ${"), "{ts}");
    }

    /// `array/count` counts the elements a predicate keeps, or the whole array without one —
    /// the orbital-core `CountOp` array forms.
    #[test]
    fn array_count_counts_with_and_without_a_predicate() {
        let b = TypeScriptBackend::new();
        let with = b.call_to_ts_typed(
            "array/count",
            &["xs".into(), "((x) => x)".into()],
            &[],
            None,
        );
        assert!(
            !with.contains("UNSUPPORTED") && with.contains(".filter(") && with.contains(".length"),
            "{with}"
        );
        let without = b.call_to_ts_typed("array/count", &["xs".into()], &[], None);
        assert!(
            !without.contains("UNSUPPORTED")
                && without.contains(".length")
                && !without.contains(".filter("),
            "{without}"
        );
    }

    #[test]
    fn array_remove_item_drops_the_first_match_only() {
        let b = TypeScriptBackend::new();
        let out = b.call_to_ts_typed("array/removeItem", &["xs".into(), "x".into()], &[], None);
        assert!(!out.contains("UNSUPPORTED"), "{out}");
        assert!(
            out.contains(".indexOf(") && out.contains(".splice("),
            "{out}"
        );
    }

    /// `array/max` / `array/min` follow the one contract (G-CROSS-082, both evaluators):
    /// elements — or their field, in the two-argument form — read like `Value::to_number`
    /// (others skipped), and `null` when nothing counts. Never `Math.max(...(xs as
    /// EntityRow[]))` (TS2345) nor a `0`/`-Infinity` for an empty list.
    #[test]
    fn array_max_and_min_follow_the_one_contract() {
        let b = TypeScriptBackend::new();
        for (op, call) in [
            ("array/max", "Math.max(...ns)"),
            ("array/min", "Math.min(...ns)"),
        ] {
            let ts = b.call_to_ts_typed(op, &["xs".into()], &[], None);
            assert!(
                ts.contains(call) && ts.contains(": null)") && ts.contains("(xs"),
                "{op}: {ts}"
            );
            assert!(ts.contains(", undefined)"), "{op}: no field: {ts}");
            assert!(!ts.contains("EntityRow"), "{op}: {ts}");
            let field = b.call_to_ts_typed(
                op,
                &["xs".into(), "\"price\"".into()],
                &[opaque(), st("price")],
                None,
            );
            assert!(
                field.contains(call) && field.contains(": null)") && field.contains(", \"price\")"),
                "{op} field form: {field}"
            );
        }
    }
    /// `Array.isArray` does not narrow a `readonly EventPayloadValue[]` out of the
    /// union (TS7053 on `e[key]` in the emitted site), so the field read narrows
    /// through a record predicate; the values follow the one coercion contract.
    #[test]
    fn array_max_field_read_narrows_through_a_record_predicate() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed(
            "array/max",
            &["xs".into(), "\"price\"".into()],
            &[opaque(), st("price")],
            None,
        );
        assert!(
            ts.contains("x is Readonly<Record<string, EventPayloadValue>>"),
            "{ts}"
        );
        assert!(
            !ts.contains("!Array.isArray(e) && !(e instanceof Date) && key in e ? e[key]"),
            "{ts}"
        );
        for (xs, key, expected) in [
            (
                "[{ price: 3 }, { price: '9' }, { price: true }, [7], { other: 50 }]",
                "\"price\"",
                "9",
            ),
            ("[3, '4', null, 'x', '']", "undefined", "4"),
            ("[[1], { price: 2 }]", "undefined", "null"),
            ("[]", "\"price\"", "null"),
        ] {
            let call = b.call_to_ts_typed(
                "array/max",
                &["xs".into(), key.into()],
                &[opaque(), opaque()],
                None,
            );
            let call = if key == "undefined" {
                b.call_to_ts_typed("array/max", &["xs".into()], &[], None)
            } else {
                call
            };
            let script = format!("type EventPayloadValue = string | number | boolean | null | Date | readonly EventPayloadValue[] | {{ readonly [k: string]: EventPayloadValue }}; const xs = {xs}; process.stdout.write(JSON.stringify({call}));");
            let out = std::process::Command::new("node")
                .args(["--input-type=module-typescript", "-e", &script])
                .output()
                .expect("node must be on PATH");
            assert!(
                out.status.success(),
                "{script}\n{}",
                String::from_utf8_lossy(&out.stderr)
            );
            assert_eq!(String::from_utf8(out.stdout).unwrap(), expected, "{xs}");
        }
    }
    /// `json/parse` / `json/stringify` keep the kernel's contract (orbital-core
    /// `operators/json.rs`): parse never throws (invalid JSON or a non-string → null),
    /// stringify gives a JSON string for any value (`null` where JSON has no form).
    #[test]
    fn json_parse_and_stringify_follow_the_kernel_contract() {
        let b = TypeScriptBackend::new();
        let run = |call: String, x: &str| {
            let script = format!("type EventPayloadValue = string | number | boolean | null | Date | readonly EventPayloadValue[] | {{ readonly [k: string]: EventPayloadValue }}; const x: EventPayloadValue | undefined = {x}; process.stdout.write(JSON.stringify({call}));");
            let out = std::process::Command::new("node")
                .args(["--input-type=module-typescript", "-e", &script])
                .output()
                .expect("node must be on PATH");
            assert!(
                out.status.success(),
                "{script}\n{}",
                String::from_utf8_lossy(&out.stderr)
            );
            String::from_utf8(out.stdout).unwrap()
        };
        let parse = b.call_to_ts_typed("json/parse", &["x".into()], &[opaque()], None);
        assert!(!parse.contains("UNSUPPORTED"), "{parse}");
        for (x, expected) in [
            ("'{\"a\":[1,2]}'", "{\"a\":[1,2]}"),
            ("'not json'", "null"),
            ("42", "null"),
            ("undefined", "null"),
        ] {
            assert_eq!(run(parse.clone(), x), expected, "json/parse of {x}");
        }
        let stringify = b.call_to_ts_typed("json/stringify", &["x".into()], &[opaque()], None);
        assert!(!stringify.contains("UNSUPPORTED"), "{stringify}");
        for (x, expected) in [
            (
                "{ a: 1, b: ['c'] }",
                "\"{\\\"a\\\":1,\\\"b\\\":[\\\"c\\\"]}\"",
            ),
            ("null", "\"null\""),
            ("undefined", "\"null\""),
            ("'s'", "\"\\\"s\\\"\""),
        ] {
            assert_eq!(run(stringify.clone(), x), expected, "json/stringify of {x}");
        }
    }

    /// `csv/parse` keeps the kernel's contract (orbital-core `operators/csv.rs`, `@almadar/evaluator`
    /// `std/csv.ts`): quoted commas, escaped quotes, CRLF, a trailing newline, empty and header-only text.
    #[test]
    fn csv_parse_follows_the_kernel_contract() {
        let b = TypeScriptBackend::new();
        let run = |call: String, x: &str| {
            let script = format!("type EventPayloadValue = string | number | boolean | null | Date | readonly EventPayloadValue[] | {{ readonly [k: string]: EventPayloadValue }}; const x: EventPayloadValue | undefined = {x}; process.stdout.write(JSON.stringify({call}));");
            let out = std::process::Command::new("node")
                .args(["--input-type=module-typescript", "-e", &script])
                .output()
                .expect("node must be on PATH");
            assert!(
                out.status.success(),
                "{script}\n{}",
                String::from_utf8_lossy(&out.stderr)
            );
            String::from_utf8(out.stdout).unwrap()
        };
        let parse = b.call_to_ts_typed("csv/parse", &["x".into()], &[opaque()], None);
        assert!(!parse.contains("UNSUPPORTED"), "{parse}");
        for (x, expected) in [
            ("'name,age\\nAda,36'", "[{\"name\":\"Ada\",\"age\":\"36\"}]"),
            (
                "'a,b\\n\"x, y\",\"she said \"\"hi\"\"\"'",
                "[{\"a\":\"x, y\",\"b\":\"she said \\\"hi\\\"\"}]",
            ),
            ("'a,b\\r\\n1,2\\r\\n'", "[{\"a\":\"1\",\"b\":\"2\"}]"),
            ("'a,b\\n1,2\\n'", "[{\"a\":\"1\",\"b\":\"2\"}]"),
            ("'a,b\\n\\n1'", "[{\"a\":\"1\",\"b\":\"\"}]"),
            ("''", "[]"),
            ("'a,b\\n'", "[]"),
            ("42", "[]"),
            ("undefined", "[]"),
        ] {
            assert_eq!(run(parse.clone(), x), expected, "csv/parse of {x}");
        }
    }

    /// G-ORB-152: `object/pick` inside a user lambda whose parameter is `k` picks from that
    /// object, not from a lowering-local `k`; a missing key is left out; a nullish object is `{}`.
    #[test]
    fn object_pick_is_hygienic_inside_a_lambda_named_like_its_locals() {
        let b = TypeScriptBackend::new();
        let pick = b.call_to_ts_typed(
            "object/pick",
            &["k".into(), "[\"a\", \"b\"]".into()],
            &[opaque(), arr()],
            None,
        );
        let run = |rows: &str| {
            let script = format!("type EventPayloadValue = string | number | boolean | null | Date | readonly EventPayloadValue[] | {{ readonly [k: string]: EventPayloadValue }}; const rows: readonly (EventPayloadValue | undefined)[] = {rows}; process.stdout.write(JSON.stringify(rows.map((k) => {pick})));");
            let out = std::process::Command::new("node")
                .args(["--input-type=module-typescript", "-e", &script])
                .output()
                .expect("node must be on PATH");
            assert!(
                out.status.success(),
                "{script}\n{}",
                String::from_utf8_lossy(&out.stderr)
            );
            String::from_utf8(out.stdout).unwrap()
        };
        assert_eq!(
            run("[{ a: 1, c: 3 }, { a: 2, b: 'x' }, null, undefined]"),
            "[{\"a\":1},{\"a\":2,\"b\":\"x\"},{},{}]",
            "{pick}"
        );
        assert!(
            !pick.contains("[\"a\", \"b\"] ??"),
            "a literal key list needs no `??`: {pick}"
        );
        let omit = b.call_to_ts_typed(
            "object/omit",
            &[
                "row".into(),
                "(k as Readonly<Record<string, EventPayloadValue>>)[\"drop\"]".into(),
            ],
            &[opaque(), opaque()],
            None,
        );
        let script = format!("type EventPayloadValue = string | number | boolean | null | Date | readonly EventPayloadValue[] | {{ readonly [k: string]: EventPayloadValue }}; const row: EventPayloadValue = {{ a: 1, b: 2, c: 3 }}; const ks: readonly EventPayloadValue[] = [{{ drop: ['a', 'c'] }}, {{ drop: [] }}]; process.stdout.write(JSON.stringify(ks.map((k) => {omit})));");
        let out = std::process::Command::new("node")
            .args(["--input-type=module-typescript", "-e", &script])
            .output()
            .expect("node must be on PATH");
        assert!(
            out.status.success(),
            "{script}\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert_eq!(
            String::from_utf8(out.stdout).unwrap(),
            "[{\"b\":2},{\"a\":1,\"b\":2,\"c\":3}]",
            "{omit}"
        );
    }

    /// G-ORB-153: `array/unique` reads its operand like every array operator: a known
    /// array is spread as is (a `?? []` on it is TS2869 under strict tsc), an unknown one
    /// is cast to the nullable array union first.
    #[test]
    fn array_unique_guards_only_an_operand_that_can_be_nullish() {
        let b = TypeScriptBackend::new();
        let known = b.call_to_ts_typed("array/unique", &["[1, 1, 2]".into()], &[arr()], None);
        assert!(!known.contains("??"), "{known}");
        let unknown = b.call_to_ts_typed("array/unique", &["xs".into()], &[opaque()], None);
        assert!(
            unknown.contains("(xs as readonly EventPayloadValue[] | undefined) ?? []"),
            "{unknown}"
        );
        let script = format!("type EventPayloadValue = string | number | boolean | null | Date | readonly EventPayloadValue[] | {{ readonly [k: string]: EventPayloadValue }}; const xs: EventPayloadValue | undefined = undefined; process.stdout.write(JSON.stringify([{known}, {unknown}]));");
        let out = std::process::Command::new("node")
            .args(["--input-type=module-typescript", "-e", &script])
            .output()
            .expect("node must be on PATH");
        assert!(
            out.status.success(),
            "{script}\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert_eq!(String::from_utf8(out.stdout).unwrap(), "[[1,2],[]]");
    }

    /// G-ORB-154: `behavior/apply` yields its value as program data (core `toProgramData`),
    /// so it fits any entity field or payload slot a value is stored in, like a quasiquote hole.
    #[test]
    fn behavior_apply_yields_program_data_and_imports_its_helper() {
        use orbital_core::ir::{OirBinding, OirEffect, OirExpr, OirTrait, OirTransition};
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed(
            "behavior/apply",
            &["v".into(), "o".into()],
            &[opaque(), opaque()],
            None,
        );
        assert_eq!(ts, "toProgramData(applyBehaviorOverrides(BehaviorValueSchema.parse(v), JsonValueSchema.parse(o)))");
        let mut t = OirTrait::new("Gen");
        let mut tr = OirTransition::new("idle", "idle", "FILL");
        tr.effects.push(OirExpr::effect(OirEffect::Set {
            target: OirBinding::entity(vec!["adopted".to_string()]),
            value: OirExpr::call(
                "behavior/apply",
                vec![
                    OirExpr::binding(OirBinding::entity(vec!["base".to_string()])),
                    OirExpr::binding(OirBinding::payload(vec!["delta".to_string()])),
                ],
            ),
            emit: None,
        }));
        t.transitions.push(tr);
        let import = b.language_trio_core_import(&t);
        assert!(
            import.contains("toProgramData") && import.contains("applyBehaviorOverrides"),
            "{import}"
        );
        assert_eq!(
            b.language_trio_core_import(&OirTrait::new("Plain")),
            "",
            "control: no trio call, no import"
        );
    }

    /// `behavior/ref` builds a whole-behavior value through core's `behaviorRef`, imported where used.
    #[test]
    fn behavior_ref_calls_the_core_constructor_and_imports_it() {
        use orbital_core::ir::{OirBinding, OirEffect, OirExpr, OirTrait, OirTransition};
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed("behavior/ref", &["s".into()], &[opaque()], None);
        assert_eq!(ts, "behaviorRef(String(s))");
        let mut t = OirTrait::new("Preview");
        let mut tr = OirTransition::new("idle", "idle", "BUILT");
        tr.effects.push(OirExpr::effect(OirEffect::Set {
            target: OirBinding::entity(vec!["app".to_string()]),
            value: OirExpr::call(
                "behavior/ref",
                vec![OirExpr::binding(OirBinding::payload(vec![
                    "behavior".to_string()
                ]))],
            ),
            emit: None,
        }));
        t.transitions.push(tr);
        assert!(b.language_trio_core_import(&t).contains("behaviorRef"));
    }

    /// `str/join` on a value typed by the general value union (an entity field read) casts it
    /// to the array union first, like `array/join`; a missing list joins to "".
    #[test]
    fn str_join_casts_an_unknown_operand_to_an_array() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed(
            "str/join",
            &["xs".into(), "\"; \"".into()],
            &[opaque(), st("; ")],
            None,
        );
        assert!(
            ts.contains("(xs as readonly EventPayloadValue[] | undefined) ?? []"),
            "{ts}"
        );
        let script = format!("type EventPayloadValue = string | number | boolean | null | Date | readonly EventPayloadValue[] | {{ readonly [k: string]: EventPayloadValue }}; const rows: readonly (EventPayloadValue | undefined)[] = [['a', 'b'], undefined]; process.stdout.write(JSON.stringify(rows.map((xs) => {ts})));");
        let out = std::process::Command::new("node")
            .args(["--input-type=module-typescript", "-e", &script])
            .output()
            .expect("node must be on PATH");
        assert!(
            out.status.success(),
            "{script}\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert_eq!(String::from_utf8(out.stdout).unwrap(), "[\"a; b\",\"\"]");
        let known = b.call_to_ts_typed(
            "str/join",
            &["[1, 2]".into(), "\",\"".into()],
            &[arr(), st(",")],
            None,
        );
        assert!(
            !known.contains("??"),
            "control: a known array needs no guard: {known}"
        );
    }

    use crate::backend::TypeScriptBackend;

    // B5: with one operator table, the former twins keep the CORRECT survivor
    // form. Pin them so a future edit can't silently regress.

    #[test]
    fn time_add_uses_named_unit_map() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed(
            "time/add",
            &["t".into(), "3".into(), "\"days\"".into()],
            &[],
            None,
        );
        assert!(
            ts.contains("days: 'day'") && ts.contains("day: 86400000"),
            "time/add must use named units, got: {ts}"
        );
        // History: the Pipeline-1 short-key-only map mis-mapped "days" → ?? 1;
        // the long-key-only replacement mis-mapped "day" the same way (found
        // live in std-winning-11's wateringCycle → +30ms instead of +30 days).
        // The table is now the evaluator's full alias vocabulary — singular,
        // plural, AND short forms must all resolve.
        assert!(
            ts.contains("day: 'day'") && ts.contains("d: 'day'"),
            "unit table must carry singular + short aliases too: {ts}"
        );
    }

    /// G-ORB-026: the compiled `time/*` operators give the JS evaluator's answers.
    /// Expected values were evaluated by `@almadar/evaluator` (the parity table
    /// `time-unit-parity.test.ts` / orbital-core `time_unit_parity.rs` pin).
    #[test]
    fn compiled_time_operators_match_the_evaluator() {
        const MAR31: &str = "1711888496789";
        const JAN15: &str = "1705276800000";
        let q = |u: &str| format!("\"{u}\"");
        let cases: Vec<(&str, Vec<String>, &str)> = vec![
            (
                "time/add",
                vec![MAR31.into(), "-1".into(), q("month")],
                "1709210096789",
            ),
            (
                "time/add",
                vec![MAR31.into(), "1".into(), q("year")],
                "1743424496789",
            ),
            (
                "time/add",
                vec![MAR31.into(), "1".into(), q("quarter")],
                "1719750896789",
            ),
            (
                "time/add",
                vec![MAR31.into(), "2".into(), q("d")],
                "1712061296789",
            ),
            (
                "time/subtract",
                vec![MAR31.into(), "1".into(), q("month")],
                "1709210096789",
            ),
            (
                "time/diff",
                vec![MAR31.into(), JAN15.into(), q("day")],
                "76",
            ),
            (
                "time/diff",
                vec![JAN15.into(), MAR31.into(), q("day")],
                "-76",
            ),
            (
                "time/diff",
                vec![MAR31.into(), JAN15.into(), q("month")],
                "2",
            ),
            (
                "time/diff",
                vec![MAR31.into(), JAN15.into(), q("year")],
                "0",
            ),
            (
                "time/diff",
                vec!["1713139200000".into(), JAN15.into(), q("quarter")],
                "1",
            ),
            ("time/diff", vec![MAR31.into(), JAN15.into()], "6611696789"),
            (
                "time/startOf",
                vec![MAR31.into(), q("week")],
                "1711324800000",
            ),
            (
                "time/startOf",
                vec![MAR31.into(), q("quarter")],
                "1704067200000",
            ),
            (
                "time/endOf",
                vec![MAR31.into(), q("month")],
                "1711929599999",
            ),
            (
                "time/endOf",
                vec![MAR31.into(), q("quarter")],
                "1711929599999",
            ),
            ("time/endOf", vec![MAR31.into(), q("week")], "1711929599999"),
            (
                "time/isSame",
                vec![MAR31.into(), JAN15.into(), q("quarter")],
                "true",
            ),
            (
                "time/isSame",
                vec![MAR31.into(), "1709251200000".into(), q("month")],
                "true",
            ),
            (
                "time/isSame",
                vec![MAR31.into(), "1709251200000".into(), q("day")],
                "false",
            ),
        ];
        let b = TypeScriptBackend::new();
        for (op, args, expected) in cases {
            let ts = b.call_to_ts_typed(op, &args, &[], None);
            let script = format!("process.stdout.write(JSON.stringify({ts}));");
            let out = std::process::Command::new("node")
                .args(["--input-type=module-typescript", "-e", &script])
                .output()
                .expect("node must be on PATH to run the emitted time code");
            assert!(
                out.status.success(),
                "{op} {args:?} failed:\n{script}\n{}",
                String::from_utf8_lossy(&out.stderr)
            );
            assert_eq!(
                String::from_utf8(out.stdout).unwrap(),
                expected,
                "{op} {args:?}"
            );
        }
    }

    /// `quarter` joined the time-unit vocabulary on both interpreters (2026-09-30,
    /// std-graphs `period: quarter`); the compiled `time/startOf` must bucket it too.
    #[test]
    fn time_start_of_buckets_quarters() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed(
            "time/startOf",
            &["t".into(), "\"quarter\"".into()],
            &[],
            None,
        );
        assert!(
            ts.contains("quarter: 'quarter', quarters: 'quarter'")
                && ts.contains("Math.floor(d.getUTCMonth() / 3) * 3"),
            "time/startOf must bucket quarters, got: {ts}"
        );
        assert!(
            ts.contains("case 'month':"),
            "control: months still bucket, got: {ts}"
        );
    }

    /// G-CROSS-041: the compiled `quote` decodes each shared fixture body to the
    /// same data the evaluator returns (`fixtures/quote/cases.json`).
    #[test]
    fn compiled_quote_decodes_the_shared_fixture() {
        let cases: Vec<serde_json::Value> =
            serde_json::from_str(orbital_core::fixtures::quote_cases()).unwrap();
        let b = TypeScriptBackend::new();
        for case in cases {
            let body = case["body"].as_str().unwrap();
            let arg = format!("\"{}\"", orbital_core::str_utils::escape_js_string(body));
            let ts = b.call_to_ts_typed("quote", &[arg], &[], None);
            let script = format!("process.stdout.write(JSON.stringify({ts}));");
            let out = std::process::Command::new("node")
                .args(["--input-type=module-typescript", "-e", &script])
                .output()
                .expect("node must be on PATH to run the emitted quote code");
            assert!(
                out.status.success(),
                "{}: {}",
                case["name"],
                String::from_utf8_lossy(&out.stderr)
            );
            let got: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
            assert_eq!(got, case["expr"], "{}", case["name"]);
        }
    }

    #[test]
    fn control_an_unknown_head_is_not_decoded() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed("str/upper", &["\"x\"".into()], &[], None);
        assert!(!ts.contains("JSON.parse"), "{ts}");
    }

    #[test]
    fn array_join_emits_a_real_join_under_both_spellings() {
        let b = TypeScriptBackend::new();
        for op in ["join", "array/join"] {
            let ts = b.call_to_ts_typed(
                op,
                &["rows".into(), "\", \"".into()],
                &[opaque(), st(", ")],
                None,
            );
            assert!(
                ts.contains("?? [])") && ts.contains(".join(\", \")"),
                "{op} must guard a wide source and emit a real .join, got: {ts}"
            );
            assert!(
                !ts.contains("UNSUPPORTED"),
                "{op} must not hit the unsupported marker, got: {ts}"
            );
        }
        // Known-array sources (literal / .map chain) skip the ?? guard —
        // same TS2869 rule as array/map.
        let ts = b.call_to_ts_typed(
            "array/join",
            &[
                "((rows ?? []) as readonly EntityRow[]).map((r) => r.name)".into(),
                "\", \"".into(),
            ],
            &[arr(), st(", ")],
            None,
        );
        assert!(
            !ts.contains("as readonly EventPayloadValue[] | undefined"),
            "a .map chain is a known array and must not be re-guarded, got: {ts}"
        );
    }

    #[test]
    fn time_start_of_emits_utc_buckets() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed("time/startOf", &["t".into(), "\"week\"".into()], &[], None);
        assert!(
            ts.contains("day = 86400000") && ts.contains("Date.UTC"),
            "time/startOf must carry the day/week/month/year buckets, got: {ts}"
        );
        assert!(
            ts.contains("(ds + 3) % 7"),
            "weeks must start Monday (ISO-8601), got: {ts}"
        );
        assert!(
            ts.contains("throw new TypeError"),
            "an unknown unit must throw like parseTimeUnit, got: {ts}"
        );
        assert!(
            !ts.contains("UNSUPPORTED"),
            "time/startOf must not hit the unsupported marker, got: {ts}"
        );
    }

    // C-COMPILED-PATH-RED §25 date-as-number: a field-read temporal operand
    // (typed `string | number | undefined`) coerces to epoch ms; our own
    // numeric emissions (`now`, `….getTime()`) must NOT re-wrap, or
    // the `?? 0` guard is unreachable (TS2869).
    #[test]
    fn time_ops_coerce_field_reads_but_not_known_numbers() {
        let b = TypeScriptBackend::new();
        let field = b.call_to_ts_typed(
            "time/subtract",
            &["entity?.weekAnchor".into(), "1".into(), "\"week\"".into()],
            &[],
            None,
        );
        assert!(
            field.contains(
                "new Date(((__v) => typeof __v === 'string' || typeof __v === 'number' ? __v : 0)(entity?.weekAnchor)).getTime()"
            ),
            "field-read operand must narrow via the dt shape before coercing to ms, got: {field}"
        );
        let now = b.call_to_ts_typed(
            "time/add",
            &["now".into(), "7".into(), "\"days\"".into()],
            &[],
            None,
        );
        assert!(
            !now.contains("new Date((now)"),
            "`now` must not be re-wrapped, got: {now}"
        );
    }

    // TS2769 regression: `time/add`/`time/subtract`/`time/diff` arithmetic
    // operands used to coerce via a bare `(src ?? 0)` that let a wide
    // `getNestedValue(...)` read (`FieldValue | undefined`, which also
    // admits `boolean`/array/object) reach `new Date(...)` — none of those
    // extra members satisfy any Date constructor overload. `time/add` must
    // route its operand through the same `dt` narrow (`typeof __v ===
    // 'string' || typeof __v === 'number' ? __v : 0`) that `time/format`/
    // `time/parse`/`time/year` already use, wrapped in `.getTime()` for the
    // arithmetic.
    #[test]
    fn time_add_narrows_a_wide_operand_through_the_dt_shape() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed(
            "time/add",
            &[
                "getNestedValue(entity, \"dueDate\")".into(),
                "1".into(),
                "\"day\"".into(),
            ],
            &[],
            None,
        );
        assert!(
            ts.contains(
                "new Date(((__v) => typeof __v === 'string' || typeof __v === 'number' ? __v : 0)(getNestedValue(entity, \"dueDate\"))).getTime()"
            ),
            "time/add must narrow a wide operand through the dt shape before new Date(...), got: {ts}"
        );
    }

    /// `object/has` with a payload-typed key (`?key` is `EventPayloadValue`)
    /// must coerce the key: a bare `x in obj` is TS2322 (`string | number |
    /// symbol` expected) on the compiled path while the runtime accepts it.
    #[test]
    fn object_has_coerces_key_to_string() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed("object/has", &["obj".into(), "key".into()], &[], None);
        assert_eq!(ts, "Object.prototype.hasOwnProperty.call(Object(obj), String(key))", "object/has must coerce the key and never `?? {{}}` a literal operand (TS2869), got: {ts}");
    }

    #[test]
    fn object_get_walks_dotted_path() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed(
            "object/get",
            &["obj".into(), "\"a.b\"".into()],
            &[opaque(), st("a.b")],
            None,
        );
        assert_eq!(
            ts, "getNestedValue(obj, \"a.b\")",
            "object/get must delegate the path-walk to getNestedValue with the literal path passed through unwrapped, got: {ts}"
        );
    }

    #[test]
    fn object_get_wraps_a_non_literal_path_in_string() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed(
            "object/get",
            &["obj".into(), "payload?.key".into()],
            &[],
            None,
        );
        assert_eq!(
            ts, "getNestedValue(obj, String(payload?.key))",
            "a non-literal path arg (EventPayloadValue | undefined) must be coerced to string, got: {ts}"
        );
    }

    /// `(array/len (object/get @x "roles" []))` — the role-filter shape — must not
    /// stack a second `?? []` on the default the `object/get` already applied
    /// (TS2869, fails the emitted-app tsc gate); a bare source keeps its guard.
    #[test]
    fn array_len_over_a_defaulted_object_get_adds_no_second_nullish_guard() {
        let b = TypeScriptBackend::new();
        let defaulted = "(getNestedValue(action, \"roles\") ?? [])";
        let ts = b.call_to_ts_typed("array/len", &[defaulted.into()], &[never_null()], None);
        assert_eq!(
            ts,
            format!("(({defaulted}) as {{ readonly length: number }}).length"),
            "got: {ts}"
        );
        let bare = b.call_to_ts_typed("array/len", &["items".into()], &[], None);
        assert_eq!(
            bare, "((items ?? []) as { readonly length: number }).length",
            "control: an un-defaulted source keeps its guard, got: {bare}"
        );
    }

    /// A residual `@config.X` the server cannot read compiles to the literal `undefined`; guarding
    /// it as `undefined ?? []` is TS2871 (always nullish), so the operand is the empty list itself.
    #[test]
    fn an_absent_array_operand_is_the_empty_list_not_an_always_nullish_guard() {
        let b = TypeScriptBackend::new();
        for (op, expected) in [
            ("array/len", "([] as { readonly length: number }).length"),
            ("array/count", "([] as { readonly length: number }).length"),
            ("array/flatten", "[].flat()"),
        ] {
            let ts = b.call_to_ts_typed(op, &["undefined".into()], &[], None);
            assert_eq!(ts, expected, "{op}");
            assert!(!ts.contains("undefined ??"), "{op}: {ts}");
        }
        let first = b.call_to_ts_typed("array/first", &["undefined".into()], &[], None);
        assert!(!first.contains("undefined as"), "array/first: {first}");
        assert!(!first.contains("undefined ??"), "array/first: {first}");
        let bare = b.call_to_ts_typed("array/count", &["rows".into()], &[], None);
        assert_eq!(
            bare, "((rows ?? []) as { readonly length: number }).length",
            "control: a readable source keeps its guard, got: {bare}"
        );
    }

    #[test]
    fn object_get_with_default_wraps_getnestedvalue_in_parens() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed(
            "object/get",
            &["obj".into(), "\"a.b\"".into(), "\"fallback\"".into()],
            &[opaque(), st("a.b"), st("fallback")],
            None,
        );
        assert_eq!(
            ts, "(getNestedValue(obj, \"a.b\") ?? \"fallback\")",
            "object/get with a default must keep the parenthesized ?? form, got: {ts}"
        );
    }

    /// `str/default` must fall back on the EMPTY STRING as well as
    /// null/undefined (native StrDefaultOp + JS evalStrDefault contract) —
    /// a bare `??` keeps "" and diverges across engines, and a constant-
    /// folded `("" ?? d)` additionally fails the emitted-app tsc gate
    /// (TS2869 unreachable right operand).
    #[test]
    fn str_default_falls_back_on_empty_string() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed("str/default", &["v0".into(), "\"root\"".into()], &[], None);
        assert!(
            ts.contains("v == null || (typeof v === 'string' && v === '')"),
            "str/default must treat '' as empty, got: {ts}"
        );
        // A number-typed argument (`versionNumber`) must not compare `number === ''` (TS2367).
        assert!(!ts.contains("|| v === ''"), "{ts}");
        assert!(
            !ts.contains("v0 ?? "),
            "str/default must not compile to bare ??, got: {ts}"
        );
    }

    #[test]
    fn str_template_supports_nested_paths() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed("str/template", &["tmpl".into(), "data".into()], &[], None);
        assert!(
            ts.contains("[\\w.]+"),
            "template regex must accept dotted keys, got: {ts}"
        );
        assert_eq!(
            ts,
            "(tmpl).replace(/\\{\\{([\\w.]+)\\}\\}/g, (_, k) => String(getNestedValue(data, k) ?? ''))",
            "template must delegate the path-walk to getNestedValue, got: {ts}"
        );
    }

    // ---- C-EMIT-NAMESPACED-FALLBACK regression (Phase 1) ----
    // Namespaced ops MUST emit standalone inline JS (the emitted app does
    // not import @almadar/runtime/@almadar/evaluator), never the corrupting
    // bare `ns/name(args)` pass-through that JS parses as division. Full-
    // organism emit is verified out-of-process (codegen_typecheck stub /
    // orbital-verify-unified); these unit tests pin the per-op codegen.

    /// True if `ts` contains a bare slash-call `ns/name(` — the corruption.
    fn has_slash_call(ts: &str) -> bool {
        let bytes = ts.as_bytes();
        let mut i = 0;
        while i + 2 < bytes.len() {
            // look for [a-z] '/' [A-Za-z?_-]+ '(' with no preceding word char
            let prev_ok = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();
            if prev_ok && bytes[i].is_ascii_lowercase() {
                // ns can be >1 letter
                let mut j = i;
                while j < bytes.len() && bytes[j].is_ascii_lowercase() {
                    j += 1;
                }
                if j < bytes.len() && bytes[j] == b'/' {
                    let mut k = j + 1;
                    let name_start = k;
                    while k < bytes.len()
                        && (bytes[k].is_ascii_alphabetic()
                            || bytes[k] == b'?'
                            || bytes[k] == b'_'
                            || bytes[k] == b'-')
                    {
                        k += 1;
                    }
                    if k > name_start && k < bytes.len() && bytes[k] == b'(' {
                        return true;
                    }
                }
            }
            i += 1;
        }
        false
    }

    #[test]
    fn geo_and_vec_ops_emit_inline_not_slash_calls() {
        let b = TypeScriptBackend::new();
        // (op, args, must-contain inline token)
        let cases: &[(&str, Vec<&str>, &str)] = &[
            ("geo/aabb-overlap", vec!["a", "b"], "&&"),
            ("geo/point-in-rect", vec!["p", "r"], ">="),
            ("geo/circle-overlap", vec!["a", "b"], "Math.sqrt"),
            ("geo/point-in-circle", vec!["p", "c"], "<="),
            ("geo/rect-circle-overlap", vec!["r", "c"], "Math.min"),
            ("vec/distance", vec!["a", "b"], "Math.sqrt"),
            ("vec/distance-sq", vec!["a", "b"], "*"),
            ("vec/add", vec!["a", "b"], "x:"),
            ("vec/sub", vec!["a", "b"], "x:"),
            ("vec/scale", vec!["a", "k"], "x:"),
            ("vec/dot", vec!["a", "b"], "*"),
            ("vec/length", vec!["a"], "Math.sqrt"),
            ("vec/normalize", vec!["a"], "Math.sqrt"),
            ("vec/lerp", vec!["a", "b", "t"], "x:"),
            ("vec/rotate", vec!["a", "rad"], "Math.cos"),
            ("vec/clamp-length", vec!["a", "max"], "Math.sqrt"),
            ("math/cos", vec!["x"], "Math.cos"),
            ("math/sin", vec!["x"], "Math.sin"),
            ("math/tan", vec!["x"], "Math.tan"),
            ("math/atan2", vec!["y", "x"], "Math.atan2"),
            ("math/hypot", vec!["a", "b"], "Math.hypot"),
            ("math/deg-rad", vec!["d"], "Math.PI"),
            ("math/approach", vec!["cur", "tgt", "maxD"], "Math.sign"),
            ("math/wrap", vec!["v", "min", "max"], "%"),
        ];
        for (op, args, token) in cases {
            let ts = b.call_to_ts_typed(
                op,
                &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                &[],
                None,
            );
            assert!(
                !has_slash_call(&ts),
                "{op} must emit inline JS, not a bare slash-call. got: {ts}"
            );
            assert!(
                !ts.contains(&format!("{op}(")),
                "{op} must not pass through as `{op}(`. got: {ts}"
            );
            assert!(
                ts.contains(token),
                "{op} expected inline token `{token}`. got: {ts}"
            );
        }
    }

    #[test]
    fn fallback_marks_armless_op_loud_not_silent() {
        let b = TypeScriptBackend::new();
        // An op with no inline arm must emit the unsupported marker (loud,
        // generate.rs hard-fails) — never the silent `ns/name(args)` corruption.
        let ts = b.call_to_ts_typed(
            "geo/totally-fabricated",
            &["a".into(), "b".into()],
            &[],
            None,
        );
        assert!(
            ts.contains("UNSUPPORTED operator:"),
            "armless op must emit the unsupported marker, got: {ts}"
        );
        assert!(
            !has_slash_call(&ts),
            "armless op must not emit a slash-call, got: {ts}"
        );
    }

    // ---- C-ARRAY-OP-NULLISH-GUARD-TS2869 / C-ARRAY-RANGE-SINGLE-ARG-NAN ----

    #[test]
    fn array_ops_drop_unreachable_nullish_guard_on_known_arrays() {
        let b = TypeScriptBackend::new();
        // Array-literal argument: the defensive `?? []` is unreachable and
        // trips TS2869 — every array-position op must route through
        // `is_known_array` and emit the bare parenthesized literal.
        for op in ["array/take", "array/drop", "array/remove"] {
            let ts =
                b.call_to_ts_typed(op, &["[1, 2, 3]".into(), "1".into()], &[arr(), num()], None);
            assert!(
                !ts.contains("?? []"),
                "{op} must not guard a known array with ?? [], got: {ts}"
            );
        }
        // Unknown (maybe-nullish) argument keeps a guard — via the
        // nullable-union cast so wide entity reads still type as an array.
        let ts = b.call_to_ts_typed("array/take", &["rows".into(), "1".into()], &[], None);
        assert!(
            ts.contains("((rows as readonly EventPayloadValue[] | undefined) ?? [])"),
            "array/take must guard unknown sources, got: {ts}"
        );
    }

    // G-ORB-242: studio-generator's `(str/snakeCase (object/get @r name))` — a string op on a
    // wide read must coerce its receiver (`String(x ?? '')`), as every other str/ op does, or
    // `.replace` fails tsc (TS2533 + TS2339).
    const STR_RECEIVER_OPS: [&str; 8] = [
        "str/trimStart",
        "str/trimEnd",
        "str/padStart",
        "str/padEnd",
        "str/titleCase",
        "str/camelCase",
        "str/kebabCase",
        "str/snakeCase",
    ];

    #[test]
    fn case_and_pad_string_ops_coerce_a_wide_receiver() {
        let b = TypeScriptBackend::new();
        for op in STR_RECEIVER_OPS {
            let args = [
                "getNestedValue(r, \"name\")".into(),
                "4".into(),
                "' '".into(),
            ];
            let ts = b.call_to_ts_typed(op, &args, &[], None);
            assert!(
                ts.starts_with("(String(getNestedValue(r, \"name\") ?? ''))."),
                "{op} must coerce its receiver, got: {ts}"
            );
        }
    }

    #[test]
    fn control_case_and_pad_string_ops_leave_a_string_receiver_bare() {
        let b = TypeScriptBackend::new();
        let string = crate::codegen::infer::ArgFacts {
            string: true,
            never_nullish: true,
            ..Default::default()
        };
        for op in STR_RECEIVER_OPS {
            let args = ["\"Hello World\"".into(), "4".into(), "' '".into()];
            let ts = b.call_to_ts_typed(op, &args, std::slice::from_ref(&string), None);
            assert!(
                ts.starts_with("(\"Hello World\")."),
                "{op} must leave a string bare, got: {ts}"
            );
        }
    }

    #[test]
    fn edge_a_pad_without_a_pad_string_keeps_the_default_space() {
        let b = TypeScriptBackend::new();
        for op in ["str/padStart", "str/padEnd"] {
            let ts = b.call_to_ts_typed(op, &["code".into(), "4".into()], &[], None);
            assert!(
                ts.ends_with("(4)"),
                "{op} with no pad string must not pass one, got: {ts}"
            );
        }
    }

    // G-ORB-242: `(array/map (array/take @entity.rows n) (fn row … @row.behavior))` — the
    // element-preserving ops must keep a known source element type, or the mapped row is
    // the wide `EventPayloadValue` union and `row?.behavior` fails tsc (TS2339).
    const ELEMENT_PRESERVING_OPS: [&str; 6] = [
        "array/take",
        "array/takeLast",
        "array/drop",
        "array/dropLast",
        "array/remove",
        "array/shuffle",
    ];

    #[test]
    fn element_preserving_array_ops_keep_a_known_element_type() {
        let b = TypeScriptBackend::new();
        for op in ELEMENT_PRESERVING_OPS {
            let ts = b.call_to_ts_typed(op, &["rows".into(), "4".into()], &[], Some("CatalogRow"));
            assert!(
                ts.contains("((rows as readonly CatalogRow[] | undefined) ?? [])"),
                "{op} must cast its source to the known element type, got: {ts}"
            );
            assert!(
                !ts.contains("EventPayloadValue"),
                "{op} must not widen a typed source, got: {ts}"
            );
        }
    }

    #[test]
    fn control_element_preserving_array_ops_keep_the_wide_cast_without_an_element_type() {
        let b = TypeScriptBackend::new();
        for op in ELEMENT_PRESERVING_OPS {
            let ts = b.call_to_ts_typed(op, &["rows".into(), "4".into()], &[], None);
            assert!(
                ts.contains("((rows as readonly EventPayloadValue[] | undefined) ?? [])"),
                "{op} keeps the wide cast for an unknown source, got: {ts}"
            );
        }
    }

    #[test]
    fn edge_element_preserving_array_ops_leave_a_known_array_unguarded() {
        let b = TypeScriptBackend::new();
        for op in ["array/take", "array/drop", "array/remove"] {
            let ts = b.call_to_ts_typed(
                op,
                &["[1, 2, 3]".into(), "1".into()],
                &[arr(), num()],
                Some("number"),
            );
            assert!(
                !ts.contains("?? []"),
                "{op} must not guard a known array, got: {ts}"
            );
        }
    }

    #[test]
    fn array_range_single_arg_emits_zero_based_range() {
        let b = TypeScriptBackend::new();
        // Interpreter semantics (orbital-core evaluator): (array/range N) is
        // [0..N-1] — never the NaN-producing 3-arg form with undefined bounds.
        let lit = crate::codegen::infer::ArgFacts {
            number: true,
            never_nullish: true,
            ..Default::default()
        };
        let ts = b.call_to_ts_typed("array/range", &["192".into()], &[lit], None);
        assert!(
            ts.contains("Array.from({ length: Math.ceil((192)) }, (_, i) => i)"),
            "single-arg array/range must be 0-based, got: {ts}"
        );
        assert!(
            !ts.contains("undefined"),
            "single-arg array/range must not reference undefined bounds, got: {ts}"
        );
    }

    #[test]
    fn array_reduce_emits_fn_first_initial_second() {
        let b = TypeScriptBackend::new();
        // Lolo order is (array, initial, fn); JS is arr.reduce(fn, initial).
        // Swapping them calls the initial value as the callback at runtime
        // ("TypeError: object is not a function") — hit by snake's food
        // respawn the moment the snake first eats.
        let ts = b.call_to_ts_typed(
            "array/reduce",
            &["rows".into(), "0".into(), "(acc, v) => acc + v".into()],
            &[],
            None,
        );
        assert!(
            ts.contains(".reduce<EventPayloadValue>((acc, v) => acc + v, 0)"),
            "array/reduce must emit fn first, initial second, explicit wide type param, got: {ts}"
        );
    }

    #[test]
    fn grid_ops_drop_unreachable_zero_guard_on_literal_numbers() {
        let b = TypeScriptBackend::new();
        // `(grid/in-bounds pos 16 12)` with literal bounds: `((16) ?? 0)` is
        // TS2869 (a literal is never nullish) — same class as the array
        // guard. Identifier-rooted args keep the `?? 0` default.
        let ts = b.call_to_ts_typed(
            "grid/in-bounds",
            &["pos".into(), "16".into(), "12".into()],
            &[opaque(), num(), num()],
            None,
        );
        assert!(
            !ts.contains("((16) ?? 0)"),
            "literal bounds must not get ?? 0, got: {ts}"
        );
        let ts = b.call_to_ts_typed(
            "grid/in-bounds",
            &["pos".into(), "w".into(), "h".into()],
            &[],
            None,
        );
        assert!(
            ts.contains("((w) ?? 0)"),
            "identifier bounds must keep ?? 0, got: {ts}"
        );
    }

    // C1-E3 item (2): `Math.abs`/etc take a strict `number`, so a wide
    // payload-read source (EventPayloadValue, not plain number) must go
    // through `nc` (Number(...) coercion) the same way `time/add`'s amount
    // arg already does — std-stock-adjustment's `Math.abs(quantityDelta)`
    // TS2345 (quantityDelta reads through @payload.data, EventPayloadValue).
    #[test]
    fn abs_coerces_a_wide_payload_read_but_not_a_known_number() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed(
            "abs",
            &["(payload?.data as EventPayload | undefined)?.quantityDelta".into()],
            &[],
            None,
        );
        assert!(
            ts.starts_with("Math.abs(Number("),
            "a non-literal source must be Number()-coerced, got: {ts}"
        );
        let ts = b.call_to_ts_typed("abs", &["16".into()], &[num()], None);
        assert_eq!(
            ts, "Math.abs((16))",
            "a known-number literal must NOT be wrapped in Number(), got: {ts}"
        );
    }

    #[test]
    fn min_max_coerce_every_variadic_arg() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed("min", &["a".into(), "b".into()], &[], None);
        assert_eq!(
            ts, "Math.min(Number(a ?? 0), Number(b ?? 0))",
            "every min() arg must go through nc, got: {ts}"
        );
    }

    // C1-E3 item (2) follow-up (found sweeping the full corpus): `nc`'s
    // "already a known number, don't re-wrap" fast path missed the exact
    // shape the `+`/`-`/`*`/`/` s-expr operators themselves compose over
    // (`(+(getNestedValue(…) ?? 0) / 4)` — a UNARY `+` forcing `number`,
    // not the char-scan's plain-literal-arithmetic case) — Math.floor's
    // new nc() wrap re-wrapped an already-non-nullish number in a SECOND
    // `Number(… ?? 0)`, tripping "Right operand of ?? is unreachable"
    // (TS2869) on std-table-map / std-restaurant-pos.
    #[test]
    fn floor_does_not_rewrap_a_unary_plus_coerced_arithmetic_expression() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed(
            "floor",
            &["(+(getNestedValue(acc, \"i\") ?? 0) / 4)".into()],
            &[num()],
            None,
        );
        assert_eq!(
            ts, "Math.floor(((+(getNestedValue(acc, \"i\") ?? 0) / 4)))",
            "a leading-unary-plus arithmetic expression is already number-typed \
             and must NOT be re-wrapped in Number(…), got: {ts}"
        );
    }

    // C1-E3 item (4): `array/sort`'s comparator param type must match the
    // array's REAL element type. When the source is a `.map(...)` chain
    // producing a fresh object-literal shape (element-type inference gives
    // up — `array/map` is not in `infer_oirexpr_element_type_ts`'s
    // pass-through list), the OLD code force-typed the params `elem`
    // (default "EntityRow") regardless — wrong for a literal shape neither
    // EntityRow nor bivariantly compatible with (std-task-manager
    // useTaskTimelineLogic TS2345). Emitting NO annotation lets TS infer
    // the params from the concrete `.map()` output instead of guessing.
    #[test]
    fn array_sort_field_form_infers_comparator_params_for_an_unresolved_map_source() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed(
            "array/sort",
            &[
                "rows.map((row) => ({ date: row.date }))".into(),
                "\"date\"".into(),
                "\"desc\"".into(),
            ],
            &[arr(), st("date"), st("desc")],
            None, // element_type inference gave up on a `.map()` source
        );
        assert!(
            ts.contains(".sort((a, b) => {"),
            "an unresolved known-array source must get unannotated params, got: {ts}"
        );
        assert!(
            !ts.contains("a: EntityRow"),
            "must not force the EntityRow default guess onto a map-shaped source, got: {ts}"
        );
    }

    #[test]
    fn array_sort_field_form_keeps_resolved_element_type_annotation() {
        let b = TypeScriptBackend::new();
        // A known-array source (`.filter()` chain) whose element type WAS
        // resolved (e.g. traced back to an `@Entity` binding) still gets
        // the explicit annotation — only an UNRESOLVED known-array source
        // (the previous test) falls back to letting TS infer.
        let ts = b.call_to_ts_typed(
            "array/sort",
            &["rows.filter((r) => true)".into(), "\"date\"".into()],
            &[arr(), st("date")],
            Some("Ticket"),
        );
        assert!(
            ts.contains("a: Ticket, b: Ticket"),
            "a resolved element type must still be spelled out explicitly, got: {ts}"
        );
    }

    #[test]
    fn array_sort_field_form_types_an_unknown_array_as_event_payload_value() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed(
            "array/sort",
            &["payload?.rows".into(), "\"date\"".into()],
            &[],
            None,
        );
        assert!(
            ts.contains("a: EventPayloadValue, b: EventPayloadValue"),
            "a non-known-array source keeps the EventPayloadValue annotation, got: {ts}"
        );
    }

    // The shipped crash: `(time/format @entity.dueDate "MMM D, YYYY")` compiled
    // to `.toLocaleDateString("MMM D, YYYY")`, throwing `RangeError: Invalid
    // language tag` — a moment/dayjs-style token string is not a BCP-47
    // locale. Codegen must do the same token replacement the runtime path's
    // `@almadar/evaluator` (`evalTimeFormat`) does, never hand the format
    // string to `toLocaleDateString`.
    #[test]
    fn time_format_two_arg_form_does_not_pass_the_token_string_as_a_locale() {
        let b = TypeScriptBackend::new();
        let ts = b.call_to_ts_typed(
            "time/format",
            &["entity?.dueDate".into(), "\"MMM D, YYYY\"".into()],
            &[],
            None,
        );
        assert!(
            !ts.contains("toLocaleDateString(\"MMM D, YYYY\")")
                && !ts.contains("toLocaleDateString('MMM D, YYYY')"),
            "must not hand the token string to toLocaleDateString as a locale, got: {ts}"
        );
        // Same token vocabulary as the evaluator, same longest-first order.
        assert!(ts.contains("MMM:") && ts.contains("YYYY:") && ts.contains("D:"));
        assert!(
            ts.contains("sort((a, b) => b.length - a.length)"),
            "must match longest token first (MMM before M), got: {ts}"
        );
        assert!(
            ts.contains("\"MMM D, YYYY\""),
            "the format string must still flow through, got: {ts}"
        );
    }
}

#[cfg(test)]
mod runtime_parity_format_tests {
    use crate::backend::TypeScriptBackend;

    fn op(name: &str, args: &[&str]) -> String {
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        let facts = vec![crate::codegen::infer::ArgFacts::default(); args.len()];
        TypeScriptBackend::new().call_to_ts_typed(name, &args, &facts, None)
    }

    /// G-ORB-189(g): the compiled number formats match `evalFormatNumber` /
    /// `evalFormatCurrency` / `evalFormatPercent` (en-US, decimals → fraction digits)
    /// and take a possibly-absent field through `Number(…)`.
    #[test]
    fn number_formats_match_the_runtime_and_accept_an_optional_value() {
        assert_eq!(
            op("format/number", &["fields?.n"]),
            "new Intl.NumberFormat('en-US').format(Number(fields?.n))"
        );
        assert!(op("format/number", &["fields?.n", "{ decimals: 2 }"])
            .contains("minimumFractionDigits: __o.decimals, maximumFractionDigits: __o.decimals"));
        assert_eq!(op("format/currency", &["fields?.n", "\"USD\""]), "new Intl.NumberFormat('en-US', { style: 'currency', currency: String(\"USD\") }).format(Number(fields?.n))");
        assert!(op("format/percent", &["x"])
            .contains("minimumFractionDigits: 0, maximumFractionDigits: 0"));
    }

    /// G-ORB-189(f): `(array/map (array/reverse @entity.history) (fn d … @d.version))`
    /// keeps the field's declared element type through the reverse.
    #[test]
    fn reorder_ops_keep_the_inferred_element_type() {
        let args = vec!["fields?.history".to_string()];
        let facts = vec![crate::codegen::infer::ArgFacts::default()];
        let b = TypeScriptBackend::new();
        assert_eq!(
            b.call_to_ts_typed("array/reverse", &args, &facts, Some("DeploymentRow")),
            "[...((fields?.history as readonly DeploymentRow[] | undefined) ?? [])].reverse()"
        );
        assert_eq!(
            b.call_to_ts_typed("array/reverse", &args, &facts, None),
            "[...((fields?.history as readonly EventPayloadValue[] | undefined) ?? [])].reverse()",
            "control: unknown element"
        );
    }

    /// The lambda takes one argument on both paths (a one-param lambda called with two is TS2554).
    #[test]
    fn object_map_lambdas_take_one_argument_like_the_runtime() {
        let args = vec!["o".to_string(), "((v) => v)".to_string()];
        let facts = vec![crate::codegen::infer::ArgFacts::default(); 2];
        let b = TypeScriptBackend::new();
        assert!(b
            .call_to_ts_typed("object/mapValues", &args, &facts, None)
            .ends_with("[key, (((v) => v))(value)]))"));
        assert!(b
            .call_to_ts_typed("object/mapKeys", &args, &facts, None)
            .contains("[String((((v) => v))(key)), value]"));
    }

    #[test]
    fn validate_url_rejects_a_non_string_like_the_runtime() {
        let ts = op("validate/url", &["fields?.draft"]);
        assert!(
            ts.contains("if (typeof __v !== 'string') return false; try { new URL(__v);"),
            "{ts}"
        );
        assert!(ts.ends_with("(fields?.draft)"), "{ts}");
    }
}

#[cfg(test)]
mod path_twin_tests {
    use crate::backend::TypeScriptBackend;
    use orbital_core::evaluator::{BindingContextBuilder, Evaluator, Value};
    use orbital_core::schema::SExpression;

    const ARGS: [&str; 6] = ["start", "goal", "blocked", "w", "h", "diag"];

    fn cells(v: &serde_json::Value) -> Vec<(i64, i64)> {
        v.as_array()
            .expect("an array of cells")
            .iter()
            .map(|c| {
                (
                    c["x"].as_f64().unwrap() as i64,
                    c["y"].as_f64().unwrap() as i64,
                )
            })
            .collect()
    }

    fn kernel(op: &str, payload: &serde_json::Value) -> Vec<(i64, i64)> {
        let mut call = vec![serde_json::json!(op)];
        call.extend(
            ARGS.iter()
                .map(|k| serde_json::json!(format!("@payload.{k}"))),
        );
        let expr: SExpression = serde_json::from_value(serde_json::Value::Array(call)).unwrap();
        let ctx = BindingContextBuilder::new()
            .payload(serde_json::from_value::<Value>(payload.clone()).unwrap())
            .build();
        let out = Evaluator::new().evaluate(&expr, &ctx).unwrap();
        cells(&serde_json::to_value(&out).unwrap())
    }

    fn compiled(op: &str, payload: &serde_json::Value) -> Vec<(i64, i64)> {
        let args: Vec<String> = ARGS.iter().map(|k| format!("payload.{k}")).collect();
        let facts = vec![crate::codegen::infer::ArgFacts::default(); args.len()];
        let call = TypeScriptBackend::new().call_to_ts_typed(op, &args, &facts, None);
        assert!(!call.contains("UNSUPPORTED"), "{call}");
        let script = format!("type EventPayloadValue = string | number | boolean | null | Date | readonly EventPayloadValue[] | {{ readonly [k: string]: EventPayloadValue }}; const payload: {{ readonly [k: string]: EventPayloadValue | undefined }} = {payload}; process.stdout.write(JSON.stringify({call}));");
        let out = std::process::Command::new("node")
            .args(["--input-type=module-typescript", "-e", &script])
            .output()
            .expect("node must be on PATH");
        assert!(
            out.status.success(),
            "{script}\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        cells(&serde_json::from_slice(&out.stdout).unwrap())
    }

    fn grid(
        start: (i64, i64),
        goal: (i64, i64),
        blocked: &[(i64, i64)],
        diag: bool,
    ) -> serde_json::Value {
        let blocked: Vec<serde_json::Value> = blocked
            .iter()
            .map(|(x, y)| serde_json::json!({"x": x, "y": y}))
            .collect();
        serde_json::json!({
            "start": {"x": start.0, "y": start.1},
            "goal": {"x": goal.0, "y": goal.1},
            "blocked": blocked,
            "w": 6, "h": 5, "diag": diag,
        })
    }

    #[test]
    fn compiled_path_operators_match_the_kernel() {
        let wall = [(2, 0), (2, 1), (2, 2), (2, 3)];
        let boxed = [(1, 0), (0, 1), (1, 1)];
        let cases = [
            grid((0, 0), (5, 4), &[], false),
            grid((0, 0), (5, 4), &[], true),
            grid((0, 0), (4, 0), &wall, false),
            grid((0, 0), (4, 0), &wall, true),
            grid((0, 0), (3, 3), &boxed, false),
            grid((1, 2), (1, 2), &[], false),
            grid((0, 0), (9, 9), &[], false),
        ];
        for payload in &cases {
            let astar = kernel("path/astar", payload);
            assert_eq!(
                compiled("path/astar", payload),
                astar,
                "path/astar of {payload}"
            );
            let mut reach = payload.clone();
            reach["goal"] = serde_json::json!(2);
            assert_eq!(
                compiled("path/reachable", &reach),
                kernel("path/reachable", &reach),
                "path/reachable of {reach}"
            );
        }
        let walled = &cases[2];
        assert_eq!(
            kernel("path/astar", walled).last(),
            Some(&(4, 0)),
            "the wall is walked around"
        );
        assert!(
            kernel("path/astar", &cases[4]).is_empty(),
            "a boxed-in start has no path"
        );
        assert!(
            kernel("path/astar", &cases[6]).is_empty(),
            "an off-grid goal has no path"
        );
        assert_eq!(
            kernel("path/astar", &cases[5]),
            vec![(1, 2)],
            "start == goal is a one-cell path"
        );
    }
}

#[cfg(test)]
mod sort_twin_tests {
    use crate::backend::TypeScriptBackend;
    use orbital_core::lower::lower_sexpr;
    use orbital_core::schema::SExpression;
    use serde_json::json;

    fn compiled(expr: serde_json::Value) -> serde_json::Value {
        let sexpr: SExpression = serde_json::from_value(expr).unwrap();
        let ts = TypeScriptBackend::new().expr_to_ts(&lower_sexpr(&sexpr).unwrap());
        assert!(!ts.contains("UNSUPPORTED"), "{ts}");
        let script = format!("type EventPayloadValue = string | number | boolean | null | Date | readonly EventPayloadValue[] | {{ readonly [k: string]: EventPayloadValue }}; type EntityRow = Record<string, unknown>; process.stdout.write(JSON.stringify({ts}));");
        let out = std::process::Command::new("node")
            .args(["--input-type=module-typescript", "-e", &script])
            .output()
            .expect("node must be on PATH");
        assert!(
            out.status.success(),
            "{script}\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        serde_json::from_slice(&out.stdout).unwrap()
    }

    #[test]
    fn sort_codegen_matches_the_evaluator_contract() {
        // numbers sort numerically, not as strings
        assert_eq!(
            compiled(json!(["array/sort", [10, 9, 1]])),
            json!([1, 9, 10])
        );
        assert_eq!(
            compiled(json!(["array/sort", [3, 1, 2], null, "desc"])),
            json!([3, 2, 1])
        );
        assert_eq!(
            compiled(json!(["array/sort", [3, 1, 2], null, "asc"])),
            json!([1, 2, 3])
        );
        assert_eq!(
            compiled(json!(["array/sort", ["b", "a", "B", "é"]])),
            json!(["B", "a", "b", "é"])
        );
        assert_eq!(
            compiled(json!(["array/sort", ["b", "a", "B", "é"], null, "desc"])),
            json!(["é", "b", "a", "B"])
        );
        let rows = json!([{"price": 3}, {"price": 9}, {"price": 5}]);
        assert_eq!(
            compiled(json!(["array/sort", rows, "price", "desc"])),
            json!([{"price": 9}, {"price": 5}, {"price": 3}])
        );
        assert_eq!(
            compiled(json!(["array/sort", rows, "price"])),
            json!([{"price": 3}, {"price": 5}, {"price": 9}])
        );
        let ties =
            json!([{"k": 1, "i": "a"}, {"k": 0, "i": "b"}, {"k": 1, "i": "c"}, {"k": 1, "i": "d"}]);
        assert_eq!(
            compiled(json!(["array/sort", ties, "k", "desc"])),
            json!([{"k": 1, "i": "a"}, {"k": 1, "i": "c"}, {"k": 1, "i": "d"}, {"k": 0, "i": "b"}])
        );
        assert_eq!(
            compiled(json!(["array/sort", [1, 3, 2], null, "bogus"])),
            json!([3, 2, 1])
        );
        assert_eq!(
            compiled(json!(["array/sort", [{"k": 2}, {"k": null}, {"k": 1}], "k"])),
            json!([{"k": null}, {"k": 1}, {"k": 2}])
        );
        assert_eq!(compiled(json!(["array/sort", []])), json!([]));
        assert_eq!(
            compiled(json!(["array/sort", ["\u{FF5E}", "\u{1F600}", "a"]])),
            json!(["a", "\u{FF5E}", "\u{1F600}"])
        );
        let mixed = json!([2, "a", true, 1, null, [1], "B", {"x": 1}, false]);
        assert_eq!(
            compiled(json!(["array/sort", mixed])),
            json!([null, false, true, 1, 2, "B", "a", [1], {"x": 1}])
        );
        assert_eq!(
            compiled(json!(["array/sort", mixed, null, "desc"])),
            json!([{"x": 1}, [1], "a", "B", 2, 1, true, false, null])
        );
    }
}
