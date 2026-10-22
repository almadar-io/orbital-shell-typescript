/**
 * English → native rendering of a `.lolo` program and a `.orb` document —
 * the forward direction of `@almadar/core/i18n`.
 *
 * Everything else in this module family goes native → English so a program
 * written in Arabic or Slovenian COMPILES (`aliasMap`, the Rust
 * `Lang::canon_*`). This is the mirror: it takes the canonical English
 * program and renders it in a target language, so a reader can be shown the
 * same program in their own vocabulary.
 *
 * ## Why it is position-aware and not a word substitution
 *
 * The i18n contract (`docs/Almadar_i18n.md` §"What a native program looks
 * like") is that the parser "canonicalizes at the grammar position that
 * expects the word, never by text replacement, so a native identifier that
 * happens to equal a keyword translation is only a keyword where a keyword is
 * expected". The forward direction inherits that constraint exactly. Blind
 * substitution corrupts real programs: `entity`/`type`/`fields`/`name`/
 * `label`/`description` are all vocabulary words AND the commonest pattern
 * prop keys, and `parse_object_literal` takes object keys VERBATIM — a
 * pattern prop is opaque and is never translated. Likewise an entity's field
 * names and a trait's state names are the author's identifiers even when they
 * spell a keyword.
 *
 * So this walks the token stream with a frame stack that reproduces the
 * parser's positional expectations, and translates only where the grammar
 * says a vocabulary word belongs. Rendering splices into the original source
 * by span, so comments, blank lines and alignment survive byte-for-byte.
 *
 * The gate on all of it is round-trip equality: for the whole `.lolo` corpus,
 * `orb emit orb` of the translated program must equal `orb emit orb` of the
 * English one. That proves both halves — every vocabulary word was translated
 * (or the `.orb` would differ) and no identifier was (same).
 *
 * @packageDocumentation
 */

import {
  getVocabulary,
  type I18nSection,
  type LanguageCode,
  type OperatorTables,
} from './index.js';
import { lexLolo, type LoloToken } from './lolo-lexer.js';
import type { JsonObject, JsonValue } from '../types/json.js';

// ---------------------------------------------------------------------------
// Forward (English → native) maps
// ---------------------------------------------------------------------------

/**
 * The vocabulary families a `.lolo` token position can draw from. `orb` is
 * excluded — those are `.orb` JSON keys, never `.lolo` source words.
 */
const LOLO_SECTIONS: readonly I18nSection[] = [
  'keywords',
  'shapes',
  'tags',
  'categories',
  'capabilities',
  'annotations',
  'sigils',
  'effects',
  'types',
  'units',
  'literals',
  'reservedEvents',
];

/**
 * The order `Lang::canon_any` tries sections in. A native word at an
 * identifier position resolves to the FIRST section that claims it, so this
 * order decides which English word a translation reads back as.
 */
const CANON_ANY_ORDER: readonly I18nSection[] = [
  'keywords',
  'shapes',
  'tags',
  'categories',
  'capabilities',
  'annotations',
  'sigils',
  'types',
  'units',
  'literals',
  'reservedEvents',
];

/**
 * English → native for one family (or the union of several), keeping ONLY the
 * entries the parser will read back as the same English word.
 *
 * Two English words can share one native spelling across sections — Arabic
 * has no letter case, so the `event` keyword and the `Event` shape are both
 * `حدث`, as are `entity`/`Entity`, `orbital`/`Orbital`, `page`/`Page` and
 * `trait`/`Trait`. `checkI18nCoverage` rule 3 only forbids collisions WITHIN
 * a section, so these pass the gate (see `docs/Almadar_i18n_Gaps.md` G-i18n-1).
 * At such a word the parser's fixed resolution order picks one meaning, and
 * emitting the other would produce a program that no longer says what the
 * English one said.
 *
 * So an entry survives only if resolving its native spelling through
 * `resolutionOrder` — the same order the parser uses at that token position —
 * lands back on the English word. When it doesn't, the English word is left
 * in place, which is always legal: `canon_*` is consulted only after an
 * exact-English match, so every language accepts English spellings.
 */
