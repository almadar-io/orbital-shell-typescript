// The server role hands back one `done` response per dispatch; the host checks its shape once, through the check generated
// from the Rust `EventResponse` (`isEventResponse` in `@almadar/core/kernel-wire`), and refuses a malformed one.
import { describe, expect, it } from 'vitest';
import { isEventResponse } from '@almadar/core/kernel-wire';
import { decodeProgress } from '@almadar/shell-runtime/kernel/decode';

const response = { success: true, transitioned: true, states: { Src: 'idle' }, emittedEvents: [{ event: 'X', payload: { n: 1 }, source: { orbital: 'Main', trait: 'Src', dispatched: true } }] };
const done = (body: object): string => JSON.stringify({ status: 'done', response: body });

describe('decodeProgress on a done response', () => {
  it('passes a well-formed response through unchanged', () => {
    const decoded = decodeProgress(done(response));
    expect(decoded).toEqual({ status: 'done', response });
  });

  it('the generated check accepts the response and refuses each malformed shape', () => {
    expect(isEventResponse(response)).toBe(true);
    for (const bad of [null, [], 'done', { ...response, success: 'yes' }, { ...response, transitioned: 1 }, { ...response, states: [] }, { ...response, emittedEvents: {} }, { transitioned: true, states: {}, emittedEvents: [] }]) {
      expect(isEventResponse(bad)).toBe(false);
    }
  });

  it('control: a malformed response is refused, typed, not passed on', () => {
    for (const bad of [{ ...response, success: 'yes' }, { ...response, states: [] }, { ...response, emittedEvents: {} }]) {
      expect(() => decodeProgress(done(bad))).toThrow(/kernel wire: .*response/);
    }
  });

  it('a field serde defaults is filled in when missing, as the Rust deserializer does; a wrong type is still refused', () => {
    expect(decodeProgress(done({ states: {}, emittedEvents: [] }))).toEqual({
      status: 'done',
      response: { success: false, transitioned: false, states: {}, emittedEvents: [] },
    });
    expect(decodeProgress(done({}))).toEqual({ status: 'done', response: { success: false, transitioned: false, states: {}, emittedEvents: [] } });
    expect(() => decodeProgress(done({ success: 1 }))).toThrow(/kernel wire: .*response\.success/);
  });

  it('control: a malformed nested field is refused, whatever the depth', () => {
    const nested = [
      { ...response, emittedEvents: [{ event: 5 }] },
      { ...response, emittedEvents: [{ event: 'X', source: { trait: 3 } }] },
      { ...response, transitions: [{ trait: 'a', from: 'x', to: 'y', event: 'e', effects: [{ type: 1, args: [], status: 'executed' }] }] },
      { ...response, transitions: [{ trait: 'a', from: 'x', to: 'y', event: 'e', effects: [{ type: 'set', args: [], status: 'maybe' }] }] },
      { ...response, clientEffectsByTrait: [{ traitName: 'a', effect: ['navigate', 5] }] },
      { ...response, clientEffectsByTrait: [{ traitName: 'a', effect: ['render-ui', 'main'] }] },
      { ...response, rejections: [{ code: 'not-a-code' }] },
      { ...response, states: { Src: 5 } },
      { ...response, dataRefs: { Item: { entityType: 'Item', ids: [1], total: 1, query: {} } } },
    ];
    for (const bad of nested) {
      expect(isEventResponse(bad)).toBe(false);
      expect(() => decodeProgress(done(bad)), JSON.stringify(bad)).toThrow(/kernel wire: .*response/);
    }
  });

  it('a well-formed response with every nested kind passes', () => {
    const full = {
      ...response,
      clientEffectsByTrait: [
        { traitName: 'a', effect: ['render-ui', 'main', { type: 'stack' }] },
        { traitName: 'a', effect: ['navigate', '/a'] },
        { traitName: 'a', effect: ['navigate-back'] },
      ],
      transitions: [{ trait: 'a', from: 'x', to: 'y', event: 'e', guardResult: true, effects: [{ type: 'set', args: [1, 'a'], status: 'executed' }] }],
      rejections: [{ code: 'guard-rejected', trait: 'a' }],
      dataRefs: { Item: { entityType: 'Item', ids: ['1'], total: 1, query: { limit: 3 } } },
    };
    expect(isEventResponse(full)).toBe(true);
    expect(decodeProgress(done(full))).toEqual({ status: 'done', response: full });
  });

  it('an await message is still checked field by field', () => {
    expect(() => decodeProgress(JSON.stringify({ status: 'await', flight: 'one', requests: [] }))).toThrow(/kernel wire/);
    expect(decodeProgress(JSON.stringify({ status: 'await', flight: 3, requests: [] }))).toEqual({ status: 'await', flight: 3, requests: [] });
  });
});
