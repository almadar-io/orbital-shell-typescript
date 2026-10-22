/**
 * lolo-document — structural index + text-span mutations over a `.lolo` source
 * (moved from Kura's scene editor so every editor of `.lolo` shares one owner).
 *
 * NOT a lolo parser: `orbital-lolo` (the `orb` binary) is the parser of record and the
 * server's emit + validate is the correctness gate after every mutation. This module only
 * locates the constructs the editor mutates (uses / entity / traits / config entries /
 * events / listens / pages) as byte spans and produces `TextEdit[]`; every byte outside a
 * touched span is preserved verbatim, so `applyEdits(text, [])` is the identity.
 */

export interface Span {
  start: number;
  end: number;
}

export interface TextEdit {
  start: number;
  end: number;
  insert: string;
}

export type LoloValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<LoloValue>
  | { readonly [key: string]: LoloValue };

export interface UsesDecl {
  alias: string;
  from: string;
  span: Span;
}

export interface TypeDecl {
  name: string;
  span: Span;
}

export interface EntityFieldDecl {
  name: string;
  type: string;
  span: Span;
}

export interface EntityDecl {
  name: string;
  tags: string;
  fields: EntityFieldDecl[];
  span: Span;
  bodySpan: Span;
}

export interface ConfigEntry {
  key: string;
  /** Present for inline (typed) config declarations: `key : Type = value`. */
  type?: string;
  valueSpan: Span;
  rawValue: string;
  span: Span;
}

export interface EventsEntry {
  upstream: string;
  local: string;
  span: Span;
}

export interface BlockDecl {
  span: Span;
  bodySpan: Span;
}

export interface ConfigBlock extends BlockDecl {
  entries: ConfigEntry[];
}

export interface EventsBlock extends BlockDecl {
  entries: EventsEntry[];
}

export interface TraitDecl {
  name: string;
  inline: boolean;
  alias?: string;
  trait?: string;
  entity?: string;
  rebindable: boolean;
  span: Span;
  bodySpan: Span;
  config?: ConfigBlock;
  events?: EventsBlock;
  listens?: BlockDecl;
  stateBlocks: Array<{ name: string; span: Span }>;
}

export interface PageDecl {
  path: string;
  name?: string;
  traits: string[];
  /** The ` ->` token (leading whitespace included); absent for a trait-less page. */
  arrowSpan?: Span;
  /** The trait list after `->`; for a trait-less page, the empty insertion point after the head. */
  traitsSpan: Span;
  span: Span;
}

export interface LoloDocument {
  text: string;
  app?: { name: string; version: string; span: Span };
  orbital: { name: string; span: Span; bodySpan: Span };
  uses: UsesDecl[];
  types: TypeDecl[];
  entities: EntityDecl[];
  traits: TraitDecl[];
  pages: PageDecl[];
  /** Indentation (whitespace string) of the orbital's direct children. */
  indent: string;
}

export interface ListenRoute {
  source: string;
  event: string;
  local: string;
}

// ---------------------------------------------------------------------------
// Scanning helpers (string- and comment-aware)
// ---------------------------------------------------------------------------

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_@]/.test(ch);
}

/** Skip a string literal starting at `i` (which must be `"`); returns index after the closing quote. */
function skipString(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length) {
    const ch = text[j];
    if (ch === '\\') {
      j += 2;
      continue;
    }
    if (ch === '"') return j + 1;
    j++;
  }
  return text.length;
}

/** Skip a `;;` or `#` line comment (or `#= … =#` block comment) starting at `i`. */
function skipComment(text: string, i: number): number {
  if (text.startsWith('#=', i)) {
    const end = text.indexOf('=#', i + 2);
    return end === -1 ? text.length : end + 2;
  }
  const nl = text.indexOf('\n', i);
  return nl === -1 ? text.length : nl;
}

function isCommentStart(text: string, i: number): boolean {
  return text.startsWith(';;', i) || text[i] === '#';
}

/**
 * Find the index of the matching closing delimiter for the opener at `openIdx`.
 * Respects strings and comments. Returns -1 when unbalanced.
 */
