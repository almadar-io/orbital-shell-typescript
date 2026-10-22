/**
 * `traitsEmbeddedByEvent` — which `@trait.X` children a trait's transitions on one event
 * actually compose, directly or through a `@config.K` they render. The capture pass
 * repaints only those: std-executive-dashboard's INIT renders an empty stack, and its
 * stat children were repainted with INIT's empty payload (`?data` null).
 */
import { describe, it, expect } from 'vitest';
import { configReferencesCallsitePayload, traitsEmbeddedByEvent } from '../src/embedded-trait-config.js';
import type { Trait } from '../src/types/index.js';

const panel: Trait = {
  name: 'Panel',
  scope: 'instance',
  config: { contentTrait: { type: 'string', default: '@trait.Body' } },
  stateMachine: {
    states: [{ name: 'idle', isInitial: true }],
    events: [],
    transitions: [
      { from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', { type: 'stack', children: [] }]] },
      { from: 'idle', to: 'idle', event: 'LOADED', guard: ['>', '@payload.n', 0], effects: [['render-ui', 'main', { type: 'stack', children: ['@trait.Won'] }]] },
      { from: 'idle', to: 'idle', event: 'LOADED', effects: [['render-ui', 'main', { type: 'stack', children: ['@trait.Empty'] }]] },
      { from: 'idle', to: 'idle', event: 'SHOW', effects: [['render-ui', 'main', { type: 'box', children: ['@config.contentTrait'] }]] },
    ],
  },
};

describe('traitsEmbeddedByEvent', () => {
  it('an event whose render embeds nothing composes no child', () => {
    expect([...traitsEmbeddedByEvent(panel, 'INIT')]).toEqual([]);
  });

  it('every arm of the event counts (guards are runtime): both LOADED children', () => {
    expect([...traitsEmbeddedByEvent(panel, 'LOADED')].sort()).toEqual(['Empty', 'Won']);
  });

  it('a child reached through a @config value the transition renders', () => {
    expect([...traitsEmbeddedByEvent(panel, 'SHOW')]).toEqual(['Body']);
  });

  it('control: config-held children are not composed by an event that never reads that config', () => {
    expect(traitsEmbeddedByEvent(panel, 'LOADED').has('Body')).toBe(false);
  });

  it('edge: an event the trait has no transition for composes nothing', () => {
    expect(traitsEmbeddedByEvent(panel, 'NOPE').size).toBe(0);
  });
});

describe('configReferencesCallsitePayload', () => {
  it('a call-site config value carrying @callsitePayload (a ref\'d atom\'s knob) references it', () => {
    expect(configReferencesCallsitePayload({ value: ['array/len', ['array/filter', '@callsitePayload.data', ['fn', 'd', true]]] })).toBe(true);
  });

  it('control: a config with no capture does not', () => {
    expect(configReferencesCallsitePayload({ label: 'Win Rate', value: '@entity.total' })).toBe(false);
  });

  it('edge: no config at all does not', () => {
    expect(configReferencesCallsitePayload(undefined)).toBe(false);
  });
});
