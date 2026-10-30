/**
 * Organism-scope config across per-orbital files: an app is stored as one
 * `.orb` per orbital, and a trait's `@config.<knob>` forward reads the
 * organism's declared `config` — so each file keeps the knobs its own traits
 * forward, and composing the files back is the Rust composer's.
 */
import { describe, it, expect } from 'vitest';
import type { DeclaredTraitConfig, OrbitalSchema, TraitRef } from '../src/types/index.js';
import { collectForwardedConfigKeys, collectOrbitalForwardedConfigKeys, filterConfigToForwardedKeys, orbitalFileOf } from '../src/embedded-trait-config.js';

const nav = [{ href: '/contacts', label: 'Contacts' }];
const organism: DeclaredTraitConfig = {
  appName: { type: 'string', default: 'CRM' },
  navItems: { type: '[NavItem]', default: nav },
  footer: { type: 'string', default: 'x' },
};

const layout: TraitRef = {
  ref: 'AppShell.traits.AppLayout',
  name: 'ContactAppLayout',
  config: {
    navItems: { type: 'unknown', default: '@config.navItems' },
    appName: { type: 'string', default: 'CRM', forwardedFrom: '@config.appName' },
    searchEvent: { type: 'unknown', default: 'CONTACT_SEARCH' },
  },
};

describe('collectForwardedConfigKeys', () => {
  it('collects the knobs a trait forwards through its default or forwardedFrom', () => {
    expect([...collectForwardedConfigKeys([layout])].sort()).toEqual(['appName', 'navItems']);
  });

  it('ignores literals, nested paths and other bindings', () => {
    const t: TraitRef = { ref: 'A.traits.B', name: 'X', config: {
      a: { type: 'string', default: 'plain' },
      b: { type: 'string', default: '@config.deep.path' },
      c: { type: 'string', default: '@entity.name' },
    } };
    expect([...collectForwardedConfigKeys([t])]).toEqual([]);
  });

  it('ignores string refs and traits without config', () => {
    expect([...collectForwardedConfigKeys(['Plain', { ref: 'A.traits.B', name: 'Y' }])]).toEqual([]);
  });
});

describe('collectOrbitalForwardedConfigKeys', () => {
  const importForward = { from: 'almadar-behaviors/std-chat', as: 'Desk', config: { appName: { type: 'unknown', default: '@config.appName' }, navItems: { type: 'unknown', default: '@config.navItems' } } };

  it('an import forwarding the app config through its uses entry counts those knobs', () => {
    expect([...collectOrbitalForwardedConfigKeys({ traits: [], uses: [importForward] })].sort()).toEqual(['appName', 'navItems']);
  });

  it('unions trait forwards and uses forwards; control: a plain uses entry adds nothing', () => {
    expect([...collectOrbitalForwardedConfigKeys({ traits: [layout], uses: [{ from: 'std/behaviors/std-browse', as: 'Browse' }] })].sort()).toEqual(['appName', 'navItems']);
    expect([...collectOrbitalForwardedConfigKeys({ traits: [], uses: [{ from: 'std/behaviors/std-browse', as: 'Browse' }] })]).toEqual([]);
  });

  it('an import orbital\'s own file keeps the app knobs its uses entry forwards', () => {
    const schema: OrbitalSchema = { name: 's', version: '1.0.0', config: organism, orbitals: [{ name: 'ChannelOrbital', entity: 'Desk.orbitals.ChannelOrbital.entity', uses: [importForward], traits: [], pages: [] }] };
    expect(Object.keys(orbitalFileOf(schema, schema.orbitals[0]!).config ?? {}).sort()).toEqual(['appName', 'navItems']);
  });
});

describe('filterConfigToForwardedKeys', () => {
  it('keeps only the forwarded knobs', () => {
    expect(filterConfigToForwardedKeys(organism, new Set(['navItems']))).toEqual({ navItems: organism.navItems });
  });

  it('is undefined when nothing is forwarded', () => {
    expect(filterConfigToForwardedKeys(organism, new Set(['missing']))).toBeUndefined();
  });
});

describe('orbitalFileOf — one orbital\'s own file', () => {
  const app: OrbitalSchema = {
    name: 'crm',
    version: '1.2.0',
    config: organism,
    orbitals: [
      { name: 'Contacts', entity: 'Contacts.entity', traits: [layout], pages: [] },
      { name: 'Plain', entity: 'Plain.entity', traits: [], pages: [] },
    ],
  };

  it('keeps the organism knobs this orbital\'s traits forward', () => {
    expect(orbitalFileOf(app, app.orbitals[0]!).config).toEqual({ navItems: organism.navItems, appName: organism.appName });
  });

  it('carries no config when the orbital forwards none, or the app declares none', () => {
    expect('config' in orbitalFileOf(app, app.orbitals[1]!)).toBe(false);
    expect('config' in orbitalFileOf({ ...app, config: undefined }, app.orbitals[0]!)).toBe(false);
  });

  it('wraps exactly one orbital with the app version', () => {
    const file = orbitalFileOf(app, app.orbitals[0]!);
    expect(file).toMatchObject({ name: 'Contacts', version: '1.2.0' });
    expect(file.orbitals.map((o) => o.name)).toEqual(['Contacts']);
  });
});
