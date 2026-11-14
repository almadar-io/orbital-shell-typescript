/**
 * A `SchemaLoader` over the lazy programs a program value carries (`lazyPrograms`, keyed by the file its lazy page
 * names): a split guest's viewer opens lazy pages from what `program/open` handed it, with no file beside it to fetch.
 *
 * @packageDocumentation
 */

import type { OrbitalSchema } from "@almadar/core";
import type { LoadResult, LoadedOrbital, LoadedSchema, SchemaLoader } from "./schema-loader.js";

export class CarriedLoader implements SchemaLoader {
  constructor(private readonly programs: Readonly<Record<string, OrbitalSchema>>) {}

  /** `importPath` joined to the folder of `fromPath`, as the kernel joins a nested lazy child's file. */
  resolvePath(importPath: string, fromPath?: string): LoadResult<string> {
    const slash = fromPath?.lastIndexOf("/") ?? -1;
    return { success: true, data: fromPath !== undefined && slash >= 0 ? `${fromPath.slice(0, slash)}/${importPath}` : importPath };
  }

  load(importPath: string, fromPath?: string): Promise<LoadResult<LoadedSchema>> {
    const resolved = this.resolvePath(importPath, fromPath);
    if (!resolved.success) return Promise.resolve(resolved);
    const file = resolved.data;
    const schema = this.programs[file];
    return Promise.resolve(
      schema === undefined
        ? { success: false, error: `The program carries no lazy program ${file}` }
        : { success: true, data: { schema, sourcePath: file, importPath } },
    );
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

  clearCache(): void {}

  getCacheStats(): { size: number } {
    return { size: Object.keys(this.programs).length };
  }
}
