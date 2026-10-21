/**
 * Every client-kernel dispatch records the runtime's own verdict where the
 * verifier reads it (`server:<Orbital>` timeline entry, matched by event).
 * Before this, a dispatch that threw inside its effects — `ui-pirate-board-3d`'s
 * FxDecay BURST self-loop, `(s ?? []).map is not a function` — was only a
 * console line, and the walk credited it because the state "reached" `to`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { OrbitalEventResponse } from '@almadar/core';
import { recordDispatchVerdict } from '../circuitVerificationObserver';
import { clearVerification, getTransitions } from '../verificationRegistry';

function response(overrides: Partial<OrbitalEventResponse>): OrbitalEventResponse {
  return { success: true, transitioned: true, states: {}, emittedEvents: [], ...overrides };
}

function verdictFor(event: string) {
  return [...getTransitions()].reverse().find((t) => t.traitName === 'server:Board' && t.event === event)?.serverResponse;
}

describe('recordDispatchVerdict', () => {
  beforeEach(() => clearVerification());

  it('records a thrown dispatch as a failed verdict carrying the error', () => {
    recordDispatchVerdict('Board', 'BURST', { error: new TypeError('(s ?? []).map is not a function') });
    const verdict = verdictFor('BURST');
    expect(verdict?.success).toBe(false);
    expect(verdict?.error).toContain('(s ?? []).map is not a function');
  });

  it('records a rejected dispatch with the runtime error and transitioned flag', () => {
    recordDispatchVerdict('Board', 'BURST', {
      response: response({ success: false, transitioned: false, error: "Payload validation failed for event 'BURST'" }),
    });
    const verdict = verdictFor('BURST');
    expect(verdict?.success).toBe(false);
    expect(verdict?.transitioned).toBe(false);
    expect(verdict?.error).toContain('Payload validation failed');
  });

  it('records a dispatch whose effect failed as a failed verdict naming the trait and error', () => {
    recordDispatchVerdict('Board', 'INIT', {
      response: response({
        rejections: [{ code: 'effect-failed', trait: 'BoardPreview', event: 'INIT', from: 'idle', error: 'behavior/ref: "Indigo Pioneer" is not a behavior specifier' }],
      }),
    });
    const verdict = verdictFor('INIT');
    expect(verdict?.success).toBe(false);
    expect(verdict?.error).toContain('BoardPreview.INIT');
    expect(verdict?.error).toContain('is not a behavior specifier');
  });

  it('control: a rejection that is not an effect failure leaves the verdict a success', () => {
    recordDispatchVerdict('Board', 'SAVE', {
      response: response({ transitioned: false, rejections: [{ code: 'no-matching-transition', trait: 'BoardPreview', event: 'SAVE' }] }),
    });
    expect(verdictFor('SAVE')?.success).toBe(true);
  });

  it('control: records a clean dispatch as success with its transitioned flag', () => {
    recordDispatchVerdict('Board', 'MOVE', { response: response({ transitioned: false }) });
    const verdict = verdictFor('MOVE');
    expect(verdict?.success).toBe(true);
    expect(verdict?.transitioned).toBe(false);
    expect(verdict?.error).toBeUndefined();
  });

  it('counts emitted events and client effects from the response', () => {
    recordDispatchVerdict('Board', 'END_TURN', {
      response: response({
        emittedEvents: [{ event: 'AI_TURN', payload: { turn: 1 } }],
        clientEffects: [['render-ui', 'main', { type: 'game-shell' }]],
      }),
    });
    const verdict = verdictFor('END_TURN');
    expect(verdict?.emittedEvents).toEqual(['AI_TURN']);
    expect(verdict?.clientEffects).toBe(1);
  });

  it('carries the response effectResults so a denied persist is visible to the walk (G-VERIFY-077)', () => {
    recordDispatchVerdict('Board', 'DO_SAVE', {
      response: response({
        success: false,
        effectResults: [{ effect: 'persist', entityType: 'Note', action: 'create', success: false, denied: true, error: 'policy denied' }],
      }),
    });
    const entry = [...getTransitions()].reverse().find((t) => t.traitName === 'server:Board' && t.event === 'DO_SAVE');
    expect(entry?.effects).toHaveLength(1);
    expect(entry?.effects[0]).toMatchObject({ type: 'persist', entityName: 'Note', action: 'create', outcome: 'denied' });
  });

  it('control: a dispatch without effectResults records no effects', () => {
    recordDispatchVerdict('Board', 'MOVE', { response: response({}) });
    const entry = [...getTransitions()].reverse().find((t) => t.traitName === 'server:Board' && t.event === 'MOVE');
    expect(entry?.effects).toEqual([]);
  });
});