function forward(
  lang: LanguageCode,
  sections: readonly I18nSection[],
  resolutionOrder: readonly I18nSection[],
  operators?: OperatorTables,
): ReadonlyMap<string, string> {
  // `canon_head` is effects-then-operators, so operators are consulted after
  // every section in `resolutionOrder`.
  const canon = (native: string): string | undefined => {
    for (const section of resolutionOrder) {
      for (const [english, value] of Object.entries(getVocabulary(lang)[section])) {
        if (value === native) return english;
      }
    }
    if (operators) {
      for (const [english, value] of Object.entries(operators.operators)) {
        if (value === native) return english;
      }
    }
    return undefined;
  };

  const map = new Map<string, string>();
  const add = (english: string, native: string): void => {
    if (canon(native) !== english) return;
    map.set(english, native);
  };
  for (const section of sections) {
    for (const [english, native] of Object.entries(getVocabulary(lang)[section])) {
      add(english, native);
    }
  }
  if (operators) {
    for (const [english, native] of Object.entries(operators.operators)) {
      add(english, native);
    }
  }
  return map;
}

/**
 * The flat English → native map over every `.lolo` vocabulary family plus the
 * caller's operators. Well-defined because `checkI18nCoverage` rule 2 forbids
 * one English word having two translations across sections — verified at 545
 * entries with zero conflicts for both `ar` and `sl`.
 *
 * Exported for callers that only need the vocabulary (a highlighter building
 * native token patterns, a docs table); `localizeLoloSource` does NOT use it,
 * because which family applies is a positional question.
 */
export function localizeMap(
  lang: LanguageCode,
  operators?: OperatorTables,
): ReadonlyMap<string, string> {
  return forward(lang, LOLO_SECTIONS, CANON_ANY_ORDER, operators);
}

/**
 * Symbolic operators (`+ - * / % == != < <= > >=`) keep their symbols. They
 * are notation, not words — Arabic and Slovenian source uses the same signs —
 * and translating them would be inconsistent anyway: a lone `=` is
 * punctuation to the lexer (`trait X = …`) while `==` is an operator
 * identifier, so only half the family could ever be rendered.
 */
function isWordShaped(english: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_/-]*$/.test(english);
}

// ---------------------------------------------------------------------------
// Frame stack — the parser's positional expectations, reproduced
// ---------------------------------------------------------------------------

type FrameKind =
  /** Top level of the program. */
  | 'root'
  /** Inside `( … )` — an s-expression. Only the head is vocabulary. */
  | 'paren'
  /** An object literal `{ … }`. Keys and values are opaque pattern vocabulary. */
  | 'object'
  /** A value array `[ … ]` inside an s-expression / object. Opaque. */
  | 'array'
  /** A declaration header `[ … ]` — tags, category, capabilities. */
  | 'mods'
  /** A type array `[ … ]` in a field's type position. */
  | 'type-array'
  /** A declaration body whose statements are field declarations. */
  | 'block-fields'
  /** A declaration body whose statements are keyword-led. */
  | 'block-body'
  /** `((x v) (y w))` — a `let` binding list, or a parenthesized lambda param list. */
  | 'binder-list'
  /** `(x v)` — one `let` binding pair; the first token is the author's name. */
  | 'binder-pair';

interface Frame {
  kind: FrameKind;
  /** First identifier of the statement currently being read in this frame. */
  stmtHead: string | undefined;
  /** The statement keyword that opened this frame (`entity`, `listens`, …). */
  blockHead: string | undefined;
  /** Whether the declaration currently being read has passed a `:`. */
  afterColon: boolean;
  /** Whether the statement currently being read has passed a `=`. */
  sawEquals: boolean;
  /** For a `paren` frame: the s-expression head, once seen. */
  parenHead: string | undefined;
  /** For a `paren` frame: whether the binder list of a `let`/`fn` was already opened. */
  binderSeen: boolean;
  /**
   * True inside the body of a trait REFERENCE (`trait X = Y.traits.Z { … }`).
   * A reference's `config { … }` ASSIGNS knob values (`name: image`) where a
   * declaration's DECLARES knob types (`name : string = "x"`) — the same
   * block spelling, opposite meaning for whatever follows the colon.
   */
  refBody: boolean;
}

