import { describe, expect, it } from 'vitest';
import {
  checkI18nCoverage,
  reportIdenticalToEnglish,
  type I18nTables,
  type LanguageCode,
  type OperatorTables,
} from '../src/i18n/index.js';
import { installFirstPartyPacks } from './language-packs.js';

// ---------------------------------------------------------------------------
// Minimal fixtures — a small, self-consistent vocabulary that exercises every
// checkI18nCoverage rule without carrying the full B1 section vocabulary
// (that is covered separately against English + the first-party packs below).
// ---------------------------------------------------------------------------

function freshCore(): Record<LanguageCode, I18nTables> {
  return {
    en: {
      meta: { code: 'en', name: 'English', rtl: false },
      keywords: { app: 'app', orbital: 'orbital', state: 'state' },
      shapes: { Entity: 'Entity' },
      tags: { persistent: 'persistent' },
      categories: { interaction: 'interaction' },
      capabilities: { read: 'read' },
      annotations: { key: 'key' },
      sigils: { entity: 'entity', state: 'state' },
      effects: { set: 'set', emit: 'emit' },
      types: { string: 'string' },
      units: { ms: 'ms' },
      literals: { true: 'true' },
      reservedEvents: { INIT: 'INIT' },
      orb: { orbitals: 'orbitals', name: 'name' },
    },
    ar: {
      meta: { code: 'ar', name: 'Arabic', rtl: true },
      keywords: { app: 'تطبيق', orbital: 'مدار', state: 'حالة' },
      shapes: { Entity: 'كيان' },
      tags: { persistent: 'دائم' },
      categories: { interaction: 'تفاعل' },
      capabilities: { read: 'قراءة' },
      annotations: { key: 'مفتاح' },
      sigils: { entity: 'كيان_سياق', state: 'حالة' },
      effects: { set: 'ضبط', emit: 'إصدار' },
      types: { string: 'نص' },
      units: { ms: 'مللي' },
      literals: { true: 'صحيح' },
      reservedEvents: { INIT: 'ابدأ' },
      orb: { orbitals: 'مدارات', name: 'اسم' },
    },
    sl: {
      meta: { code: 'sl', name: 'Slovenian', rtl: false },
      keywords: { app: 'aplikacija', orbital: 'orbitala', state: 'stanje' },
      shapes: { Entity: 'entiteta' },
      tags: { persistent: 'trajno' },
      categories: { interaction: 'interakcija' },
      capabilities: { read: 'branje' },
      annotations: { key: 'kljuc' },
      sigils: { entity: 'entitetaSigil', state: 'stanje' },
      effects: { set: 'nastavi', emit: 'sprozi' },
      types: { string: 'niz' },
      // Loanword, deliberately identical to English — exercises reportIdenticalToEnglish.
      units: { ms: 'ms' },
      literals: { true: 'true' },
      reservedEvents: { INIT: 'ZACNI' },
      orb: { orbitals: 'orbitale', name: 'ime' },
    },
  };
}

function freshStd(): Record<LanguageCode, OperatorTables> {
  return {
    en: { operators: { '+': '+', '-': '-' } },
    ar: { operators: { '+': '+', '-': '-' } },
    sl: { operators: { '+': '+', '-': '-' } },
  };
}

const canonicalOperators = ['+', '-'] as const;