export function matchDelimiter(text: string, openIdx: number): number {
  const open = text[openIdx];
  const close = open === '{' ? '}' : open === '[' ? ']' : open === '(' ? ')' : '';
  if (close === '') return -1;
  let depth = 0;
  let i = openIdx;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i = skipString(text, i);
      continue;
    }
    if (isCommentStart(text, i)) {
      i = skipComment(text, i);
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** End index (exclusive) of a value that starts at `start`: balanced through braces/brackets, stopping at a newline at depth 0. */
function scanValueEnd(text: string, start: number, stopBefore: number): number {
  let i = start;
  let depth = 0;
  while (i < stopBefore) {
    const ch = text[i];
    if (ch === '"') {
      i = skipString(text, i);
      continue;
    }
    if (isCommentStart(text, i)) break;
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') {
      if (depth === 0) break;
      depth--;
    } else if (ch === '\n' && depth === 0) break;
    i++;
  }
  // trim trailing whitespace inside the value span
  let end = i;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return end;
}

export function lineStart(text: string, idx: number): number {
  const nl = text.lastIndexOf('\n', idx - 1);
  return nl === -1 ? 0 : nl + 1;
}

function lineEnd(text: string, idx: number): number {
  const nl = text.indexOf('\n', idx);
  return nl === -1 ? text.length : nl;
}

function indentOf(text: string, idx: number): string {
  const ls = lineStart(text, idx);
  const m = /^[ \t]*/.exec(text.slice(ls, lineEnd(text, ls)));
  return m ? m[0] : '';
}

/**
 * Iterate the direct-child statements of a `{ … }` body: yields the start index of each
 * statement (first non-whitespace char of a line at depth 0 inside the body).
 */
function* statementStarts(text: string, bodySpan: Span): Generator<number> {
  let i = bodySpan.start;
  let depth = 0;
  let atLineStart = true;
  while (i < bodySpan.end) {
    const ch = text[i];
    if (ch === '"') {
      i = skipString(text, i);
      atLineStart = false;
      continue;
    }
    if (isCommentStart(text, i)) {
      i = skipComment(text, i);
      continue;
    }
    if (ch === '\n') {
      atLineStart = true;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (depth === 0 && atLineStart && isIdentStart(ch)) {
      yield i;
    }
    atLineStart = false;
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    i++;
  }
}

// ---------------------------------------------------------------------------
// Parsing the structural index
// ---------------------------------------------------------------------------

/** The `uses` alias for a behavior: its kebab name in PascalCase, the identifier form `USES_RE` indexes (`std-arcade-flow` → `StdArcadeFlow`). */
export function aliasForBehavior(behavior: string): string {
  return behavior.split(/[^A-Za-z0-9]+/).filter((part) => part.length > 0).map((part) => part[0].toUpperCase() + part.slice(1)).join('');
}

const USES_RE = /^uses\s+([A-Za-z_][\w]*)\s+from\s+"([^"]+)"/;
const TYPE_RE = /^type\s+([A-Za-z_][\w]*)\s*=/;
const ENTITY_RE = /^entity\s+([A-Za-z_][\w]*)\s*(\[[^\]]*\])?\s*\{/;
const TRAIT_REF_RE =
  /^trait\s+([A-Za-z_][\w]*)\s*(?:::[^=]*)?=\s*([A-Za-z_][\w]*)\.traits\.([A-Za-z_][\w]*)\s*(?:->\s*(@rebindable\s+)?([A-Za-z_][\w]*))?\s*\{/;
const TRAIT_INLINE_RE =
  /^trait\s+([A-Za-z_][\w]*)\s*(?:::[^-]*)?->\s*(@rebindable\s+)?([A-Za-z_][\w]*)\s*(\[[^\]]*\])?\s*\{/;
const PAGE_RE = /^page\s+"([^"]+)"(?:\s+as\s+([A-Za-z_][\w]*))?/;
const FIELD_RE = /^([A-Za-z_][\w]*)\s*:\s*([^\n=]+?)(?:\s*=\s*|\s*$)/;

function blockAt(text: string, openIdx: number): BlockDecl | null {
  const close = matchDelimiter(text, openIdx);
  if (close === -1) return null;
  return { span: { start: openIdx, end: close + 1 }, bodySpan: { start: openIdx + 1, end: close } };
}

