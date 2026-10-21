import { describe, it, expect } from 'vitest';
import { mermaidRepairCandidates } from '../markdown/mermaidSource';

/** Candidates are proposals; mermaid decides (see mermaidGrammar.test.ts). These pin
 *  what is proposed — above all, that nothing already valid is altered. */
describe('mermaidRepairCandidates', () => {
  it('quotes an unquoted node label', () => {
    const [first] = mermaidRepairCandidates('graph TD\n  A[Scripting Engine (Vimscript)] --> B[Ok]');
    expect(first).toContain('A["Scripting Engine (Vimscript)"]');
    expect(first).toContain('B["Ok"]');
  });

  it('leaves an already-quoted label alone', () => {
    const candidates = mermaidRepairCandidates('graph TD\n  A["Already (quoted)"] --> B["Fine"]');
    expect(candidates).toEqual([]);
  });

  it('quotes edge labels and subgraph titles in later candidates only', () => {
    const candidates = mermaidRepairCandidates(
      'flowchart LR\n  subgraph Vim Core (Monolithic)\n    A[Buffer] -->|writes (flush)| B[Disk]\n  end',
    );
    expect(candidates[0]).toContain('A["Buffer"]');
    expect(candidates[0]).not.toContain('|"writes (flush)"|');
    expect(candidates.at(-1)).toContain('|"writes (flush)"|');
    expect(candidates.at(-1)).toContain('subgraph "Vim Core (Monolithic)"');
  });

  it('leaves a subgraph declared in the id[Title] form to the node pass', () => {
    const [first] = mermaidRepairCandidates('graph TD\n  subgraph core[Vim Core]\n  A[X] --> B[Y]\n  end');
    expect(first).toContain('subgraph core["Vim Core"]');
  });

  it('escapes a quote inside a label with mermaid\'s entity form', () => {
    const [first] = mermaidRepairCandidates('graph TD\n  A[He said "hi" loudly] --> B[Ok]');
    expect(first).toContain('A["He said #quot;hi#quot; loudly"]');
  });

  it('offers nothing for a non-flowchart diagram type', () => {
    expect(mermaidRepairCandidates('sequenceDiagram\n  Alice->>John: Hi (there)')).toEqual([]);
    expect(mermaidRepairCandidates('stateDiagram-v2\n  [*] --> Still')).toEqual([]);
  });

  it('reads the diagram type past comments and blank lines', () => {
    const candidates = mermaidRepairCandidates('\n%% a comment\ngraph TD\n  A[Label (x)] --> B[Y]');
    expect(candidates[0]).toContain('A["Label (x)"]');
  });

  it('never returns the original source as a candidate', () => {
    const source = 'graph TD\n  A --> B';
    expect(mermaidRepairCandidates(source)).not.toContain(source);
  });

  it('leaves an unterminated shape alone rather than spanning the line', () => {
    const [first] = mermaidRepairCandidates('graph TD\n  A[Unclosed\n  B[Fine] --> C[Ok]');
    expect(first).toContain('A[Unclosed');
    expect(first).toContain('B["Fine"]');
  });
});