describe('checkI18nCoverage — pass case', () => {
  it('reports ok on a self-consistent fixture', () => {
    const result = checkI18nCoverage({ core: freshCore(), std: freshStd(), canonicalOperators });
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('checkI18nCoverage — one failing case per problem kind', () => {
  it('missing: a language omits an English key', () => {
    const core = freshCore();
    delete core.ar.keywords.state;
    const result = checkI18nCoverage({ core });
    expect(result.ok).toBe(false);
    expect(result.problems).toContainEqual({ lang: 'ar', section: 'keywords', kind: 'missing', key: 'state' });
  });

  it('orphan: a language has a key English does not', () => {
    const core = freshCore();
    core.sl.keywords.extra = 'nekaj';
    const result = checkI18nCoverage({ core });
    expect(result.ok).toBe(false);
    expect(result.problems).toContainEqual({ lang: 'sl', section: 'keywords', kind: 'orphan', key: 'extra' });
  });

  it('empty: a translated value is the empty string', () => {
    const core = freshCore();
    core.ar.types.string = '';
    const result = checkI18nCoverage({ core });
    expect(result.ok).toBe(false);
    expect(result.problems).toContainEqual({ lang: 'ar', section: 'types', kind: 'empty', key: 'string' });
  });

  it('inconsistent: the same English word translated differently across sections', () => {
    const core = freshCore();
    core.ar.sigils.state = 'مختلف';
    const result = checkI18nCoverage({ core });
    expect(result.ok).toBe(false);
    const problem = result.problems.find((p) => p.kind === 'inconsistent' && p.lang === 'ar' && p.key === 'state');
    expect(problem).toBeDefined();
    expect(problem?.section).toBe('sigils');
  });

  it('collision: two English keys share a native value in one section', () => {
    const core = freshCore();
    core.ar.keywords.orbital = core.ar.keywords.app; // 'تطبيق'
    const result = checkI18nCoverage({ core });
    expect(result.ok).toBe(false);
    expect(result.problems).toContainEqual({
      lang: 'ar',
      section: 'keywords',
      kind: 'collision',
      key: 'orbital',
      detail: 'shares native value "تطبيق" with "app" in keywords',
    });
  });

  it('collision: an effect and an operator share a native value', () => {
    const core = freshCore();
    const std = freshStd();
    std.ar.operators['+'] = core.ar.effects.set; // 'ضبط'
    const result = checkI18nCoverage({ core, std, canonicalOperators });
    expect(result.ok).toBe(false);
    const problem = result.problems.find((p) => p.kind === 'collision' && p.section === 'effects∪operators');
    expect(problem).toBeDefined();
    expect(problem).toMatchObject({ lang: 'ar', key: '+' });
  });

  it('selector-not-unique: keywords.app collides across languages', () => {
    const core = freshCore();
    core.sl.keywords.app = core.ar.keywords.app; // 'تطبيق'
    const result = checkI18nCoverage({ core });
    expect(result.ok).toBe(false);
    const langs = result.problems.filter((p) => p.kind === 'selector-not-unique' && p.key === 'app').map((p) => p.lang).sort();
    expect(langs).toEqual(['ar', 'sl']);
  });

  it('selector-not-unique: orb.orbitals collides across languages', () => {
    const core = freshCore();
    core.sl.orb.orbitals = core.en.orb.orbitals; // 'orbitals'
    const result = checkI18nCoverage({ core });
    expect(result.ok).toBe(false);
    const langs = result.problems.filter((p) => p.kind === 'selector-not-unique' && p.key === 'orbitals').map((p) => p.lang).sort();
    expect(langs).toEqual(['en', 'sl']);
  });

  it('operators-mismatch: a language operator table diverges from the canonical set', () => {
    const core = freshCore();
    const std = freshStd();
    delete std.ar.operators['-'];
    std.ar.operators['*'] = '*';
    const result = checkI18nCoverage({ core, std, canonicalOperators });
    expect(result.ok).toBe(false);
    expect(result.problems).toContainEqual({ lang: 'ar', section: 'operators', kind: 'operators-mismatch', key: '-', detail: 'missing from language operator table' });
    expect(result.problems).toContainEqual({ lang: 'ar', section: 'operators', kind: 'operators-mismatch', key: '*', detail: 'not present in canonical operator set' });
  });

  it('identical-to-english: informational only, never fails checkI18nCoverage', () => {
    const core = freshCore(); // sl.units.ms === en.units.ms === 'ms' by construction
    const result = checkI18nCoverage({ core });
    expect(result.ok).toBe(true);
    expect(result.problems.some((p) => p.kind === 'identical-to-english')).toBe(false);

    const identical = reportIdenticalToEnglish({ core });
    expect(identical).toContainEqual({ lang: 'sl', section: 'units', kind: 'identical-to-english', key: 'ms', detail: 'matches English value "ms"' });
    expect(identical).toContainEqual({ lang: 'sl', section: 'literals', kind: 'identical-to-english', key: 'true', detail: 'matches English value "true"' });
  });
});

// ---------------------------------------------------------------------------
// English plus the first-party language packs (devDependencies). Operator
// parity against std's canonical set is std's i18n-operators test and the
// pattern-sync `i18n` gate.
// ---------------------------------------------------------------------------

describe('checkI18nCoverage — English and the first-party packs', () => {
  it('pass the coverage gate', () => {
    const result = checkI18nCoverage({ core: installFirstPartyPacks() });

    if (!result.ok) {
      const byKind = new Map<string, number>();
      for (const p of result.problems) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
      console.error(
        `i18n coverage: ${result.problems.length} problem(s) — ` +
          [...byKind.entries()].map(([kind, count]) => `${kind}=${count}`).join(', '),
      );
      for (const p of result.problems) {
        console.error(`  [${p.lang}] ${p.section}.${p.kind}: ${p.key}${p.detail ? ' — ' + p.detail : ''}`);
      }
    }

    expect(result.ok, `${result.problems.length} i18n coverage problem(s) — see console output above`).toBe(true);
  });
});
