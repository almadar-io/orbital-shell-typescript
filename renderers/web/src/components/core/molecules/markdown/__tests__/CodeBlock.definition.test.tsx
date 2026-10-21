/**
 * Go to definition: with Cmd (Ctrl) held, a click — or Cmd+Enter with the caret —
 * on an identifier the host accepts (`definitionAt`) reports it
 * (`onGoToDefinition`). Identifiers the syntax highlighting marks as comment or
 * string are never offered.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { CodeBlock, preloadCodeHighlighter } from '../CodeBlock';

// Blocks paint highlighted only once the on-demand highlighter is in (G-UI-105).
beforeAll(() => preloadCodeHighlighter());
import { EventBusProvider } from '../../../../../core';

const CODE = 'orbital A {\n  uses AppShell from "std/behaviors/std-app-layout"\n  ;; AppShell is the layout\n  trait L = AppShell.traits.AppLayout {\n  }\n}';

function setup() {
  const onGoToDefinition = vi.fn();
  const definitionAt = (id: string) => id === 'AppShell' || id.startsWith('AppShell.traits.');
  const view = render(
    <EventBusProvider debug={false}>
      <CodeBlock code={CODE} language="lolo" editable onChange={() => {}} definitionAt={definitionAt} onGoToDefinition={onGoToDefinition} />
    </EventBusProvider>,
  );
  const ta = view.container.querySelector('textarea');
  if (!ta) throw new Error('no textarea');
  const at = (needle: string, from = 0) => CODE.indexOf(needle, from) + 2;
  const caret = (i: number) => ta.setSelectionRange(i, i);
  return { ta, onGoToDefinition, at, caret };
}

describe('CodeBlock go to definition', () => {
  it('Cmd+click on an accepted identifier reports it', () => {
    const { ta, onGoToDefinition, at, caret } = setup();
    caret(at('AppShell from'));
    fireEvent.click(ta, { metaKey: true });
    expect(onGoToDefinition).toHaveBeenCalledWith('AppShell');
  });

  it('a dotted trait reference is reported whole', () => {
    const { ta, onGoToDefinition, at, caret } = setup();
    caret(at('traits.AppLayout'));
    fireEvent.click(ta, { ctrlKey: true });
    expect(onGoToDefinition).toHaveBeenCalledWith('AppShell.traits.AppLayout');
  });

  it('Cmd+Enter with the caret on it reports it too', () => {
    const { ta, onGoToDefinition, at, caret } = setup();
    caret(at('AppShell from'));
    fireEvent.keyDown(ta, { key: 'Enter', metaKey: true });
    expect(onGoToDefinition).toHaveBeenCalledWith('AppShell');
  });

  it('control: a plain click only moves the caret', () => {
    const { ta, onGoToDefinition, at, caret } = setup();
    caret(at('AppShell from'));
    fireEvent.click(ta);
    expect(onGoToDefinition).not.toHaveBeenCalled();
  });

  it('control: an identifier the host does not accept is not reported', () => {
    const { ta, onGoToDefinition, at, caret } = setup();
    caret(at('orbital'));
    fireEvent.click(ta, { metaKey: true });
    expect(onGoToDefinition).not.toHaveBeenCalled();
  });

  it('edge: the same name inside a comment is not offered', () => {
    const { ta, onGoToDefinition, at, caret } = setup();
    caret(at('AppShell is'));
    fireEvent.click(ta, { metaKey: true });
    expect(onGoToDefinition).not.toHaveBeenCalled();
  });
});
