/**
 * Repair candidates for mermaid source that failed to parse.
 *
 * This is NOT a guess about what a diagram means. It proposes rewrites and lets
 * mermaid's own parser decide: a candidate is used only if the parser accepts it,
 * and source that already parses is never touched. So the worst case is identical
 * to having no repair at all, and the best case renders the diagram the author meant.
 *
 * Scope is bounded by the diagram's OWN declared type — the node/edge/subgraph
 * rewrites below describe flowchart grammar, so they are offered only for a source
 * whose first directive is `graph`/`flowchart`. Other diagram types get no candidates
 * rather than a rewrite written against the wrong grammar.
 *
 * The failure this exists for: LLM-authored labels carrying characters that mermaid
 * reads as syntax — `B[Scripting Engine (Vimscript)]` truncates at `(` and fails the
 * whole diagram. Quoting the label is the fix mermaid documents.
 */

/** Node shapes, longest opener first so `[[` is matched before `[`. */
const NODE_SHAPES: ReadonlyArray<readonly [string, string]> = [
  ['[[', ']]'],
  ['[(', ')]'],
  ['([', '])'],
  ['((', '))'],
  ['{{', '}}'],
  ['[', ']'],
  ['(', ')'],
  ['{', '}'],
];

const FLOWCHART_DIRECTIVE = /^(?:graph|flowchart)\b/;

/** A label mermaid can carry verbatim: already quoted, empty, or a `#`-entity string. */
function isQuoted(label: string): boolean {
  const trimmed = label.trim();
  return trimmed.length === 0 || (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1);
}

/** Mermaid has no backslash escape inside a quoted label; `#quot;` is its entity form. */
function quote(label: string): string {
  return `"${label.replace(/"/g, '#quot;')}"`;
}

function isIdentifierChar(ch: string): boolean {
  return /[A-Za-z0-9_\-.]/.test(ch);
}

/** The declared diagram type, from the first directive line. */
function declaredType(code: string): string {
  for (const line of code.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;
    return trimmed;
  }
  return '';
}

function isFlowchart(code: string): boolean {
  return FLOWCHART_DIRECTIVE.test(declaredType(code));
}

/**
 * Quote unquoted node labels: `A[User Interface]` → `A["User Interface"]`.
 * A shape opener only counts when it directly follows a node id, which is what
 * separates `B[label]` from the `-->|label|` and `subgraph` forms handled below.
 */
function quoteNodeLabels(code: string): string {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const shape = NODE_SHAPES.find(([open]) => code.startsWith(open, i));
    const precededByIdentifier = i > 0 && isIdentifierChar(code[i - 1] ?? '');
    if (shape === undefined || !precededByIdentifier) {
      out += code[i];
      i += 1;
      continue;
    }
    const [open, close] = shape;
    const contentStart = i + open.length;
    const closeAt = code.indexOf(close, contentStart);
    const newlineAt = code.indexOf('\n', contentStart);
    if (closeAt === -1 || (newlineAt !== -1 && newlineAt < closeAt)) {
      out += code[i];
      i += 1;
      continue;
    }
    const label = code.slice(contentStart, closeAt);
    out += open + (isQuoted(label) ? label : quote(label)) + close;
    i = closeAt + close.length;
  }
  return out;
}

/** Quote unquoted edge labels: `A -->|calls (sync)| B` → `A -->|"calls (sync)"| B`. */
function quoteEdgeLabels(code: string): string {
  return code
    .split('\n')
    .map(line => {
      let out = '';
      let rest = line;
      for (;;) {
        const open = rest.indexOf('|');
        if (open === -1) break;
        const close = rest.indexOf('|', open + 1);
        if (close === -1) break;
        const label = rest.slice(open + 1, close);
        out += rest.slice(0, open + 1) + (isQuoted(label) ? label : quote(label)) + '|';
        rest = rest.slice(close + 1);
      }
      return out + rest;
    })
    .join('\n');
}

/**
 * Quote unquoted subgraph titles: `subgraph Vim Core (Monolithic)` → quoted.
 * A `subgraph id[Title]` line is left to `quoteNodeLabels`, which owns that form.
 */
function quoteSubgraphTitles(code: string): string {
  return code
    .split('\n')
    .map(line => {
      const match = /^(\s*subgraph\s+)(.+?)(\s*)$/.exec(line);
      if (match === null) return line;
      const [, prefix, title, trailing] = match;
      if (title === undefined || prefix === undefined) return line;
      if (isQuoted(title) || title.includes('[')) return line;
      return prefix + quote(title) + (trailing ?? '');
    })
    .join('\n');
}

/**
 * Ordered repair candidates for `code`, least-altering first, never including
 * `code` itself. Empty when the diagram type is one this module has no grammar for.
 *
 * Every candidate must still be validated by mermaid before it is rendered — this
 * function makes proposals, it does not decide.
 */
export function mermaidRepairCandidates(code: string): ReadonlyArray<string> {
  if (!isFlowchart(code)) return [];
  const nodes = quoteNodeLabels(code);
  const nodesAndEdges = quoteEdgeLabels(nodes);
  const all = quoteSubgraphTitles(nodesAndEdges);
  const ordered = [nodes, nodesAndEdges, all];
  const seen = new Set<string>([code]);
  const candidates: string[] = [];
  for (const candidate of ordered) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
  }
  return candidates;
}
