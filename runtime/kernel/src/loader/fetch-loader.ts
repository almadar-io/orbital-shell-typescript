/**
 * A `SchemaLoader` over HTTP: a browser client fetches the `.orb` of a lazy page (`uses lazy`) from beside the program
 * it booted, at the page's `orbRef` resolved against the importer's URL (EXEC-LOAD-2: a browser client opens lazy pages
 * through its own loader).
 *
 * @packageDocumentation
 */

import type { OrbitalSchema } from "@almadar/core";
import type { LoadResult, LoadedOrbital, LoadedSchema, SchemaLoader } from "./schema-loader.js";

export class FetchSchemaLoader implements SchemaLoader {
  private readonly cache = new Map<string, Promise<LoadResult<LoadedSchema>>>();

  /** `base`: the URL relative imports resolve against when no importer is named (the page's own URL by default). */
  constructor(private readonly base: string) {}

  resolvePath(importPath: string, fromPath?: string): LoadResult<string> {
    try {
      return { success: true, data: new URL(importPath, new URL(fromPath ?? this.base, this.base)).href };
    } catch (error) {
      return { success: false, error: `Cannot resolve ${importPath}${fromPath !== undefined ? ` from ${fromPath}` : ""}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  load(importPath: string, fromPath?: string): Promise<LoadResult<LoadedSchema>> {
    const resolved = this.resolvePath(importPath, fromPath);
    if (!resolved.success) return Promise.resolve(resolved);
    const url = resolved.data;
    const held = this.cache.get(url);
    if (held !== undefined) return held;
    const loading = fetchSchema(url, importPath);
    // A failed fetch is not kept: the next open asks again.
    loading.then((result) => { if (!result.success) this.cache.delete(url); }, () => this.cache.delete(url));
    this.cache.set(url, loading);
    return loading;
  }

  async loadOrbital(importPath: string, orbitalName?: string, fromPath?: string): Promise<LoadResult<LoadedOrbital>> {
    const loaded = await this.load(importPath, fromPath);
    if (!loaded.success) return loaded;
    const { schema, sourcePath } = loaded.data;
    const orbital = orbitalName === undefined ? schema.orbitals[0] : schema.orbitals.find((o) => o.name === orbitalName);
    if (orbital === undefined) {
      return { success: false, error: `${sourcePath} has no orbital ${orbitalName ?? "(none)"}; found: ${schema.orbitals.map((o) => o.name).join(", ")}` };
    }
    return { success: true, data: { orbital, orbitals: schema.orbitals, sourcePath, importPath } };
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheStats(): { size: number } {
    return { size: this.cache.size };
  }
}

async function fetchSchema(url: string, importPath: string): Promise<LoadResult<LoadedSchema>> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    return { success: false, error: `${url}: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!response.ok) return { success: false, error: `${url}: ${response.status} ${response.statusText}` };
  try {
    // The compile wrote it from the resolved program, and the kernel validates the program it opens.
    const schema: OrbitalSchema = await response.json();
    return { success: true, data: { schema, sourcePath: url, importPath } };
  } catch (error) {
    return { success: false, error: `${url} is not a program: ${error instanceof Error ? error.message : String(error)}` };
  }
}
