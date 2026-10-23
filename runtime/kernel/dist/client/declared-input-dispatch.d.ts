import { OrbitalSchema, ExternalInputRequest, OrbitalEventRequest, OrbitalEventResponse } from '@almadar/core';

declare function dispatchDeclaredInput(schema: OrbitalSchema | null | undefined, orbitalName: string, request: ExternalInputRequest, send: (orbitalName: string, request: OrbitalEventRequest) => Promise<OrbitalEventResponse>): Promise<OrbitalEventResponse>;

export { dispatchDeclaredInput };
