// @vitest-environment jsdom
/**
 * Slot motion: contained (preview) modal/drawer slots render the real Modal /
 * Drawer molecules, and a cleared modal/drawer slot stays mounted through its
 * exit animation on the runtime, contained and compiled paths alike.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { UISlotProvider, useUISlots } from '../../src/providers/UISlotContext';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import { UISlotComponent } from '../../src/components/core/organisms/UISlotRenderer';
import { SlotContainedContext } from '../../src/lib/slotContained';
import { Modal } from '../../src/components/core/molecules/Modal';

function ManagerGrabber({ onReady }: { onReady: (manager: UISlotManager) => void }): null {
  onReady(useUISlots());
  return null;
}

function harness(children: React.ReactNode, contained: boolean) {
  let manager!: UISlotManager;
  const utils = render(
    <EventBusProvider isolated>
      <UISlotProvider>
        <SlotContainedContext.Provider value={contained}>
          <ManagerGrabber onReady={(m) => { manager = m; }} />
          {children}
        </SlotContainedContext.Provider>
      </UISlotProvider>
    </EventBusProvider>,
  );
  return { ...utils, manager: () => manager };
}

function fill(manager: UISlotManager, target: 'modal' | 'drawer', title: string): void {
  act(() => {
    manager.render({ target, pattern: 'typography', props: { content: `${target} body`, title } });
  });
}

describe.each([true, false])('modal/drawer slot motion (contained=%s)', (contained) => {
  it('modal slot renders the Modal molecule: dialog, X with the CLOSE test id, slot anchor', () => {
    const h = harness(<UISlotComponent slot="modal" portal />, contained);
    fill(h.manager(), 'modal', 'Edit');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('action-CLOSE')).toBeInTheDocument();
    expect(document.getElementById('slot-modal')).not.toBeNull();
    expect(screen.getByRole('dialog').className).toContain('animate-modal-in');
  });

  it('a cleared modal stays mounted playing modal-out, then unmounts on animationend', () => {
    const h = harness(<UISlotComponent slot="modal" portal />, contained);
    fill(h.manager(), 'modal', 'Edit');
    act(() => h.manager().clear('modal'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('animate-modal-out');
    expect(screen.getByText('modal body')).toBeInTheDocument();
    act(() => { fireEvent.animationEnd(dialog); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.getElementById('slot-modal')).toBeNull();
  });

  it('re-filling during the exit reopens with the new content', () => {
    const h = harness(<UISlotComponent slot="modal" portal />, contained);
    fill(h.manager(), 'modal', 'First');
    act(() => h.manager().clear('modal'));
    fill(h.manager(), 'modal', 'Second');
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('animate-modal-in');
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('a cleared drawer stays mounted until its exit animation ends', () => {
    const h = harness(<UISlotComponent slot="drawer" portal />, contained);
    fill(h.manager(), 'drawer', 'Details');
    const panel = screen.getByRole('dialog');
    expect(panel.className).toContain('animate-drawer-in');
    act(() => h.manager().clear('drawer'));
    expect(screen.getByRole('dialog').className).toContain('animate-drawer-out');
    act(() => { fireEvent.animationEnd(screen.getByRole('dialog')); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe.each([true, false])('self-overlay modal content (contained=%s)', (contained) => {
  it('a cleared modal-pattern slot plays its own exit, then unmounts', () => {
    const h = harness(<UISlotComponent slot="modal" portal />, contained);
    act(() => {
      h.manager().render({ target: 'modal', pattern: 'modal', props: { title: 'Self', children: [{ type: 'typography', content: 'self body' }] } });
    });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    act(() => h.manager().clear('modal'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('animate-modal-out');
    act(() => { fireEvent.animationEnd(dialog); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('contained modal placement', () => {
  it('contained: renders inside the host (absolute), never portaled, page scroll untouched', () => {
    const h = harness(<UISlotComponent slot="modal" portal />, true);
    fill(h.manager(), 'modal', 'Edit');
    const overlay = screen.getByRole('dialog').parentElement;
    expect(overlay?.className).toContain('absolute');
    expect(h.container.contains(screen.getByRole('dialog'))).toBe(true);
    expect(document.body.style.overflow).toBe('');
  });

  it('control: non-contained portals out of the host with fixed positioning and locks page scroll', () => {
    const h = harness(<UISlotComponent slot="modal" portal />, false);
    fill(h.manager(), 'modal', 'Edit');
    const overlay = screen.getByRole('dialog').parentElement;
    expect(overlay?.className).toContain('fixed');
    expect(h.container.contains(screen.getByRole('dialog'))).toBe(false);
    expect(document.body.style.overflow).toBe('hidden');
  });
});

describe('compiled slot motion', () => {
  it('pattern "clear" plays the exit with the last compiled children, then unmounts', () => {
    function Host() {
      const [open, setOpen] = React.useState(true);
      return (
        <>
          <span data-testid="toggle" onClick={() => setOpen(false)} />
          {open
            ? <UISlotComponent slot="modal" pattern="stack"><span>compiled body</span></UISlotComponent>
            : <UISlotComponent slot="modal" pattern="clear"><span /></UISlotComponent>}
        </>
      );
    }
    harness(<Host />, false);
    expect(screen.getByRole('dialog').className).toContain('animate-modal-in');
    act(() => { fireEvent.click(screen.getByTestId('toggle')); });
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('animate-modal-out');
    expect(screen.getByText('compiled body')).toBeInTheDocument();
    act(() => { fireEvent.animationEnd(dialog); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('control: pattern "clear" with nothing shown before renders nothing', () => {
    harness(<UISlotComponent slot="modal" pattern="clear"><span>never</span></UISlotComponent>, false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('compiled self-overlay render-function children play their own exit with the presence', () => {
    function Host() {
      const [writer, setWriter] = React.useState<string | null>('OPEN');
      return (
        <>
          <span data-testid="toggle" onClick={() => setWriter(null)} />
          <UISlotComponent slot="modal" pattern={writer === 'OPEN' ? 'modal' : 'clear'} sourceTrait="T">
            {(presence) => (writer === 'OPEN' ? <Modal title="Self" isOpen={presence.open} onExited={presence.onExited}>self compiled</Modal> : null)}
          </UISlotComponent>
        </>
      );
    }
    harness(<Host />, false);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    act(() => { fireEvent.click(screen.getByTestId('toggle')); });
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('animate-modal-out');
    expect(screen.getByText('self compiled')).toBeInTheDocument();
    act(() => { fireEvent.animationEnd(dialog); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('control: compiled self-overlay FINISHED JSX (no presence) unmounts at once on clear', () => {
    function Host() {
      const [open, setOpen] = React.useState(true);
      return (
        <>
          <span data-testid="toggle" onClick={() => setOpen(false)} />
          <UISlotComponent slot="modal" pattern={open ? 'modal' : 'clear'} sourceTrait="T">
            {open ? <Modal title="Self">finished jsx</Modal> : null}
          </UISlotComponent>
        </>
      );
    }
    harness(<Host />, false);
    act(() => { fireEvent.click(screen.getByTestId('toggle')); });
    expect(screen.queryByText('finished jsx')).toBeNull();
  });
});
