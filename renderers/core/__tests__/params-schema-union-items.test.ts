/**
 * A list knob whose element is a union (`tools : [AgentTool]`, `AgentTool =
 * Scope | Input | Read`) is offered as `oneOf` closed variants: the fill can
 * pick one form per element but never merge two (`{ event, read, scope }`).
 */
import { describe, expect, it } from 'vitest';
import type { EntityField, FactorySignature, JsonSchema } from '../index';
import { signatureToParamsSchema } from '../index';

const toolItems: EntityField = {
  type: 'union',
  values: ['AgentToolScope', 'AgentToolInput', 'AgentToolRead'],
  properties: {
    AgentToolScope: { name: 'AgentToolScope', type: 'object', properties: { scope: { name: 'scope', type: 'string', required: true, values: ['declared'] } } },
    AgentToolInput: { name: 'AgentToolInput', type: 'object', properties: { event: { name: 'event', type: 'EventAddress', required: true } } },
    AgentToolRead: { name: 'AgentToolRead', type: 'object', properties: { read: { name: 'read', type: 'string', required: true } } },
  },
};

const structItems: EntityField = {
  type: 'object',
  properties: { label: { name: 'label', type: 'string', required: true } },
};

function signature(items: EntityField): FactorySignature {
  return {
    organism: 'std-agent-tool-loop',
    orbital: 'AgentToolLoopOrbital',
    tier: 'atoms',
    factoryPath: 'fake.ts',
    entities: [{ name: 'AgentTurn', fields: [{ name: 'status', type: 'string', required: false }], persistence: 'runtime' }],
    traits: [
      {
        name: 'AgentToolLoop',
        emittedEvents: [],
        listenedEvents: [],
        overridableConfigKeys: [{ key: 'tools', type: '[AgentTool]', default: [], items }],
        capabilities: [],
      },
    ],
    pages: [{ name: 'AgentToolLoopPage', defaultPath: '/agent', primaryEntity: 'AgentTurn' }],
    emittedEvents: [],
    listenedEvents: [],
  };
}

function toolsItems(items: EntityField): JsonSchema | undefined {
  return signatureToParamsSchema(signature(items)).properties?.['traitOverrides']?.properties?.['AgentToolLoop']?.properties?.['config']?.properties?.['tools']?.items;
}

describe('signatureToParamsSchema — union list elements', () => {
  it('offers one closed variant per union member, in declaration order', () => {
    const items = toolsItems(toolItems);
    const variants = items?.oneOf ?? [];
    expect(variants.map((v) => Object.keys(v.properties ?? {}))).toEqual([['scope'], ['event'], ['read']]);
    for (const v of variants) {
      expect(v.additionalProperties).toBe(false);
      expect(v.required?.length).toBe(1);
    }
  });

  it('never presents the variant names as element keys', () => {
    const items = toolsItems(toolItems);
    expect(items?.properties).toBeUndefined();
  });

  it('a CallKey member is a string at rest', () => {
    const input: EntityField = { name: 'AgentToolInput', type: 'object', properties: { key: { name: 'key', type: 'CallKey', required: true } } };
    const item: EntityField = { ...toolItems, properties: { ...toolItems.properties, AgentToolInput: input } };
    expect(toolsItems(item)?.oneOf?.[1]?.properties?.['key']?.type).toBe('string');
  });

  it('an EventAddress member is a string', () => {
    const input = toolsItems(toolItems)?.oneOf?.[1];
    expect(input?.properties?.['event']?.type).toBe('string');
  });

  it('control: a plain struct element stays one object with its members', () => {
    const items = toolsItems(structItems);
    expect(items?.oneOf).toBeUndefined();
    expect(Object.keys(items?.properties ?? {})).toEqual(['label']);
  });
});
