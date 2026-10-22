/**
 * The mock answer to a `call-service`: one placeholder value per field of the action's
 * registry `responseShape`. Every host's mock mode answers through this one function
 * (the Rust twin is orbital-core `runtime::mock_answer`).
 */
import servicesRegistry from '../patterns/services-registry.json' with { type: 'json' };
import { z } from 'zod';

export type ServiceMockValue = string | number | boolean | ServiceMockValue[] | { [key: string]: ServiceMockValue };

/** A `responseShape` field: a flat type name, or a described one (`array` / `T[]` with `items`, `object` with `properties`, or a map with `mapValue`). */
export type ResponseShapeField =
  | string
  | { type: string; items?: ResponseShapeField; properties?: Record<string, ResponseShapeField>; mapValue?: ResponseShapeField };

const ResponseShapeFieldSchema: z.ZodType<ResponseShapeField> = z.lazy(() =>
  z.union([
    z.string(),
    z.object({
      type: z.string(),
      items: ResponseShapeFieldSchema.optional(),
      properties: z.record(ResponseShapeFieldSchema).optional(),
      mapValue: ResponseShapeFieldSchema.optional(),
    }),
  ]),
);

const RegistrySchema = z.object({
  services: z.record(
    z.object({
      actions: z.array(z.object({ name: z.string(), responseShape: z.record(ResponseShapeFieldSchema).optional() })),
    }),
  ),
});

const services = RegistrySchema.parse(servicesRegistry).services;

/** One mock value for a `responseShape` field, recursing into array items and object properties. */
export function mockValueForDescriptor(key: string, descriptor: ResponseShapeField): ServiceMockValue {
  if (typeof descriptor === 'string') {
    if (descriptor.endsWith('[]')) return [];
    switch (descriptor) {
      case 'string': return `mock_${key}`;
      case 'number': return 42;
      case 'boolean': return true;
      case 'object':
      case 'map': return {};
      default: return `mock_${key}`;
    }
  }
  if (descriptor.items === undefined && descriptor.properties === undefined && descriptor.mapValue === undefined) {
    return mockValueForDescriptor(key, descriptor.type);
  }
  if (descriptor.type === 'array' || descriptor.type.endsWith('[]')) {
    return descriptor.items ? [mockValueForDescriptor(`${key}Item`, descriptor.items)] : [];
  }
  if (descriptor.properties) {
    const obj: Record<string, ServiceMockValue> = {};
    for (const [propKey, propDescriptor] of Object.entries(descriptor.properties)) {
      obj[propKey] = mockValueForDescriptor(propKey, propDescriptor);
    }
    return obj;
  }
  if (descriptor.mapValue) {
    return { sample: mockValueForDescriptor('sample', descriptor.mapValue) };
  }
  return {};
}

/** The mock result of a whole `responseShape`. */
export function mockFromResponseShape(shape: Record<string, ResponseShapeField>): Record<string, ServiceMockValue> {
  const data: Record<string, ServiceMockValue> = {};
  for (const [key, descriptor] of Object.entries(shape)) data[key] = mockValueForDescriptor(key, descriptor);
  return data;
}

export type ServiceMockAnswer =
  | { ok: true; value: Record<string, ServiceMockValue> }
  | { ok: false; reason: 'unknown-service' | 'unknown-action'; message: string };

/** The mock answer for `service.action`: its registry shape mocked, or a generic success when it declares none. */
export function mockServiceAnswer(service: string, action: string): ServiceMockAnswer {
  const entry = services[service];
  if (entry === undefined) return { ok: false, reason: 'unknown-service', message: `Unknown service: ${service}` };
  const declared = entry.actions.find((a) => a.name === action);
  if (declared === undefined) return { ok: false, reason: 'unknown-action', message: `No mock response for action: ${action}` };
  const shape = declared.responseShape;
  if (shape !== undefined && Object.keys(shape).length > 0) return { ok: true, value: mockFromResponseShape(shape) };
  return { ok: true, value: { success: true, _mock: true, _action: action } };
}

/** Every service the registry declares. */
export function registryServiceNames(): string[] {
  return Object.keys(services);
}

/** The actions `service` declares, or none for an unknown service. */
export function registryActionNames(service: string): string[] {
  return services[service]?.actions.map((a) => a.name) ?? [];
}
