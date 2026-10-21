// @vitest-environment jsdom
/**
 * Busy action controls: the control that fired an action is busy for exactly
 * the dispatches its event started (lib/pendingDispatch). A listener stands in
 * for the bus ingress: it begins the event's pendingKey and ends it on demand.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { UISlotProvider, useUISlots } from '../../src/providers/UISlotContext';
import { useEventBus } from '../../src/core';
import type { UISlotManager } from '../../src/hooks/useUISlots';
import { UISlotComponent } from '../../src/components/core/organisms/UISlotRenderer';
import { SlotContainedContext } from '../../src/lib/slotContained';
import { Button } from '../../src/core';
import { TableView } from '../../src/components/core/molecules/TableView';
import { Form } from '../../src/components/core/organisms/Form';
import { beginPending, endPending } from '../../src/core';
import { useUIEvents } from '../../src/hooks/useUIEvents';

/** Simulated ingress: begins each `UI:<event>` pendingKey; `settle()` ends them. */
const inFlight: string[] = [];
function settleAll(): void {
  act(() => { while (inFlight.length > 0) endPending(inFlight.pop()!); });
}
function Ingress({ events }: { events: string[] }): null {
  const bus = useEventBus();
  React.useEffect(() => {
    const unsubs = events.map((e) => bus.on(`UI:${e}`, (evt) => {
      const key = evt.source?.pendingKey;
      if (key) { beginPending(key); inFlight.push(key); }
    }));
    return () => unsubs.forEach((u) => u());
  }, [bus, events]);
  return null;
}

function Grab({ onReady }: { onReady: (m: UISlotManager) => void }): null {
  onReady(useUISlots());
  return null;
}

function wrap(children: React.ReactNode, events: string[]) {
  let manager!: UISlotManager;
  const utils = render(
    <EventBusProvider isolated>
      <UISlotProvider>
        <SlotContainedContext.Provider value={true}>
          <Ingress events={events} />
          <Grab onReady={(m) => { manager = m; }} />
          {children}
        </SlotContainedContext.Provider>
      </UISlotProvider>
    </EventBusProvider>,
  );
  return { ...utils, manager: () => manager };
}

beforeEach(() => { inFlight.length = 0; });

describe('busy action controls', () => {
  it('a button is busy while the dispatch it started is in flight, then idle', () => {
    wrap(<Button action="SAVE">Save</Button>, ['SAVE']);
    const btn = screen.getByTestId('action-SAVE');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    settleAll();
    expect(btn.getAttribute('aria-busy')).toBeNull();
  });

  it('control: a button whose event nothing handles is never busy', () => {
    wrap(<Button action="NOBODY">Go</Button>, ['SAVE']);
    const btn = screen.getByTestId('action-NOBODY');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-busy')).toBeNull();
  });

  it('busy keeps the button label in place (no size change) behind the spinner', () => {
    wrap(<Button action="SAVE">Save</Button>, ['SAVE']);
    fireEvent.click(screen.getByTestId('action-SAVE'));
    expect(screen.getByText('Save')).toBeTruthy();
    settleAll();
  });

  it('a row action marks only its own row pending', () => {
    wrap(
      <TableView
        entity={[{ id: 'r1', name: 'One' }, { id: 'r2', name: 'Two' }]}
        columns={[{ key: 'name', header: 'Name' }]}
        itemActions={[{ label: 'Archive', event: 'ARCHIVE' }]}
      />,
      ['ARCHIVE'],
    );
    fireEvent.click(screen.getAllByTestId('action-overflow')[0]);
    fireEvent.click(screen.getByText('Archive'));
    const rows = document.querySelectorAll('[data-entity-row]');
    expect(rows[0].getAttribute('data-row-pending')).toBe('true');
    expect(rows[1].getAttribute('data-row-pending')).toBeNull();
    settleAll();
    expect(rows[0].getAttribute('data-row-pending')).toBeNull();
  });

  it('a cleared dialog holds open while its confirm is in flight, then leaves', () => {
    const h = wrap(<UISlotComponent slot="modal" portal />, ['CONFIRM']);
    act(() => { h.manager().render({ target: 'modal', pattern: 'button', props: { label: 'Confirm', action: 'CONFIRM' } }); });
    fireEvent.click(screen.getByTestId('action-CONFIRM'));
    act(() => h.manager().clear('modal'));
    expect(screen.getByRole('dialog').className).not.toContain('animate-modal-out');
    settleAll();
    expect(screen.getByRole('dialog').className).toContain('animate-modal-out');
  });

  it('control: a dialog cleared with nothing in flight leaves at once', () => {
    const h = wrap(<UISlotComponent slot="modal" portal />, ['CONFIRM']);
    act(() => { h.manager().render({ target: 'modal', pattern: 'button', props: { label: 'Confirm', action: 'CONFIRM' } }); });
    act(() => h.manager().clear('modal'));
    expect(screen.getByRole('dialog').className).toContain('animate-modal-out');
  });

  it('a form submit locks the form and busies its submit button until settle', () => {
    wrap(<Form fields={[{ name: 'title', label: 'Title', type: 'string' }]} submitEvent="SAVE_ITEM" />, ['SAVE_ITEM']);
    const submit = screen.getByTestId('action-SAVE_ITEM');
    fireEvent.submit(submit.closest('form')!);
    expect(submit.getAttribute('aria-busy')).toBe('true');
    settleAll();
    expect(submit.getAttribute('aria-busy')).toBeNull();
  });

  it('compiled path: useUIEvents keeps the firing button busy until the generated queue settles the dispatch', async () => {
    let release: () => void = () => {};
    function CompiledTrait(): null {
      useUIEvents((_e: 'SAVE') => new Promise<void>((r) => { release = r; }), 'NoteOrbital.NoteView', ['SAVE'] as const);
      return null;
    }
    wrap(<><CompiledTrait /><Button action="NoteOrbital.NoteView.SAVE">Save</Button></>, []);
    const btn = screen.getByTestId('action-NoteOrbital.NoteView.SAVE');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    await act(async () => { release(); await Promise.resolve(); });
    expect(btn.getAttribute('aria-busy')).toBeNull();
  });

  it('a focused button keeps focus while busy (never natively disabled) and ignores re-activation', () => {
    let fired = 0;
    function Count(): null {
      const bus = useEventBus();
      React.useEffect(() => bus.on('UI:SAVE', () => { fired += 1; }), [bus]);
      return null;
    }
    wrap(<><Count /><Button action="SAVE">Save</Button></>, ['SAVE']);
    const btn = screen.getByTestId('action-SAVE') as HTMLButtonElement;
    btn.focus();
    fireEvent.click(btn);
    expect(btn.disabled).toBe(false);
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(fired).toBe(1);
    settleAll();
  });

  it('a row menu action fires exactly once, with the row payload (no second payload-less copy from the menu)', () => {
    const seen: Array<Record<string, unknown>> = [];
    function Spy(): null {
      const bus = useEventBus();
      React.useEffect(() => bus.on('UI:OPEN', (e) => { seen.push((e.payload ?? {}) as Record<string, unknown>); }), [bus]);
      return null;
    }
    wrap(
      <>
        <Spy />
        <TableView entity={[{ id: 'r1', name: 'One' }]} columns={[{ key: 'name', header: 'Name' }]} itemActions={[{ label: 'Open', event: 'OPEN' }]} />
      </>,
      [],
    );
    fireEvent.click(screen.getByTestId('action-overflow'));
    fireEvent.click(screen.getByText('Open'));
    expect(seen).toHaveLength(1);
    expect(seen[0].id).toBe('r1');
  });
});
