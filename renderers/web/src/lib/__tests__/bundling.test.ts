/**
 * @almadar/ui loads heavy families lazily (mermaid and what it pulls: cytoscape, katex, elk;
 * leaflet) through dynamic import(). An app's catch-all `vendor` chunk moved them into the
 * eagerly loaded bundle anyway (the prototype: 18% of a 14.3 MB vendor chunk). A module only
 * reachable through a dynamic import stays out of named chunks.
 */
import { describe, it, expect } from 'vitest';
import { keepDynamicImportsLazy } from '../../../bundling.mjs';

type Graph = Record<string, { isEntry?: boolean; importers?: string[] }>;
const meta = (graph: Graph) => ({
  getModuleInfo: (id: string) => (graph[id] ? { isEntry: graph[id].isEntry ?? false, importers: graph[id].importers ?? [] } : null),
});
const vendor = (id: string) => (id.includes('node_modules') ? 'vendor' : undefined);

describe('keepDynamicImportsLazy', () => {
  const graph: Graph = {
    'src/main.tsx': { isEntry: true },
    'node_modules/@almadar/ui/index.js': { importers: ['src/main.tsx'] },
    'node_modules/react/index.js': { importers: ['src/main.tsx', 'node_modules/@almadar/ui/index.js'] },
    // Only ever reached through `import('mermaid')` in the ui: no static importer.
    'node_modules/mermaid/index.js': { importers: [] },
    'node_modules/cytoscape/index.js': { importers: ['node_modules/mermaid/index.js'] },
    // Imported both ways: statically by the ui, dynamically elsewhere.
    'node_modules/lodash-es/index.js': { importers: ['node_modules/@almadar/ui/index.js', 'node_modules/mermaid/index.js'] },
  };
  const chunk = keepDynamicImportsLazy(vendor);

  it('a library reached only through a dynamic import (and what it imports) stays lazy', () => {
    expect(chunk('node_modules/mermaid/index.js', meta(graph))).toBeUndefined();
    expect(chunk('node_modules/cytoscape/index.js', meta(graph))).toBeUndefined();
  });

  it('control: statically imported libraries still go to the named chunk', () => {
    expect(chunk('node_modules/@almadar/ui/index.js', meta(graph))).toBe('vendor');
    expect(chunk('node_modules/react/index.js', meta(graph))).toBe('vendor');
  });

  it('edge: a library imported both ways is eager; the app\'s own code stays unassigned; a cycle ends', () => {
    expect(chunk('node_modules/lodash-es/index.js', meta(graph))).toBe('vendor');
    expect(chunk('src/main.tsx', meta(graph))).toBeUndefined();
    const cyclic: Graph = { 'node_modules/a.js': { importers: ['node_modules/b.js'] }, 'node_modules/b.js': { importers: ['node_modules/a.js'] } };
    expect(chunk('node_modules/a.js', meta(cyclic))).toBeUndefined();
  });
});
