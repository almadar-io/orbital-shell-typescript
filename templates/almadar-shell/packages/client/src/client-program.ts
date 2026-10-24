/**
 * The program the browser runs, fetched at boot from `/program.client.orb` (a static asset of the
 * client build): the resolved program without what no client code path reads.
 *
 * @packageDocumentation
 */

import type { OrbitalSchema } from '@almadar/core';

let loaded: Promise<OrbitalSchema> | undefined;

async function fetchProgram(): Promise<OrbitalSchema> {
  const response = await fetch(`${import.meta.env.BASE_URL}program.client.orb`);
  if (!response.ok) throw new Error(`program.client.orb: ${response.status}`);
  // The compile wrote it from the resolved program, and the kernel validates the program it opens.
  const program: OrbitalSchema = await response.json();
  return program;
}

export function loadProgram(): Promise<OrbitalSchema> {
  loaded ??= fetchProgram().catch((error: Error) => {
    loaded = undefined;
    throw error;
  });
  return loaded;
}
