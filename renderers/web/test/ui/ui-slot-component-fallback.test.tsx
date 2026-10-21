// @vitest-environment jsdom
/**
 * UISlotComponent `fallback`/`mode` (Studio V4 §14, Part I2). `fallback` is
 * a slot-host's stock content for a region: `replace` (default) shows it
 * only while the slot is empty; `append` shows it alongside slot content,
 * fallback first. Neither prop touches the pre-existing `children`
 * (compiled-mode) contract — `children` still wins outright when both are
 * passed. `data-testid`/`data-slot-mode` on the wrapper let a host or e2e
 * assert which branch actually rendered.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { UISlotProvider, useUISlots } from '../../src/providers/UISlotContext';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import { UISlotComponent } from '../../src/components/core/organisms/UISlotRenderer';

const STOCK_TESTID = 'stock-fallback';
const STOCK_TEXT = 'Stock content';

function Fallback(): React.ReactElement {
  return <div data-testid={STOCK_TESTID}>{STOCK_TEXT}</div>;
}

/** Grabs the live `useUISlots()` manager so tests can `render()`/`clear()` a slot from `act()`. */
function ManagerGrabber({ onReady }: { onReady: (manager: UISlotManager) => void }): null {
  const manager = useUISlots();
  onReady(manager);
  return null;
}

function harness(children: React.ReactNode) {
  return render(
    <EventBusProvider isolated>
      <UISlotProvider>{children}</UISlotProvider>
    </EventBusProvider>,
  );
}

function fillSidebar(manager: UISlotManager, text: string): void {
  act(() => {
    manager.render({ target: 'sidebar', pattern: 'typography', props: { content: text } });
  });
}

describe('UISlotComponent — fallback/mode', () => {
  it('replace (default): renders fallback when the slot is empty', () => {
    harness(<UISlotComponent slot="sidebar" fallback={<Fallback />} />);

    expect(screen.getByTestId(STOCK_TESTID)).toBeInTheDocument();
    expect(screen.getByTestId('ui-slot-sidebar')).toHaveAttribute('data-slot-mode', 'fallback');
  });

  it('replace: slot content wins once filled, fallback is gone', () => {
    let manager!: UISlotManager;
    harness(
      <>
        <ManagerGrabber onReady={(m) => { manager = m; }} />
        <UISlotComponent slot="sidebar" fallback={<Fallback />} />
      </>,
    );
    expect(screen.getByTestId(STOCK_TESTID)).toBeInTheDocument();

    fillSidebar(manager, 'Slot content');

    expect(screen.queryByTestId(STOCK_TESTID)).not.toBeInTheDocument();
    expect(screen.getByText('Slot content')).toBeInTheDocument();
    expect(screen.getByTestId('ui-slot-sidebar')).toHaveAttribute('data-slot-mode', 'content');
  });

  it('append: fallback is a fixture — both render together once the slot fills, fallback first', () => {
    let manager!: UISlotManager;
    harness(
      <>
        <ManagerGrabber onReady={(m) => { manager = m; }} />
        <UISlotComponent slot="sidebar" mode="append" fallback={<Fallback />} />
      </>,
    );
    // Empty + append: nothing to append to yet, fallback alone.
    expect(screen.getByTestId(STOCK_TESTID)).toBeInTheDocument();
    expect(screen.getByTestId('ui-slot-sidebar')).toHaveAttribute('data-slot-mode', 'fallback');

    fillSidebar(manager, 'Slot content');

    expect(screen.getByTestId(STOCK_TESTID)).toBeInTheDocument();
    expect(screen.getByText('Slot content')).toBeInTheDocument();
    expect(screen.getByTestId('ui-slot-sidebar')).toHaveAttribute('data-slot-mode', 'append');

    // Order: fallback first, then slot content.
    const stockNode = screen.getByTestId(STOCK_TESTID);
    const contentNode = screen.getByText('Slot content');
    // eslint-disable-next-line no-bitwise
    expect(stockNode.compareDocumentPosition(contentNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('append with no fallback behaves exactly like replace once filled', () => {
    let manager!: UISlotManager;
    harness(
      <>
        <ManagerGrabber onReady={(m) => { manager = m; }} />
        <UISlotComponent slot="sidebar" mode="append" />
      </>,
    );
    fillSidebar(manager, 'Solo content');

    expect(screen.queryByTestId(STOCK_TESTID)).not.toBeInTheDocument();
    expect(screen.getByText('Solo content')).toBeInTheDocument();
    expect(screen.getByTestId('ui-slot-sidebar')).toHaveAttribute('data-slot-mode', 'content');
  });

  it('children (compiled mode) wins over fallback even when both are passed', () => {
    harness(
      <UISlotComponent slot="main" fallback={<Fallback />}>
        <div data-testid="compiled">Compiled children</div>
      </UISlotComponent>,
    );

    expect(screen.getByTestId('compiled')).toBeInTheDocument();
    expect(screen.queryByTestId(STOCK_TESTID)).not.toBeInTheDocument();
  });

  it('no fallback, no content: unchanged empty placeholder (backward compatible)', () => {
    harness(<UISlotComponent slot="sidebar" />);

    const placeholder = screen.getByTestId('ui-slot-sidebar');
    expect(placeholder).toHaveAttribute('data-slot-mode', 'empty');
    expect(placeholder).toBeEmptyDOMElement();
  });

  it('portal mode, empty: fallback renders inline in place (no portal root needed)', () => {
    harness(<UISlotComponent slot="modal" portal fallback={<Fallback />} />);

    expect(screen.getByTestId(STOCK_TESTID)).toBeInTheDocument();
    expect(screen.getByTestId('ui-slot-modal')).toHaveAttribute('data-slot-mode', 'fallback');
  });

  it('portal mode, append + filled: fallback stays inline while content still portals to document.body', async () => {
    let manager!: UISlotManager;
    const { container } = harness(
      <>
        <ManagerGrabber onReady={(m) => { manager = m; }} />
        <UISlotComponent slot="modal" portal mode="append" fallback={<Fallback />} />
      </>,
    );

    act(() => {
      manager.render({ target: 'modal', pattern: 'typography', props: { content: 'Modal content' } });
    });

    const fallbackNode = screen.getByTestId('ui-slot-modal-fallback');
    expect(fallbackNode).toHaveAttribute('data-slot-mode', 'append');
    // The fallback wrapper is NOT the portaled content's own `slot-modal` id —
    // no id collision between the inline fallback and the portaled content.
    expect(fallbackNode.id).toBe('slot-modal-fallback');
    // The fallback rendered in place, inside this test's own render container.
    expect(container.contains(fallbackNode)).toBe(true);

    // SlotPortal (and the Modal molecule's own nested portal) mount in an
    // effect — wait for the content to actually land in the DOM.
    await waitFor(() => {
      expect(document.getElementById('slot-modal')).not.toBeNull();
      expect(document.getElementById('slot-modal')?.textContent).toContain('Modal content');
    });

    // Content portaled OUT of this test's render container entirely —
    // fallback (inline) and content (portaled) are never in the same subtree.
    const contentNode = document.getElementById('slot-modal')!;
    expect(container.contains(contentNode)).toBe(false);
  });
});
