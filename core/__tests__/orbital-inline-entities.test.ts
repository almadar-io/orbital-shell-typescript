import { describe, expect, it } from 'vitest';

import { orbitalInlineEntities } from '../src/access/entityAccess.js';
import type { OrbitalEntity } from '../src/types/entity.js';
import type { EntityField } from '../src/types/field.js';
import type { Orbital } from '../src/types/orbital.js';

const ID_FIELD: EntityField = { name: 'id', type: 'string', required: true };

const entity = (name: string, fields: EntityField[] = [ID_FIELD]): OrbitalEntity => ({ name, fields });

describe('orbitalInlineEntities', () => {
  it('returns just the primary entity when there are no auxiliaries', () => {
    const orbital: Orbital = { name: 'O', entity: entity('Primary'), traits: [], pages: [] };
    expect(orbitalInlineEntities(orbital).map((e) => e.name)).toEqual(['Primary']);
  });

  it('returns the primary entity plus every auxiliary — the shape a whole-orbital import surfaces (e.g. WebhookOrbital + WebhookOrbitalWebhookDelivery)', () => {
    const orbital: Orbital = {
      name: 'WebhookOrbital',
      entity: entity('WebhookEndpoint'),
      auxiliaryEntities: [entity('WebhookOrbitalWebhookDelivery'), entity('WebhookOrbitalAppLayoutData')],
      traits: [],
      pages: [],
    };
    expect(orbitalInlineEntities(orbital).map((e) => e.name)).toEqual([
      'WebhookEndpoint',
      'WebhookOrbitalWebhookDelivery',
      'WebhookOrbitalAppLayoutData',
    ]);
  });

  it('skips an unresolved string/EntityCall ref instead of throwing', () => {
    const orbital: Orbital = {
      name: 'O',
      entity: 'Gateway.orbitals.WebhookOrbital.entity',
      auxiliaryEntities: [entity('RealAux')],
      traits: [],
      pages: [],
    };
    expect(orbitalInlineEntities(orbital).map((e) => e.name)).toEqual(['RealAux']);
  });
});