function parseConfigBlock(text: string, block: BlockDecl): ConfigBlock {
  const entries: ConfigEntry[] = [];
  for (const s of statementStarts(text, block.bodySpan)) {
    if (text[s] === '@') continue; // annotation line (@label / @tier …)
    const le = lineEnd(text, s);
    const head = text.slice(s, le);
    const m = /^([A-Za-z_][\w]*)\s*:/.exec(head);
    if (!m) continue;
    const key = m[1];
    const afterColon = s + m[0].length;
    // inline typed form: `key : Type = value` — find ` = ` at depth 0 on the head line
    const typed = /^(\s*)([^=\n]+?)\s*=\s*/.exec(text.slice(afterColon, le));
    let type: string | undefined;
    let valueStart: number;
    if (typed && /^\s/.test(text.slice(afterColon, afterColon + 1)) && head.includes(' = ')) {
      type = typed[2].trim();
      valueStart = afterColon + typed[0].length;
    } else {
      valueStart = afterColon;
      while (valueStart < le && /[ \t]/.test(text[valueStart])) valueStart++;
    }
    const valueEnd = scanValueEnd(text, valueStart, block.bodySpan.end);
    entries.push({
      key,
      type,
      valueSpan: { start: valueStart, end: valueEnd },
      rawValue: text.slice(valueStart, valueEnd),
      span: { start: lineStart(text, s), end: valueEnd },
    });
  }
  return { ...block, entries };
}

function parseEventsBlock(text: string, block: BlockDecl): EventsBlock {
  const entries: EventsEntry[] = [];
  const body = text.slice(block.bodySpan.start, block.bodySpan.end);
  const re = /([A-Za-z_][\w]*)\s*:\s*([A-Za-z_][\w]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const start = block.bodySpan.start + m.index;
    entries.push({ upstream: m[1], local: m[2], span: { start, end: start + m[0].length } });
  }
  return { ...block, entries };
}

