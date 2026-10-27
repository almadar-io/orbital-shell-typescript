import { describe, expect, it } from 'vitest';

import {
  type OrbitalEventRequest,
  type OrbitalEventResponse,
  OrbitalEventRequestSchema,
  OrbitalEventResponseSchema,
  ClientEffectTupleSchema,
  ClientRenderUITupleSchema,
  ClientNavigateTupleSchema,
  EmittedEventSchema,
  type EventDispatchRequest,
  type EventDispatchResponse,
} from '../src/types/bus.js';
import { ServerEffectResultSchema } from '../src/types/effect-result.js';
import { SERVER_REPORTED_EFFECTS } from '../src/types/effect.js';
import { asEventId } from '../src/types/identity.js';

/**
 * A0 (Program A, §156): `@almadar/core` becomes the single owner of the
 * event-dispatch wire, canonical = the TS runtime's implementation. These
 * tests pin the request/response shapes and the client-effect tuple
 * grammar's exact arities so the wire cannot silently drift.
 */
describe('OrbitalEventRequestSchema', () => {
  it('accepts a mount batch: each seed names its trait and its own lifecycle event', () => {
    const request: OrbitalEventRequest = {
      event: 'INIT',
      payload: { id: 'inv-1' },
      mount: [{ trait: 'InvoiceManage', event: 'INIT' }, { trait: 'InvoiceStats', event: 'LOAD' }, { trait: 'Clock', event: '$MOUNT' }],
      traits: [{ trait: 'InvoiceManage', from: 'loading' }],
    };
    expect(OrbitalEventRequestSchema.parse(request)).toEqual(request);
  });

  it('control: a mount seed with a non-lifecycle event is rejected', () => {
    expect(OrbitalEventRequestSchema.safeParse({ event: 'INIT', mount: [{ trait: 'A', event: 'SAVE' }] }).success).toBe(false);
  });

  it('carries the viewer locale so servers resolve i18n/t for that viewer', () => {
    const request: OrbitalEventRequest = { event: 'INIT', locale: 'ar' };
    expect(OrbitalEventRequestSchema.parse(request)).toEqual(request);
  });

  it('control: a non-string locale is rejected', () => {
    expect(OrbitalEventRequestSchema.safeParse({ event: 'INIT', locale: 3 }).success).toBe(false);
  });

  it('accepts a minimal request (only the required `event` field)', () => {
    const request: OrbitalEventRequest = { event: 'INIT' };
    expect(OrbitalEventRequestSchema.parse(request)).toEqual(request);
  });

  it('accepts the full stateless-addressing shape (traits[]/entityByTrait/behavior)', () => {
    const request: OrbitalEventRequest = {
      event: 'CREATE_DRAFT',
      eventId: asEventId('evt_abc123'),
      payload: { title: 'New note' },
      entityId: 'note-1',
      targetTrait: 'NotePersistor',
      user: { id: 'u1', role: 'member' },
      clientId: 'tab-1',
      tick: 'sync',
      sourceTrait: 'InlineButtonRender3',
      traits: [
        { trait: 'InlineButtonRender3', from: 'idle' },
        { trait: 'NotePersistor', from: 'idle' },
      ],
      entityByTrait: { NotePersistor: { id: 'note-1', title: 'Draft' } },
      behavior: 'NoteOrbital',
    };
    expect(OrbitalEventRequestSchema.parse(request)).toEqual(request);
  });

  it('rejects a request with no `event`', () => {
    expect(() => OrbitalEventRequestSchema.parse({})).toThrow();
  });
});

describe('OrbitalEventResponseSchema', () => {
  it('requires `emittedEvents` — always present, `[]` when none', () => {
    const response: OrbitalEventResponse = {
      success: true,
      transitioned: true,
      states: { NotePersistor: 'saved' },
      emittedEvents: [],
    };
    expect(OrbitalEventResponseSchema.parse(response)).toEqual(response);
    expect(() =>
      OrbitalEventResponseSchema.parse({ success: true, transitioned: true, states: {} }),
    ).toThrow();
  });

  it('accepts the full response shape (entityByTrait/clientEffectsByTrait/effectResults/guardFailed)', () => {
    const response: OrbitalEventResponse = {
      success: false,
      transitioned: false,
      states: { NoteForm: 'idle' },
      emittedEvents: [{ event: 'SAVE_FAILED', payload: { reason: 'guard' }, source: { orbital: 'NoteOrbital', trait: 'NoteForm' } }],
      data: { Note: [{ id: 'n1', title: 'Draft' }] },
      entityByTrait: { NoteForm: { id: 'n1', title: 'Draft' } },
      clientEffectsByTrait: [{ traitName: 'NoteForm', effect: ['navigate-back'] }],
      effectResults: [{ effect: 'persist', success: false, denied: true, error: 'access denied' }],
      guardFailed: 'NoteForm.SAVE',
      error: 'guard failed',
    };
    expect(OrbitalEventResponseSchema.parse(response)).toEqual(response);
  });
});

