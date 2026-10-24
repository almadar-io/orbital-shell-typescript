// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { AvlTransitionDetail } from '../AvlTransitionDetail';
import { EventBusProvider } from '../../../../core';
import type { AvlPlayStep } from '../../../../lib/avl-play';

const schema: OrbitalSchema = {
  name: 'EditorApp',
  orbitals: [
    {
      name: 'Editor',
      entity: { name: 'Doc', fields: [{ name: 'mode', type: 'string', default: 'normal' }] },
      pages: [],
      traits: [
        {
          name: 'Modes',
          linkedEntity: 'Doc',
          stateMachine: {
            states: [{ name: 'NORMAL', isInitial: true }, { name: 'INSERT' }],
            events: [{ key: 'KEY', name: 'Key' }, { key: 'ESC', name: 'Esc' }],
            transitions: [
              { from: 'NORMAL', to: 'INSERT', event: 'KEY', guard: ['=', '@payload.key', 'i'], effects: [['set', '@entity.mode', 'insert']] },
              { from: 'INSERT', to: 'NORMAL', event: 'ESC' },
            ],
          },
        },
      ],
    },
  ],
};

const fired: AvlPlayStep = {
  orbital: 'Editor',
  trait: 'Modes',
  from: 'NORMAL',
  event: 'KEY',
  payload: { key: 'i' },
  result: { trait: 'Modes', event: 'KEY', transitionFired: true, guard: 'pass', firedArm: 0, state: { before: 'NORMAL', after: 'INSERT' }, effects: [], emitted: [] },
};

const renderRaw = (props: Partial<React.ComponentProps<typeof AvlTransitionDetail>>) =>
  render(
    <EventBusProvider debug={false}>
      <AvlTransitionDetail orbital="Editor" trait="Modes" {...props} />
    </EventBusProvider>,
  );

describe('AvlTransitionDetail — raw program form (.lolo)', () => {
  it('parses the transition from the program by index', () => {
    renderRaw({ schema, transitionIndex: 0 });
    expect(screen.getAllByTestId('avl-circuit-code').map((c) => c.textContent)).toEqual(['(= @payload.key "i")', '(set @entity.mode "insert")']);
  });

  it('accepts the program as JSON text too', () => {
    renderRaw({ schema: JSON.stringify(schema), transitionIndex: 1 });
    expect(screen.queryAllByTestId('avl-circuit-code')).toEqual([]);
    expect(screen.getByText('ESC')).toBeTruthy();
  });

  it('a scene with a step of this transition shows that run (verdict)', () => {
    renderRaw({ schema, transitionIndex: 0, scene: [fired], cursor: 0 });
    expect(screen.getByTestId('avl-transition-verdict')).toBeTruthy();
  });

  it('control: no scene, nothing ran', () => {
    renderRaw({ schema, transitionIndex: 0 });
    expect(screen.queryByTestId('avl-transition-verdict')).toBeNull();
  });

  it('edge: an index past the trait`s transitions renders the empty state, not a crash', () => {
    renderRaw({ schema, transitionIndex: 9 });
    expect(screen.getByTestId('avl-transition-missing')).toBeTruthy();
  });

  it('edge: an unknown trait renders the empty state', () => {
    renderRaw({ schema, trait: 'Nope', transitionIndex: 0 });
    expect(screen.getByTestId('avl-transition-missing')).toBeTruthy();
  });
});
