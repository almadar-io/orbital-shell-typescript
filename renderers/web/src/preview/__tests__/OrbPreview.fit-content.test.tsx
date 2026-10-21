/**
 * `fit="content"` renders the behavior inside the content-fitting wrapper (the
 * slot content is fit and centered); plain `fit` keeps the whole-box fit.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';

const schema: OrbitalSchema = JSON.parse(JSON.stringify({
  name: 'button-app',
  version: '1.0.0',
  orbitals: [{
    name: 'Buttons',
    entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [{
      name: 'Show',
      scope: 'instance',
      linkedEntity: 'Item',
      stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [],
        transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'typography', content: 'Hello' }]] }],
      },
    }],
    pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Show' }] }],
  }],
}));

describe('OrbPreview fit modes', () => {
  it('fit="content" fits the rendered component and still renders it', async () => {
    const { container } = render(<OrbPreview schema={schema} isolated fit="content" height="80px" />);
    expect(container.querySelector('[data-fit-mode="content"]')).toBeTruthy();
    expect(await screen.findByText('Hello')).toBeTruthy();
  });

  it('control: fit keeps the whole-box fit; no fit renders no fitting wrapper', () => {
    const boxed = render(<OrbPreview schema={schema} isolated fit height="80px" />);
    expect(boxed.container.querySelector('[data-fit-mode="box"]')).toBeTruthy();
    boxed.unmount();
    const plain = render(<OrbPreview schema={schema} isolated height="80px" />);
    expect(plain.container.querySelector('[data-fit-mode]')).toBeNull();
  });
});
