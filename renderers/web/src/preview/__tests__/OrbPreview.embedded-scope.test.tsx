// @vitest-environment jsdom
/**
 * A sibling a Host embeds through `@trait.Child` paints inside the Host's tree, yet its slot content is scoped to
 * its own orbital: the kernel's page circuit answers the owner of the sibling, so a control inside it emits its
 * qualified `UI:<Orbital>.<Trait>.<EVENT>` key.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { OrbitalSchema, TypedEffect } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';
import { TEST_TYPE_CONTRACT_VERSION } from '../../test-support/kernel-engine';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const idle = [{ name: 'idle', isInitial: true }];
const embedChild: TypedEffect = ['render-ui', 'main', { type: 'stack', children: ['@trait.Child'] }];
const childButton: TypedEffect = ['render-ui', 'main', { type: 'button', label: 'Go child', action: 'GO' }];

const childHeard: TypedEffect = ['render-ui', 'main', { type: 'typography', content: 'child heard GO' }];

const schema: OrbitalSchema = {
  typeContractVersion: TEST_TYPE_CONTRACT_VERSION,
  name: 'embedded-scope-app',
  version: '1.0.0',
  orbitals: [{
    name: 'Lab',
    entity: { name: 'Item', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
    traits: [
      { name: 'Host', linkedEntity: 'Item', stateMachine: { states: idle, events: [], transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [embedChild] }] } },
      { name: 'Child', linkedEntity: 'Item', stateMachine: { states: idle, events: [], transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [childButton] }, { from: 'idle', to: 'idle', event: 'GO', effects: [childHeard] }] } },
    ],
    pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Host' }, { ref: 'Child' }] }],
  }],
};

describe('OrbPreview: an embedded sibling is scoped to its orbital', () => {
  it('a control inside the embedded child reaches the child itself, not an unowned bare key', async () => {
    render(<OrbPreview schema={schema} isolated />);
    fireEvent.click(await screen.findByText('Go child'));
    expect(await screen.findByText('child heard GO')).toBeTruthy();
  });
});