function parseTrait(text: string, s: number): TraitDecl | null {
  const rest = text.slice(s);
  let decl: Omit<TraitDecl, 'span' | 'bodySpan' | 'stateBlocks'>;
  let openOffset: number;
  const ref = TRAIT_REF_RE.exec(rest);
  if (ref) {
    decl = {
      name: ref[1],
      inline: false,
      alias: ref[2],
      trait: ref[3],
      entity: ref[5],
      rebindable: ref[4] !== undefined,
    };
    openOffset = ref[0].length - 1;
  } else {
    const inl = TRAIT_INLINE_RE.exec(rest);
    if (!inl) return null;
    decl = { name: inl[1], inline: true, entity: inl[3], rebindable: inl[2] !== undefined };
    openOffset = inl[0].length - 1;
  }
  const block = blockAt(text, s + openOffset);
  if (!block) return null;
  const trait: TraitDecl = { ...decl, span: { start: s, end: block.span.end }, bodySpan: block.bodySpan, stateBlocks: [] };
  for (const cs of statementStarts(text, block.bodySpan)) {
    const le = lineEnd(text, cs);
    const head = text.slice(cs, le);
    const kw = /^(config|events|listens|state|fields|emits|ticks)\b\s*([A-Za-z_][\w]*)?[^{]*\{/.exec(head);
    if (!kw) continue;
    const open = cs + head.indexOf('{');
    const sub = blockAt(text, open);
    if (!sub) continue;
    if (kw[1] === 'config') trait.config = parseConfigBlock(text, sub);
    else if (kw[1] === 'events') trait.events = parseEventsBlock(text, sub);
    else if (kw[1] === 'listens') trait.listens = sub;
    else if (kw[1] === 'state' && kw[2]) trait.stateBlocks.push({ name: kw[2], span: { start: cs, end: sub.span.end } });
  }
  return trait;
}

function parseEntity(text: string, s: number): EntityDecl | null {
  const m = ENTITY_RE.exec(text.slice(s));
  if (!m) return null;
  const block = blockAt(text, s + m[0].length - 1);
  if (!block) return null;
  const fields: EntityFieldDecl[] = [];
  for (const fs of statementStarts(text, block.bodySpan)) {
    const le = lineEnd(text, fs);
    const fm = FIELD_RE.exec(text.slice(fs, le));
    if (!fm) continue;
    fields.push({ name: fm[1], type: fm[2].trim(), span: { start: lineStart(text, fs), end: le } });
  }
  return { name: m[1], tags: m[2] ?? '', fields, span: { start: s, end: block.span.end }, bodySpan: block.bodySpan };
}

/** End of a declaration whose `[` modifier bracket may span lines: the line end after its `]`. */
function bracketEnd(text: string, bracketAt: number, firstLineEnd: number): number {
  if (text[bracketAt] !== '[') return firstLineEnd;
  const close = matchDelimiter(text, bracketAt);
  return close === -1 ? firstLineEnd : lineEnd(text, close);
}

function parsePage(text: string, s: number): PageDecl | null {
  const le = lineEnd(text, s);
  const head = text.slice(s, le);
  const m = PAGE_RE.exec(head);
  if (!m) return null;
  // The trait list ends before the attribute block, if any.
  const bracket = head.indexOf('[', m[0].length);
  const tail = bracket === -1 ? le : s + bracket;
  const arrowIdx = head.indexOf('->', m[0].length);
  const arrowAt = arrowIdx !== -1 && (bracket === -1 || arrowIdx < bracket) ? s + arrowIdx : -1;
  // A trait-less page has no `->` at all (the orb binary rejects a dangling arrow);
  // its traits span is the empty insertion point after the head, before attributes.
  let traitsStart: number;
  let traitsEnd = tail;
  if (arrowAt === -1) {
    while (traitsEnd > s + m[0].length && /\s/.test(text[traitsEnd - 1])) traitsEnd--;
    traitsStart = traitsEnd;
  } else {
    traitsStart = arrowAt + 2;
    while (traitsStart < tail && /\s/.test(text[traitsStart])) traitsStart++;
    while (traitsEnd > traitsStart && /\s/.test(text[traitsEnd - 1])) traitsEnd--;
  }
  const traits =
    arrowAt === -1
      ? []
      : text
          .slice(traitsStart, traitsEnd)
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
  const page: PageDecl = { path: m[1], name: m[2], traits, traitsSpan: { start: traitsStart, end: traitsEnd }, span: { start: s, end: bracketEnd(text, tail, le) } };
  if (arrowAt !== -1) {
    let arrowStart = arrowAt;
    while (arrowStart > s && /\s/.test(text[arrowStart - 1])) arrowStart--;
    page.arrowSpan = { start: arrowStart, end: arrowAt + 2 };
  }
  return page;
}

export function parseLoloDocument(text: string): LoloDocument {
  const orbitalRe = /^orbital\s+([A-Za-z_][\w]*)\s*\{/m;
  const om = orbitalRe.exec(text);
  if (!om || om.index === undefined) throw new Error('lolo-document: no `orbital Name {` block found');
  const openIdx = om.index + om[0].length - 1;
  const block = blockAt(text, openIdx);
  if (!block) throw new Error('lolo-document: unbalanced orbital block');
  const doc: LoloDocument = {
    text,
    orbital: { name: om[1], span: { start: om.index, end: block.span.end }, bodySpan: block.bodySpan },
    uses: [],
    types: [],
    entities: [],
    traits: [],
    pages: [],
    indent: '  ',
  };
  // `app NAME [version: "1.0.0", …]`, or the pre-bracket `app NAME "1.0.0"` / `vN`.
  const appMatch = /^app\s+([\w.-]+)(?:\s+(?:"([^"]+)"|(v[\w.]+)))?/m.exec(text);
  if (appMatch && appMatch.index !== undefined) {
    const appLineEnd = lineEnd(text, appMatch.index);
    const appBracket = text.slice(appMatch.index, appLineEnd).indexOf('[', appMatch[0].length);
    const bracketClose = appBracket === -1 ? -1 : matchDelimiter(text, appMatch.index + appBracket);
    const bracketVersion =
      bracketClose === -1 ? undefined : /\bversion:\s*"([^"]+)"/.exec(text.slice(appMatch.index + appBracket, bracketClose))?.[1];
    doc.app = {
      name: appMatch[1],
      version: bracketVersion ?? appMatch[2] ?? appMatch[3] ?? '',
      span: { start: appMatch.index, end: bracketEnd(text, appBracket === -1 ? appLineEnd : appMatch.index + appBracket, appLineEnd) },
    };
  }
  let indentSeen = false;
  for (const s of statementStarts(text, block.bodySpan)) {
    if (!indentSeen) {
      doc.indent = indentOf(text, s);
      indentSeen = true;
    }
    const le = lineEnd(text, s);
    const head = text.slice(s, le);
    const u = USES_RE.exec(head);
    if (u) {
      doc.uses.push({ alias: u[1], from: u[2], span: { start: s, end: le } });
      continue;
    }
    const t = TYPE_RE.exec(head);
    if (t) {
      const brace = head.indexOf('{');
      const end = brace !== -1 ? (matchDelimiter(text, s + brace) + 1) : le;
      doc.types.push({ name: t[1], span: { start: s, end } });
      continue;
    }
    if (head.startsWith('entity ')) {
      const e = parseEntity(text, s);
      if (e) doc.entities.push(e);
      continue;
    }
    if (head.startsWith('trait ')) {
      const tr = parseTrait(text, s);
      if (tr) doc.traits.push(tr);
      continue;
    }
    if (head.startsWith('page ')) {
      const p = parsePage(text, s);
      if (p) doc.pages.push(p);
    }
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

export function applyEdits(text: string, edits: ReadonlyArray<TextEdit>): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].end > sorted[i - 1].start) throw new Error('lolo-document: overlapping edits');
  }
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.insert + out.slice(e.end);
  return out;
}

