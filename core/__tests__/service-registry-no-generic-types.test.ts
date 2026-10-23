import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import servicesRegistry from '../src/patterns/services-registry.json' with { type: 'json' };

interface Node {
  type?: string;
  properties?: Record<string, Node>;
  items?: Node;
  mapValue?: Node;
  cyclic?: boolean;
}
interface Action {
  name: string;
  params: Array<Node & { name: string }>;
  responseShape: Record<string, string | Node>;
}

const NodeSchema: z.ZodType<Node> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    properties: z.record(z.string(), NodeSchema).optional(),
    items: NodeSchema.optional(),
    mapValue: NodeSchema.optional(),
    cyclic: z.boolean().optional(),
  }),
);
const ActionsSchema: z.ZodType<Action[]> = z.array(
  z.object({
    name: z.string(),
    params: z.array(NodeSchema.and(z.object({ name: z.string() }))),
    responseShape: z.record(z.string(), z.union([z.string(), NodeSchema])),
  }),
);

const GENERIC = ['object', 'array', 'any', 'unknown', 'json', 'Json'];

/** The positions that declare a generic type: a bare `object`/`array`/`any`/`unknown`/`json` with no shape. */
function generic(actions: Action[], where: string): string[] {
  const found: string[] = [];
  const visit = (node: Node, path: string): void => {
    const shaped =
      (node.properties !== undefined && Object.keys(node.properties).length > 0) ||
      node.items !== undefined ||
      node.mapValue !== undefined ||
      node.cyclic === true;
    for (const arm of (node.type ?? '').split('|')) {
      if (GENERIC.includes(arm.trim().replace(/(\[\])+$/, '')) && !shaped) found.push(`${path}: ${node.type}`);
    }
    for (const [name, child] of Object.entries(node.properties ?? {})) visit(child, `${path}.${name}`);
    if (node.items) visit(node.items, `${path}[]`);
    if (node.mapValue) visit(node.mapValue, `${path}{}`);
  };
  for (const action of actions) {
    for (const param of action.params) visit(param, `${where}.${action.name}(${param.name})`);
    for (const [field, shape] of Object.entries(action.responseShape)) {
      visit(typeof shape === 'string' ? { type: shape } : shape, `${where}.${action.name} -> ${field}`);
    }
  }
  return found;
}

describe('the service contracts declare no generic type', () => {
  it('services-registry.json', () => {
    const found = Object.values(servicesRegistry.services).flatMap((s) => generic(ActionsSchema.parse(s.actions), s.name));
    expect(found).toEqual([]);
  });

  it('control: the gate finds a bare object and accepts a shaped one', () => {
    const bare: Action[] = [{ name: 'a', params: [{ name: 'x', type: 'object' }], responseShape: {} }];
    expect(generic(bare, 's')).toEqual(['s.a(x): object']);
    const shaped: Action[] = [{ name: 'a', params: [{ name: 'x', type: 'map', mapValue: { type: 'string' } }], responseShape: {} }];
    expect(generic(shaped, 's')).toEqual([]);
  });
});
