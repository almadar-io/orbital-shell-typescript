// @vitest-environment jsdom
/**
 * G-RUNTIME-010 — `(notify level message)` lowers to
 * `(render-ui toast { type: alert, variant, message, dismissible })`. The
 * interpreter/playground must show it the way the compiled app does
 * (std-realtime-chat's "Your message couldn't be sent — …").
 */
import { describe, it } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

function schema(): OrbitalSchema {
  return {
    name: 'notify-toast',
    version: '1.0.0',
    orbitals: [{
      name: 'NoteOrbital',
      entity: { name: 'Note', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
      traits: [{
        name: 'Notifier',
        scope: 'instance',
        linkedEntity: 'Note',
        stateMachine: {
          states: [{ name: 'idle', isInitial: true }],
          events: [],
          transitions: [
            { from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'button', label: 'Go', action: 'FAIL' }]] },
            {
              from: 'idle', to: 'idle', event: 'FAIL',
              effects: [['render-ui', 'toast', { type: 'alert', variant: 'error', dismissible: true, message: ['str/concat', 'Could not save — ', 'offline'] }]],
            },
          ],
        },
      }],
      pages: [{ name: 'NotePage', path: '/notes', traits: [{ ref: 'Notifier' }] }],
    }],
  } as OrbitalSchema;
}

describe('notify renders as a toast on the interpreter', () => {
  it('shows the message after the failing action', async () => {
    render(
      <MemoryRouter>
        <OrbPreview schema={schema()} initialPagePath="/notes" isolated />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTestId('action-FAIL', {}, { timeout: 10_000 }));
    await screen.findByText('Could not save — offline', {}, { timeout: 10_000 });
  }, 30_000);
});