function quote(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

/**
 * Render a value in the `.lolo` literal style the corpus uses: objects inline with commas,
 * arrays of objects one element per line (no commas), scalar arrays inline space-separated.
 */
export function formatLoloValue(value: LoloValue, indent = ''): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const allObjects = value.every((v) => typeof v === 'object' && v !== null && !Array.isArray(v));
    if (allObjects) {
      const inner = indent + '  ';
      return '[\n' + value.map((v) => inner + formatLoloValue(v, inner)).join('\n') + '\n' + indent + ']';
    }
    return '[' + value.map((v) => formatLoloValue(v, indent)).join(' ') + ']';
  }
  const parts = Object.entries(value).map(([k, v]) => `${k}: ${formatLoloValue(v, indent)}`);
  return parts.length === 0 ? '{}' : '{ ' + parts.join(', ') + ' }';
}

function inferLoloType(value: LoloValue): string {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return '[object]';
  return 'object';
}

function findTrait(doc: LoloDocument, name: string): TraitDecl {
  const t = doc.traits.find((x) => x.name === name);
  if (!t) throw new Error(`lolo-document: trait "${name}" not found`);
  return t;
}

function insertAtBlockEnd(text: string, block: BlockDecl, line: string, childIndent: string): TextEdit {
  const closeIdx = block.bodySpan.end;
  const ls = lineStart(text, closeIdx);
  const singleLine = !text.slice(block.bodySpan.start, block.bodySpan.end).includes('\n');
  if (singleLine) {
    // Keep existing bytes untouched: append the new line and move the `}` to its own line.
    const parentIndent = indentOf(text, block.span.start);
    let at = block.bodySpan.end;
    while (at > block.bodySpan.start && /\s/.test(text[at - 1])) at--;
    return { start: at, end: block.bodySpan.end, insert: `\n${childIndent}${line}\n${parentIndent}` };
  }
  return { start: ls, end: ls, insert: `${childIndent}${line}\n` };
}

function childIndentOf(text: string, block: BlockDecl, fallbackParentIndent: string): string {
  const openerLine = lineStart(text, block.span.start);
  for (const s of statementStarts(text, block.bodySpan)) {
    if (lineStart(text, s) !== openerLine) return indentOf(text, s);
  }
  return fallbackParentIndent + '  ';
}

export function addUses(doc: LoloDocument, alias: string, from: string): TextEdit[] {
  if (doc.uses.some((u) => u.from === from || u.alias === alias)) return [];
  const line = `${doc.indent}uses ${alias} from ${quote(from)}\n`;
  if (doc.uses.length > 0) {
    const last = doc.uses[doc.uses.length - 1];
    const at = lineEnd(doc.text, last.span.end) + 1;
    return [{ start: at, end: at, insert: line }];
  }
  const at = lineEnd(doc.text, doc.orbital.bodySpan.start) + 1;
  return [{ start: at, end: at, insert: line }];
}

export function usesAlias(doc: LoloDocument, from: string): string | undefined {
  return doc.uses.find((u) => u.from === from)?.alias;
}

export interface AddTraitRefInput {
  name: string;
  alias: string;
  trait: string;
  entity: string;
  config: Record<string, LoloValue>;
  events?: Record<string, string>;
}

export function addTraitRef(doc: LoloDocument, input: AddTraitRefInput): TextEdit[] {
  if (doc.traits.some((t) => t.name === input.name)) throw new Error(`lolo-document: trait "${input.name}" already exists`);
  const ind = doc.indent;
  const inner = ind + '  ';
  const lines: string[] = [`${ind}trait ${input.name} = ${input.alias}.traits.${input.trait} -> ${input.entity} {`];
  const events = Object.entries(input.events ?? {});
  if (events.length > 0) {
    lines.push(`${inner}events {`);
    for (const [up, local] of events) lines.push(`${inner}  ${up}: ${local}`);
    lines.push(`${inner}}`);
  }
  const cfg = Object.entries(input.config);
  if (cfg.length > 0) {
    lines.push(`${inner}config {`);
    for (const [k, v] of cfg) lines.push(`${inner}  ${k}: ${formatLoloValue(v, inner + '  ')}`);
    lines.push(`${inner}}`);
  }
  lines.push(`${ind}}`);
  const block = lines.join('\n') + '\n\n';
  const anchor = doc.pages.length > 0 ? lineStart(doc.text, doc.pages[0].span.start) : lineStart(doc.text, doc.orbital.bodySpan.end);
  return [{ start: anchor, end: anchor, insert: block }];
}

