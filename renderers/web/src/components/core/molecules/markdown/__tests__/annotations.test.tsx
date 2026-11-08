import React from 'react';
import { describe, it, expect, vi, beforeAll, type Mock } from 'vitest';
import type { BusEventListener } from '@almadar/core';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MarkdownContent } from '../MarkdownContent';
import { CodeBlock } from '../CodeBlock';
import { SegmentRenderer, type LessonSegment } from '../../../organisms/SegmentRenderer';
import { EventBusProvider } from '../../../../../core';
import { useEventBus } from '../../../../../core';

beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}),
  });
});

function withBus(ui: React.ReactNode, events: Record<string, Mock<BusEventListener>>) {
  const Listener: React.FC = () => {
    const bus = useEventBus();
    React.useEffect(() => {
      const offs = Object.entries(events).map(([name, fn]) => bus.on(`UI:${name}`, fn));
      return () => offs.forEach((off) => off());
    }, [bus]);
    return null;
  };
  return render(
    <EventBusProvider debug={false}>
      <Listener />
      {ui}
    </EventBusProvider>,
  );
}

function selectText(node: Node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  act(() => {
    document.dispatchEvent(new Event('selectionchange'));
  });
}

describe('select-to-annotate', () => {
  it('shows Ask/Note on selection and emits selectedText', () => {
    const ask = vi.fn();
    const note = vi.fn();
    withBus(<MarkdownContent content="Alpha beta gamma" askEvent="ASK" noteEvent="NOTE" />, { ASK: ask, NOTE: note });
    expect(screen.queryByRole('toolbar')).toBeNull();
    selectText(screen.getByText('Alpha beta gamma'));
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ payload: { selectedText: 'Alpha beta gamma' } }));
    expect(note).not.toHaveBeenCalled();
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('uses declared labels and Note emits its own event', () => {
    const note = vi.fn();
    withBus(<MarkdownContent content="Hello" noteEvent="NOTE" askLabel="x" noteLabel="Jot" />, { NOTE: note });
    selectText(screen.getByText('Hello'));
    expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Jot' }));
    expect(note).toHaveBeenCalledWith(expect.objectContaining({ payload: { selectedText: 'Hello' } }));
  });

  it('control: no selection, collapsed selection, or no declared events shows no bar', () => {
    withBus(<MarkdownContent content="Hello" askEvent="ASK" />, {});
    const selection = document.getSelection();
    selection?.removeAllRanges();
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('control: a selection outside the content shows no bar; without events none either', () => {
    withBus(
      <>
        <p>outside text</p>
        <MarkdownContent content="Inside" askEvent="ASK" />
      </>,
      {},
    );
    selectText(screen.getByText('outside text'));
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('Escape dismisses the bar', () => {
    withBus(<MarkdownContent content="Hello" askEvent="ASK" />, {});
    selectText(screen.getByText('Hello'));
    fireEvent.keyDown(screen.getByRole('toolbar'), { key: 'Escape' });
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});

describe('CodeBlock select-to-annotate', () => {
  it('shows Ask/Note on code selected in a read-only block, with line numbers or without', () => {
    const ask = vi.fn();
    const note = vi.fn();
    withBus(
      <>
        <div data-testid="viewer"><CodeBlock code="let walk = 1;" language="text" showLineNumbers askEvent="ASK" noteEvent="NOTE" /></div>
        <div data-testid="standard"><CodeBlock code="fn other() {}" language="text" noteEvent="NOTE" /></div>
      </>,
      { ASK: ask, NOTE: note },
    );
    const blockRoot = (id: string): Node => {
      const root = screen.getByTestId(id).firstElementChild?.firstElementChild;
      if (!root) throw new Error(`no code block in ${id}`);
      return root;
    };
    const viewer = blockRoot('viewer');
    const standard = blockRoot('standard');
    selectText(viewer);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ payload: { selectedText: expect.stringContaining('let walk = 1;') } }));
    selectText(standard);
    expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Note' }));
    expect(note).toHaveBeenCalledWith(expect.objectContaining({ payload: { selectedText: expect.stringContaining('fn other() {}') } }));
  });

  it('control: no declared events, or an editable block, shows no bar', () => {
    withBus(
      <>
        <div data-testid="plain"><CodeBlock code="plain code" language="text" /></div>
        <div data-testid="typed"><CodeBlock code="typed code" language="text" editable askEvent="ASK" /></div>
      </>,
      {},
    );
    for (const id of ['plain', 'typed']) {
      const root = screen.getByTestId(id).firstElementChild;
      if (!root) throw new Error(`no code block in ${id}`);
      selectText(root);
      expect(screen.queryByRole('toolbar')).toBeNull();
    }
  });
});

describe('annotation highlights', () => {
  const annotations = [
    { id: 'a1', text: 'beta', kind: 'question' as const },
    { id: 'a2', text: 'missing', kind: 'note' as const },
  ];

  it('highlights the first occurrence only and emits the id on click', () => {
    const click = vi.fn();
    const { container } = withBus(
      <MarkdownContent content="alpha beta beta gamma" annotations={annotations} annotationEvent="OPEN_NOTE" />,
      { OPEN_NOTE: click },
    );
    const marks = container.querySelectorAll('[data-annotation-id]');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('beta');
    expect(marks[0].getAttribute('data-highlight-type')).toBe('question');
    fireEvent.click(marks[0]);
    expect(click).toHaveBeenCalledWith(expect.objectContaining({ payload: { annotationId: 'a1' } }));
    expect(container.textContent).toBe('alpha beta beta gamma');
  });

  it('control: no annotations, empty text, and text inside code are not highlighted', () => {
    const { container } = withBus(
      <MarkdownContent content={'plain `beta` text'} annotations={[{ id: 'z', text: '', kind: 'note' }, ...annotations]} />,
      {},
    );
    expect(container.querySelectorAll('[data-annotation-id]')).toHaveLength(0);
  });
});

describe('SegmentRenderer segments + shared annotation', () => {
  const lesson: LessonSegment[] = [
    { type: 'activate', question: 'What do you know?' },
    { type: 'markdown', content: 'Intro text about gravity.' },
    { type: 'reflect', prompt: 'Why does it matter?' },
    { type: 'bloom', level: 'apply', question: 'Compute g?', answer: '9.8' },
  ];

  it('renders lesson segments and routes block interactions to declared events', () => {
    const act1 = vi.fn();
    const refl = vi.fn();
    const bloom = vi.fn();
    withBus(
      <SegmentRenderer
        segments={lesson}
        activationSaveEvent="ACT"
        reflectionSaveEvent="REFL"
        bloomAnswerEvent="BLOOM"
      />,
      { ACT: act1, REFL: refl, BLOOM: bloom },
    );
    expect(screen.getByText('What do you know?')).toBeInTheDocument();
    expect(screen.getByText('Intro text about gravity.')).toBeInTheDocument();
    expect(screen.getByText('Compute g?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(act1).toHaveBeenCalledWith(expect.objectContaining({ payload: { response: '' } }));
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));
    expect(bloom).toHaveBeenCalledWith(expect.objectContaining({ payload: { index: 0, level: 'apply' } }));
  });

  it('control: no segments renders no lesson blocks', () => {
    withBus(<SegmentRenderer />, {});
    expect(screen.queryByText('What do you know?')).toBeNull();
    expect(screen.queryByRole('button', { name: /skip/i })).toBeNull();
  });

  it('one action bar over the whole lesson, highlights once across segments', () => {
    const ask = vi.fn();
    const { container } = withBus(
      <SegmentRenderer
        segments={[
          { type: 'markdown', content: 'first gravity' },
          { type: 'markdown', content: 'second gravity' },
        ]}
        askEvent="ASK"
        annotations={[{ id: 'g', text: 'gravity', kind: 'note' }]}
      />,
      { ASK: ask },
    );
    expect(container.querySelectorAll('[data-annotation-id]')).toHaveLength(1);
    selectText(screen.getByText('second', { exact: false }));
    expect(screen.getAllByRole('toolbar')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ payload: { selectedText: expect.stringContaining('second') } }));
  });
});
