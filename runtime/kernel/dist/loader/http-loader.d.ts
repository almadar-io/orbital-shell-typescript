import { ImportChainLike, SchemaLoader, HttpLoaderOptions, LoadResult, LoadedSchema, LoadedOrbital } from './schema-loader.js';
import '@almadar/core';

/**
 * HTTP Schema Loader
 *
 * Loads OrbitalSchema files via HTTP/fetch for browser environments.
 * Also works in Node.js with the fetch API.
 *
 * @packageDocumentation
 */

declare class HttpImportChain implements ImportChainLike {
    private chain;
    /**
     * Try to add a path to the chain.
     * @returns Error message if circular, null if OK
     */
    push(absolutePath: string): string | null;
    /**
     * Remove the last path from the chain.
     */
    pop(): void;
    /**
     * Clone the chain for nested loading.
     */
    clone(): HttpImportChain;
}
/**
 * HttpLoader - Loads OrbitalSchema files via HTTP/fetch.
 *
 * Designed for browser environments where file system access is not available.
 * Uses the fetch API for loading schemas.
 *
 * Path Resolution:
 * - Relative paths: `./health.orb` -> base URL + path
 * - Standard library: `std/behaviors/game-core` -> std lib URL + path
 * - Scoped packages: `@scope/pkg.orb` -> scoped URL + path
 * - Absolute URLs: `https://...` -> used directly
 *
 * @example
 * ```typescript
 * const loader = new HttpLoader({
 *   basePath: "/api/schemas",
 *   stdLibPath: "https://cdn.example.com/orbital-std",
 * });
 *
 * // Load from relative path
 * const result = await loader.load("./my-schema.orb");
 *
 * // Load from std library
 * const stdResult = await loader.load("std/behaviors/game-core");
 * ```
 */
declare class HttpLoader implements SchemaLoader {
    private options;
    private cache;
    constructor(options: HttpLoaderOptions);
    /**
     * Load a schema from an import path.
     */
    load(importPath: string, fromPath?: string, chain?: ImportChainLike): Promise<LoadResult<LoadedSchema>>;
    /**
     * Load a specific orbital from a schema by name.
     */
    loadOrbital(importPath: string, orbitalName?: string, fromPath?: string, chain?: ImportChainLike): Promise<LoadResult<LoadedOrbital>>;
    /**
     * Resolve an import path to an absolute URL.
     */
    resolvePath(importPath: string, fromPath?: string): LoadResult<string>;
    /**
     * Resolve a standard library path.
     */
    private resolveStdPath;
    /**
     * Resolve a scoped package path.
     */
    private resolveScopedPath;
    /**
     * Resolve a relative path.
     */
    private resolveRelativePath;
    /**
     * Fetch and parse an OrbitalSchema from a URL.
     */
    private fetchSchema;
    /**
     * Join URL parts, handling relative paths and trailing slashes.
     */
    private joinUrl;
    /**
     * Get parent URL (directory) from a URL.
     */
    private getParentUrl;
    /**
     * Clear the cache.
     */
    clearCache(): void;
    /**
     * Get cache statistics.
     */
    getCacheStats(): {
        size: number;
    };
}
/**
 * Create an HTTP loader with sensible defaults.
 */
declare function createHttpLoader(basePath: string, options?: Partial<HttpLoaderOptions>): HttpLoader;

export { HttpImportChain, HttpLoader, createHttpLoader };
