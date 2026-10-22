/**
 * Sheet convergence (owner-approved) + the kflow-assets manifest adapter:
 * `SPRITE_SHEET_LAYOUT`/`DEFAULT_UNIT_ANIMATION_ROWS`/`defaultUnitAtlas`,
 * `ManifestEntry`/`ManifestEntrySchema`, `manifestToAssetCatalog`, and the
 * `t:`/`l:`/free-text query grammar (`parseAssetQuery`/`matchAssetQuery`).
 */

import { describe, it, expect } from 'vitest';
import {
  SPRITE_SHEET_LAYOUT,
  DEFAULT_UNIT_ANIMATION_ROWS,
  defaultUnitAtlas,
  SpriteSheetAtlasSchema,
  ManifestEntrySchema,
  manifestToAssetCatalog,
  parseAssetQuery,
  matchAssetQuery,
  type ManifestEntry,
  type AssetCatalogEntry,
} from '../index';

describe('SPRITE_SHEET_LAYOUT / DEFAULT_UNIT_ANIMATION_ROWS', () => {
  it('matches spritesheet-bake.ts SPRITE_LAYOUT geometry', () => {
    expect(SPRITE_SHEET_LAYOUT).toEqual({
      frameWidth: 256,
      frameHeight: 256,
      columns: 8,
      rows: 5,
      background: '#20202E',
    });
  });

  it('matches spritesheet-bake.ts SPRITE_LAYOUT animation table', () => {
    expect(DEFAULT_UNIT_ANIMATION_ROWS).toEqual([
      { name: 'idle', row: 0, frames: 4, loop: true, frameRate: 6 },
      { name: 'walk', row: 1, frames: 8, loop: true, frameRate: 10 },
      { name: 'attack', row: 2, frames: 6, loop: false, frameRate: 12 },
      { name: 'hit', row: 3, frames: 3, loop: false, frameRate: 8 },
      { name: 'death', row: 4, frames: 6, loop: false, frameRate: 8 },
    ]);
  });
});

describe('defaultUnitAtlas', () => {
  it('builds a SpriteSheetAtlas-shaped atlas from the canonical layout', () => {
    const atlas = defaultUnitAtlas({ se: 'se.png', sw: 'sw.png' });
    expect(SpriteSheetAtlasSchema.safeParse(atlas).success).toBe(true);
    expect(atlas.frameWidth).toBe(256);
    expect(atlas.frameHeight).toBe(256);
    expect(atlas.columns).toBe(8);
    expect(atlas.rows).toBe(5);
    expect(atlas.directions).toEqual(['se', 'sw']);
    expect(atlas.animations.idle).toEqual({ row: 0, frames: 4, loop: true, frameRate: 6 });
    expect(atlas.animations.death).toEqual({ row: 4, frames: 6, loop: false, frameRate: 8 });
  });

  it('honors an explicit directions override', () => {
    const atlas = defaultUnitAtlas({ se: 'se.png', sw: 'sw.png', ne: 'ne.png', nw: 'nw.png' }, { directions: ['se'] });
    expect(atlas.directions).toEqual(['se']);
    expect(SpriteSheetAtlasSchema.safeParse(atlas).success).toBe(true);
  });
});

describe('ManifestEntrySchema', () => {
  // Copied verbatim from almadar-assets/kflow-assets/manifest.json.
  const realRow = {
    url: 'https://almadar-kflow-assets.web.app/shared/terrains/tiles-iso-medieval/kflow/iso/blocks/Preview.png',
    name: 'Preview',
    category: 'isometric-blocks',
    kind: 'image',
    width: 918,
    height: 515,
    canvasAffinity: 'isometric',
    genreAffinity: ['terrain'],
    swapClass: 'tiles-iso-medieval',
    sourceCatalog: 'kflow-assets',
    frameSpec: null,
  };

  it('accepts a real manifest row', () => {
    const result = ManifestEntrySchema.safeParse(realRow);
    expect(result.success).toBe(true);
  });

  it('rejects a bad canvasAffinity', () => {
    const result = ManifestEntrySchema.safeParse({ ...realRow, canvasAffinity: 'diagonal' });
    expect(result.success).toBe(false);
  });
});