export function removeTrait(doc: LoloDocument, name: string): TextEdit[] {
  const trait = findTrait(doc, name);
  const edits: TextEdit[] = [];
  const ls = lineStart(doc.text, trait.span.start);
  let end = lineEnd(doc.text, trait.span.end);
  if (doc.text[end] === '\n') end++;
  if (doc.text[end] === '\n' && doc.text[ls - 1] === '\n' && doc.text[ls - 2] === '\n') end++;
  edits.push({ start: ls, end, insert: '' });
  for (const page of doc.pages) {
    if (page.traits.includes(name)) edits.push(...removePageTrait(doc, page.path, name));
  }
  if (trait.alias !== undefined) {
    const stillUsed = doc.traits.some((t) => t.name !== name && t.alias === trait.alias);
    const pageUses = doc.text.slice(doc.orbital.bodySpan.start, doc.orbital.bodySpan.end).includes(`${trait.alias}.pages.`);
    if (!stillUsed && !pageUses) {
      const u = doc.uses.find((x) => x.alias === trait.alias);
      if (u) {
        const uls = lineStart(doc.text, u.span.start);
        let uend = lineEnd(doc.text, u.span.end);
        if (doc.text[uend] === '\n') uend++;
        edits.push({ start: uls, end: uend, insert: '' });
      }
    }
  }
  return edits;
}

export function findPage(doc: LoloDocument, path: string): PageDecl {
  const p = doc.pages.find((x) => x.path === path);
  if (!p) throw new Error(`lolo-document: page "${path}" not found`);
  return p;
}

export function appendPageTrait(doc: LoloDocument, path: string, traitName: string): TextEdit[] {
  const page = findPage(doc, path);
  if (page.traits.includes(traitName)) return [];
  const insert = page.arrowSpan === undefined ? ` -> ${traitName}` : page.traits.length === 0 ? traitName : `, ${traitName}`;
  return [{ start: page.traitsSpan.end, end: page.traitsSpan.end, insert }];
}

export function removePageTrait(doc: LoloDocument, path: string, traitName: string): TextEdit[] {
  const page = findPage(doc, path);
  if (!page.traits.includes(traitName)) return [];
  const remaining = page.traits.filter((t) => t !== traitName);
  // Removing the last trait removes the arrow too — `page "/" as P -> ` does not emit.
  if (remaining.length === 0 && page.arrowSpan !== undefined) {
    return [{ start: page.arrowSpan.start, end: page.traitsSpan.end, insert: '' }];
  }
  return [{ start: page.traitsSpan.start, end: page.traitsSpan.end, insert: remaining.join(', ') }];
}

export function setConfigValue(doc: LoloDocument, traitName: string, key: string, value: LoloValue): TextEdit[] {
  const trait = findTrait(doc, traitName);
  const text = doc.text;
  if (trait.config) {
    const entry = trait.config.entries.find((e) => e.key === key);
    const childIndent = childIndentOf(text, trait.config, indentOf(text, trait.config.span.start));
    if (entry) {
      return [{ start: entry.valueSpan.start, end: entry.valueSpan.end, insert: formatLoloValue(value, childIndent) }];
    }
    const typed = trait.config.entries.some((e) => e.type !== undefined) || trait.inline;
    const line = typed
      ? `${key} : ${inferLoloType(value)} = ${formatLoloValue(value, childIndent)}`
      : `${key}: ${formatLoloValue(value, childIndent)}`;
    return [insertAtBlockEnd(text, trait.config, line, childIndent)];
  }
  const inner = indentOf(text, trait.span.start) + '  ';
  const line = trait.inline
    ? `${inner}config {\n${inner}  ${key} : ${inferLoloType(value)} = ${formatLoloValue(value, inner + '  ')}\n${inner}}\n`
    : `${inner}config {\n${inner}  ${key}: ${formatLoloValue(value, inner + '  ')}\n${inner}}\n`;
  const ls = lineStart(text, trait.bodySpan.end);
  return [{ start: ls, end: ls, insert: line }];
}

/**
 * Index of a 1-based line and character (code point) column — the position `orb embeds`
 * reports for an inline embed's opening `<`. -1 when the text has no such position.
 */