/**
 * Blocks whose statements declare NAMES followed by a type — an entity's
 * fields, a `type` alias body, a `config` knob list. Inside these, a
 * statement-leading identifier is the author's field name and is never
 * translated; the words after `:` are types and are.
 */
const FIELD_BLOCK_HEADS = new Set(['entity', 'type', 'config', 'params', 'variants', 'tokens', 'event']);

/**
 * Blocks whose statements are EVENT names, each opening its own payload field
 * block: `listens { EMIT_TRACE { event : string! } }`. Without this the inner
 * block reads as keyword-led and a payload field spelling a keyword (`event`,
 * `entities`) would be translated.
 */
const EVENT_BLOCK_HEADS = new Set(['listens', 'emits', 'events']);

/**
 * Keywords that introduce a NAME. The identifier immediately after one is the
 * author's, even when it spells a vocabulary word (`state config`).
 */
const NAME_INTRODUCING = new Set([
  'app',
  'orbital',
  'entity',
  'trait',
  'state',
  'page',
  'type',
  'event',
  'uses',
  'theme',
  'as',
  'extend',
]);

/** Punctuation after which an identifier is a target name, never vocabulary. */
const NAME_PUNCT = new Set(['->', '-->', '→', '.', '--']);

// ---------------------------------------------------------------------------
// The renderer
// ---------------------------------------------------------------------------

export interface LocalizeLoloOptions {
  /** Operator vocabulary — supplied by the caller (`@almadar/std`), since core must not import std. */
  operators?: OperatorTables;
}

/**
 * Render an English `.lolo` source in `lang`, preserving the original
 * formatting exactly. `lang === 'en'` returns the source unchanged.
 */
