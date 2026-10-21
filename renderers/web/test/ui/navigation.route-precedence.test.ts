/**
 * Route resolution precedence — static segments outrank `:param` siblings.
 *
 * `findPageByPath` used to be a flat first-match over declaration order, so a
 * `/listings/:id` page declared before `/listings/moderation` swallowed its
 * static sibling (recorded as R-ROUTE-MATCH-FLAT-FIRST-MATCH-NO-STATIC-PRECEDENCE
 * in `docs/Almadar_Runtime_Gaps.md`). `matchPathAmong` is the single resolver
 * both `findPageByPath` and `OrbPreview`'s navigate/mount paths go through, so
 * these cases pin the shared behaviour.
 */
import { describe, it, expect } from 'vitest';
import type { OrbitalSchema } from '@almadar/core';
import { comparePathSpecificity, matchPathAmong } from '../../src/core';
import { findPageByPath } from '../../src/core';

const pageEntry = (path: string, name: string) => ({ page: { name, path } });

describe('comparePathSpecificity', () => {
  it('ranks a static segment ahead of a param at the same position', () => {
    expect(comparePathSpecificity('/listings/moderation', '/listings/:id')).toBeLessThan(0);
    expect(comparePathSpecificity('/listings/:id', '/listings/moderation')).toBeGreaterThan(0);
  });

  it('ties patterns that agree in kind, leaving declaration order to decide', () => {
    expect(comparePathSpecificity('/listings/:id', '/orders/:id')).toBe(0);
    expect(comparePathSpecificity('/a/b', '/c/d')).toBe(0);
  });

  it('decides on the first disagreeing segment', () => {
    expect(comparePathSpecificity('/x/:a/y', '/:b/c/y')).toBeLessThan(0);
  });
});

describe('matchPathAmong', () => {
  const candidates = [
    pageEntry('/listings/:id', 'ListingDetailPage'),
    pageEntry('/listings/moderation', 'ModerationPage'),
    pageEntry('/listings', 'ListingsPage'),
  ];
  const resolve = (path: string) =>
    matchPathAmong(candidates, path, (entry) => entry.page.path);

  it('prefers the static sibling even though the param route is declared first', () => {
    expect(resolve('/listings/moderation')?.candidate.page.name).toBe('ModerationPage');
  });

  it('still routes a concrete id to the param page, with params extracted', () => {
    const hit = resolve('/listings/abc-123');
    expect(hit?.candidate.page.name).toBe('ListingDetailPage');
    expect(hit?.params).toEqual({ id: 'abc-123' });
  });

  it('returns null when nothing matches', () => {
    expect(resolve('/nope/at/all')).toBeNull();
  });

  it('leaves the caller array untouched (declaration order is still theirs)', () => {
    const order = candidates.map((c) => c.page.name);
    resolve('/listings/moderation');
    expect(candidates.map((c) => c.page.name)).toEqual(order);
  });
});

describe('findPageByPath', () => {
  const schema: OrbitalSchema = {
    name: 'fixture',
    orbitals: [
      {
        name: 'ListingOrbital',
        entity: { name: 'Listing', fields: [{ name: 'id', type: 'string' }] },
        traits: [],
        pages: [
          { name: 'ListingDetailPage', path: '/listings/:id', traits: [] },
          { name: 'ModerationPage', path: '/listings/moderation', traits: [] },
        ],
      },
    ],
  };

  it('resolves the static route the param route used to shadow', () => {
    const hit = findPageByPath(schema, '/listings/moderation');
    expect(hit?.page.name).toBe('ModerationPage');
    expect(hit?.params).toEqual({});
    expect(hit?.orbitalName).toBe('ListingOrbital');
  });

  it('resolves a concrete id to the param route with its params', () => {
    const hit = findPageByPath(schema, '/listings/xyz');
    expect(hit?.page.name).toBe('ListingDetailPage');
    expect(hit?.params).toEqual({ id: 'xyz' });
  });
});

describe('matchPathAmong — a static sibling wins whatever else the page list holds', () => {
  // std-healthcare's real page list: `/appointments/checkin` opened the detail page
  // with id "checkin" because sorting by a non-transitive comparator left
  // `/appointments/:id` ahead of it once enough unrelated pages sat between them.
  const healthcare = ['/patients', '/patients/upload', '/patients/:id', '/appointments/waitlist', '/appointments',
    '/appointments/reminder', '/appointments/:id', '/my-appointments', '/intake', '/prescriptions/refill-requests',
    '/prescriptions', '/my-prescriptions', '/dashboard', '/patients-phi', '/rx-controlled', '/insurance-claims-from-std',
    '/appointment-policies-from-std', '/billing', '/my-billing', '/appointments/checkin', '/people'];
  const pages = healthcare.map((p, i) => pageEntry(p, `P${i}`));

  it('resolves the declared static page', () => {
    expect(matchPathAmong(pages, '/appointments/checkin', (e) => e.page.path)?.candidate.page.path).toBe('/appointments/checkin');
    expect(matchPathAmong(pages, '/patients/upload', (e) => e.page.path)?.candidate.page.path).toBe('/patients/upload');
  });

  it('control: an unknown segment still lands on the param page with its id', () => {
    const hit = matchPathAmong(pages, '/appointments/a-17', (e) => e.page.path);
    expect(hit?.candidate.page.path).toBe('/appointments/:id');
    expect(hit?.params).toEqual({ id: 'a-17' });
  });

  it('edge: the order of the list never changes the winner', () => {
    const reversed = [...pages].reverse();
    expect(matchPathAmong(reversed, '/appointments/checkin', (e) => e.page.path)?.candidate.page.path).toBe('/appointments/checkin');
  });
});
