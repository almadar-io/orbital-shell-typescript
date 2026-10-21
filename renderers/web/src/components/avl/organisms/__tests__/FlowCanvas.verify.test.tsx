/**
 * Verification on canvas cards: a host that opts in (`verify`) gets, on each card, controls to
 * verify the transition the card shows or the whole trait's walk, and the trait's verdict. A
 * run flips the card to each state it reaches (`UI:CANVAS_SHOW_STATE`).
 */
import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { EventPayload, OrbitalSchema } from '@almadar/core';
import { useEventBus } from '../../../../core';
import { FlowCanvas } from '../FlowCanvas';
import type { CanvasVerify } from '../../molecules/OrbPreviewNode';

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

const schema: OrbitalSchema = {
  name: 'FixtureApp',
  orbitals: [{
    name: 'TaskBoard',
    entity: { name: 'Task', fields: [{ name: 'title', type: 'string', required: true }] },
    pages: [{ name: 'TasksPage', path: '/tasks' }],
    traits: [{
      name: 'TaskList',
      scope: 'collection',
      linkedEntity: 'Task',
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }, { name: 'loaded' }, { name: 'editing' }],
        events: [{ key: 'INIT', name: 'Init' }, { key: 'EDIT', name: 'Edit' }],
        transitions: [
          { from: 'idle', to: 'loaded', event: 'INIT', effects: [['render-ui', 'main', { type: 'badge' }]] },
          { from: 'loaded', to: 'editing', event: 'EDIT', effects: [['render-ui', 'main', { type: 'typography' }]] },
        ],
      },
    }],
  }],
};

const heard: Array<{ type: string; payload: EventPayload | undefined }> = [];
let busEmit: ((type: string, payload?: EventPayload) => void) | null = null;
function Bus(): null {
  const bus = useEventBus();
  busEmit = bus.emit;
  useEffect(() => {
    const offs = ['UI:CARD_VERIFY_STEP', 'UI:CARD_VERIFY_TRAIT'].map((type) => bus.on(type, (e) => { heard.push({ type, payload: e.payload }); }));
    return () => offs.forEach((off) => off());
  }, [bus]);
  return null;
}

const verify: CanvasVerify = {
  verdictOf: (_orbital, trait) => (trait === 'TaskList' ? { status: 'fail', detail: 'guard failed' } : undefined),
  playing: () => false,
};

describe('canvas card verification', () => {
  it('control: without a verify host the card shows no verify controls', () => {
    render(<FlowCanvas schema={schema} initialOrbital="TaskBoard" />);
    expect(screen.queryByTestId('card-verify-transition-TaskBoard')).toBeNull();
  });

  it('verifies the transition the card shows, and the trait it belongs to', () => {
    heard.length = 0;
    render(<><Bus /><FlowCanvas schema={schema} initialOrbital="TaskBoard" verify={verify} /></>);
    fireEvent.click(screen.getByTestId('card-verify-transition-TaskBoard'));
    fireEvent.click(screen.getByTestId('card-verify-trait-TaskBoard'));
    expect(heard).toEqual([
      { type: 'UI:CARD_VERIFY_STEP', payload: { orbital: 'TaskBoard', trait: 'TaskList', from: 'idle', event: 'INIT', payload: {} } },
      { type: 'UI:CARD_VERIFY_TRAIT', payload: { orbital: 'TaskBoard', trait: 'TaskList' } },
    ]);
  });

  it("shows the trait's verdict on the card", () => {
    render(<FlowCanvas schema={schema} initialOrbital="TaskBoard" verify={verify} />);
    expect(screen.getByTestId('card-verdict-TaskBoard').getAttribute('data-status')).toBe('fail');
  });

  it('flips the card to the state a played step reached', () => {
    render(<><Bus /><FlowCanvas schema={schema} initialOrbital="TaskBoard" verify={verify} /></>);
    const select = screen.getByTestId('canvas-state-TaskBoard');
    act(() => { busEmit?.('UI:CANVAS_SHOW_STATE', { orbital: 'TaskBoard', trait: 'TaskList', event: 'EDIT', from: 'loaded', to: 'editing' }); });
    expect(select).toHaveValue('TaskList:EDIT:loaded:editing');
  });

  it('control: a state with no screen leaves the card as it is', () => {
    render(<><Bus /><FlowCanvas schema={schema} initialOrbital="TaskBoard" verify={verify} /></>);
    const select = screen.getByTestId('canvas-state-TaskBoard');
    const before = (select as HTMLSelectElement).value;
    act(() => { busEmit?.('UI:CANVAS_SHOW_STATE', { orbital: 'TaskBoard', trait: 'TaskList', event: 'SAVE', from: 'editing', to: 'saving' }); });
    expect(select).toHaveValue(before);
  });
});
