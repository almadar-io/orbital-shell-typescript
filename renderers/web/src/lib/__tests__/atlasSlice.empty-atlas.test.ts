/**
 * An empty `atlas` / `sprite` means "no atlas" — the whole image draws. The
 * Asset defaults across the game corpus author `atlas: ""`; treating that as
 * an atlas URL fetched "" and painted the fallback square for every tile.
 */
import { describe, it, expect } from 'vitest';
import { isAtlasAsset } from '../../core';

describe('isAtlasAsset', () => {
  it('is false for an empty atlas string', () => {
    expect(isAtlasAsset({ url: 'https://cdn.example/ground.png', atlas: '', sprite: '' })).toBe(false);
    expect(isAtlasAsset({ url: 'https://cdn.example/ground.png', atlas: '', sprite: 'x.png' })).toBe(false);
  });

  it('is false for an atlas with an empty sprite name', () => {
    expect(isAtlasAsset({ url: 'https://cdn.example/sheet.png', atlas: 'https://cdn.example/atlas.json', sprite: '' })).toBe(false);
  });

  it('control: an atlas + sprite pair slices', () => {
    expect(isAtlasAsset({ url: 'https://cdn.example/sheet.png', atlas: 'https://cdn.example/atlas.json', sprite: 'blockBrown.png' })).toBe(true);
  });

  it('is false with no asset or no atlas', () => {
    expect(isAtlasAsset(undefined)).toBe(false);
    expect(isAtlasAsset({ url: 'https://cdn.example/ground.png' })).toBe(false);
  });
});
