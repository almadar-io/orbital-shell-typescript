/**
 * themeDrawables — resolve a drawable tree against the theme before a painter sees it. Canvas 2D
 * and three.js cannot read `var()` or a tone name (`ink`, `series-2`, …), so every color-typed
 * field of the drawable contract is resolved here, once, for both the 2D painter and the 3D host.
 * Meshes also take the theme's material response (`scene` axis) wherever they leave it unset.
 *
 * @packageDocumentation
 */

import type { CanvasTheme } from '@almadar/core';
import type { DrawableNode } from './paintDispatch';
import type { DrawShapeProps } from '../../components/game/atoms/DrawShape';
import type { DrawTextProps } from '../../components/game/atoms/DrawText';
import type { MeshMaterial } from '../../components/game/atoms/DrawMesh';

/** Resolves one color-field value; identity for a literal. */
export type ColorResolver = (value: string) => string;

function opt(value: string | undefined, resolve: ColorResolver): string | undefined {
  return value === undefined ? undefined : resolve(value);
}

function themeShape(node: DrawShapeProps, resolve: ColorResolver): DrawShapeProps {
  return {
    ...node,
    ...(node.fill !== undefined ? { fill: resolve(node.fill) } : {}),
    ...(node.stroke !== undefined ? { stroke: resolve(node.stroke) } : {}),
    ...(node.gradient ? { gradient: { ...node.gradient, stops: node.gradient.stops.map((s) => ({ ...s, color: resolve(s.color) })) } } : {}),
    ...(node.fillPattern?.color !== undefined ? { fillPattern: { ...node.fillPattern, color: resolve(node.fillPattern.color) } } : {}),
    ...(node.shadow ? { shadow: { ...node.shadow, color: resolve(node.shadow.color) } } : {}),
    ...(node.animation
      ? {
          animation: {
            ...node.animation,
            keyframes: node.animation.keyframes.map((k) => ({
              ...k,
              ...(k.fill !== undefined ? { fill: resolve(k.fill) } : {}),
              ...(k.stroke !== undefined ? { stroke: resolve(k.stroke) } : {}),
            })),
          },
        }
      : {}),
  };
}

function themeText(node: DrawTextProps, resolve: ColorResolver): DrawTextProps {
  return { ...node, color: resolve(node.color) };
}

function themeMaterial(material: MeshMaterial | undefined, resolve: ColorResolver): MeshMaterial | undefined {
  if (!material) return material;
  return {
    ...material,
    ...(material.color !== undefined ? { color: resolve(material.color) } : {}),
    ...(material.emissive !== undefined ? { emissive: resolve(material.emissive) } : {}),
  };
}

/** Resolves every color-typed field in a drawable tree. */
export function resolveDrawableColors(nodes: readonly DrawableNode[], resolve: ColorResolver): DrawableNode[] {
  return nodes.map((node): DrawableNode => {
    switch (node.type) {
      case 'draw-shape':
        return themeShape(node, resolve);
      case 'draw-text':
        return themeText(node, resolve);
      case 'draw-group':
        return { ...node, items: resolveDrawableColors(node.items, resolve) };
      case 'draw-shape-layer':
        return { ...node, items: node.items.map((item) => themeShape(item, resolve)) };
      case 'draw-text-layer':
        return { ...node, items: node.items.map((item) => themeText(item, resolve)) };
      case 'draw-fx-layer':
        return {
          ...node,
          ...(node.textColor !== undefined ? { textColor: resolve(node.textColor) } : {}),
          ...(node.presets
            ? {
                presets: node.presets.map((p) => ({
                  ...p,
                  ...(p.color !== undefined ? { color: resolve(p.color) } : {}),
                  ...(p.color2 !== undefined ? { color2: resolve(p.color2) } : {}),
                })),
              }
            : {}),
        };
      case 'draw-mesh':
        return {
          ...node,
          material: themeMaterial(node.material, resolve),
          ...(node.outline ? { outline: { ...node.outline, ...(node.outline.color !== undefined ? { color: resolve(node.outline.color) } : {}) } } : {}),
          ...(node.animation
            ? {
                animation: {
                  ...node.animation,
                  keyframes: node.animation.keyframes.map((k) => ({
                    ...k,
                    ...(k.color !== undefined ? { color: resolve(k.color) } : {}),
                    ...(k.emissive !== undefined ? { emissive: opt(k.emissive, resolve) } : {}),
                  })),
                },
              }
            : {}),
        };
      default:
        return node;
    }
  });
}

/**
 * Gives every mesh the theme's material response where it leaves it unset: roughness, metalness,
 * flat shading, and a toon outline when the theme draws one. An explicit descriptor value wins.
 */
export function applySceneMaterials(nodes: readonly DrawableNode[], theme: CanvasTheme): DrawableNode[] {
  return nodes.map((node): DrawableNode => {
    if (node.type === 'draw-group') return { ...node, items: applySceneMaterials(node.items, theme) };
    if (node.type !== 'draw-mesh') return node;
    const m = node.material ?? {};
    const pbr = (m.kind ?? 'standard') === 'standard' || m.kind === 'physical';
    return {
      ...node,
      material: {
        ...m,
        ...(pbr && m.roughness === undefined ? { roughness: theme.scene.roughness } : {}),
        ...(pbr && m.metalness === undefined ? { metalness: theme.scene.metalness } : {}),
        ...(m.flatShading === undefined && theme.scene.flat ? { flatShading: true } : {}),
      },
      ...(node.outline === undefined && theme.scene.outline > 0
        ? { outline: { color: theme.tones.ink, width: theme.scene.outline * 0.02 } }
        : {}),
    };
  });
}
