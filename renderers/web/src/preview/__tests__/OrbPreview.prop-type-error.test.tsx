/**
 * The `app-1789833059828` crash through the real runtime: `navItems` bound to a
 * `@config.navItems` nothing declares reaches `dashboard-layout` as a string.
 * Same shape on `accordion.items` (declared `array`, mapped unguarded): the
 * renderer reports that element instead of the tree crashing.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';

function schemaWith(items: string | Array<{ title: string; content: string }>): OrbitalSchema {
  return JSON.parse(JSON.stringify({
    name: 'layout-app',
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
          transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'accordion', items }]] }],
        },
      }],
      pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Layout' }] }],
    }],
  }));
}

describe('OrbPreview — a prop value of the wrong shape', () => {
  it('reports the element (pattern, prop, expected, got) instead of crashing', async () => {
    render(<OrbPreview schema={schemaWith('@config.items')} isolated />);
    const error = await screen.findByTestId('pattern-prop-type-error');
    expect(error.textContent).toMatch(/^accordion\.items: expected array, got (missing|string)$/);
    expect(screen.queryByText(/is not a function/)).toBeNull();
  });

  it('control: a real items array renders the accordion', async () => {
    render(<OrbPreview schema={schemaWith([{ title: 'Home', content: 'Welcome' }])} isolated />);
    expect(await screen.findByText('Home')).toBeTruthy();
    expect(screen.queryByTestId('pattern-prop-type-error')).toBeNull();
  });
});
