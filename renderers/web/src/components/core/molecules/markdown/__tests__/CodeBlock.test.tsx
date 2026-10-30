/**
 * CodeBlock Component Tests
 *
 * GAP-84 regression: `CodeBlock` had three render branches (standard /
 * editable / viewer) but only the first two tokenized code through
 * `SyntaxHighlighter` — viewer mode (`title`/`files`/`showLineNumbers`/
 * `diff`/`actions`) mapped `code.split('\n')` straight into `<Typography>`
 * rows with NO Prism pass at all, live on the public marketing/playground
 * sites via `OrbPreviewBlock`. These tests assert real tokenization (a
 * `.token` span count) for every branch, including diff rows, so the defect
 * can't silently come back.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { CodeBlock, EDITOR_MOTIONS, EDITOR_OPERATORS, preloadCodeHighlighter } from '../CodeBlock';
import { EventBusProvider } from '../../../../../core';
import { EditorFocusProvider, useEditorFocus, type EditorFocus } from '../../../../../providers/EditorFocusContext';
import { useEventBus, type EventBusContextType } from '../../../../../core';

// Blocks paint highlighted only once the on-demand highlighter is in (G-UI-105).
beforeAll(() => preloadCodeHighlighter());
import { getVocabulary } from '@almadar/core/i18n';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <EventBusProvider debug={false}>{children}</EventBusProvider>;
}

const JSON_CODE = '{\n  "orbital": "Task",\n  "count": 3\n}';

const LOLO_CODE = [
  'app Shop',
  '',
  'entity Product [persistent: products]',
  '  price: number',
  '',
  'trait Cart for Product [interaction]',
  '  initial idle',
  '  state idle',
  '    on ADD -> active',
  '      (persist create @entity)',
  '  state active',
].join('\n');

describe('CodeBlock', () => {
  it('standard mode: tokenizes JSON via SyntaxHighlighter', () => {
    const { container } = render(
      <Wrapper>
        <CodeBlock code={JSON_CODE} language="json" />
      </Wrapper>,
    );
    const tokens = container.querySelectorAll('span.token');
    expect(tokens.length).toBeGreaterThan(1);
    expect(container.textContent).toContain('"orbital"');
  });

  it('viewer mode (title): tokenizes JSON via SyntaxHighlighter (GAP-84)', () => {
    // This is the exact call shape of the live GAP-84 callers
    // (OrbPreviewBlock passes title="schema.orb"), which used to route into
    // the unhighlighted `activeCode.split('\n')` → `<Typography>` branch.
    const { container } = render(
      <Wrapper>
        <CodeBlock code={JSON_CODE} language="json" title="schema.orb" />
      </Wrapper>,
    );
    const tokens = container.querySelectorAll('span.token');
    expect(tokens.length).toBeGreaterThan(1);
    expect(container.textContent).toContain('"orbital"');
  });

  it('viewer mode (showLineNumbers): tokenizes AND renders line numbers', () => {
    const { container } = render(
      <Wrapper>
        <CodeBlock code={JSON_CODE} language="json" title="schema.orb" showLineNumbers />
      </Wrapper>,
    );
    const tokens = container.querySelectorAll('span.token');
    expect(tokens.length).toBeGreaterThan(1);

    const lineNumbers = container.querySelectorAll('.react-syntax-highlighter-line-number');
    expect(lineNumbers.length).toBeGreaterThan(0);
    expect(lineNumbers[0]?.textContent).toContain('1');
  });

  it('editable mode: the Prism overlay produces token spans', () => {
    const { container } = render(
      <Wrapper>
        <CodeBlock code={JSON_CODE} language="json" editable onChange={() => {}} />
      </Wrapper>,
    );
    const tokens = container.querySelectorAll('span.token');
    expect(tokens.length).toBeGreaterThan(1);
  });

  it('diff mode: tokenizes +/- lines AND keeps diff row backgrounds', () => {
    const { container } = render(
      <Wrapper>
        <CodeBlock
          language="json"
          title="schema.orb"
          diff={[
            { type: 'context', content: '{', lineNumber: 1 },
            { type: 'remove', content: '  "count": 2', lineNumber: 2 },
            { type: 'add', content: '  "count": 3', lineNumber: 2 },
            { type: 'context', content: '}', lineNumber: 3 },
          ]}
        />
      </Wrapper>,
    );

    const tokens = container.querySelectorAll('span.token');
    expect(tokens.length).toBeGreaterThan(1);
    expect(container.textContent).toContain('"count"');

    const removedRow = Array.from(container.querySelectorAll('.bg-error\\/10'));
    const addedRow = Array.from(container.querySelectorAll('.bg-success\\/10'));
    expect(removedRow.length).toBeGreaterThan(0);
    expect(addedRow.length).toBeGreaterThan(0);
  });

  it('oldValue/newValue: an inserted line marks only that line added, not every line after it', () => {
    const { container } = render(
      <Wrapper>
        <CodeBlock language="text" title="notes" mode="diff" oldValue={'a\nb\nc'} newValue={'a\nX\nb\nc'} />
      </Wrapper>,
    );
    expect(container.querySelectorAll('.bg-success\\/10')).toHaveLength(1);
    expect(container.querySelectorAll('.bg-error\\/10')).toHaveLength(0);
  });

  // P0-1 S-A: declaration-only editor capability surface (plugin system,
  // Part D1). Runtime wiring lands in P1 — these props are accepted but
  // inert here.
  describe('editor capability surface (declaration-only)', () => {
    it('EDITOR_MOTIONS lists all 17 motions', () => {
      expect(EDITOR_MOTIONS).toHaveLength(17);
      expect(EDITOR_MOTIONS).toEqual([
        'left',
        'right',
        'up',
        'down',
        'word-forward',
        'word-back',
        'word-end',
        'line-start',
        'line-end',
        'first-nonblank',
        'doc-start',
        'doc-end',
        'paragraph-forward',
        'paragraph-back',
        'line',
        'selection',
        'match-bracket',
      ]);
    });

    it('EDITOR_OPERATORS lists all 12 operators', () => {
      expect(EDITOR_OPERATORS).toEqual([
        'delete',
        'yank',
        'change',
        'put',
        'put-before',
        'undo',
        'redo',
        'join',
        'toggle-case',
        'indent',
        'dedent',
        'replace',
      ]);
    });

    it('accepts the editor capability props without runtime error', () => {
      const { container } = render(
        <Wrapper>
          <CodeBlock
            code={JSON_CODE}
            language="json"
            editorId="editor-1"
            onEditorFocus="EDITOR_FOCUS"
            onEditorBlur="EDITOR_BLUR"
            onMotion="MOTION"
            onOperate="OPERATE"
            onInsertText="INSERT_TEXT"
            onSetMode="SET_MODE"
            motions={EDITOR_MOTIONS}
            operators={EDITOR_OPERATORS}
          />
        </Wrapper>,
      );
      const tokens = container.querySelectorAll('span.token');
      expect(tokens.length).toBeGreaterThan(1);
    });
  });

  // Natural-language tabs: the same program rendered in Arabic / Slovenian.
  describe('naturalLanguages', () => {
    it('renders exactly as without the prop when it is absent', () => {
      const plain = render(<Wrapper><CodeBlock code={LOLO_CODE} language="lolo" /></Wrapper>);
      const withProp = render(<Wrapper><CodeBlock code={LOLO_CODE} language="lolo" naturalLanguages={[]} /></Wrapper>);
      expect(withProp.container.innerHTML).toBe(plain.container.innerHTML);
      expect(plain.container.querySelector('[data-testid="codeblock-language-tabs"]')).toBeNull();
    });

    it('renders exactly as without the prop for a single language', () => {
      const plain = render(<Wrapper><CodeBlock code={LOLO_CODE} language="lolo" /></Wrapper>);
      const single = render(<Wrapper><CodeBlock code={LOLO_CODE} language="lolo" naturalLanguages={['ar']} /></Wrapper>);
      expect(single.container.innerHTML).toBe(plain.container.innerHTML);
      expect(single.container.textContent).toContain('app Shop');
    });

    it('shows a tab per language for two or more', () => {
      const { container } = render(
        <Wrapper>
          <CodeBlock code={LOLO_CODE} language="lolo" naturalLanguages={['en', 'ar', 'sl']} />
        </Wrapper>,
      );
      const strip = container.querySelector('[data-testid="codeblock-language-tabs"]');
      expect(strip).not.toBeNull();
      expect(strip?.textContent).toContain(getVocabulary('en').meta.name);
      expect(strip?.textContent).toContain(getVocabulary('ar').meta.name);
      expect(strip?.textContent).toContain(getVocabulary('sl').meta.name);
      // First tab wins: the English source renders untranslated.
      expect(container.textContent).toContain('app Shop');
    });

    it('switching a tab swaps the rendered text and flips the chrome to RTL', () => {
      const { container, getByText } = render(
        <Wrapper>
          <CodeBlock code={LOLO_CODE} language="lolo" naturalLanguages={['en', 'ar']} />
        </Wrapper>,
      );
      expect(container.textContent).toContain('app Shop');
      expect(container.textContent).not.toContain('تطبيق');

      fireEvent.click(getByText(getVocabulary('ar').meta.name));

      expect(container.textContent).toContain('تطبيق');
      expect(container.textContent).toContain('كيان Product');
      expect(container.textContent).not.toContain('app Shop');
      const strip = container.querySelector('[data-testid="codeblock-language-tabs"]');
      expect(strip?.getAttribute('dir')).toBe('rtl');
      // Code lines stay LTR — bidi would mirror the s-expression brackets.
      expect(container.querySelector('[dir="ltr"]')).not.toBeNull();
    });

    it('translates .orb documents too', () => {
      const orb = JSON.stringify({ orbitals: [{ name: 'Shop' }] }, null, 2);
      const { container, getByText } = render(
        <Wrapper>
          <CodeBlock code={orb} language="orb" naturalLanguages={['en', 'ar']} />
        </Wrapper>,
      );
      fireEvent.click(getByText(getVocabulary('ar').meta.name));
      expect(container.textContent).toContain('مدارات');
    });

    it('editable wins: no tabs, English source', () => {
      const { container } = render(
        <Wrapper>
          <CodeBlock code={LOLO_CODE} language="lolo" editable naturalLanguages={['en', 'ar']} />
        </Wrapper>,
      );
      expect(container.querySelector('[data-testid="codeblock-language-tabs"]')).toBeNull();
      const textarea = container.querySelector('textarea');
      expect(textarea?.value).toBe(LOLO_CODE);
      expect(container.textContent).not.toContain('تطبيق');
    });

    it('leaves a non-program language alone', () => {
      const { container, getByText } = render(
        <Wrapper>
          <CodeBlock code={JSON_CODE} language="json" naturalLanguages={['en', 'ar']} />
        </Wrapper>,
      );
      fireEvent.click(getByText(getVocabulary('ar').meta.name));
      expect(container.textContent).toContain('"orbital"');
    });
  });

  // P1-1 S-H: runtime wiring of the editor capability surface (Part E3).
  describe('editor capabilities (runtime wiring)', () => {
    function BusGrabber({ onBus }: { onBus: (bus: EventBusContextType) => void }) {
      onBus(useEventBus());
      return null;
    }

    function renderEditable(props: { editorId?: string; onChange?: (code: string) => void }) {
      let bus!: EventBusContextType;
      const { container } = render(
        <Wrapper>
          <BusGrabber onBus={(b) => { bus = b; }} />
          <CodeBlock code="hello world" language="text" editable {...props} />
        </Wrapper>,
      );
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      return { bus, textarea };
    }

    it('emits UI:EDITOR_FOCUS on focus and UI:EDITOR_BLUR on blur when editorId is set', () => {
      const { bus, textarea } = renderEditable({ editorId: 'e1' });
      const focusSpy = vi.fn();
      const blurSpy = vi.fn();
      bus.on('UI:EDITOR_FOCUS', focusSpy);
      bus.on('UI:EDITOR_BLUR', blurSpy);

      fireEvent.focus(textarea);
      expect(focusSpy).toHaveBeenCalledTimes(1);
      expect(focusSpy.mock.calls[0][0].payload).toEqual({ editorId: 'e1' });

      fireEvent.blur(textarea);
      expect(blurSpy).toHaveBeenCalledTimes(1);
      expect(blurSpy.mock.calls[0][0].payload).toEqual({ editorId: 'e1' });
    });

    it('reports its focus and blur to the editor focus context, and only when editorId is set', () => {
      let store!: EditorFocus;
      function Grab(): null {
        store = useEditorFocus();
        return null;
      }
      const { container } = render(
        <Wrapper>
          <EditorFocusProvider>
            <Grab />
            <CodeBlock code="hello" language="text" editable editorId="e1" />
            <CodeBlock code="other" language="text" editable />
          </EditorFocusProvider>
        </Wrapper>,
      );
      const [withId, withoutId] = Array.from(container.querySelectorAll('textarea'));
      fireEvent.focus(withoutId);
      expect(store.focused()).toBeNull();
      fireEvent.focus(withId);
      expect(store.focused()).toBe('e1');
      fireEvent.blur(withId);
      expect(store.focused()).toBeNull();
    });

    it('UI:OPERATE delete word-forward changes the textarea value and calls onChange with it', () => {
      const onChange = vi.fn();
      const { bus, textarea } = renderEditable({ editorId: 'e1', onChange });
      textarea.setSelectionRange(0, 0);

      act(() => {
        bus.emit('UI:OPERATE', { editorId: 'e1', operator: 'delete', motion: 'word-forward', count: 1 });
      });

      expect(textarea.value).toBe('world');
      expect(onChange).toHaveBeenCalledWith('world');
    });
  });
});
