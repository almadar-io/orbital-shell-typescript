/**
 * `traitReferencesCallsitePayload` / `collectCallsiteCaptureChildren` —
 * the shared (`@almadar/runtime` + `@almadar/ui`) discovery of which
 * embedded children (`@trait.X`) need their lifecycle transition re-run
 * under their embedder's payload whenever the embedder's own transition
 * fires. A JSX-hoisted inline child trait's config carries a
 * `@callsitePayload.<field>` capture — whole-value (`content:
 * @callsitePayload.error`) or nested inside an S-expression (`disabled:
 * (if (= @callsitePayload.data.status "resolved") false true)`, the
 * std-helpdesk shape). See `orbital-core/src/schema/types.rs`
 * `CALLSITE_PAYLOAD_PREFIX` for the compiled-path twin of this grammar.
 */

import { describe, it, expect } from 'vitest';
import { traitReferencesCallsitePayload, collectCallsiteCaptureChildren } from '../src/embedded-trait-config.js';
import type { OrbitalDefinition, Trait } from '../src/types/index.js';

const emptyStateMachine = { states: [], events: [] };

describe('traitReferencesCallsitePayload', () => {
  it('is false for a trait with no config and no state machine capture', () => {
    const trait: Trait = {
      name: 'Plain',
      scope: 'instance',
      config: { title: { type: 'string', default: 'Hello' } },
      stateMachine: { ...emptyStateMachine, transitions: [] },
    };
    expect(traitReferencesCallsitePayload(trait)).toBe(false);
  });

  it('is true for a whole-value capture in a config default (InlineTypographyRender22 shape)', () => {
    const trait: Trait = {
      name: 'InlineTypographyRender22',
      scope: 'instance',
      config: { content: { type: 'string', default: '@callsitePayload.error' } },
      stateMachine: { ...emptyStateMachine, transitions: [] },
    };
    expect(traitReferencesCallsitePayload(trait)).toBe(true);
  });

  it('is true for a nested capture inside an S-expression config default (std-helpdesk disabled shape)', () => {
    const trait: Trait = {
      name: 'InlineButtonRender7',
      scope: 'instance',
      config: {
        disabled: {
          type: 'boolean',
          default: ['if', ['and', ['=', '@callsitePayload.data.status', 'resolved'], true], false, true],
        },
      },
      stateMachine: { ...emptyStateMachine, transitions: [] },
    };
    expect(traitReferencesCallsitePayload(trait)).toBe(true);
  });

  it('is true when the capture lives inside a state-machine render-ui effect instead of config', () => {
    const trait: Trait = {
      name: 'DirectRender',
      scope: 'instance',
      stateMachine: {
        ...emptyStateMachine,
        transitions: [
          {
            from: 'idle',
            event: 'INIT',
            to: 'idle',
            effects: [['render-ui', 'main', { type: 'typography', content: '@callsitePayload.error' }]],
          },
        ],
      },
    };
    expect(traitReferencesCallsitePayload(trait)).toBe(true);
  });

  it('is false for undefined/null', () => {
    expect(traitReferencesCallsitePayload(undefined)).toBe(false);
    expect(traitReferencesCallsitePayload(null)).toBe(false);
  });
});

describe('collectCallsiteCaptureChildren', () => {
  function orbitalWith(traits: Trait[]): OrbitalDefinition {
    return {
      name: 'Orb',
      entity: { name: 'Ticket', persistence: 'runtime', fields: [{ name: 'id', type: 'string', required: true }] },
      pages: [],
      traits,
    } as OrbitalDefinition;
  }

  it('keeps a direct child that itself references callsitePayload', () => {
    const orbital = orbitalWith([
      {
        name: 'Host',
        scope: 'instance',
        stateMachine: {
          ...emptyStateMachine,
          transitions: [
            { from: 'idle', event: 'INIT', to: 'idle', effects: [['render-ui', 'main', { type: 'stack', children: ['@trait.Child'] }]] },
          ],
        },
      },
      {
        name: 'Child',
        scope: 'instance',
        config: { content: { type: 'string', default: '@callsitePayload.error' } },
        stateMachine: { ...emptyStateMachine, transitions: [] },
      },
    ]);

    const map = collectCallsiteCaptureChildren(orbital);
    expect(map.get('Host')).toEqual(new Set(['Child']));
  });

  it('drops a direct child that does not capture and has no capturing descendant', () => {
    const orbital = orbitalWith([
      {
        name: 'Host',
        scope: 'instance',
        stateMachine: {
          ...emptyStateMachine,
          transitions: [
            { from: 'idle', event: 'INIT', to: 'idle', effects: [['render-ui', 'main', { type: 'stack', children: ['@trait.Child'] }]] },
          ],
        },
      },
      {
        name: 'Child',
        scope: 'instance',
        config: { title: { type: 'string', default: 'Static' } },
        stateMachine: { ...emptyStateMachine, transitions: [] },
      },
    ]);

    const map = collectCallsiteCaptureChildren(orbital);
    expect(map.has('Host')).toBe(false);
  });

  it('keeps a non-capturing intermediate child as a pass-through to a capturing grandchild', () => {
    const orbital = orbitalWith([
      {
        name: 'Host',
        scope: 'instance',
        stateMachine: {
          ...emptyStateMachine,
          transitions: [
            { from: 'idle', event: 'INIT', to: 'idle', effects: [['render-ui', 'main', { type: 'stack', children: ['@trait.Middle'] }]] },
          ],
        },
      },
      {
        name: 'Middle',
        scope: 'instance',
        config: { title: { type: 'string', default: 'Static' } },
        stateMachine: {
          ...emptyStateMachine,
          transitions: [
            { from: 'idle', event: 'INIT', to: 'idle', effects: [['render-ui', 'main', { type: 'stack', children: ['@trait.Grandchild'] }]] },
          ],
        },
      },
      {
        name: 'Grandchild',
        scope: 'instance',
        config: { content: { type: 'string', default: '@callsitePayload.error' } },
        stateMachine: { ...emptyStateMachine, transitions: [] },
      },
    ]);

    const map = collectCallsiteCaptureChildren(orbital);
    // Host must walk through Middle to reach Grandchild's capture.
    expect(map.get('Host')).toEqual(new Set(['Middle']));
    expect(map.get('Middle')).toEqual(new Set(['Grandchild']));
  });

  it('returns an empty map for an orbital with no captures anywhere', () => {
    const orbital = orbitalWith([
      {
        name: 'Host',
        scope: 'instance',
        stateMachine: {
          ...emptyStateMachine,
          transitions: [
            { from: 'idle', event: 'INIT', to: 'idle', effects: [['render-ui', 'main', { type: 'stack', children: ['@trait.Child'] }]] },
          ],
        },
      },
      {
        name: 'Child',
        scope: 'instance',
        config: { title: { type: 'string', default: 'Static' } },
        stateMachine: { ...emptyStateMachine, transitions: [] },
      },
    ]);

    const map = collectCallsiteCaptureChildren(orbital);
    expect(map.size).toBe(0);
  });
});
