// @vitest-environment jsdom
/**
 * CodeBlock's editable-mode integration: the `motions`/`operators` prop
 * defaults (kept as JSON literals for the pattern-registry parser, item 1),
 * the `o`/`O` open-line ordering (SV4-3), and the caret-mirror measurement
 * scaffold (SV4-4). Motion/operator MATH is covered by `editorMotions.test.ts`;
 * the bus-driven capability wiring by `useEditorCapabilities.test.tsx`. This
 * file is CodeBlock's own render/DOM surface.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { CodeBlock } from '../../src/components/core/molecules/markdown/CodeBlock';
import { EDITOR_MOTIONS, EDITOR_OPERATORS } from '../../src/lib/editorMotions';
import { EventBusProvider } from '../../src/core';
import { useEventBus, type EventBusContextType } from '../../src/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function Wrapper({ children }: { children: React.ReactNode }) {
  return <EventBusProvider debug={false}>{children}</EventBusProvider>;
}

/** Pull a `name = [ ...literal strings... ]` array straight out of CodeBlock.tsx's source — the registry parser needs the prop default to stay a literal, so this checks the ACTUAL file text, not a re-typed copy. */
function extractDefaultLiteral(source: string, propName: string): string[] {
  const re = new RegExp(`\\b${propName}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm');
  const match = source.match(re);
  if (!match) throw new Error(`could not find "${propName} = [...]" in CodeBlock.tsx`);
  return match[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/^['"]|['"]$/g, ''));
}

describe('CodeBlock motions/operators prop defaults (item 1: single-source vocabulary)', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../components/core/molecules/markdown/CodeBlock.tsx'),
    'utf8',
  );

  it('the `motions` prop default literal equals EDITOR_MOTIONS from lib/editorMotions.ts', () => {
    expect(extractDefaultLiteral(source, 'motions')).toEqual([...EDITOR_MOTIONS]);
  });

  it('the `operators` prop default literal equals EDITOR_OPERATORS from lib/editorMotions.ts', () => {
    expect(extractDefaultLiteral(source, 'operators')).toEqual([...EDITOR_OPERATORS]);
  });
});

describe('CodeBlock editable — the `o`/`O` open-line sequences (SV4-3)', () => {
  function renderEditable() {
    let bus!: EventBusContextType;
    function BusGrabber() {
      bus = useEventBus();
      return null;
    }
    const { container } = render(
      <Wrapper>
        <BusGrabber />
        <CodeBlock code={"alpha\nbeta"} language="text" editable editorId="e1" onChange={() => {}} />
      </Wrapper>,
    );
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    return { bus, textarea };
  }

  it('o: line-end -> right -> insert "\\n" -> SET_MODE INSERT opens a new line BELOW, caret on it', () => {
    const { bus, textarea } = renderEditable();
    textarea.setSelectionRange(2, 2); // caret inside "alpha"

    act(() => {
      bus.emit('UI:MOTION', { editorId: 'e1', motion: 'line-end', count: 1 });
      bus.emit('UI:MOTION', { editorId: 'e1', motion: 'right', count: 1 });
      bus.emit('UI:INSERT_TEXT', { editorId: 'e1', text: '\n' });
      bus.emit('UI:SET_MODE', { editorId: 'e1', mode: 'INSERT', caret: 'bar' });
    });

    expect(textarea.value).toBe('alpha\n\nbeta');
    expect(textarea.selectionStart).toBe(6); // the new empty line, between the two \n
  });

  it('O: line-start -> insert "\\n" -> up -> SET_MODE INSERT opens a new line ABOVE, caret at 0', () => {
    const { bus, textarea } = renderEditable();
    textarea.setSelectionRange(2, 2);

    act(() => {
      bus.emit('UI:MOTION', { editorId: 'e1', motion: 'line-start', count: 1 });
      bus.emit('UI:INSERT_TEXT', { editorId: 'e1', text: '\n' });
      bus.emit('UI:MOTION', { editorId: 'e1', motion: 'up', count: 1 });
      bus.emit('UI:SET_MODE', { editorId: 'e1', mode: 'INSERT', caret: 'bar' });
    });

    expect(textarea.value).toBe('\nalpha\nbeta');
    expect(textarea.selectionStart).toBe(0);
  });
});

describe('CodeBlock editable — caret mirror (SV4-4, structure only: jsdom has no layout)', () => {
  function renderEditable() {
    let bus!: EventBusContextType;
    function BusGrabber() {
      bus = useEventBus();
      return null;
    }
    const utils = render(
      <Wrapper>
        <BusGrabber />
        <CodeBlock code={"alpha\nbeta"} language="text" editable editorId="e1" onChange={() => {}} />
      </Wrapper>,
    );
    const textarea = utils.container.querySelector('textarea') as HTMLTextAreaElement;
    return { ...utils, bus, textarea };
  }

  it('the caret span is absent while unfocused, even after SET_MODE(block)', () => {
    const { bus, container } = renderEditable();

    act(() => {
      bus.emit('UI:SET_MODE', { editorId: 'e1', mode: 'NORMAL', caret: 'block' });
    });

    // no focus fired -> neither the mirror nor the caret span render
    expect(container.querySelector('[data-testid="editor-caret-mirror"]')).toBeNull();
    expect(container.querySelector('[data-testid="editor-caret"]')).toBeNull();
  });

  it('the caret span is absent while focused but caretMode is bar (the default)', () => {
    const { textarea, container } = renderEditable();
    fireEvent.focus(textarea);
    expect(container.querySelector('[data-testid="editor-caret"]')).toBeNull();
  });

  it('focusing + SET_MODE(block) renders the mirror (with a marker span) and the caret span', () => {
    const { bus, textarea, container } = renderEditable();
    fireEvent.focus(textarea);

    act(() => {
      bus.emit('UI:SET_MODE', { editorId: 'e1', mode: 'NORMAL', caret: 'block' });
    });

    const mirror = container.querySelector('[data-testid="editor-caret-mirror"]');
    expect(mirror).not.toBeNull();
    expect(mirror?.querySelector('[data-testid="editor-caret-marker"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="editor-caret"]')).not.toBeNull();
  });

  it('blurring resets to the bar caret, removing the caret span', () => {
    const { bus, textarea, container } = renderEditable();
    fireEvent.focus(textarea);
    act(() => {
      bus.emit('UI:SET_MODE', { editorId: 'e1', mode: 'NORMAL', caret: 'block' });
    });
    expect(container.querySelector('[data-testid="editor-caret"]')).not.toBeNull();

    fireEvent.blur(textarea);
    expect(container.querySelector('[data-testid="editor-caret"]')).toBeNull();
  });
});

describe('CodeBlock editable wins over showLineNumbers (the editable gutter shows the numbers)', () => {
  const textarea = (ui: React.ReactElement) => render(ui, { wrapper: Wrapper }).container.querySelector('textarea');

  it('editable + showLineNumbers renders the editable surface', () => {
    expect(textarea(<CodeBlock code="a" language="text" editable showLineNumbers />)).not.toBeNull();
  });

  it('control: showLineNumbers without editable stays a read-only viewer', () => {
    expect(textarea(<CodeBlock code="a" language="text" showLineNumbers />)).toBeNull();
  });

  it('edge: diff mode stays a viewer even when editable', () => {
    expect(textarea(<CodeBlock code="" language="text" editable mode="diff" oldValue="a" newValue="b" />)).toBeNull();
  });
});