export function localizeLoloSource(
  source: string,
  lang: LanguageCode,
  options: LocalizeLoloOptions = {},
): string {
  if (lang === 'en') return source;

  const { operators } = options;
  // Each map's resolution order is the one the PARSER uses at that token
  // position: `canon_any` for identifier/modifier positions, `canon_type` for
  // a field's type, `canon_head` (effects then operators) for an s-expression
  // head, `canon_sigil_or_annotation` for a `@root`.
  const keywords = forward(lang, ['keywords'], CANON_ANY_ORDER);
  const shapes = forward(lang, ['shapes'], CANON_ANY_ORDER);
  const types = forward(lang, ['types'], ['types']);
  const modifiers = forward(lang, ['tags', 'categories', 'capabilities', 'keywords'], CANON_ANY_ORDER);
  const heads = forward(lang, ['effects'], ['effects'], operators);
  const sigils = forward(lang, ['sigils', 'annotations'], ['sigils', 'annotations']);
  // In an EXPRESSION a `@root` is a binding, never an annotation: `@key` in a
  // lambda body is the author's parameter, not the `key` annotation.
  const bindingSigils = forward(lang, ['sigils'], ['sigils', 'annotations']);
  const literals = forward(lang, ['literals'], ['literals']);
  const units = forward(lang, ['units'], ['units']);
  const reservedEvents = forward(lang, ['reservedEvents'], ['reservedEvents']);

  const tokens = lexLolo(source);
  const edits: Array<{ start: number; end: number; text: string }> = [];

  const stack: Frame[] = [
    {
      kind: 'root',
      stmtHead: undefined,
      blockHead: undefined,
      afterColon: false,
      sawEquals: false,
      refBody: false,
      parenHead: undefined,
      binderSeen: false,
    },
  ];
  const top = (): Frame => stack[stack.length - 1];

  /** The previous token that is not a comment. */
  let prev: LoloToken | undefined;

  const replace = (token: LoloToken, map: ReadonlyMap<string, string>): void => {
    if (!isWordShaped(token.text)) return;
    const native = map.get(token.text);
    if (native === undefined || native === token.text) return;
    edits.push({ start: token.textStart, end: token.end, text: native });
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind === 'comment') continue;

    const frame = top();
    const startsStatement =
      prev === undefined ||
      prev.text === '{' ||
      prev.text === '}' ||
      source.slice(prev.end, token.start).includes('\n');
    if (startsStatement) {
      frame.stmtHead = undefined;
      frame.afterColon = false;
      frame.sawEquals = false;
    }

    // ── Punctuation: maintain the frame stack ────────────────────────────
    if (token.kind === 'punct') {
      const text = source.slice(token.start, token.end);
      const child = (kind: FrameKind): Frame => ({
        kind,
        stmtHead: undefined,
        blockHead: frame.stmtHead,
        afterColon: false,
        sawEquals: false,
        refBody: frame.refBody || frame.sawEquals,
        parenHead: undefined,
        binderSeen: false,
      });
      if (text === '(' || text === '@(') {
        stack.push({ ...child(parenFrame(frame, prev)), blockHead: undefined });
        if (top().kind === 'binder-list') frame.binderSeen = true;
      } else if (text === '{') {
        stack.push(child(braceFrame(frame, prev)));
      } else if (text === '[') {
        stack.push(child(bracketFrame(frame, prev)));
      } else if (text === ')' || text === '}' || text === ']') {
        if (stack.length > 1) stack.pop();
        // A closing delimiter ends the declaration it belonged to.
        top().afterColon = false;
        top().sawEquals = false;
      } else if (text === ':') {
        frame.afterColon = true;
      } else if (text === '=') {
        // What follows a `=` is a DEFAULT VALUE, not a type:
        // `metaFormat : "none" | "date" | … = date` — `date` is an enum
        // member the author chose, and `date` is also a type name.
        frame.afterColon = false;
        frame.sawEquals = true;
      } else if (text === ',') {
        // Declarations are comma-separated on one line as often as they are
        // newline-separated: `{ role: string!, timestamp: number }`.
        frame.afterColon = false;
        frame.sawEquals = false;
        frame.stmtHead = undefined;
      }
      prev = token;
      continue;
    }

    // An object literal / value array holds pattern data, which is opaque
    // (owner ruling). `@config.x` still binds there, but an annotation word
    // like `@key` is a plain binding name, and `true` / `INIT` are values.
    const opaque =
      frame.kind === 'object' ||
      frame.kind === 'array' ||
      frame.kind === 'binder-list' ||
      (frame.kind === 'binder-pair' && prev !== undefined && prev.text === '(');

    // ── Sigils: `@root.tail` / `?payloadField` ───────────────────────────
    if (token.kind === 'sigil') {
      const dot = token.text.indexOf('.');
      const root = dot === -1 ? token.text : token.text.slice(0, dot);
      const native = (opaque || frame.kind === 'paren' ? bindingSigils : sigils).get(root);
      if (native !== undefined && native !== root) {
        edits.push({ start: token.textStart, end: token.textStart + root.length, text: native });
      }
      prev = token;
      continue;
    }
    // `?field` is a payload FIELD reference — the author's name, never vocabulary.
    if (token.kind === 'payload-sigil' || token.kind === 'string' || token.kind === 'number') {
      prev = token;
      continue;
    }

    if (token.kind === 'literal') {
      if (!opaque) replace(token, literals);
      prev = token;
      continue;
    }

    // ── Identifiers ──────────────────────────────────────────────────────
    const prevText = prev === undefined ? undefined : source.slice(prev.start, prev.end);
    const afterName = prevText !== undefined && (NAME_INTRODUCING.has(prevText) || NAME_PUNCT.has(prevText));

    // `INIT` is the one reserved event name. It is vocabulary at an event
    // position — a transition trigger, a listens arm — but a plain string in
    // pattern data (`config { action : string = INIT }`).
    if (token.text === 'INIT' && !opaque && !frame.sawEquals) {
      replace(token, reservedEvents);
      if (frame.stmtHead === undefined) frame.stmtHead = token.text;
      prev = token;
      continue;
    }

    // A unit follows a number directly: `every 100 ms` — on the SAME
    // statement, or the `1` ending `j : number = 1` would make the next
    // line's `m : number` field name a minutes unit.
    if (!opaque && !startsStatement && prev !== undefined && prev.kind === 'number') {
      replace(token, units);
      prev = token;
      continue;
    }

    switch (frame.kind) {
      case 'paren': {
        // Only the head of an s-expression is vocabulary; every argument is
        // the author's — an entity name, a state name, a pattern prop value.
        if (prevText === '(') {
          frame.parenHead = token.text;
          replace(token, heads);
        }
        break;
      }
      case 'binder-list':
      case 'binder-pair':
        // `(let ((match …)) …)` — a binding NAME, never vocabulary.
        break;
      case 'object':
      case 'array':
        // Pattern props are opaque (owner ruling): keys AND values pass through.
        break;
      case 'mods':
        // `[persistent: orders]` — after the colon is the collection name.
        if (!frame.afterColon) replace(token, modifiers);
        break;
      case 'type-array':
        replace(token, types);
        break;
      case 'block-fields': {
        // `name : Type` — the name is the author's, the type is vocabulary.
        // A default (`= …`) is a value, not a type.
        if (frame.afterColon && !afterName) replace(token, types);
        break;
      }
      case 'root':
      case 'block-body': {
        if (!afterName) replace(token, frame.afterColon ? types : keywords);
        break;
      }
    }

    // `type X = Event { … }` — the shape after `=` in a type declaration.
    if ((frame.kind === 'root' || frame.kind === 'block-body') && prevText === '=') {
      replace(token, shapes);
    }

    if (frame.stmtHead === undefined) frame.stmtHead = token.text;
    prev = token;
  }

  return applyEdits(source, edits);
}

