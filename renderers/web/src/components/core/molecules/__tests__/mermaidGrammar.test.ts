import { describe, it, expect } from 'vitest';
import { mermaidRepairCandidates } from '../markdown/mermaidSource';

/**
 * The grammar facts the lesson-authoring prompt promises (the retired knowledge package
 * `promptBuilders/markdownRenderRules.ts`). Diagram source reaching MermaidDiagram
 * is LLM-authored, so those rules are the only thing standing between a learner and
 * a parser error — pinned here against the mermaid version this package renders with.
 */

const UNQUOTED_LABEL_WITH_PARENS = `graph TD
    subgraph "Vim Core (Monolithic)"
        A[User Interface] --> B[Scripting Engine (Vimscript)]
        B --> C[Editing Logic]
    end`;

const QUOTED = `graph TD
    subgraph "Vim Core (Monolithic)"
        A["User Interface"] --> B["Scripting Engine (Vimscript)"]
        B --> C["Editing Logic"]
        C --> D["File I/O"]
    end
    E["User"] --> A`;

const QUOTED_EDGE_LABEL = `graph TD
    A -->|"calls (sync)"| B`;

async function parser() {
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
  return mermaid;
}

describe('mermaid grammar the authoring rules depend on', () => {
  it('rejects an unquoted node label containing parentheses', async () => {
    await expect((await parser()).parse(UNQUOTED_LABEL_WITH_PARENS)).rejects.toThrow(/Parse error/);
  });

  it.each([
    ['quoted node labels', QUOTED],
    ['quoted edge label', QUOTED_EDGE_LABEL],
  ])('accepts %s', async (_name, source) => {
    await expect((await parser()).parse(source)).resolves.toBeTruthy();
  });
});

describe('repair candidates are accepted by the real parser', () => {
  /** The diagram as an LLM actually produced it — the one that was reported broken. */
  const REPORTED = `graph TD
    subgraph "Vim Core (Monolithic)"
        A[User Interface] --> B[Scripting Engine (Vimscript)]
        B --> C[Editing Logic]
        C --> D[File I/O]
        A --> C
        B --> D
    end
    E[User] --> A
    F[Plugin] --> B`;

  const UNQUOTED_SUBGRAPH_AND_EDGE = `flowchart LR
    subgraph Vim Core (Monolithic)
        A[Buffer] -->|writes (flush)| B[File I/O]
    end`;

  it.each([
    ['the reported diagram', REPORTED],
    ['unquoted subgraph title and edge label', UNQUOTED_SUBGRAPH_AND_EDGE],
  ])('produces a candidate mermaid accepts for %s', async (_name, source) => {
    const mermaid = await parser();
    await expect(mermaid.parse(source)).rejects.toThrow();

    const candidates = mermaidRepairCandidates(source);
    expect(candidates.length).toBeGreaterThan(0);

    const accepted: string[] = [];
    for (const candidate of candidates) {
      const ok = await mermaid.parse(candidate).then(() => true, () => false);
      if (ok) accepted.push(candidate);
    }
    expect(accepted.length).toBeGreaterThan(0);
  });

  it('keeps every label\'s text through the repair', async () => {
    const mermaid = await parser();
    let repaired: string | undefined;
    for (const candidate of mermaidRepairCandidates(REPORTED)) {
      const ok = await mermaid.parse(candidate).then(() => true, () => false);
      if (ok) {
        repaired = candidate;
        break;
      }
    }
    expect(repaired).toBeDefined();
    for (const label of ['User Interface', 'Scripting Engine (Vimscript)', 'Editing Logic', 'File I/O', 'User', 'Plugin']) {
      expect(repaired).toContain(label);
    }
    // Structure is untouched: only the label delimiters gained quotes.
    expect(repaired?.split('\n').length).toBe(REPORTED.split('\n').length);
  });

  it('offers nothing for a diagram type it has no grammar for', () => {
    expect(mermaidRepairCandidates('sequenceDiagram\n    Alice->>John: Hello (hi)')).toEqual([]);
  });
});
