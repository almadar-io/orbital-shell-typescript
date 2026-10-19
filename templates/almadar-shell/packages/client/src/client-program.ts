/**
 * The program the browser runs, fetched at boot from `/program.client.json` (a static asset of the
 * client build): the resolved program without what no client code path reads.
 *
 * @packageDocumentation
 */

import { parseOrbitalSchema, type OrbitalSchema } from '@almadar/core';

let loaded: Promise<OrbitalSchema> | undefined;

async function fetchProgram(): Promise<OrbitalSchema> {
  const response = await fetch(`${import.meta.env.BASE_URL}program.client.json`);
  if (!response.ok) throw new Error(`program.client.json: ${response.status}`);
  return parseOrbitalSchema(await response.json());
}

export function loadProgram(): Promise<OrbitalSchema> {
  loaded ??= fetchProgram().catch((error: Error) => {
    loaded = undefined;
    throw error;
  });
  return loaded;
}
