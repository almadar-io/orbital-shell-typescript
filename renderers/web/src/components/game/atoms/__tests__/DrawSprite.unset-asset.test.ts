/**
 * `paintSprite` must never render an unresolvable asset as an invisible hole.
 * An empty `url` (`ui-platformer-board`'s `playerSprite` / `backgroundImage`
 * defaults) or an absent asset (a `tileSprites` lookup into an empty map) can
 * never load — same class as a failed fetch, so it paints the fallback square.
 */
import { describe, it, expect } from 'vitest';
import type { Painter2D, TextureHandle } from '../../../../lib/painter2d';
import { create2DProjector } from '../../../../lib/drawable/projector';
import type { DrawContext } from '../../../../lib/drawable/contract';
import { paintSprite, type DrawSpriteProps } from '../DrawSprite';

type Call = { op: string; args: ReadonlyArray<number | string | boolean | object | null | undefined> };

function recordingPainter(texture: TextureHandle | null): { painter: Painter2D; calls: Call[] } {
  const calls: Call[] = [];
  const record = (op: string) => (...args: ReadonlyArray<number | string | boolean | object | null | undefined>) => { calls.push({ op, args }); };
  const painter: Painter2D = {
    setViewport: record('setViewport'), clear: record('clear'), save: record('save'), restore: record('restore'),
    translate: record('translate'), scale: record('scale'), rotate: record('rotate'), setAlpha: record('setAlpha'),
    setShadow: record('setShadow'), setBlend: record('setBlend'), setLineDash: record('setLineDash'), setBlur: record('setBlur'),
    clipPath: record('clipPath'), resolveTexture: (url: string) => { calls.push({ op: 'resolveTexture', args: [url] }); return texture; },
    blit: record('blit'), blitTransformed: record('blitTransformed'), fillRect: record('fillRect'), strokeRect: record('strokeRect'),
    fillPoly: record('fillPoly'), strokePoly: record('strokePoly'), fillEllipse: record('fillEllipse'), strokeEllipse: record('strokeEllipse'),
    fillPath: record('fillPath'), strokePath: record('strokePath'), text: record('text'),
  };
  return { painter, calls };
}

const dctx: DrawContext = { projector: create2DProjector({ baseOffsetX: 0, layout: 'flat' }), time: 0, invalidate: () => undefined };

function sprite(asset: DrawSpriteProps['asset']): DrawSpriteProps {
  return { type: 'draw-sprite', position: { x: 10, y: 20 }, width: 32, height: 48, asset };
}

describe('paintSprite — unresolvable asset', () => {
  it('paints the fallback square for an empty url', () => {
    const { painter, calls } = recordingPainter(null);
    paintSprite(painter, sprite({ url: '', sprite: 'adventurer_idle.png', role: 'player', category: 'player' }), dctx);
    expect(calls.some((c) => c.op === 'fillRect')).toBe(true);
    expect(calls.some((c) => c.op === 'resolveTexture')).toBe(false);
  });

  it('paints the fallback square when the asset is absent (lookup into an empty map)', () => {
    const { painter, calls } = recordingPainter(null);
    const node = { type: 'draw-sprite', position: { x: 10, y: 20 }, width: 32, height: 16 } as DrawSpriteProps;
    expect(() => paintSprite(painter, node, dctx)).not.toThrow();
    expect(calls.some((c) => c.op === 'fillRect')).toBe(true);
  });

  it('control: a resolved texture blits and paints no fallback', () => {
    const tex = { width: 64, height: 64 } as TextureHandle;
    const { painter, calls } = recordingPainter(tex);
    paintSprite(painter, sprite({ url: 'https://cdn.example/ground.png', role: 'tile', category: 'terrain' }), dctx);
    expect(calls.some((c) => c.op === 'blit')).toBe(true);
    expect(calls.some((c) => c.op === 'fillRect')).toBe(false);
  });

  it('draws a whole image whose atlas and sprite are empty strings', () => {
    const tex = { width: 64, height: 64 } as TextureHandle;
    const { painter, calls } = recordingPainter(tex);
    paintSprite(painter, sprite({ url: 'https://cdn.example/ground.png', atlas: '', sprite: '', role: 'tile', category: 'terrain' }), dctx);
    expect(calls.some((c) => c.op === 'blit')).toBe(true);
    expect(calls.some((c) => c.op === 'fillRect')).toBe(false);
  });

  it('draws a whole image for an animation with an empty atlas', () => {
    const tex = { width: 64, height: 64 } as TextureHandle;
    const { painter, calls } = recordingPainter(tex);
    paintSprite(painter, { ...sprite({ url: 'https://cdn.example/hero.png', atlas: '', sprite: '', role: 'player', category: 'player' }), animation: 'idle' }, dctx);
    expect(calls.some((c) => c.op === 'blit')).toBe(true);
    expect(calls.some((c) => c.op === 'fillRect')).toBe(false);
  });

  it('control: an in-flight texture paints nothing yet', () => {
    const { painter, calls } = recordingPainter(null);
    paintSprite(painter, sprite({ url: 'https://cdn.example/loading.png', role: 'tile', category: 'terrain' }), dctx);
    expect(calls.some((c) => c.op === 'fillRect' || c.op === 'blit')).toBe(false);
  });

  it('paints nothing for an invalid position, asset or not', () => {
    const { painter, calls } = recordingPainter(null);
    paintSprite(painter, { ...sprite({ url: '', role: 'tile', category: 'terrain' }), position: { x: Number.NaN, y: 0 } }, dctx);
    expect(calls.some((c) => c.op === 'fillRect')).toBe(false);
  });
});
