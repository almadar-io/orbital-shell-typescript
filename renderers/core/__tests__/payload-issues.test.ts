// A value checked against a declared payload: what a host does with a model's tool arguments.
import { describe, it, expect } from 'vitest';
import { payloadIssues, payloadSchemaToJsonSchema, type PayloadField } from '../index';

const FILL: PayloadField[] = [
  { name: 'layout', type: 'string', required: true, values: ['grid', 'rows'] },
  { name: 'count', type: 'number' },
  { name: 'tags', type: '[string]', values: ['new', 'sale'] },
  { name: 'config', type: 'object', properties: [{ name: 'dense', type: 'boolean' }] },
  { name: 'rows', type: '[object]', properties: [{ name: 'id', type: 'string', required: true }] },
];

describe('payloadIssues', () => {
  it('accepts a value that matches the declaration', () => {
    expect(payloadIssues(FILL, { layout: 'grid', count: 3, tags: ['sale'], config: { dense: true }, rows: [{ id: 'a' }] })).toEqual([]);
  });

  it('control: a missing required field', () => {
    expect(payloadIssues(FILL, {})).toEqual([{ path: 'layout', reason: 'missing' }]);
  });

  it('control: a value outside the closed set, also inside an array', () => {
    expect(payloadIssues(FILL, { layout: 'cards', tags: ['new', 'old'] })).toEqual([
      { path: 'layout', reason: 'not-one-of', expected: 'grid | rows' },
      { path: 'tags[1]', reason: 'not-one-of', expected: 'new | sale' },
    ]);
  });

  it('control: a wrong primitive, a wrong container and a nested miss', () => {
    expect(payloadIssues(FILL, { layout: 'grid', count: 'three', config: [], rows: [{}] })).toEqual([
      { path: 'count', reason: 'wrong-type', expected: 'number' },
      { path: 'config', reason: 'wrong-type', expected: 'object' },
      { path: 'rows[0].id', reason: 'missing' },
    ]);
  });

  it('control: a key the declaration does not name, at any depth', () => {
    expect(payloadIssues(FILL, { layout: 'grid', colour: 'red', config: { dense: true, wide: true } })).toEqual([
      { path: 'config.wide', reason: 'unknown', expected: 'dense' },
      { path: 'colour', reason: 'unknown', expected: 'layout | count | tags | config | rows' },
    ]);
  });

  it('edge: a key on an object that declares none names no alternatives', () => {
    expect(payloadIssues([{ name: 'roles', type: 'object', properties: [] }], { roles: { Member: 'StudioUser' } })).toEqual([
      { path: 'roles.Member', reason: 'unknown', expected: '(no keys)' },
    ]);
  });

  it('an object without declared properties stays open', () => {
    expect(payloadIssues([{ name: 'data', type: 'object' }], { data: { anything: 1 } })).toEqual([]);
  });
});

describe('payloadSchemaToJsonSchema with closed values', () => {
  it('carries values as enum, element-wise for arrays, and closes declared objects', () => {
    expect(payloadSchemaToJsonSchema([FILL[0]!, FILL[2]!, FILL[3]!])).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        layout: { type: 'string', enum: ['grid', 'rows'] },
        tags: { type: 'array', items: { type: 'string', enum: ['new', 'sale'] } },
        config: { type: 'object', additionalProperties: false, properties: { dense: { type: 'boolean' } } },
      },
      required: ['layout'],
    });
  });
});

describe('payloadSchemaToJsonSchema leaves out what cannot be filled', () => {
  it('an object field that declares no keys is not offered', () => {
    expect(payloadSchemaToJsonSchema([{ name: 'roles', type: 'object', properties: [] }, FILL[1]!])).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: { count: { type: 'number' } },
    });
  });

  it('control: an open object (no declared properties) is still offered', () => {
    expect(payloadSchemaToJsonSchema([{ name: 'data', type: 'object' }]).properties).toHaveProperty('data');
  });
});
