/**
 * An orbital's inline entity definitions. Access policies and the owner of an entity are the
 * kernel's (`KernelEngine.readRows`, `entityOwnerOrbital`).
 *
 * @packageDocumentation
 */

import type { OrbitalEntity } from '../types/entity.js';
import type { EntityRef, OrbitalDefinition } from '../types/orbital.js';

/**
 * One orbital's own inline entity definitions: its primary entity plus any
 * auxiliaries an import brought along (`auxiliaryEntities` — a linkedEntity
 * naming an imported atom's own entity resolves here, not among any
 * orbital's primary entity alone). Skips unresolved `string`/`EntityCall`
 * refs — those are pre-inline-phase forms that never reach this by the time
 * a schema is served.
 */
export function orbitalInlineEntities(orbital: OrbitalDefinition): OrbitalEntity[] {
  const out: OrbitalEntity[] = [];
  const refs: EntityRef[] = [orbital.entity, ...(orbital.auxiliaryEntities ?? [])];
  for (const ref of refs) {
    if (typeof ref === 'object' && ref !== null && 'fields' in ref) {
      out.push(ref as OrbitalEntity);
    }
  }
  return out;
}