/**
 * A `(` is normally an s-expression. Two heads bind NAMES first, and a name is
 * the author's even when it spells vocabulary: `(let ((match …) …) body)` —
 * `match` there is a variable, not the match operator — and `(fn (a b) body)`.
 */
function parenFrame(frame: Frame, prev: LoloToken | undefined): FrameKind {
  if (frame.kind === 'binder-list') return 'binder-pair';
  // Only the group IMMEDIATELY after the head binds names: `(fn (a b) body)`
  // does, `(fn c (== …))`'s body does not.
  if (
    frame.kind === 'paren' &&
    !frame.binderSeen &&
    prev !== undefined &&
    prev.text === frame.parenHead &&
    (frame.parenHead === 'let' || frame.parenHead === 'fn' || frame.parenHead === 'lambda')
  ) {
    return 'binder-list';
  }
  return 'paren';
}

/**
 * A `{` opens an object literal inside an s-expression, or a field default
 * (`seedRow : ModalRecord = {}`); everything else is a declaration body. Note
 * `type X = { … }` / `type X = Event { … }` is NOT a value — a type alias's
 * body declares fields — so the `= {` rule only applies inside a field block.
 */
function braceFrame(frame: Frame, prev: LoloToken | undefined): FrameKind {
  if (isExpression(frame.kind)) return 'object';
  if (frame.kind === 'block-fields' && prev !== undefined && prev.text === '=') return 'object';
  // A trait REFERENCE's `config { name: image }` assigns knob VALUES; only a
  // trait DECLARATION's `config { name : string = "x" }` declares types.
  if (frame.refBody && frame.stmtHead === 'config') return 'object';
  // A nested block under `listens`/`emits`/`events` is one event's payload.
  if (frame.blockHead !== undefined && EVENT_BLOCK_HEADS.has(frame.blockHead)) return 'block-fields';
  // An inline structural type: `data : { … }` or `data : [{ … }]`.
  if (frame.kind === 'type-array') return 'block-fields';
  if (frame.kind === 'block-fields' && frame.afterColon) return 'block-fields';
  const head = frame.stmtHead;
  return head !== undefined && FIELD_BLOCK_HEADS.has(head) ? 'block-fields' : 'block-body';
}

