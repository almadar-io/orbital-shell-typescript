// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { EventPayload, SExpr } from '@almadar/core';
import { traced } from '../../../../../test/ui/helpers/traced';
import { AvlTransitionDetail } from '../AvlTransitionDetail';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';
import type { TraitTransitionInfo } from '../../../../lib/avl-schema-parser';
import type { AvlTransitionPlayback } from '../../../../lib/avl-play';

const GUARD: SExpr = ['=', '@payload.key', 'i'];
const SET: SExpr = ['set', '@entity.mode', 'insert'];
const transition: TraitTransitionInfo = {
  from: 'NORMAL',
  to: 'INSERT',
  event: 'KEY',
  guard: GUARD,
  effects: [{ type: 'set', args: ['@entity.mode', 'insert'] }],
  index: 0,
};

function Listener({ event, onEvent }: { event: string; onEvent: (p: EventPayload) => void }) {
  const bus = useEventBus();
  useEffect(() => bus.on(`UI:${event}`, (e) => onEvent(e.payload ?? {})), [bus, event, onEvent]);
  return null;
}

function played(key: string): AvlTransitionPlayback {
  const guardRun = traced(GUARD, { payload: { key } });
  const passed = guardRun.value === true;
  const effectRun = traced(SET, { entity: { mode: 'normal' } });
  return {
    step: {
      orbital: 'Editor',
      trait: 'Modes',
      from: 'NORMAL',
      event: 'KEY',
      payload: { key },
      result: {
        trait: 'Modes',
        event: 'KEY',
        transitionFired: passed,
        guard: passed ? 'pass' : 'fail',
        ...(passed ? { firedArm: 0 } : {}),
        state: { before: 'NORMAL', after: passed ? 'INSERT' : 'NORMAL' },
        effects: [],
        emitted: [],
      },
    },
    fired: passed,
    guard: { arm: 0, guard: GUARD, passed, trace: guardRun.trace },
    effects: passed ? [{ type: 'set', args: ['@entity.mode', 'insert'], status: 'executed', evalTrace: effectRun.trace }] : [],
  };
}

const renderDetail = (props: Partial<React.ComponentProps<typeof AvlTransitionDetail>> = {}, listener?: React.ReactNode) =>
  render(
    <EventBusProvider debug={false}>
      {listener}
      <AvlTransitionDetail orbital="Editor" trait="Modes" transition={transition} {...props} />
    </EventBusProvider>,
  );

const statuses = () => screen.getAllByTestId('avl-circuit-node').map((n) => n.getAttribute('data-status'));

describe('AvlTransitionDetail', () => {
  it('idle: guard and effect are drawn as circuits, nothing ran, no verdict and no Step', () => {
    renderDetail();
    expect(screen.getAllByTestId('avl-circuit-code').map((c) => c.textContent)).toEqual(['(= @payload.key "i")', '(set @entity.mode "insert")']);
    expect(statuses().every((s) => s === 'idle')).toBe(true);
    expect(screen.queryByTestId('avl-transition-verdict')).toBeNull();
    expect(screen.queryByTestId('action-PLAY_STEP')).toBeNull();
  });

  it('Step asks the host to play this transition with the edited payload', () => {
    const onStep = vi.fn();
    renderDetail({ stepEvent: 'PLAY_STEP' }, <Listener event="PLAY_STEP" onEvent={onStep} />);
    fireEvent.click(screen.getByTestId('action-PLAY_STEP'));
    expect(onStep).toHaveBeenCalledWith({ orbital: 'Editor', trait: 'Modes', from: 'NORMAL', event: 'KEY', payload: {} });
  });

  it('a fired run: verdict fired, guard passed, both boards carry the run values', () => {
    renderDetail({ playback: played('i') });
    expect(screen.getByTestId('avl-transition-verdict').textContent).toBe('Fired');
    expect(screen.getByText('Guard passed')).toBeInTheDocument();
    expect(statuses().filter((s) => s === 'done').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('avl-circuit-value').map((c) => c.textContent)).toContain('"i"');
  });

  it('control: a blocked run shows the failed guard and leaves the effect idle', () => {
    renderDetail({ playback: played('q') });
    expect(screen.getByTestId('avl-transition-verdict').textContent).toBe('Blocked');
    expect(screen.getByText('Guard failed')).toBeInTheDocument();
    const roots = screen.getAllByTestId('avl-circuit-node').filter((n) => n.getAttribute('data-key') === '');
    expect(roots.map((n) => n.getAttribute('data-status'))).toEqual(['done', 'idle']);
  });

  it('control: an unguarded transition draws no guard board', () => {
    renderDetail({ transition: { ...transition, guard: null } });
    expect(screen.getAllByTestId('avl-circuit-code').map((c) => c.textContent)).toEqual(['(set @entity.mode "insert")']);
  });
});
