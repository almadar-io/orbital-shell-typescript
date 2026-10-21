/**
 * Build-time helper for apps bundling @almadar/ui. The ui loads heavy families lazily (mermaid
 * and what it pulls, leaflet, …) through dynamic import(); an app's catch-all `manualChunks`
 * would move them into its eagerly loaded vendor chunk. Wrap it: a module goes to the named
 * chunk only when an entry reaches it through static imports.
 */
export function keepDynamicImportsLazy(assign) {
  const memo = new WeakMap();
  return (id, meta) => {
    const name = assign(id);
    if (!name) return name;
    let known = memo.get(meta.getModuleInfo);
    if (!known) {
      known = new Map();
      memo.set(meta.getModuleInfo, known);
    }
    return staticallyReachable(id, meta.getModuleInfo, known) ? name : undefined;
  };
}

function staticallyReachable(id, getModuleInfo, known) {
  if (known.has(id)) return known.get(id);
  known.set(id, false); // in progress: a cycle does not reach an entry by itself
  const info = getModuleInfo(id);
  const reachable = info === null || info.isEntry || info.importers.some((importer) => staticallyReachable(importer, getModuleInfo, known));
  known.set(id, reachable);
  return reachable;
}
