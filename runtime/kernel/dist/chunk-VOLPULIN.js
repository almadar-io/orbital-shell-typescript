import { OrbitalSchemaSchema } from '@almadar/core';

// src/loader/http-loader.ts
function isAbsoluteUrl(base) {
  return /^[a-z][a-z0-9+.-]*:/i.test(base);
}
var HttpImportChain = class _HttpImportChain {
  chain = [];
  /**
   * Try to add a path to the chain.
   * @returns Error message if circular, null if OK
   */
  push(absolutePath) {
    if (this.chain.includes(absolutePath)) {
      const cycle = [
        ...this.chain.slice(this.chain.indexOf(absolutePath)),
        absolutePath
      ];
      return `Circular import detected: ${cycle.join(" -> ")}`;
    }
    this.chain.push(absolutePath);
    return null;
  }
  /**
   * Remove the last path from the chain.
   */
  pop() {
    this.chain.pop();
  }
  /**
   * Clone the chain for nested loading.
   */
  clone() {
    const newChain = new _HttpImportChain();
    newChain.chain = [...this.chain];
    return newChain;
  }
};
var HttpLoaderCache = class {
  cache = /* @__PURE__ */ new Map();
  get(url) {
    return this.cache.get(url);
  }
  set(url, schema) {
    this.cache.set(url, schema);
  }
  has(url) {
    return this.cache.has(url);
  }
  clear() {
    this.cache.clear();
  }
  get size() {
    return this.cache.size;
  }
};
var HttpLoader = class {
  options;
  cache;
  constructor(options) {
    this.options = {
      basePath: options.basePath,
      stdLibPath: options.stdLibPath ?? "",
      scopedPaths: options.scopedPaths ?? {},
      fetchOptions: options.fetchOptions,
      timeout: options.timeout ?? 3e4,
      credentials: options.credentials ?? "same-origin"
    };
    this.cache = new HttpLoaderCache();
  }
  /**
   * Load a schema from an import path.
   */
  async load(importPath, fromPath, chain) {
    const importChain = chain ?? new HttpImportChain();
    const resolveResult = this.resolvePath(importPath, fromPath);
    if (!resolveResult.success) {
      return resolveResult;
    }
    const absoluteUrl = resolveResult.data;
    const circularError = importChain.push(absoluteUrl);
    if (circularError) {
      return { success: false, error: circularError };
    }
    try {
      const cached = this.cache.get(absoluteUrl);
      if (cached) {
        return { success: true, data: cached };
      }
      const loadResult = await this.fetchSchema(absoluteUrl);
      if (!loadResult.success) {
        return loadResult;
      }
      const loaded = {
        schema: loadResult.data,
        sourcePath: absoluteUrl,
        importPath
      };
      this.cache.set(absoluteUrl, loaded);
      return { success: true, data: loaded };
    } finally {
      importChain.pop();
    }
  }
  /**
   * Load a specific orbital from a schema by name.
   */
  async loadOrbital(importPath, orbitalName, fromPath, chain) {
    const schemaResult = await this.load(importPath, fromPath, chain);
    if (!schemaResult.success) {
      return schemaResult;
    }
    const schema = schemaResult.data.schema;
    let orbital;
    if (orbitalName) {
      const found = schema.orbitals.find(
        (o) => o.name === orbitalName
      );
      if (!found) {
        return {
          success: false,
          error: `Orbital "${orbitalName}" not found in ${importPath}. Available: ${schema.orbitals.map((o) => o.name).join(", ")}`
        };
      }
      orbital = found;
    } else {
      if (schema.orbitals.length === 0) {
        return {
          success: false,
          error: `No orbitals found in ${importPath}`
        };
      }
      orbital = schema.orbitals[0];
    }
    return {
      success: true,
      data: {
        orbital,
        orbitals: schema.orbitals,
        ...schema.config ? { schemaConfig: schema.config } : {},
        sourcePath: schemaResult.data.sourcePath,
        importPath
      }
    };
  }
  /**
   * Resolve an import path to an absolute URL.
   */
  resolvePath(importPath, fromPath) {
    if (importPath.startsWith("http://") || importPath.startsWith("https://")) {
      return { success: true, data: importPath };
    }
    if (importPath.startsWith("std/")) {
      return this.resolveStdPath(importPath);
    }
    if (importPath.startsWith("@")) {
      return this.resolveScopedPath(importPath);
    }
    if (importPath.startsWith("./") || importPath.startsWith("../")) {
      return this.resolveRelativePath(importPath, fromPath);
    }
    return this.resolveRelativePath(`./${importPath}`, fromPath);
  }
  /**
   * Resolve a standard library path.
   */
  resolveStdPath(importPath) {
    if (!this.options.stdLibPath) {
      return {
        success: false,
        error: `Standard library URL not configured. Cannot load: ${importPath}`
      };
    }
    const relativePath = importPath.slice(4);
    let absoluteUrl = this.joinUrl(this.options.stdLibPath, relativePath);
    if (!absoluteUrl.endsWith(".orb")) {
      absoluteUrl += ".orb";
    }
    return { success: true, data: absoluteUrl };
  }
  /**
   * Resolve a scoped package path.
   */
  resolveScopedPath(importPath) {
    const match = importPath.match(/^(@[^/]+)/);
    if (!match) {
      return {
        success: false,
        error: `Invalid scoped package path: ${importPath}`
      };
    }
    const scope = match[1];
    const scopeRoot = this.options.scopedPaths[scope];
    if (!scopeRoot) {
      return {
        success: false,
        error: `Scoped package "${scope}" not configured. Available: ${Object.keys(this.options.scopedPaths).join(", ") || "none"}`
      };
    }
    const relativePath = importPath.slice(scope.length + 1);
    let absoluteUrl = this.joinUrl(scopeRoot, relativePath);
    if (!absoluteUrl.endsWith(".orb")) {
      absoluteUrl += ".orb";
    }
    return { success: true, data: absoluteUrl };
  }
  /**
   * Resolve a relative path.
   */
  resolveRelativePath(importPath, fromPath) {
    const baseUrl = fromPath ? this.getParentUrl(fromPath) : this.options.basePath;
    let absoluteUrl = this.joinUrl(baseUrl, importPath);
    if (!absoluteUrl.endsWith(".orb")) {
      absoluteUrl += ".orb";
    }
    return { success: true, data: absoluteUrl };
  }
  /**
   * Fetch and parse an OrbitalSchema from a URL.
   */
  async fetchSchema(url) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.options.timeout
      );
      try {
        const response = await fetch(url, {
          ...this.options.fetchOptions,
          credentials: this.options.credentials,
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            ...this.options.fetchOptions?.headers
          }
        });
        if (!response.ok) {
          return {
            success: false,
            error: `HTTP ${response.status}: ${response.statusText} for ${url}`
          };
        }
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          return {
            success: false,
            error: `Invalid JSON in ${url}: ${e instanceof Error ? e.message : String(e)}`
          };
        }
        const parseResult = OrbitalSchemaSchema.safeParse(data);
        if (!parseResult.success) {
          const errors = parseResult.error.errors.map((e) => `  - ${e.path.join(".")}: ${e.message}`).join("\n");
          return {
            success: false,
            error: `Invalid schema in ${url}:
${errors}`
          };
        }
        return { success: true, data: parseResult.data };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        return {
          success: false,
          error: `Request timeout for ${url} (${this.options.timeout}ms)`
        };
      }
      return {
        success: false,
        error: `Failed to fetch ${url}: ${e instanceof Error ? e.message : String(e)}`
      };
    }
  }
  /**
   * Join URL parts, handling relative paths and trailing slashes.
   */
  joinUrl(base, path) {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    if (isAbsoluteUrl(base)) return new URL(path, base.endsWith("/") ? base : base + "/").href;
    const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
    const normalizedPath = path.startsWith("/") ? path : "/" + path;
    if (normalizedPath.startsWith("/./")) {
      return normalizedBase + normalizedPath.slice(2);
    }
    if (normalizedPath.startsWith("/../")) {
      const baseParts = normalizedBase.split("/");
      baseParts.pop();
      return baseParts.join("/") + normalizedPath.slice(3);
    }
    return normalizedBase + normalizedPath;
  }
  /**
   * Get parent URL (directory) from a URL.
   */
  getParentUrl(url) {
    if (isAbsoluteUrl(url)) {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split("/");
      pathParts.pop();
      urlObj.pathname = pathParts.join("/");
      return urlObj.href;
    }
    const lastSlash = url.lastIndexOf("/");
    return lastSlash !== -1 ? url.slice(0, lastSlash) : url;
  }
  /**
   * Clear the cache.
   */
  clearCache() {
    this.cache.clear();
  }
  /**
   * Get cache statistics.
   */
  getCacheStats() {
    return { size: this.cache.size };
  }
};
function createHttpLoader(basePath, options) {
  return new HttpLoader({
    basePath,
    ...options
  });
}

export { HttpImportChain, HttpLoader, createHttpLoader };
