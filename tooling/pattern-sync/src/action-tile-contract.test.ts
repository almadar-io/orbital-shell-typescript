import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PATTERNS_DIR } from './config.js';

type PatternRegistry = {
  patterns: Record<string, { propsSchema: Record<string, unknown> }>;
};

describe('ActionTile generated contract', () => {
  it('contains action presentation and drag props without entity-display state', () => {
    const registry = JSON.parse(
      readFileSync(join(PATTERNS_DIR, 'patterns-registry.json'), 'utf8'),
    ) as PatternRegistry;
    const props = registry.patterns['action-tile'].propsSchema;
    expect(Object.keys(props)).toEqual(expect.arrayContaining([
      'action', 'size', 'disabled', 'categoryColors', 'className',
    ]));
    for (const name of [
      'isLoading', 'error', 'sortBy', 'sortDirection', 'searchValue',
      'page', 'pageSize', 'totalCount', 'activeFilters', 'selectedIds',
    ]) {
      expect(props).not.toHaveProperty(name);
    }
  });
});
