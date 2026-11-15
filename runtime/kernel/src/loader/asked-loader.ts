/**
 * A `SchemaLoader` that asks for each lazy program when a route first needs it: a split guest's viewer opens a lazy page
 * by asking its guest for that page's client program by file (`program/lazy`, EXEC-LOAD-2), and the answer arrives later
 * through `answer`.
 *
 * @packageDocumentation
 */

import type { OrbitalSchema } from "@almadar/core";
import type { LoadResult, LoadedOrbital, LoadedSchema, SchemaLoader } from "./schema-loader.js";

/** One answered ask: the file and its client program, or why the guest refused it. */
export interface LazyAnswer {
  file: string;
  program?: OrbitalSchema;
  error?: string;
}

export class AskedLoader implements SchemaLoader {
  private readonly loaded = new Map<string, OrbitalSchema>();
  private readonly waiting = new Map<string, Array<(answer: LazyAnswer) => void>>();

  constructor(private readonly ask: (file: string) => void) {}

  /** `importPath` joined to the folder of `fromPath`, as the kernel joins a nested lazy child's file. */
  resolvePath(importPath: string, fromPath?: string): LoadResult<string> {
    const slash = fromPath?.lastIndexOf("/") ?? -1;
    return { success: true, data: fromPath !== undefined && slash >= 0 ? `${fromPath.slice(0, slash)}/${importPath}` : importPath };
  }

  async load(importPath: string, fromPath?: string): Promise<LoadResult<LoadedSchema>> {
    const resolved = this.resolvePath(importPath, fromPath);
    if (!resolved.success) return resolved;
    const file = resolved.data;
    const held = this.loaded.get(file);
    const answer: LazyAnswer = held !== undefined ? { file, program: held } : await this.asked(file);
    return answer.program === undefined
      ? { success: false, error: answer.error ?? `The guest answered no program for ${file}` }
      : { success: true, data: { schema: answer.program, sourcePath: file, importPath } };
  }

  /** Settle every load waiting on `answer.file`; false when none was. */
  answer(answer: LazyAnswer): boolean {
    const waiters = this.waiting.get(answer.file);
    if (waiters === undefined) return false;
    this.waiting.delete(answer.file);
    if (answer.program !== undefined) this.loaded.set(answer.file, answer.program);
    waiters.forEach((settle) => settle(answer));
    return true;
  }

  private asked(file: string): Promise<LazyAnswer> {
    return new Promise((settle) => {
      const waiters = this.waiting.get(file);
      if (waiters !== undefined) {
        waiters.push(settle);
        return;
      }
      this.waiting.set(file, [settle]);
      this.ask(file);
    });
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
    this.loaded.clear();
  }

  getCacheStats(): { size: number } {
    return { size: this.loaded.size };
  }
}