describe('ClientEffectTupleSchema — exact tuple arities', () => {
  it('accepts render-ui with a slot and a pattern (G-CROSS-257)', () => {
    expect(ClientEffectTupleSchema.parse(['render-ui', 'main', null])).toBeTruthy();
    expect(ClientEffectTupleSchema.parse(['render-ui', 'main', { patternType: 'box' }])).toBeTruthy();
  });

  it('control: a render-ui tuple carrying props or a priority is refused', () => {
    expect(() => ClientEffectTupleSchema.parse(['render-ui', 'main', { patternType: 'box' }, { className: 'x' }])).toThrow();
    expect(() => ClientEffectTupleSchema.parse(['render-ui', 'main', { patternType: 'box' }, null, 2])).toThrow();
  });

  it('empty slots are null on the wire (JSON.stringify writes null for undefined)', () => {
    expect(ClientEffectTupleSchema.parse(JSON.parse(JSON.stringify(['render-ui', 'main', undefined])))).toEqual(['render-ui', 'main', null]);
    expect(ClientEffectTupleSchema.parse(['navigate', '/tasks', null])).toBeTruthy();
    expect(() => ClientEffectTupleSchema.parse(['navigate', '/tasks', undefined])).toThrow();
  });

  it('rejects a render-ui tuple with a wrong arity', () => {
    expect(() => ClientRenderUITupleSchema.parse(['render-ui', 'main'])).toThrow();
    expect(() => ClientRenderUITupleSchema.parse(['render-ui', 'main', null, {}])).toThrow();
  });

  it('accepts every navigate arity (2/3/4)', () => {
    expect(ClientEffectTupleSchema.parse(['navigate', '/tasks'])).toBeTruthy();
    expect(ClientEffectTupleSchema.parse(['navigate', '/tasks/:id', { id: '1' }])).toBeTruthy();
    expect(
      ClientEffectTupleSchema.parse(['navigate', '/tasks/:id', { id: '1' }, { crumb: 'Task 1' }]),
    ).toBeTruthy();
  });

  it('rejects a navigate tuple with a wrong arity', () => {
    expect(() => ClientNavigateTupleSchema.parse(['navigate'])).toThrow();
    expect(() =>
      ClientNavigateTupleSchema.parse(['navigate', '/tasks', {}, { crumb: 'x' }, 'extra']),
    ).toThrow();
  });

  it('accepts navigate-back and rejects it with an argument', () => {
    expect(ClientEffectTupleSchema.parse(['navigate-back'])).toBeTruthy();
    expect(() => ClientEffectTupleSchema.parse(['navigate-back', 'extra'])).toThrow();
  });

  it('rejects an unknown effect kind', () => {
    expect(() => ClientEffectTupleSchema.parse(['emit', 'X'])).toThrow();
  });
});

describe('EmittedEventSchema', () => {
  it('accepts an emitted event with a full BusEventSource', () => {
    const emitted = {
      event: 'NoteSaved',
      payload: { id: 'n1' },
      source: { orbital: 'NoteOrbital', trait: 'NotePersistor', fromBridge: true, dispatched: false },
    };
    expect(EmittedEventSchema.parse(emitted)).toEqual(emitted);
  });

  it('accepts an emitted event with no payload/source', () => {
    expect(EmittedEventSchema.parse({ event: 'SAVE' })).toEqual({ event: 'SAVE' });
  });
});

describe('ServerEffectResultSchema', () => {
  it('accepts a persist success and a denied failure', () => {
    expect(
      ServerEffectResultSchema.parse({ effect: 'persist', action: 'create', success: true, data: { id: 'n1' } }),
    ).toBeTruthy();
    expect(
      ServerEffectResultSchema.parse({ effect: 'persist', success: false, denied: true, error: 'access denied' }),
    ).toBeTruthy();
  });

  it('rejects an unknown effect kind', () => {
    expect(() => ServerEffectResultSchema.parse({ effect: 'unknown', success: true })).toThrow();
  });
});

describe('EventDispatchRequest/Response — deprecated aliases', () => {
  it('are structurally the same shape as OrbitalEventRequest/Response', () => {
    const request: EventDispatchRequest = { event: 'INIT' };
    const response: EventDispatchResponse = { success: true, transitioned: false, states: {}, emittedEvents: [] };
    expect(OrbitalEventRequestSchema.parse(request)).toEqual(request);
    expect(OrbitalEventResponseSchema.parse(response)).toEqual(response);
  });
});

describe('ServerEffectResult.effect derives from the effect union', () => {
  it('accepts every SERVER_REPORTED_EFFECTS member and the substrate grouping', () => {
    for (const effect of SERVER_REPORTED_EFFECTS) {
      expect(ServerEffectResultSchema.parse({ effect, success: true })).toEqual({ effect, success: true });
    }
    expect(ServerEffectResultSchema.parse({ effect: 'substrate', name: 'memory/store', success: true }).name).toBe('memory/store');
  });

  it('rejects a name that is not an effect head', () => {
    expect(() => ServerEffectResultSchema.parse({ effect: 'swap!', success: true })).toThrow(); // the retired spelling
    expect(() => ServerEffectResultSchema.parse({ effect: 'substrate', name: 'store', success: true })).toThrow();
  });
});
