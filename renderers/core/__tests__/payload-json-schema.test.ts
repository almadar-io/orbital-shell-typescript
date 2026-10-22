// A declared input's payload, as the JSON Schema a tool-calling model receives.
import { describe, it, expect } from 'vitest';
import { payloadSchemaToJsonSchema } from '../index';

describe('payloadSchemaToJsonSchema', () => {
  it('maps primitives, required fields and nested objects', () => {
    expect(
      payloadSchemaToJsonSchema([
        { name: 'title', type: 'string', required: true },
        { name: 'points', type: 'number' },
        { name: 'data', type: 'object', required: true, properties: [{ name: 'done', type: 'boolean', required: true }] },
      ]),
    ).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        points: { type: 'number' },
        data: { type: 'object', additionalProperties: false, properties: { done: { type: 'boolean' } }, required: ['done'] },
      },
      required: ['title', 'data'],
    });
  });

  it('maps an array of objects to items', () => {
    expect(
      payloadSchemaToJsonSchema([{ name: 'rows', type: '[object]', properties: [{ name: 'id', type: 'string', required: true }] }]),
    ).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: { rows: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } }, required: ['id'] } } },
    });
  });

  it('control: an empty payload is an empty object schema', () => {
    expect(payloadSchemaToJsonSchema([])).toEqual({ type: 'object', properties: {} });
  });
});
