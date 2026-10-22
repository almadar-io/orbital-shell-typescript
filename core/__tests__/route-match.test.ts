/**
 * The one route resolver: a static segment outranks a `:param` sibling whatever
 * else the page list holds. std-healthcare `/appointments/checkin` opened the
 * detail page with id "checkin" because a whole-list sort by a non-transitive
 * comparator left `/appointments/:id` ahead of it.
 */
import { describe, it, expect } from 'vitest';
import { defaultPage, matchPathAmong, pathMatchesPattern } from '../index';
import type { OrbitalDefinition, OrbitalSchema } from '../index';

const healthcare = ['/patients', '/patients/upload', '/patients/:id', '/appointments/waitlist', '/appointments',
  '/appointments/reminder', '/appointments/:id', '/my-appointments', '/intake', '/prescriptions/refill-requests',
  '/prescriptions', '/my-prescriptions', '/dashboard', '/patients-phi', '/rx-controlled', '/insurance-claims-from-std',
  '/appointment-policies-from-std', '/billing', '/my-billing', '/appointments/checkin', '/people'];
const pick = (list: string[], path: string) => matchPathAmong(list, path, (p) => p);

describe('matchPathAmong', () => {
  it('resolves a declared static page over its :param sibling', () => {
    expect(pick(healthcare, '/appointments/checkin')?.candidate).toBe('/appointments/checkin');
  });

  it('control: an undeclared segment lands on the :param page with its value', () => {
    expect(pick(healthcare, '/appointments/a%2017')).toEqual({ candidate: '/appointments/:id', params: { id: 'a 17' } });
  });

  it('edge: list order never changes the winner', () => {
    expect(pick([...healthcare].reverse(), '/appointments/checkin')?.candidate).toBe('/appointments/checkin');
  });

  it('edge: equally specific patterns keep declaration order', () => {
    expect(pick(['/a/:x', '/a/:y'], '/a/1')?.candidate).toBe('/a/:x');
  });

  it('edge: nothing matches', () => {
    expect(pick(healthcare, '/nowhere/at/all')).toBeNull();
  });
});

describe('pathMatchesPattern follows the same matcher', () => {
  it('matches with a trailing slash and rejects a segment-count mismatch', () => {
    expect(pathMatchesPattern('/appointments/7/', '/appointments/:id')).toBe(true);
    expect(pathMatchesPattern('/appointments', '/appointments/:id')).toBe(false);
  });
});

describe('defaultPage — the page an app shows when no page matches its route', () => {
  const page = (name: string, path: string) => ({ name, path, traits: [{ ref: `${name}View` }] });
  const orbital = (name: string, pages: OrbitalDefinition['pages']): OrbitalDefinition => ({ name, entity: { name: `${name}Item`, fields: [] }, traits: [], pages });

  it('is the first inline page of the first orbital that declares one', () => {
    const schema: OrbitalSchema = { name: 'shop', orbitals: [orbital('Shop', [page('Shop', '/shop'), page('Cart', '/cart')]), orbital('Orders', [page('Orders', '/orders')])] };
    expect(defaultPage(schema)).toEqual({ page: page('Shop', '/shop'), orbitalName: 'Shop' });
  });

  it('skips page references and orbitals without pages', () => {
    const schema: OrbitalSchema = { name: 'app', orbitals: [orbital('Rules', []), orbital('Shell', ['Other.pages.Home', page('Desk', '/desk')])] };
    expect(defaultPage(schema)?.page.name).toBe('Desk');
  });

  it('is the page the program declares initial, in any orbital', () => {
    const home = { ...page('Home', '/'), isInitial: true };
    const schema: OrbitalSchema = { name: 'studio', orbitals: [orbital('Account', [page('Account', '/settings/account')]), orbital('Apps', [home])] };
    expect(defaultPage(schema)).toEqual({ page: home, orbitalName: 'Apps' });
  });

  it('edge: several initial pages, the first in declaration order wins', () => {
    const en = { ...page('HomeEN', '/'), isInitial: true };
    const ar = { ...page('HomeAR', '/ar'), isInitial: true };
    const schema: OrbitalSchema = { name: 'studio', orbitals: [orbital('Account', [page('Account', '/settings/account')]), orbital('AppsEN', [en]), orbital('AppsAR', [ar])] };
    expect(defaultPage(schema)?.page.name).toBe('HomeEN');
  });

  it('control: isInitial false is not a declaration', () => {
    const schema: OrbitalSchema = { name: 'app', orbitals: [orbital('A', [page('A', '/a')]), orbital('B', [{ ...page('B', '/b'), isInitial: false }])] };
    expect(defaultPage(schema)?.page.name).toBe('A');
  });

  it('control: no inline page anywhere, no default', () => {
    expect(defaultPage({ name: 'atom', orbitals: [orbital('Rules', [])] })).toBeNull();
  });
});
