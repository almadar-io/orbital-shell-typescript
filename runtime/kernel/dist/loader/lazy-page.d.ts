import { LazyPage, OrbitalSchema } from '@almadar/core';
import { SchemaLoader, LoadResult } from './schema-loader.js';

/**
 * `uses lazy`: the behavior behind a lazy page lives in its own `.orb`, at the
 * page's `orbRef` relative to the importer's `.orb`, and is loaded when the
 * page is opened.
 */

declare function loadLazyPage(loader: SchemaLoader, page: LazyPage, importerPath?: string): Promise<LoadResult<OrbitalSchema>>;

export { loadLazyPage };
