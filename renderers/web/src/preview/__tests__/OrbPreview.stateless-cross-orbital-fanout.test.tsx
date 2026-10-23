// @vitest-environment jsdom
/**
 * G-RUNTIME-041, stateless topology — the std-global-search shape: an
 * on-page searcher fans one query out to N modules through a self-emitted
 * FAN_OUT_STEP loop; responders in ANOTHER orbital answer RESULTS; the
 * searcher (`*.RESULTS -> RESULTS`) counts answers and renders them.
 * Stateless = a fresh server manager per request, the client carrying
 * states/rows (the hosted playground topology). Live, project-friday
 * /global-search sat on "Searching…" and re-requested with moduleKey null.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';
import { statelessKernelTransport } from '../../test-support/stateless-kernel';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

function schema(): OrbitalSchema {
  return {
    name: 'stateless-fanout',
    version: '1.0.0',
    orbitals: [
      {
        name: 'SearchOrbital',
        entity: {
          name: 'Query',
          persistence: 'runtime',
          fields: [
            { name: 'id', type: 'string' },
            { name: 'pending', type: 'array', default: [] },
            { name: 'answered', type: 'number', default: 0 },
          ],
        },
        traits: [
          {
            name: 'Searcher',
            scope: 'instance',
            linkedEntity: 'Query',
            emits: [{ event: 'REQUESTED', scope: 'external', payloadSchema: [{ name: 'moduleKey', type: 'string' }] }],
            listens: [{ event: 'RESULTS', source: { kind: 'any' }, triggers: 'RESULTS' }],
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }, { name: 'searching' }],
              events: [],
              transitions: [
                { from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'button', label: 'Go', action: 'GO' }]] },
                {
                  from: 'idle', to: 'searching', event: 'GO',
                  effects: [
                    ['set', '@entity.pending', ['list', 'tasks', 'clients']],
                    ['set', '@entity.answered', 0],
                    ['emit', 'STEP', { remaining: 2 }],
                    ['render-ui', 'main', { type: 'typography', content: 'Searching…' }],
                  ],
                },
                {
                  from: 'searching', to: 'searching', event: 'STEP', guard: ['>', '@payload.remaining', 0],
                  effects: [
                    ['emit', 'REQUESTED', { moduleKey: ['array/first', '@entity.pending'] }],
                    ['set', '@entity.pending', ['array/drop', '@entity.pending', 1]],
                    ['when', ['>', ['array/len', '@entity.pending'], 0], ['emit', 'STEP', { remaining: ['array/len', '@entity.pending'] }]],
                  ],
                },
                {
                  from: 'searching', to: 'searching', event: 'RESULTS',
                  effects: [
                    ['set', '@entity.answered', ['+', '@entity.answered', 1]],
                    ['render-ui', 'main', { type: 'typography', content: ['str/concat', 'answered:', '@entity.answered'] }],
                  ],
                },
              ],
            },
          },
        ],
        pages: [{ name: 'SearchPage', path: '/search', traits: [{ ref: 'Searcher' }] }],
      },
      {
        name: 'ModuleOrbital',
        entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        traits: [
          {
            name: 'Responder',
            scope: 'instance',
            linkedEntity: 'Item',
            category: 'lifecycle',
            emits: [{ event: 'RESULTS', scope: 'external', payloadSchema: [{ name: 'moduleKey', type: 'string' }] }],
            listens: [{ event: 'REQUESTED', source: { kind: 'any' }, triggers: 'REQUESTED' }],
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }],
              events: [],
              transitions: [
                {
                  from: 'idle', to: 'idle', event: 'REQUESTED', guard: ['!=', '@payload.moduleKey', null],
                  effects: [['emit', 'RESULTS', { moduleKey: '@payload.moduleKey' }]],
                },
              ],
            },
          },
        ],
        pages: [],
      },
    ],
  } as OrbitalSchema;
}

function statelessTransport(s: OrbitalSchema) {
  return statelessKernelTransport(s);
}

describe('stateless cross-orbital fan-out answers reach the on-page searcher', () => {
  it('every module answer is counted and rendered', async () => {
    const s = schema();
    render(
      <MemoryRouter>
        <OrbPreview schema={s} transport={statelessTransport(s)} initialPagePath="/search" isolated />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTestId('action-GO', {}, { timeout: 10_000 }));
    await waitFor(() => expect(screen.getByText('answered:2')).toBeTruthy(), { timeout: 10_000 });
  }, 30_000);
});
