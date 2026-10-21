/** What `keepDynamicImportsLazy` reads of Rollup's module graph. */
export interface BundlingModuleInfo {
  isEntry: boolean;
  /** Static importers only (Rollup lists dynamic ones separately). */
  importers: readonly string[];
}

export interface BundlingChunkMeta {
  getModuleInfo(id: string): BundlingModuleInfo | null;
}

/**
 * Wraps an app's `manualChunks` rule: a module goes to the named chunk only when an entry reaches
 * it through static imports, so @almadar/ui's lazily imported families stay lazy.
 */
export declare function keepDynamicImportsLazy(
  assign: (id: string) => string | null | undefined,
): (id: string, meta: BundlingChunkMeta) => string | null | undefined;
