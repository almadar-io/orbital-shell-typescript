/**
 * A trait whose lifecycle step throws (an array operator given a non-array:
 * the evaluator's TypeMismatch) shows the error on its card instead of a blank
 * card — the failure is named where the user is looking.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { TRAIT_MOUNT_ERROR_TESTID, type OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';

const footer = {
  name: 'Footer', scope: 'instance', linkedEntity: 'Item',
  stateMachine: {
    states: [{ name: 'idle', isInitial: true }], events: [],
    transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content: 'footer' }]] }],
  },
};

function schemaWith(items: string | string[]): OrbitalSchema {
  return JSON.parse(JSON.stringify({
    name: 'nav-app',
    version: '1.0.0',
    orbitals: [{
      name: 'Shell',
      entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
      traits: [{
        name: 'Layout',
        scope: 'instance',
        linkedEntity: 'Item',
        stateMachine: {
          states: [{ name: 'idle', isInitial: true }],
          events: [],
          transitions: [{
            from: 'idle', to: 'idle', event: 'INIT',
            effects: [['render-ui', 'main', { type: 'typography', content: ['str/join', ['array/filter', Array.isArray(items) ? ['list', ...items] : items, ['fn', 'x', true]], ', '] }]],
          }],
        },
      }, footer],
      pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Footer' }, { ref: 'Layout' }] }],
    }],
  }));
}

describe('OrbPreview — a trait that fails to start', () => {
  it('shows the typed evaluation error on the card, naming only the trait that failed', async () => {
    render(<OrbPreview schema={schemaWith('not-a-list')} isolated />);
    const error = await screen.findByTestId(TRAIT_MOUNT_ERROR_TESTID);
    expect(error.textContent).toContain('Layout failed to start');
    expect(error.textContent).toContain('Type mismatch: expected array, got string');
    expect(error.textContent).not.toContain('Footer');
    expect(error.textContent).not.toContain('Something went wrong');
  });

  it('control: a real list renders, with no mount error', async () => {
    render(<OrbPreview schema={schemaWith(['Home', 'Away'])} isolated />);
    expect(await screen.findByText('Home, Away')).toBeTruthy();
    expect(screen.queryByTestId(TRAIT_MOUNT_ERROR_TESTID)).toBeNull();
  });
});