function indexOfLineCol(text: string, line: number, col: number): number {
  let i = 0;
  for (let l = 1; l < line; l++) {
    const nl = text.indexOf('\n', i);
    if (nl === -1) return -1;
    i = nl + 1;
  }
  for (let c = 1; c < col; c++) {
    if (i >= text.length || text[i] === '\n') return -1;
    i += (text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
  }
  return i;
}

/**
 * Set `key` on the inline behavior embed whose tag opens at (`line`, `col`) — the
 * `.lolo` home of an `.orb` trait named `Inline<Short><N>` (located by `orb embeds`).
 * Replaces the attribute's value in place, or adds it before the opening tag closes.
 */
export function setEmbedAttribute(text: string, line: number, col: number, key: string, value: LoloValue): TextEdit[] {
  const open = indexOfLineCol(text, line, col);
  if (open < 0 || text[open] !== '<') throw new Error(`lolo-document: no embed tag at ${line}:${col}`);
  const formatted = `{${formatLoloValue(value)}}`;
  let i = open + 1;
  while (i < text.length && !/[\s/>]/.test(text[i])) i++;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) throw new Error(`lolo-document: unterminated embed tag at ${line}:${col}`);
    if (text[i] === '>' || text.startsWith('/>', i)) {
      let at = i;
      while (at > open && /\s/.test(text[at - 1])) at--;
      return [{ start: at, end: at, insert: ` ${key}=${formatted}` }];
    }
    const nameStart = i;
    while (i < text.length && /[A-Za-z0-9_-]/.test(text[i])) i++;
    const name = text.slice(nameStart, i);
    if (name === '' || text[i] !== '=') throw new Error(`lolo-document: unreadable attribute in the embed at ${line}:${col}`);
    const valueStart = i + 1;
    const valueEnd = text[valueStart] === '{'
      ? matchDelimiter(text, valueStart) + 1
      : text[valueStart] === '"'
        ? skipString(text, valueStart)
        : -1;
    if (valueEnd <= valueStart) throw new Error(`lolo-document: unreadable value for ${name} in the embed at ${line}:${col}`);
    if (name === key) return [{ start: valueStart, end: valueEnd, insert: formatted }];
    i = valueEnd;
  }
}

/** Top-level elements of an array literal `[ … ]` as spans (balanced, string-aware). */
export function arrayElementSpans(text: string, arraySpan: Span): Span[] {
  const spans: Span[] = [];
  const open = text.indexOf('[', arraySpan.start);
  if (open === -1 || open >= arraySpan.end) return spans;
  let i = open + 1;
  const close = arraySpan.end - 1;
  while (i < close) {
    const ch = text[i];
    if (/[\s,]/.test(ch)) {
      i++;
      continue;
    }
    if (isCommentStart(text, i)) {
      i = skipComment(text, i);
      continue;
    }
    let end: number;
    if (ch === '{' || ch === '[' || ch === '(') end = matchDelimiter(text, i) + 1;
    else if (ch === '"') end = skipString(text, i);
    else {
      end = i;
      while (end < close && !/[\s,\]]/.test(text[end])) end++;
    }
    spans.push({ start: i, end });
    i = end;
  }
  return spans;
}

/** Patch scalar fields of an object literal element `{ k: v, … }`; unknown keys are appended. */
function patchObjectLiteral(text: string, span: Span, patch: Record<string, LoloValue>): TextEdit[] {
  const edits: TextEdit[] = [];
  const body = { start: span.start + 1, end: span.end - 1 };
  const remaining = new Map(Object.entries(patch));
  let i = body.start;
  while (i < body.end) {
    const ch = text[i];
    if (/[\s,]/.test(ch)) {
      i++;
      continue;
    }
    const km = /^([A-Za-z_][\w]*)\s*:\s*/.exec(text.slice(i, body.end));
    if (!km) break;
    const vs = i + km[0].length;
    let ve: number;
    const vc = text[vs];
    if (vc === '{' || vc === '[' || vc === '(') ve = matchDelimiter(text, vs) + 1;
    else if (vc === '"') ve = skipString(text, vs);
    else {
      ve = vs;
      while (ve < body.end && !/[\s,}]/.test(text[ve])) ve++;
    }
    const key = km[1];
    if (remaining.has(key)) {
      const v = remaining.get(key);
      if (v !== undefined) edits.push({ start: vs, end: ve, insert: formatLoloValue(v) });
      remaining.delete(key);
    }
    i = ve;
  }
  if (remaining.size > 0) {
    const tail = [...remaining.entries()].map(([k, v]) => `${k}: ${formatLoloValue(v)}`).join(', ');
    let insertAt = body.end;
    while (insertAt > body.start && /\s/.test(text[insertAt - 1])) insertAt--;
    const hasFields = text.slice(body.start, body.end).trim().length > 0;
    edits.push({ start: insertAt, end: insertAt, insert: hasFields ? `, ${tail}` : ` ${tail} ` });
  }
  return edits;
}

