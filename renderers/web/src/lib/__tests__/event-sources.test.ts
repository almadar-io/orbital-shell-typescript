/**
 * A canvas card offers a wire handle for every event its render tree can emit.
 * Which props emit is the pattern registry's call (`kind: "event"`-family props
 * and `event-list` action items, via @almadar/core) — never a hardcoded key.
 */
import { describe, expect, it } from 'vitest';
import type { OrbitalSchema } from '@almadar/core';
import { schemaToOverviewGraph } from '../avl-preview-converter';

function schemaWith(tree: object): OrbitalSchema {
  return {
    name: 'S',
    version: '1.0.0',
    orbitals: [{
      name: 'Source',
      entity: { name: 'Thing', persistence: 'runtime', fields: [{ name: 'title', type: 'string' }] },
      traits: [{
        name: 'SourceView',
        linkedEntity: 'Thing',
        stateMachine: {
          states: [{ name: 'idle', isInitial: true }],
          events: [{ key: 'INIT', name: 'INIT' }],
          transitions: [{ from: 'idle', to: 'idle', event: 'INIT', effects: [['render-ui', 'main', tree]] }],
        },
      }],
      pages: [{ name: 'P', path: '/p', traits: [{ ref: 'SourceView' }] }],
    }],
  } as OrbitalSchema;
}

const sources = (tree: object) => schemaToOverviewGraph(schemaWith(tree)).nodes[0].data.eventSources.map((s) => s.event);

describe('canvas event sources', () => {
  it("a button's action is an event source (the registry declares it kind: event)", () => {
    expect(sources({ type: 'stack', children: [{ type: 'button', label: 'Create', action: 'WIDGET_CREATED' }] })).toEqual(['WIDGET_CREATED']);
  });

  it('an action list (event-list) contributes each item event', () => {
    const tree = { type: 'data-list', entity: '@entity', itemActions: [{ label: 'Open', event: 'OPEN_ROW' }, { label: 'Delete', event: 'DELETE_ROW' }] };
    expect(sources(tree)).toEqual(expect.arrayContaining(['OPEN_ROW', 'DELETE_ROW']));
  });

  it('control: a prop the registry does not declare as an event (a label, an undeclared `event` key) is not a source', () => {
    expect(sources({ type: 'button', label: 'WIDGET_CREATED', event: 'NOT_A_PROP' })).toEqual([]);
  });

  it('edge: an unknown pattern and a non-string action offer nothing', () => {
    expect(sources({ type: 'no-such-pattern', action: 'X' })).toEqual([]);
    expect(sources({ type: 'button', label: 'Go', action: 42 })).toEqual([]);
  });
});
