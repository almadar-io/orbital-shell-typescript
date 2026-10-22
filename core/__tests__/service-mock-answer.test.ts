import { describe, expect, it, vi } from 'vitest';
import { mockServiceAnswer, registryActionNames, registryServiceNames } from '../src/mock/serviceAnswer';

/** A test-scoped registry: the real one changes as services retire, so the shape cases pin their own. */
const SCOPED_SERVICES = {
  gen: {
    actions: [
      {
        name: 'generate',
        responseShape: {
          content: 'string',
          usage: { type: 'object', properties: { promptTokens: 'number', completionTokens: 'number', totalTokens: 'number' } },
        },
      },
      {
        name: 'classifyMany',
        responseShape: {
          verdicts: { type: 'array', items: { type: 'object', properties: { id: 'string', category: 'string', confidence: 'number' } } },
        },
      },
      { name: 'ping' },
    ],
  },
};

async function scopedAnswers(): Promise<{ mockServiceAnswer: typeof mockServiceAnswer }> {
  vi.resetModules();
  vi.doMock('../src/patterns/services-registry.json', () => ({ default: { services: SCOPED_SERVICES } }));
  const scoped = await import('../src/mock/serviceAnswer');
  vi.doUnmock('../src/patterns/services-registry.json');
  return scoped;
}

describe('mockServiceAnswer: the registry-shaped mock answer every host shares', () => {
  it('mocks each field of the action responseShape, recursing into objects', async () => {
    const { mockServiceAnswer: answer } = await scopedAnswers();
    expect(answer('gen', 'generate')).toEqual({
      ok: true,
      value: { content: 'mock_content', usage: { promptTokens: 42, completionTokens: 42, totalTokens: 42 } },
    });
  });

  it('an array-of-objects field mocks to one placeholder object', async () => {
    const { mockServiceAnswer: answer } = await scopedAnswers();
    expect(answer('gen', 'classifyMany')).toEqual({ ok: true, value: { verdicts: [{ id: 'mock_id', category: 'mock_category', confidence: 42 }] } });
  });

  it('edge: an action without a responseShape answers a generic success', async () => {
    const { mockServiceAnswer: answer } = await scopedAnswers();
    expect(answer('gen', 'ping')).toEqual({
      ok: true,
      value: { success: true, _mock: true, _action: 'ping' },
    });
  });

  it('control: an undeclared action or service has no mock answer', async () => {
    const { mockServiceAnswer: answer } = await scopedAnswers();
    expect(answer('gen', 'nope')).toEqual({ ok: false, reason: 'unknown-action', message: 'No mock response for action: nope' });
    expect(answer('nope', 'x')).toMatchObject({ ok: false, reason: 'unknown-service' });
  });

  it('every declared action has an answer', () => {
    for (const service of registryServiceNames()) {
      for (const action of registryActionNames(service)) expect(mockServiceAnswer(service, action).ok).toBe(true);
    }
  });
});
