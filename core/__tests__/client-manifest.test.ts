// The manifest a server hands the program-independent web client at startup (`/client.json`): what the client used
// to bake in per program. The Rust shell writes it; the client parses it with this schema.
import { describe, expect, it } from 'vitest';
import { ClientManifestSchema, parseClientManifest } from '../index';

const manifest = {
  locale: 'ar',
  direction: 'rtl',
  themes: [{ name: 'terminal', displayName: 'Terminal', hasLightMode: true, hasDarkMode: true }],
  defaultTheme: 'terminal',
  defaultMode: 'dark',
};

describe('ClientManifest', () => {
  it('parses what the shell writes', () => {
    expect(parseClientManifest(manifest)).toEqual(manifest);
  });

  it('a program with no themes has no default theme', () => {
    expect(parseClientManifest({ ...manifest, themes: [], defaultTheme: null })).toMatchObject({ themes: [], defaultTheme: null });
  });

  it('control: an unknown direction, a missing field or an extra key is refused', () => {
    expect(() => parseClientManifest({ ...manifest, direction: 'ttb' })).toThrow();
    const { locale: _locale, ...noLocale } = manifest;
    expect(() => parseClientManifest(noLocale)).toThrow();
    expect(ClientManifestSchema.safeParse({ ...manifest, extra: 1 }).success).toBe(false);
    expect(ClientManifestSchema.safeParse({ ...manifest, language: false }).success).toBe(false);
  });
});
