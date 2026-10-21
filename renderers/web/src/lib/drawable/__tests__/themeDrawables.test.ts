/**
 * Drawables reach a painter with concrete colors: tone names and var() resolve through the theme,
 * literals pass through, and meshes take the theme's material response unless they set their own.
 */
import { describe, it, expect } from 'vitest';
import { afterEach } from 'vitest';
import { resolveCanvasTheme } from '../../canvasTheme';
import { applySceneMaterials, resolveDrawableColors } from '../themeDrawables';
import type { DrawableNode } from '../paintDispatch';

const resolve = (c: string): string => (c === 'ink' ? 'rgb(1, 1, 1)' : c === 'series-2' ? 'rgb(2, 2, 2)' : c);

function sceneTheme() {
  const scope = document.createElement('div');
  for (const [k, v] of Object.entries({ '--color-diagram-ink': 'rgb(9, 9, 9)', '--material-roughness': '0.9', '--material-metalness': '0.2', '--material-flat': '1', '--material-outline': '2' })) {
    scope.style.setProperty(k, v);
  }
  document.body.appendChild(scope);
  return resolveCanvasTheme(scope);
}

afterEach(() => {
  document.body.innerHTML = '';
});

const at = { x: 0, y: 0 };

describe('resolveDrawableColors', () => {
  it('resolves fx preset colors (tone names) and keeps literal ones', () => {
    const nodes: DrawableNode[] = [
      { type: 'draw-fx-layer', items: [], tickMs: 500, presets: [{ type: 'pickup', color: 'series-2', color2: '#123456' }, { type: 'hit', color: 'ink' }] },
    ];
    const [layer] = resolveDrawableColors(nodes, resolve);
    expect(layer.type === 'draw-fx-layer' && layer.presets).toEqual([
      { type: 'pickup', color: 'rgb(2, 2, 2)', color2: '#123456' },
      { type: 'hit', color: 'rgb(1, 1, 1)' },
    ]);
  });

  it('resolves tones on shapes, text, mesh materials and nested groups; leaves literals', () => {
    const nodes: DrawableNode[] = [
      { type: 'draw-shape', shape: 'rect', position: at, fill: 'series-2', stroke: '#abcdef' },
      { type: 'draw-text', text: 'x', position: at, color: 'ink' },
      { type: 'draw-group', position: at, items: [{ type: 'draw-mesh', shape: 'box', position: at, material: { color: 'series-2', emissive: 'ink' } }] },
    ];
    const [shape, text, group] = resolveDrawableColors(nodes, resolve);
    expect(shape).toMatchObject({ fill: 'rgb(2, 2, 2)', stroke: '#abcdef' });
    expect(text).toMatchObject({ color: 'rgb(1, 1, 1)' });
    expect(group.type === 'draw-group' && group.items[0]).toMatchObject({ material: { color: 'rgb(2, 2, 2)', emissive: 'rgb(1, 1, 1)' } });
  });

  it('control: a literal color comes back unchanged', () => {
    const node: DrawableNode = { type: 'draw-text', text: 'plain', position: at, color: '#123456' };
    expect(resolveDrawableColors([node], resolve)[0]).toEqual(node);
  });
});

describe('applySceneMaterials', () => {
  it('fills unset PBR material fields and adds the theme outline', () => {
    const [mesh] = applySceneMaterials([{ type: 'draw-mesh', shape: 'box', position: at, material: { color: '#fff' } }], sceneTheme());
    expect(mesh).toMatchObject({ material: { roughness: 0.9, metalness: 0.2, flatShading: true }, outline: { color: 'rgb(9, 9, 9)' } });
  });

  it('control: explicit material values and outlines win', () => {
    const [mesh] = applySceneMaterials(
      [{ type: 'draw-mesh', shape: 'box', position: at, material: { roughness: 0.1, metalness: 1, flatShading: false }, outline: { color: '#f00', width: 0.1 } }],
      sceneTheme(),
    );
    expect(mesh).toMatchObject({ material: { roughness: 0.1, metalness: 1, flatShading: false }, outline: { color: '#f00', width: 0.1 } });
  });

  it('edge: an unlit basic material gets no PBR fields', () => {
    const [mesh] = applySceneMaterials([{ type: 'draw-mesh', shape: 'box', position: at, material: { kind: 'basic' } }], sceneTheme());
    expect(mesh.type === 'draw-mesh' && mesh.material?.roughness).toBeUndefined();
  });
});