describe('manifestToAssetCatalog', () => {
  const base: Omit<ManifestEntry, 'url' | 'name' | 'category' | 'kind' | 'width' | 'height' | 'canvasAffinity' | 'frameSpec'> = {
    genreAffinity: [],
    swapClass: 'x',
    sourceCatalog: 'kflow-assets',
  };

  it('maps a sprite-sheet row to spritesheet + 2d + 1:1', () => {
    const entry: ManifestEntry = {
      ...base,
      url: 'https://cdn.example/sheet.png',
      name: 'sheet',
      category: 'units',
      kind: 'spritesheet',
      width: 256,
      height: 256,
      canvasAffinity: 'flat',
      frameSpec: { kind: 'sprite-sheet', frame: 256, cols: 8, rows: 5 },
    };
    const [catalogEntry] = manifestToAssetCatalog([entry]);
    expect(catalogEntry.kind).toBe('spritesheet');
    expect(catalogEntry.dimension).toBe('2d');
    expect(catalogEntry.aspect).toBe('1:1');
    expect(catalogEntry.thumbnailUrl).toBe(entry.url);
  });

  it('maps a .glb row to model + 3d', () => {
    const entry: ManifestEntry = {
      ...base,
      url: 'https://cdn.example/bridge.glb',
      name: 'bridge',
      category: 'terrain',
      kind: 'model',
      width: -1,
      height: -1,
      canvasAffinity: '3d',
      frameSpec: null,
    };
    const [catalogEntry] = manifestToAssetCatalog([entry]);
    expect(catalogEntry.kind).toBe('model');
    expect(catalogEntry.dimension).toBe('3d');
    expect(catalogEntry.aspect).toBeUndefined();
    expect(catalogEntry.thumbnailUrl).toBeUndefined();
  });

  it('maps an .ogg row to audio', () => {
    const entry: ManifestEntry = {
      ...base,
      url: 'https://cdn.example/alpha-dance.ogg',
      name: 'alpha-dance',
      category: 'audio',
      kind: 'audio',
      width: -1,
      height: -1,
      canvasAffinity: 'none',
      frameSpec: null,
    };
    const [catalogEntry] = manifestToAssetCatalog([entry]);
    expect(catalogEntry.kind).toBe('audio');
  });

  it('maps a 16:9 row to aspect 16:9', () => {
    const entry: ManifestEntry = {
      ...base,
      url: 'https://cdn.example/backdrop.png',
      name: 'backdrop',
      category: 'backdrops',
      kind: 'image',
      width: 1920,
      height: 1080,
      canvasAffinity: 'none',
      frameSpec: null,
    };
    const [catalogEntry] = manifestToAssetCatalog([entry]);
    expect(catalogEntry.aspect).toBe('16:9');
  });

  it('omits aspect for a -1x-1 row', () => {
    const entry: ManifestEntry = {
      ...base,
      url: 'https://cdn.example/alpha-dance.ogg',
      name: 'alpha-dance',
      category: 'audio',
      kind: 'audio',
      width: -1,
      height: -1,
      canvasAffinity: 'none',
      frameSpec: null,
    };
    const [catalogEntry] = manifestToAssetCatalog([entry]);
    expect(catalogEntry.aspect).toBeUndefined();
  });

  it('prefixes a relative url with cdnPrefix and leaves an absolute url untouched', () => {
    const entry: ManifestEntry = {
      ...base,
      url: 'shared/units/x.png',
      name: 'x',
      category: 'units',
      kind: 'image',
      width: 64,
      height: 64,
      canvasAffinity: 'flat',
      frameSpec: null,
    };
    const [relative] = manifestToAssetCatalog([entry], { cdnPrefix: 'https://cdn.example/' });
    expect(relative.url).toBe('https://cdn.example/shared/units/x.png');

    const absoluteEntry: ManifestEntry = { ...entry, url: 'https://already-absolute.example/x.png' };
    const [absolute] = manifestToAssetCatalog([absoluteEntry], { cdnPrefix: 'https://cdn.example/' });
    expect(absolute.url).toBe('https://already-absolute.example/x.png');
  });
});

describe('parseAssetQuery', () => {
  it('parses t:/l:/free-text into kind + labels + text', () => {
    expect(parseAssetQuery('t:spritesheet l:units riya')).toEqual({
      kind: 'spritesheet',
      labels: ['units'],
      text: 'riya',
    });
  });

  it('omits kind for an unrecognized t: value', () => {
    expect(parseAssetQuery('t:not-a-kind riya')).toEqual({ labels: [], text: 'riya' });
  });

  it('parses free text alone', () => {
    expect(parseAssetQuery('guardian sprite')).toEqual({ labels: [], text: 'guardian sprite' });
  });
});

describe('matchAssetQuery', () => {
  const entry: AssetCatalogEntry = {
    url: 'https://cdn.example/riya-sprite-sheet.png',
    name: 'riya-sprite-sheet',
    category: 'units',
    kind: 'spritesheet',
  };

  it('matches on kind + label + case-insensitive text', () => {
    expect(matchAssetQuery(entry, 't:spritesheet l:units RIYA')).toBe(true);
  });

  it('fails on a mismatched kind', () => {
    expect(matchAssetQuery(entry, 't:audio')).toBe(false);
  });

  it('matches nothing on an unrecognized t: value', () => {
    expect(matchAssetQuery(entry, 't:not-a-kind')).toBe(false);
  });

  it('fails on a mismatched label', () => {
    expect(matchAssetQuery(entry, 'l:props')).toBe(false);
  });

  it('fails when the free text is not a substring of name/category', () => {
    expect(matchAssetQuery(entry, 'guardian')).toBe(false);
  });
});
