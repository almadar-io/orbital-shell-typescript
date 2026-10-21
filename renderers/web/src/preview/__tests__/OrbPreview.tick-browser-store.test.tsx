/**
 * A client tick whose effects write a browser-stored entity (drift D-1): the tick's `persist` goes
 * to the browser store as a `runTick` leg instead of being dropped, so the row it writes is there
 * for the next fetch.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { OrbitalSchema, TraitTick } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';

const fetchInvoices = ['fetch', 'Invoice', { emit: { success: 'LOADED' } }];
const list = ['render-ui', 'main', { type: 'data-grid', entity: '@payload.data', fields: [{ name: 'client', label: 'Client' }] }];

function schema(name: string, ticks: TraitTick[]): OrbitalSchema {
  return JSON.parse(JSON.stringify({
    name,
    version: '1.0.0',
    orbitals: [{
      name: 'Books',
      entity: {
        name: 'Invoice', persistence: 'persistent', collection: 'invoices', local: true,
        fields: [{ name: 'id', type: 'string', required: true }, { name: 'client', type: 'string' }],
        instances: [{ id: 'INV-1042', client: 'Noor Logistics' }],
      },
      traits: [{
        name: 'InvoiceList', scope: 'collection', linkedEntity: 'Invoice',
        stateMachine: {
          states: [{ name: 'loading', isInitial: true }, { name: 'browsing' }],
          events: [],
          transitions: [
            { from: 'loading', to: 'loading', event: 'INIT', effects: [fetchInvoices] },
            { from: 'loading', to: 'browsing', event: 'LOADED', effects: [list] },
            { from: 'browsing', to: 'loading', event: 'ADDED', effects: [fetchInvoices] },
          ],
        },
        ticks,
      }],
      pages: [{ name: 'Home', path: '/', traits: [{ ref: 'InvoiceList' }] }],
    }],
  }));
}

const autosave: TraitTick = {
  name: 'autosave',
  interval: 40,
  appliesTo: ['browsing'],
  effects: [['persist', 'create', 'Invoice', { id: 'INV-TICK', client: 'Ticked Co' }, { emit: { success: 'ADDED' } }]],
};

describe('OrbPreview — a tick writing a browser-stored entity', () => {
  it('stores the row the tick writes, and the refetch shows it', async () => {
    render(<OrbPreview schema={schema(`tick-books-${Math.random()}`, [autosave])} isolated />);
    expect(await screen.findByText('Noor Logistics')).toBeTruthy();
    expect(await screen.findByText('Ticked Co', {}, { timeout: 5_000 })).toBeTruthy();
  }, 20_000);

  it('control: with no tick the row never appears', async () => {
    render(<OrbPreview schema={schema(`tick-books-${Math.random()}`, [])} isolated />);
    expect(await screen.findByText('Noor Logistics')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByText('Ticked Co')).toBeNull();
  }, 20_000);
});
