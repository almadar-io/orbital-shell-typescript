/**
 * A trait whose lifecycle step throws (an array operator given a non-array:
 * the evaluator's TypeMismatch) shows the error on its card instead of a blank
 * card — the failure is named where the user is looking.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { TRAIT_MOUNT_ERROR_TESTID, type OrbitalSchema, type Trait } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';
import type { ServerBridgeTransport } from '../../providers/ServerBridge';
import { TransportStatusError } from '@almadar/shell-runtime/client/EventTransport';
import { TEST_TYPE_CONTRACT_VERSION } from '../../test-support/kernel-engine';

const footer: Trait = {
  name: 'Footer', linkedEntity: 'Item',
  stateMachine: {
    states: [{ name: 'idle', isInitial: true }], events: [],
    transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content: 'footer' }]] }],
  },
};

function schemaWith(items: string | string[]): OrbitalSchema {
  return {
    typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
    name: 'nav-app',
    version: '1.0.0',
    orbitals: [{
      name: 'Shell',
      entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
      traits: [{
        name: 'Layout',
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
  };
}

function schemaWithServerRows(): OrbitalSchema {
  const trait = (name: string): Trait => ({
    name, linkedEntity: 'Row',
    stateMachine: {
      states: [{ name: 'idle', isInitial: true }], events: [],
      transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['fetch', 'Row'], ['render-ui', 'main', { type: 'typography', content: name }]] }],
    },
  });
  return {
    typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
    name: 'refused-app',
    version: '1.0.0',
    orbitals: [{
      name: 'Shell',
      entity: { name: 'Row', persistence: 'persistent', collection: 'rows', fields: [{ name: 'id', type: 'string' }] },
      traits: [trait('FirstTrait'), trait('SecondTrait')],
      pages: [{ name: 'Home', path: '/', traits: [{ ref: 'FirstTrait' }, { ref: 'SecondTrait' }] }],
    }],
  };
}

function refusing(status: number, body: string): ServerBridgeTransport {
  return {
    register: async () => ({ success: true, carriesCircuitState: true }),
    unregister: async () => undefined,
    send: async () => { throw new TransportStatusError(status, body); },
    subscribe: () => () => undefined,
  };
}

describe('OrbPreview — a server that refuses the page', () => {
  it('says the server refused it, in the server\'s own words, without listing the traits', async () => {
    render(<OrbPreview schema={schemaWithServerRows()} transport={refusing(429, '{"error":"Too many requests"}')} />);
    const error = await screen.findByTestId(TRAIT_MOUNT_ERROR_TESTID);
    expect(error.textContent).toContain('The server refused this page');
    expect(error.textContent).toContain('Too many requests');
    expect(error.textContent).not.toContain('FirstTrait');
    expect(error.textContent).not.toContain('{"error"');
  });

  it('a refusal with no body still names the status', async () => {
    render(<OrbPreview schema={schemaWithServerRows()} transport={refusing(503, '')} />);
    const error = await screen.findByTestId(TRAIT_MOUNT_ERROR_TESTID);
    expect(error.textContent).toContain('The server refused this page');
    expect(error.textContent).toContain('503');
  });
});

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
