/**
 * Render-time binding marker contract — the IR vocabulary for "evaluate
 * this prop leaf at render, not at flush" (`$renderBinding`). Pins the
 * marker shape, the guard, and the entity/payload containment walks that
 * the deferring executor (`@almadar/runtime`'s `deferEntityBindings`)
 * decides on. Token boundaries matter: `@entityId` must NOT classify as
 * an `@entity` reference.
 */

import { describe, it, expect } from 'vitest';
import {
  RENDER_BINDING_MARKER,
  isRenderBindingMarker,
  containsEntityBinding,
  containsPayloadBinding,
  type RenderBindingMarker,
} from '../src/types/bindings.js';

describe('isRenderBindingMarker', () => {
  it('accepts a well-formed marker', () => {
    const marker: RenderBindingMarker = { [RENDER_BINDING_MARKER]: true, expression: '@entity.hp' };
    expect(isRenderBindingMarker(marker)).toBe(true);
  });

  it('rejects non-markers', () => {
    expect(isRenderBindingMarker('@entity.hp')).toBe(false);
    expect(isRenderBindingMarker({ $renderBinding: false })).toBe(false);
    expect(isRenderBindingMarker({ expression: '@entity.hp' })).toBe(false);
    expect(isRenderBindingMarker(['$renderBinding', true])).toBe(false);
    expect(isRenderBindingMarker(null)).toBe(false);
    expect(isRenderBindingMarker(new Date())).toBe(false);
  });
});

describe('containsEntityBinding', () => {
  it('detects pure, embedded, nested, and object-tree references', () => {
    expect(containsEntityBinding('@entity.hp')).toBe(true);
    expect(containsEntityBinding('HP: @entity.hp / @entity.maxHp')).toBe(true);
    expect(containsEntityBinding(['+', '@entity.x', 1])).toBe(true);
    expect(containsEntityBinding({ drawables: ['array/map', '@entity.tiles', ['fn', 't', {}]] })).toBe(true);
    expect(containsEntityBinding('@entity.tiles[0].x')).toBe(true);
  });

  it('treats markers as entity-referencing by construction', () => {
    const marker: RenderBindingMarker = { [RENDER_BINDING_MARKER]: true, expression: 'anything' };
    expect(containsEntityBinding(marker)).toBe(true);
  });

  it('rejects non-entity values and near-miss tokens', () => {
    expect(containsEntityBinding('plain text')).toBe(false);
    expect(containsEntityBinding(42)).toBe(false);
    expect(containsEntityBinding('@payload.row')).toBe(false);
    expect(containsEntityBinding('@config.title')).toBe(false);
    expect(containsEntityBinding('@entityId.foo')).toBe(false);
    expect(containsEntityBinding('@entityCount')).toBe(false);
  });
});

describe('containsPayloadBinding', () => {
  it('detects payload references in any position', () => {
    expect(containsPayloadBinding('@payload.amount')).toBe(true);
    expect(containsPayloadBinding('got @payload.name here')).toBe(true);
    expect(containsPayloadBinding(['object/get', '@payload.row', 'id'])).toBe(true);
    expect(containsPayloadBinding('@callsitePayload.data.length')).toBe(true);
  });

  it('rejects entity/config values', () => {
    expect(containsPayloadBinding('@entity.hp')).toBe(false);
    expect(containsPayloadBinding('@config.title')).toBe(false);
    expect(containsPayloadBinding('plain')).toBe(false);
  });
});
