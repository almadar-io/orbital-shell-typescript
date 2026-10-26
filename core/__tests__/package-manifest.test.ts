import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface CoreManifest {
  orb?: object;
  orbLanguage?: { compiler?: string; patterns?: string; componentMapping?: string; eventContracts?: string; services?: string; bindingRules?: string; programTypes?: string; protocols?: string; themes?: string; fixtures?: string };
}

const manifest: CoreManifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

describe('@almadar/core package.json language-data declaration', () => {
  it('has no `orb` block — every orb binary reads an `orb` block as a behavior package, and older ones reject a block without behavior fields', () => {
    expect(manifest.orb).toBeUndefined();
  });

  it('declares the language data under the top-level `orbLanguage` key', () => {
    expect(manifest.orbLanguage?.compiler).toMatch(/\d+\.\d+\.\d+/);
    expect(manifest.orbLanguage?.patterns).toBe('dist/patterns/patterns-registry.json');
    expect(manifest.orbLanguage?.componentMapping).toBe('dist/patterns/component-mapping.json');
    expect(manifest.orbLanguage?.eventContracts).toBe('dist/patterns/event-contracts.json');
    expect(manifest.orbLanguage?.services).toBe('dist/patterns/services-registry.json');
    expect(manifest.orbLanguage?.bindingRules).toBe('dist/language/binding-rules.json');
    expect(manifest.orbLanguage?.programTypes).toBe('dist/language/program-types.json');
    expect(manifest.orbLanguage?.protocols).toBe('dist/language/protocols.json');
  });

  it('declares the theme preset directory orb loads (one ThemeDefinition per file, shipped)', () => {
    expect(manifest.orbLanguage?.themes).toBe('themes');
    const files: string[] = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).files;
    expect(files).toContain('themes');
    expect(readdirSync(join(__dirname, '..', 'themes')).some((f) => f.endsWith('.json'))).toBe(true);
  });

  it('declares the conformance fixture directory orb and its tests load (shipped)', () => {
    expect(manifest.orbLanguage?.fixtures).toBe('fixtures');
    const files: string[] = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).files;
    expect(files).toContain('fixtures');
    expect(readdirSync(join(__dirname, '..', 'fixtures', 'events-wire')).length).toBeGreaterThan(0);
  });
});
