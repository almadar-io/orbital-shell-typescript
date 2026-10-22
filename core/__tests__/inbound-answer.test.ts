import { describe, it, expect } from 'vitest';
import { inboundAnswerOf, type InboundRoute } from '../src/access/inbound.js';

const route: InboundRoute = { name: 'hook', orbital: 'O', trait: 'T', event: 'GOT', answer: 'ANSWER' };
const answered = (payload: Record<string, string | number>) => inboundAnswerOf(route, [{ event: 'ANSWER', payload }]);

describe('inboundAnswerOf stderr', () => {
  it('carries a string stderr', () => {
    expect(answered({ status: 200, body: '{}', stderr: 'warn' })).toEqual({ status: 200, body: '{}', stderr: 'warn' });
  });
  it('control: without stderr the answer has no stderr key', () => {
    expect(answered({ status: 200, body: '{}' })).toEqual({ status: 200, body: '{}' });
  });
  it('a non-string stderr is an invalid answer', () => {
    expect(answered({ status: 200, body: '{}', stderr: 7 })).toEqual({ status: 500, body: JSON.stringify({ error: 'inbound-answer-invalid' }) });
  });
  it('control: a non-string body is the same invalid answer', () => {
    expect(answered({ status: 200, body: 7 })).toEqual({ status: 500, body: JSON.stringify({ error: 'inbound-answer-invalid' }) });
  });
});
