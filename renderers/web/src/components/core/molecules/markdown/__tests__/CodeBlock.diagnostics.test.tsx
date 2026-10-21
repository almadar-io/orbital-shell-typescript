/**
 * An editable CodeBlock given `diagnostics` underlines exactly the text each
 * one reports (red wavy for errors, dotted where the position is approximate),
 * and shows the message of the diagnostic under the caret.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { CodeBlock, type CodeDiagnostic } from '../CodeBlock';
import { EventBusProvider } from '../../../../../core';

const CODE = 'orbital A {\n    oops\n  (set @entity.title ?name)\n}';

function setup(diagnostics?: readonly CodeDiagnostic[], editable = true) {
  const view = render(
    <EventBusProvider debug={false}>
      <CodeBlock code={CODE} language="lolo" editable={editable} diagnostics={diagnostics} />
    </EventBusProvider>,
  );
  return { ...view, ta: view.container.querySelector('textarea') };
}

describe('CodeBlock diagnostics', () => {
  it('underlines exactly the reported text', () => {
    const { getAllByTestId } = setup([
      { line: 2, column: 5, endLine: 2, endColumn: 9, severity: 'error', message: 'unexpected token' },
      { line: 3, column: 8, endLine: 3, endColumn: 21, severity: 'error', message: "field 'title' not found" },
    ]);
    const marks = getAllByTestId('code-diagnostic');
    expect(marks.map((m) => m.textContent)).toEqual(['oops', '@entity.title']);
    expect(marks.every((m) => m.getAttribute('data-severity') === 'error')).toBe(true);
  });

  it('the underline layer holds the same text as the editor, so it lines up', () => {
    const { getByTestId } = setup([{ line: 2, column: 5, endColumn: 9, severity: 'error', message: 'm' }]);
    expect(getByTestId('code-diagnostics-layer').textContent).toBe(CODE);
  });

  it('an approximate position is drawn dotted, not as a precise squiggle', () => {
    const { getByTestId } = setup([{ line: 3, column: 3, endColumn: 7, severity: 'error', message: 'm', approximate: true }]);
    expect(getByTestId('code-diagnostic').getAttribute('data-approximate')).toBe('true');
  });

  it('shows the message of the diagnostic under the caret', () => {
    const { ta, getByTestId, queryByTestId } = setup([
      { line: 2, column: 5, endColumn: 9, severity: 'error', message: 'unexpected token' },
    ]);
    if (!ta) throw new Error('no textarea');
    expect(queryByTestId('code-diagnostic-at-caret')).toBeNull();
    const at = CODE.indexOf('oops') + 2;
    ta.setSelectionRange(at, at);
    fireEvent.click(ta);
    expect(getByTestId('code-diagnostic-at-caret').textContent).toContain('unexpected token');
    ta.setSelectionRange(0, 0);
    fireEvent.click(ta);
    expect(queryByTestId('code-diagnostic-at-caret')).toBeNull();
  });

  it('diagnostics computed on earlier code are carried over the edit to the text they named', () => {
    const earlier = CODE.replace('orbital A {', 'orbital {');
    const view = render(
      <EventBusProvider debug={false}>
        <CodeBlock
          code={CODE}
          language="lolo"
          editable
          diagnosticsCode={earlier}
          diagnostics={[
            { line: 1, column: 1, endColumn: 8, severity: 'error', message: 'kept' },
            { line: 2, column: 5, endColumn: 9, severity: 'error', message: 'moved' },
          ]}
        />
      </EventBusProvider>,
    );
    expect(view.getAllByTestId('code-diagnostic').map((m) => m.textContent)).toEqual(['orbital', 'oops']);
  });

  it('control: no diagnostics draws no layer; a read-only block ignores them', () => {
    expect(setup().queryByTestId('code-diagnostics-layer')).toBeNull();
    const ro = setup([{ line: 2, column: 5, endColumn: 9, severity: 'error', message: 'm' }], false);
    expect(ro.queryByTestId('code-diagnostic')).toBeNull();
  });

  it('edge: a diagnostic at a line end still gets a visible marker', () => {
    const { getByTestId } = setup([{ line: 1, column: 12, endColumn: 12, severity: 'warning', message: 'm' }]);
    expect(getByTestId('code-diagnostic').getAttribute('data-severity')).toBe('warning');
  });
});