export function setConfigArrayRow(
  doc: LoloDocument,
  traitName: string,
  key: string,
  index: number,
  patch: Record<string, LoloValue>,
): TextEdit[] {
  const trait = findTrait(doc, traitName);
  const entry = trait.config?.entries.find((e) => e.key === key);
  if (!entry) throw new Error(`lolo-document: config "${key}" not found on trait "${traitName}"`);
  const elements = arrayElementSpans(doc.text, entry.valueSpan);
  const el = elements[index];
  if (!el) throw new Error(`lolo-document: "${key}[${index}]" out of range (${elements.length} elements)`);
  if (doc.text[el.start] !== '{') throw new Error(`lolo-document: "${key}[${index}]" is not an object literal`);
  return patchObjectLiteral(doc.text, el, patch);
}

export function renameEvent(doc: LoloDocument, traitName: string, upstream: string, local: string): TextEdit[] {
  const trait = findTrait(doc, traitName);
  if (trait.inline) throw new Error('lolo-document: events {} renames apply to referenced traits only');
  const text = doc.text;
  if (trait.events) {
    const existing = trait.events.entries.find((e) => e.upstream === upstream);
    const childIndent = childIndentOf(text, trait.events, indentOf(text, trait.events.span.start));
    if (existing) {
      return [{ start: existing.span.start, end: existing.span.end, insert: `${upstream}: ${local}` }];
    }
    return [insertAtBlockEnd(text, trait.events, `${upstream}: ${local}`, childIndent)];
  }
  const inner = indentOf(text, trait.span.start) + '  ';
  const at = lineEnd(text, trait.span.start) + 1;
  return [{ start: at, end: at, insert: `${inner}events {\n${inner}  ${upstream}: ${local}\n${inner}}\n` }];
}

/**
 * Add a listens route. On a referenced trait a `listens {}` override REPLACES the atom's
 * set, so the atom's own routes are restated first (`atomRoutes`) — the rebind-listens trap.
 */
export function addListens(
  doc: LoloDocument,
  traitName: string,
  route: ListenRoute,
  atomRoutes: ReadonlyArray<ListenRoute> = [],
): TextEdit[] {
  const trait = findTrait(doc, traitName);
  const text = doc.text;
  const line = `${route.source}.${route.event} -> ${route.local}`;
  if (trait.listens) {
    const body = text.slice(trait.listens.bodySpan.start, trait.listens.bodySpan.end);
    if (body.includes(line)) return [];
    const childIndent = childIndentOf(text, trait.listens, indentOf(text, trait.listens.span.start));
    return [insertAtBlockEnd(text, trait.listens, line, childIndent)];
  }
  const inner = indentOf(text, trait.span.start) + '  ';
  const routes = trait.inline ? [route] : [...atomRoutes, route];
  const lines = routes.map((r) => `${inner}  ${r.source}.${r.event} -> ${r.local}`);
  const ls = lineStart(text, trait.bodySpan.end);
  return [{ start: ls, end: ls, insert: `${inner}listens {\n${lines.join('\n')}\n${inner}}\n` }];
}

export interface LoloFieldInput {
  name: string;
  type: string;
  default?: LoloValue;
}

export function addEntityFields(doc: LoloDocument, entityName: string, fields: ReadonlyArray<LoloFieldInput>): TextEdit[] {
  const entity = doc.entities.find((e) => e.name === entityName);
  if (!entity) throw new Error(`lolo-document: entity "${entityName}" not found`);
  const missing = fields.filter((f) => !entity.fields.some((x) => x.name === f.name));
  if (missing.length === 0) return [];
  const childIndent = childIndentOf(doc.text, entity, indentOf(doc.text, entity.span.start));
  const lines = missing.map((f) => `${childIndent}${f.name} : ${f.type}${f.default !== undefined ? ` = ${formatLoloValue(f.default, childIndent)}` : ''}\n`);
  const ls = lineStart(doc.text, entity.bodySpan.end);
  return [{ start: ls, end: ls, insert: lines.join('') }];
}
