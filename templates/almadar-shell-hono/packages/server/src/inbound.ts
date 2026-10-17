/**
 * Inbound deliveries
 *
 * Checked-in stub so the template builds standalone in CI; the compiler overwrites it with the
 * program's inbound handlers (`/api/hooks/<name>`, EXEC-INBOUND-1).
 */

import { unknownHook, type InboundAnswer, type InboundDelivery } from '@almadar/core';

export async function deliverInbound(name: string, _delivery: InboundDelivery): Promise<InboundAnswer> {
  return unknownHook(name);
}
