/**
 * Generates `fixtures/theme-tokens/every-key.json`: `color`, `illustration`,
 * `diagram` and `scene` slices with EVERY key populated, iterated from their
 * `*_TOKEN_KEYS` lists (ledger §166). The Rust `ColorTokens`/
 * `IllustrationTokens`/`DiagramTokens`/`SceneTokens` mirrors (`orbital-core`
 * `schema/types.rs`) round-trip it in `tests/theme_tokens_fixture.rs`, so a
 * key core knows and Rust does not goes red there.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COLOR_TOKEN_KEYS,
  DIAGRAM_TOKEN_KEYS,
  ILLUSTRATION_TOKEN_KEYS,
  SCENE_TOKEN_KEYS,
  ColorTokensSchema,
  DiagramTokensSchema,
  IllustrationTokensSchema,
  SceneTokensSchema,
  type ColorTokens,
  type DiagramTokens,
  type IllustrationTokens,
  type SceneTokens,
} from '../src/types/domain.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(PACKAGE_ROOT, 'fixtures', 'theme-tokens');

const color: ColorTokens = Object.fromEntries(COLOR_TOKEN_KEYS.map((k, i) => [k, `#${i.toString(16).padStart(6, '0')}`]));
const illustration: IllustrationTokens = Object.fromEntries(
  ILLUSTRATION_TOKEN_KEYS.map((k) => [k, k === 'style' ? 'minimal' : `${k}.svg`]),
);

const DIAGRAM_ENUM_VALUES: Partial<Record<keyof DiagramTokens, string>> = {
  lineCap: 'round',
  lineJoin: 'bevel',
  fillStyle: 'hatch',
  marker: 'open',
  labelFont: 'mono',
  labelCase: 'uppercase',
};
const diagram: DiagramTokens = DiagramTokensSchema.parse(
  Object.fromEntries(DIAGRAM_TOKEN_KEYS.map((k, i) => [k, DIAGRAM_ENUM_VALUES[k] ?? `${i}`])),
);
const scene: SceneTokens = Object.fromEntries(SCENE_TOKEN_KEYS.map((k, i) => [k, `${i}`]));

const fixture = {
  color: ColorTokensSchema.parse(color),
  illustration: IllustrationTokensSchema.parse(illustration),
  diagram,
  scene: SceneTokensSchema.parse(scene),
};
if (Object.keys(fixture.color).length !== COLOR_TOKEN_KEYS.length) throw new Error('ColorTokensSchema dropped a key');
if (Object.keys(fixture.illustration).length !== ILLUSTRATION_TOKEN_KEYS.length) throw new Error('IllustrationTokensSchema dropped a key');
if (Object.keys(fixture.diagram).length !== DIAGRAM_TOKEN_KEYS.length) throw new Error('DiagramTokensSchema dropped a key');
if (Object.keys(fixture.scene).length !== SCENE_TOKEN_KEYS.length) throw new Error('SceneTokensSchema dropped a key');

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'every-key.json'), `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`✓ Generated theme-tokens fixture (${COLOR_TOKEN_KEYS.length} color + ${ILLUSTRATION_TOKEN_KEYS.length} illustration + ${DIAGRAM_TOKEN_KEYS.length} diagram + ${SCENE_TOKEN_KEYS.length} scene keys)`);