/** A `[` is a value array inside an expression, a type array after `:`, a modifier list otherwise. */
function bracketFrame(frame: Frame, prev: LoloToken | undefined): FrameKind {
  if (isExpression(frame.kind)) return 'array';
  if (prev !== undefined && prev.text === '=') return 'array';
  if (frame.afterColon) return frame.kind === 'block-fields' ? 'type-array' : 'array';
  return 'mods';
}

/** Frames whose contents are expression / data, never declaration syntax. */
function isExpression(kind: FrameKind): boolean {
  return (
    kind === 'paren' ||
    kind === 'object' ||
    kind === 'array' ||
    kind === 'binder-list' ||
    kind === 'binder-pair'
  );
}

function applyEdits(
  source: string,
  edits: Array<{ start: number; end: number; text: string }>,
): string {
  if (edits.length === 0) return source;
  edits.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const edit of edits) {
    if (edit.start < cursor) continue;
    out += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return out + source.slice(cursor);
}

// ---------------------------------------------------------------------------
// `.orb` documents
// ---------------------------------------------------------------------------

/**
 * Render an English `.orb` value in `lang` — the exact inverse of the Rust
 * `translate_orb_value`: object keys via `orb`, a `type` value via `types`,
 * an array's leading string (an s-expression / effect head) via
 * `effects ∪ operators`, and the root of any `@sigil` string. Every other
 * string — an entity name, a label, free text — is left alone.
 */
export function localizeOrbValue(
  value: JsonValue,
  lang: LanguageCode,
  options: LocalizeLoloOptions = {},
): JsonValue {
  if (lang === 'en') return value;
  const orbKeys = forward(lang, ['orb'], ['orb']);
  const types = forward(lang, ['types'], ['types']);
  const tags = forward(lang, ['tags'], ['tags']);
  const heads = forward(lang, ['effects'], ['effects'], options.operators);
  const sigils = forward(lang, ['sigils'], ['sigils', 'annotations']);

  /**
   * `type` is overloaded, and only POSITION separates the two meanings: on an
   * entity field it names a field type (`"type": "date"`), inside a
   * `render-ui` props object it names a PATTERN (`{ "type": "icon" }`), which
   * is opaque by the pattern-vocabulary ruling. Exactly one of the 279 pattern
   * names collides with a field-type word — `icon` — and translating it there
   * renamed the pattern. `inExpression` is set once we descend into an
   * s-expression, which is the only way a pattern name is reachable.
   *
   * Note this defect round-trips: the inbound walker applied the same rule, so
   * `orb emit orb` matched and the round-trip gate could not see it. A
   * symmetric error is invisible to a symmetric gate — hence the dedicated
   * assertion in the tests.
   */
  const walk = (node: JsonValue, inExpression: boolean): JsonValue => {
    if (Array.isArray(node)) {
      // An array is an s-expression only when its head resolves as one; a
      // plain value list (`"fields": ["title", "completed"]`) is not.
      const head = node[0];
      const native = typeof head === 'string' ? heads.get(head) : undefined;
      const isExpression = native !== undefined;
      const items = node.map((child, index) =>
        index === 0 && isExpression ? child : walk(child, inExpression || isExpression),
      );
      if (native !== undefined) items[0] = native;
      return items;
    }
    if (node !== null && typeof node === 'object') {
      const out: JsonObject = {};
      for (const [key, child] of Object.entries(node)) {
        const nativeKey = orbKeys.get(key) ?? key;
        let next = walk(child, inExpression);
        if (typeof next === 'string') {
          if (key === 'type' && !inExpression) next = types.get(next) ?? next;
          // `"persistence": "persistent"` — the word is `tags` vocabulary and
          // has always had a translation; only this walker never applied it.
          else if (key === 'persistence') next = tags.get(next) ?? next;
        }
        out[nativeKey] = next;
      }
      return out;
    }
    if (typeof node === 'string' && node.startsWith('@')) {
      const rest = node.slice(1);
      const dot = rest.indexOf('.');
      const root = dot === -1 ? rest : rest.slice(0, dot);
      const native = sigils.get(root);
      if (native === undefined) return node;
      return dot === -1 ? `@${native}` : `@${native}${rest.slice(dot)}`;
    }
    return node;
  };

  return walk(value, false);
}
