/**
 * Page modifiers (`access`, `indexing`, `title`, `description`) and the app
 * `site` modifiers: the schema accepts exactly the declared shapes. The kernel carries them
 * onto the route table (orbital-compiler `route_manifest`).
 */
import { describe, it, expect } from 'vitest';
import { parseOrbitalSchema, safeParseOrbitalSchema, HOST_SIGN_IN_ROUTE, isHostSignInRoute } from '../src/types/schema.js';
import { notFoundPage } from '../src/route-match.js';
import { PageModifiersSchema } from '../src/types/page.js';
import { resolvePageMeta } from '../src/types/page.js';

function app(page: Record<string, string | string[]>, site?: Record<string, string>) {
  return {
    name: 'ModifierApp',
    ...(site ? { site } : {}),
    orbitals: [
      {
        name: 'Main',
        entity: { name: 'Item', fields: [{ name: 'id', type: 'string', required: true }] },
        traits: [],
        pages: [{ name: 'HomePage', path: '/', traits: [], ...page }],
      },
    ],
  };
}

describe('page modifiers', () => {
  it('accepts declared modifiers on the page and the site', () => {
    const schema = parseOrbitalSchema(
      app(
        { access: 'public', indexing: 'index', title: 'Home', description: ['i18n/t', 'app:meta.home'] },
        { origin: 'https://example.org', signIn: '/login', name: 'Example', icon: '/icon.svg' },
      ),
    );
    expect(schema.site?.signIn).toBe('/login');
  });

  it('a page declared notFound is found by notFoundPage', () => {
    const base = app({});
    const orbital = base.orbitals[0]!;
    const schema = parseOrbitalSchema({
      ...base,
      orbitals: [{ ...orbital, pages: [{ name: 'HomePage', path: '/', traits: [] }, { name: 'Missing', path: '/missing', traits: [], isNotFound: true }] }],
    });
    expect(notFoundPage(schema)?.page.name).toBe('Missing');
    expect(notFoundPage(parseOrbitalSchema(app({})))).toBeNull();
  });

  it('rejects an unknown access or indexing value', () => {
    expect(safeParseOrbitalSchema(app({ access: 'private' })).success).toBe(false);
    expect(safeParseOrbitalSchema(app({ indexing: 'follow' })).success).toBe(false);
  });

  it('rejects metadata bound to anything but a literal or i18n/t', () => {
    expect(safeParseOrbitalSchema(app({ title: ['str/concat', 'a'] })).success).toBe(false);
    expect(safeParseOrbitalSchema(app({ title: ['i18n/t', ''] })).success).toBe(false);
  });

  it('rejects a relative origin and an unknown site key', () => {
    expect(safeParseOrbitalSchema(app({}, { origin: 'orb.almadar.io' })).success).toBe(false);
    expect(safeParseOrbitalSchema(app({}, { favicon: '/x.svg' })).success).toBe(false);
  });

  it('resolvePageMeta reads a literal or looks a message up', () => {
    const catalog: Record<string, string> = { 'app:meta.home': 'Domov' };
    expect(resolvePageMeta('Home', (k) => catalog[k])).toBe('Home');
    expect(resolvePageMeta(['i18n/t', 'app:meta.home'], (k) => catalog[k])).toBe('Domov');
    expect(resolvePageMeta(['i18n/t', 'app:missing'], (k) => catalog[k])).toBeUndefined();
    expect(resolvePageMeta(undefined, (k) => catalog[k])).toBeUndefined();
  });
});

describe('host sign-in route', () => {
  it('names the route every host provides itself', () => {
    expect(HOST_SIGN_IN_ROUTE).toBe('/login');
    expect(isHostSignInRoute('/login')).toBe(true);
  });
  it('edge: a trailing slash is the same route', () => {
    expect(isHostSignInRoute('/login/')).toBe(true);
  });
  it('control: other routes, even prefixed ones, are not it', () => {
    for (const path of ['/', '/login-help', '/login/step', '/Login', '/signin']) {
      expect(isHostSignInRoute(path)).toBe(false);
    }
  });
});

describe('translationOf and the stamped head on pages', () => {
  it('the schema accepts translationOf on pages and pageModifiers on orbital references', () => {
    const parsed = safeParseOrbitalSchema({
      name: 'app',
      orbitals: [
        {
          name: 'Blog',
          entity: { name: 'Post', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
          traits: [],
          pages: [{ name: 'PostAR', path: '/ar/blog/x', translationOf: 'blog/x', traits: [] }],
        },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(PageModifiersSchema.safeParse({ access: 'public', translationOf: 'x', view: 'list' }).success).toBe(false);
  });
});

describe('the stamped page head', () => {
  const page = (head: object) => ({
    name: 'app',
    orbitals: [{ name: 'Blog', entity: { name: 'Post', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] }, traits: [], pages: [{ name: 'PostAR', path: '/ar/blog/x', traits: [], head }] }],
  });

  it('the schema accepts the head a build stamps on a page', () => {
    expect(safeParseOrbitalSchema(page({ title: 'س', description: 'د', alternates: [{ locale: 'en', path: '/blog/x' }, { locale: 'ar', path: '/ar/blog/x' }] })).success).toBe(true);
  });

  it('control: a head with a key the compiler does not write is refused', () => {
    expect(safeParseOrbitalSchema(page({ title: 'x', image: '/a.png' })).success).toBe(false);
  });
});
