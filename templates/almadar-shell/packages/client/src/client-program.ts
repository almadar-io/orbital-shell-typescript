/**
 * The program the browser runs, fetched at boot from `/program.client.orb` (a static asset of the
 * client build): the resolved program without what no client code path reads.
 *
 * @packageDocumentation
 */

import type { OrbitalSchema } from '@almadar/core';
import { readDefsJson } from '@almadar/shell-runtime/kernel/blobs';

let loaded: Promise<OrbitalSchema> | undefined;

async function fetchProgram(): Promise<OrbitalSchema> {
  const response = await fetch(`${import.meta.env.BASE_URL}program.client.orb`);
  if (!response.ok) throw new Error(`program.client.orb: ${response.status}`);
  // The compile wrote it from the resolved program, each repeated part once; the kernel validates the program it opens.
  return readDefsJson<OrbitalSchema>(await response.text());
}

export function loadProgram(): Promise<OrbitalSchema> {
  loaded ??= fetchProgram().catch((error: Error) => {
    loaded = undefined;
    throw error;
  });
  return loaded;
}

/** The server's address: `VITE_API_URL` when the build sets it, else the program's `page http` origin, else '' (the page's own origin). */
export function serverBase(program: OrbitalSchema): string {
  return import.meta.env.VITE_API_URL ?? program._metadata?.serverOrigin ?? '';
}
