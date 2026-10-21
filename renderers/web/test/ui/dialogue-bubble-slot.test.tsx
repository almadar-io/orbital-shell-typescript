/**
 * `ui-visual-novel-board` crashed in the catalog with `t.slice is not a
 * function` inside `DialogueBubble`: the board renders a `dialogue-bubble`
 * child of `game-shell` with `text` bound to a plain string entity field.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { RENDER_BINDING_MARKER, type EntityRow, type SExpr } from '@almadar/core';
import { SlotContentRenderer, UISlotRenderer } from '../../src/components/core/organisms/UISlotRenderer';
import { UISlotProvider, useUISlots, type SlotPropValue, type SlotProps } from '../../src/providers/UISlotContext';
import { EntityBindingContext, type EntityBindingSource } from '../../src/providers/EntityBindingContext';

const TEXT = 'The corridor stretches into shadow. A lone sentinel blocks your path.';

function renderSlot(props: SlotProps) {
  return render(
    <UISlotProvider>
      <SlotContentRenderer content={{ id: 'main', pattern: 'game-shell', props, priority: 0 }} onDismiss={() => {}} />
    </UISlotProvider>,
  );
}

describe('dialogue-bubble inside game-shell', () => {
  it('renders the revealed prefix of a string text', () => {
    renderSlot({
      children: [
        { type: 'dialogue-bubble', speaker: 'Narrator', text: TEXT, revealedChars: 7 },
        { type: 'data-list', entity: [{ label: 'Approach', nextId: 'meet' }], fields: [], gap: 'sm' },
      ],
    });
    expect(screen.getByText('The cor')).toBeInTheDocument();
  });

  it('renders the full text when revealedChars covers it', () => {
    renderSlot({ children: [{ type: 'dialogue-bubble', speaker: 'Narrator', text: TEXT, revealedChars: TEXT.length }] });
    expect(screen.getByText(TEXT)).toBeInTheDocument();
  });
});

const marker = (expression: string): SlotPropValue => ({ [RENDER_BINDING_MARKER]: true, expression: expression as SExpr }) as SlotPropValue;

const ROW: EntityRow = {
  id: 'vn-1',
  currentSpeaker: 'Narrator',
  currentText: TEXT,
  revealedChars: 7,
  currentChoices: [{ label: 'Approach', nextId: 'meet' }],
};

function source(row: EntityRow): EntityBindingSource {
  return {
    getEntitySnapshot: () => row,
    getConfig: () => undefined,
    getState: () => 'playing',
    subscribe: () => () => undefined,
  };
}

function renderBound(props: Record<string, SlotPropValue>) {
  return render(
    <EntityBindingContext.Provider value={source(ROW)}>
      <UISlotProvider>
        <SlotContentRenderer
          content={{ id: 'main', pattern: 'game-shell', sourceTrait: 'VisualNovelBoardRender', props, priority: 0 }}
          onDismiss={() => {}}
        />
      </UISlotProvider>
    </EntityBindingContext.Provider>,
  );
}

describe('dialogue-bubble with render-time bindings (the interpreted path)', () => {
  it('resolves @entity markers on a game-shell child before the atom renders', () => {
    renderBound({
      children: [
        { type: 'dialogue-bubble', speaker: marker('@entity.currentSpeaker'), text: marker('@entity.currentText'), revealedChars: marker('@entity.revealedChars') },
      ] as SlotPropValue,
    });
    expect(screen.getByText('The cor')).toBeInTheDocument();
  });

  it('resolves them next to a data-list whose entity is also a marker', () => {
    renderBound({
      children: [
        { type: 'dialogue-bubble', speaker: marker('@entity.currentSpeaker'), text: marker('@entity.currentText'), revealedChars: marker('@entity.revealedChars') },
        { type: 'data-list', entity: marker('@entity.currentChoices'), fields: [], gap: 'sm' },
      ] as SlotPropValue,
    });
    expect(screen.getByText('The cor')).toBeInTheDocument();
  });
});

/** A live entity store: `commit` swaps the row and notifies like the kernel's frame store. */
function liveSource(initial: EntityRow): { source: EntityBindingSource; commit: (row: EntityRow) => void } {
  let row = initial;
  const listeners = new Set<() => void>();
  return {
    source: {
      getEntitySnapshot: () => row,
      getConfig: () => undefined,
      getState: () => 'playing',
      subscribe: (_trait, cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    },
    commit: (next) => { row = next; for (const cb of listeners) cb(); },
  };
}

/** The descriptor the typewriter tick re-flushes every 30 ms: markers only. */
function typewriterProps(): SlotProps {
  return {
    children: [
      { type: 'dialogue-bubble', speaker: marker('@entity.currentSpeaker'), text: marker('@entity.currentText'), revealedChars: marker('@entity.revealedChars') },
    ],
  } as SlotProps;
}

let flush: (() => void) | undefined;
function Flusher() {
  const { render: renderSlot } = useUISlots();
  flush = () => { renderSlot({ target: 'main', pattern: 'game-shell', sourceTrait: 'VisualNovelBoardRender', props: typewriterProps() }); };
  return null;
}

describe('dialogue-bubble across tick re-flushes and entity commits', () => {
  it('keeps resolving markers when the same descriptor re-flushes after an entity commit', () => {
    const live = liveSource({ ...ROW, revealedChars: 7 });
    render(
      <EntityBindingContext.Provider value={live.source}>
        <UISlotProvider>
          <Flusher />
          <UISlotRenderer />
        </UISlotProvider>
      </EntityBindingContext.Provider>,
    );
    act(() => flush?.());
    expect(screen.getByText('The cor')).toBeInTheDocument();

    for (const n of [8, 9, 10]) {
      act(() => live.commit({ ...ROW, revealedChars: n }));
      act(() => flush?.());
      expect(screen.getByText(TEXT.slice(0, n))).toBeInTheDocument();
    }
  });
});

describe('resolveRenderBindingMarkers — a re-flush with unchanged entity', () => {
  it('still resolves markers when a new flush reuses marker objects and the entity did not change', () => {
    const live = liveSource({ ...ROW, revealedChars: 7 });
    let flushVariant: ((position: string) => void) | undefined;
    function VariantFlusher() {
      const { render: renderSlot } = useUISlots();
      const text = marker('@entity.currentText');
      const speaker = marker('@entity.currentSpeaker');
      const revealed = marker('@entity.revealedChars');
      flushVariant = (position) => {
        renderSlot({
          target: 'main',
          pattern: 'game-shell',
          sourceTrait: 'VisualNovelBoardRender',
          props: { children: [{ type: 'dialogue-bubble', speaker, text, revealedChars: revealed, position }] } as SlotProps,
        });
      };
      return null;
    }
    render(
      <EntityBindingContext.Provider value={live.source}>
        <UISlotProvider>
          <VariantFlusher />
          <UISlotRenderer />
        </UISlotProvider>
      </EntityBindingContext.Provider>,
    );
    act(() => flushVariant?.('bottom'));
    expect(screen.getByText('The cor')).toBeInTheDocument();
    // A literal prop changes, the markers and the entity do not.
    act(() => flushVariant?.('top'));
    expect(screen.getByText('The cor')).toBeInTheDocument();
  });
});
