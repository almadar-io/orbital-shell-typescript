/**
 * Every drawing surface draws in the theme's hand: no hardcoded color in any file that paints a
 * canvas, a WebGL scene or a drawable. Colors come from `useCanvasTheme` roles, `var()` tokens or
 * declared convention knobs. A new drawing file is covered automatically (it is found by what it
 * does, not by a list); the only exemptions are the named engine fallbacks below, each tracked by
 * G-UI-066 and expected to shrink.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['components', 'lib', 'hooks'];
const DRAWS = /getContext\(|\buseFrame\b|meshStandardMaterial|\bTHREE\.|paintDrawable\(|createWebPainter\(/;
const HEX = /['"`]#[0-9a-fA-F]{3,8}\b/;

/** Engine fallbacks still carrying literals (G-UI-066). Remove an entry when its file is clean. */
const EXEMPT = new Set([
  'components/game/atoms/MiniMap.tsx',
  'lib/drawable/three/Lighting3D.tsx',
  'lib/drawable/three/Scene3D.tsx',
  'lib/drawable/three/mesh3d.tsx',
  'lib/drawable/three/DrawMesh3D.tsx',
  'lib/drawable/three/ModelLoader.tsx',
  'lib/drawable/three/hooks/useThree.ts',
  'lib/webPainter2d.ts',
]);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|stories)\./.test(entry.name)) out.push(full);
  }
  return out;
}

const drawingFiles = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)))
  .map((f) => ({ rel: path.relative(ROOT, f).split(path.sep).join('/'), src: stripComments(fs.readFileSync(f, 'utf8')) }))
  .filter((f) => DRAWS.test(f.src));

describe('drawing surfaces carry no hardcoded colors', () => {
  it('finds the drawing surfaces it guards', () => {
    const rels = drawingFiles.map((f) => f.rel);
    for (const known of ['components/learning/atoms/LearningCanvas.tsx', 'components/core/molecules/GraphCanvas.tsx', 'components/game/molecules/Canvas2D.tsx', 'lib/drawable/three/Canvas3DHost.tsx']) {
      expect(rels).toContain(known);
    }
  });

  it('no non-exempt drawing file paints a literal color', () => {
    const offenders = drawingFiles.filter((f) => !EXEMPT.has(f.rel) && HEX.test(f.src)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('every exemption is still needed (a cleaned file must leave the list)', () => {
    const stale = [...EXEMPT].filter((rel) => {
      const f = drawingFiles.find((d) => d.rel === rel);
      return !f || !HEX.test(f.src);
    });
    expect(stale).toEqual([]);
  });

  it('control: the detector flags a literal and ignores one in a comment', () => {
    expect(HEX.test(stripComments("ctx.fillStyle = '#ff0000';"))).toBe(true);
    expect(HEX.test(stripComments("// default '#ff0000'\nctx.fillStyle = theme.ground;"))).toBe(false);
  });
});

describe('patterns drawn natively by the Rust renderer stay theme-tone only (owner 2026-10-10)', () => {
  const COLOR_LITERAL = /['"`]#[0-9a-fA-F]{3,8}\b|['"](?:white|black)['"]|rgba?\(/;
  const svgDir = path.join(ROOT, 'components/core/atoms/svg');
  const files = [
    ...fs.readdirSync(svgDir).filter((f) => f.endsWith('.tsx')).map((f) => path.join(svgDir, f)),
    path.join(ROOT, 'components/core/molecules/OrbitalVisualization.tsx'),
  ];

  it('no svg-* atom or the orbital visualization paints a colour literal', () => {
    const offenders = files.filter((f) => COLOR_LITERAL.test(stripComments(fs.readFileSync(f, 'utf8'))));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('control: the scan sees the svg atoms and would catch a literal', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(COLOR_LITERAL.test('fill="white"')).toBe(true);
    expect(COLOR_LITERAL.test('fill="var(--surface-diagram)"')).toBe(false);
  });
});
