/**
 * Page modifiers (`access`, `indexing`, `title`, `description`) and the app
 * `site` modifiers: the schema accepts exactly the declared shapes, and the
 * resolver carries them onto the ResolvedPage without defaulting absent ones.
 */
import { describe, it, expect } from 'vitest';
import { parseOrbitalSchema, safeParseOrbitalSchema, HOST_SIGN_IN_ROUTE, isHostSignInRoute } from '../src/types/schema.js';
import { schemaToIR, getPage, pageModifiers } from '../src/resolver.js';
import { localeAlternates } from '../src/i18n/index.js';
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
  it('resolves declared modifiers onto the page', () => {
    const schema = parseOrbitalSchema(
      app(
        { access: 'public', indexing: 'index', title: 'Home', description: ['i18n/t', 'app:meta.home'] },
        { origin: 'https://example.org', signIn: '/login', name: 'Example', icon: '/icon.svg' },
      ),
    );
    const page = getPage(schemaToIR(schema, false), 'HomePage');
    expect(page?.access).toBe('public');
    expect(page?.indexing).toBe('index');
    expect(page?.title).toBe('Home');
    expect(page?.description).toEqual(['i18n/t', 'app:meta.home']);
    expect(schema.site?.signIn).toBe('/login');
  });

  it('control: omitted modifiers stay absent on the resolved page', () => {
    const page = getPage(schemaToIR(parseOrbitalSchema(app({})), false), 'HomePage');
    expect(page).toBeDefined();
    for (const key of ['access', 'indexing', 'title', 'description'] as const) {
      expect(page && key in page).toBe(false);
    }
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

describe('localeAlternates (twin of orbital-compiler locale_alternates)', () => {
  const locales = ['en', 'ar', 'sl'];
  const pub = { access: 'public' as const, indexing: 'index' as const };
  const pages = [
    { path: '/', sourcePage: 'pag_home', ...pub },
    { path: '/sl', sourcePage: 'pag_home', ...pub },
    { path: '/ar', sourcePage: 'pag_home', ...pub },
    { path: '/docs', ...pub },
    { path: '/a', sourcePage: 'pag_post', ...pub },
    { path: '/b', sourcePage: 'pag_post', ...pub },
  ];

  it('imports of one page in different locales are alternates in locale order', () => {
    expect(localeAlternates(pages, pages[1], locales)).toEqual([
      { locale: 'en', path: '/' },
      { locale: 'ar', path: '/ar' },
      { locale: 'sl', path: '/sl' },
    ]);
  });

  it('control: a page with no source has none', () => {
    expect(localeAlternates(pages, pages[3], locales)).toBeUndefined();
  });

  it('edge: two imports in one locale are not alternates', () => {
    expect(localeAlternates(pages, pages[4], locales)).toBeUndefined();
  });

  it('edge: a private or unindexed translation drops out, and a private page gets none', () => {
    const mixed = pages.map((p) => (p.path === '/sl' ? { ...p, indexing: 'noindex' as const } : p.path === '/ar' ? { ...p, access: 'authenticated' as const } : p));
    expect(localeAlternates(mixed, mixed[0], locales)).toBeUndefined();
    expect(localeAlternates(mixed, mixed[2], locales)).toBeUndefined();
  });

  it('pageModifiers carries the source page onto the resolved page', () => {
    expect(pageModifiers({ sourcePage: 'pag_home' })).toEqual({ sourcePage: 'pag_home' });
  });
});

describe('translationOf groups pages that are not imports of one page', () => {
  const locales = ['en', 'ar'];
  const pub = { access: 'public' as const, indexing: 'index' as const };

  it('separately authored translations sharing translationOf are alternates', () => {
    const pages = [{ path: '/blog/x', translationOf: 'blog/x', ...pub }, { path: '/ar/blog/x', translationOf: 'blog/x', ...pub }];
    expect(localeAlternates(pages, pages[1], locales)).toEqual([{ locale: 'en', path: '/blog/x' }, { locale: 'ar', path: '/ar/blog/x' }]);
  });

  it('control: translationOf takes precedence over a shared sourcePage', () => {
    const pages = [
      { path: '/a', sourcePage: 'pag_x', translationOf: 'a', ...pub },
      { path: '/ar/b', sourcePage: 'pag_x', translationOf: 'b', ...pub },
    ];
    expect(localeAlternates(pages, pages[0], locales)).toBeUndefined();
  });

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
