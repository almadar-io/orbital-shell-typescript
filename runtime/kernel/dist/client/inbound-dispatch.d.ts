import { OrbitalSchema, InboundDelivery, OrbitalEventRequest, OrbitalEventResponse, InboundAnswer } from '@almadar/core';

declare function dispatchInbound(schema: OrbitalSchema | null | undefined, name: string, delivery: InboundDelivery, send: (orbitalName: string, request: OrbitalEventRequest) => Promise<OrbitalEventResponse>, credential: (name: string) => Promise<string | null | undefined>): Promise<InboundAnswer>;

export { dispatchInbound };
