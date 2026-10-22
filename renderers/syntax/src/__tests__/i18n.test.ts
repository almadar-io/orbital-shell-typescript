/**
 * The `.lolo`/`.orb` grammars must highlight a program rendered in Arabic or
 * Slovenian, not just the English source it was rendered from.
 *
 * The regression this guards: every keyword list used to be anchored with
 * `\b`, which is ASCII-only in JavaScript regex and therefore can NEVER match
 * Arabic script — an Arabic rendering came out as one unstyled wall.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { getVocabulary } from '@almadar/core/i18n';
import { translateLolo, translateOrb, multilingualWords, multilingualOrbKeys, stdOperatorTables } from '../i18n.js';
import { classifyLoloToken, registerLoloLanguage } from '../lolo/prism-lolo.js';
import { classifyOrbToken, registerOrbLanguage } from '../prism-orb.js';

const EN_SOURCE = `app Shop

entity Product [persistent: products]
  price: number

trait Cart for Product [interaction]
  initial idle
  state idle
    on ADD -> active
      (persist create @entity)
      (emit CART_CHANGED)
  state active
`;

/** Prism resolves a token by first matching grammar entry; reproduce that. */
function grammarClassOf(grammar: Record<string, unknown>, token: string): string | undefined {
  for (const [name, entry] of Object.entries(grammar)) {
    const pattern = entry instanceof RegExp
      ? entry
      : (entry !== null && typeof entry === 'object' && 'pattern' in entry && entry.pattern instanceof RegExp
        ? entry.pattern
        : undefined);
    if (!pattern) continue;
    const match = pattern.exec(token);
    if (match && match.index === 0 && match[0].length === token.length) return name;
  }
  return undefined;
}

function loloGrammar(): Record<string, unknown> {
  const prism: { languages: Record<string, unknown> } = { languages: {} };
  registerLoloLanguage(prism);
  const grammar = prism.languages.lolo;
  if (grammar === null || typeof grammar !== 'object') throw new Error('lolo grammar not registered');
  return { ...grammar };
}

describe('translateLolo / translateOrb', () => {
  it('renders the English source in Arabic, preserving layout', () => {
    const ar = translateLolo(EN_SOURCE, 'ar');
    expect(ar).toContain('تطبيق Shop');
    expect(ar).toContain('كيان Product [دائم: products]');
    expect(ar).toContain('(حفظ create @كيان)');
    expect(ar.split('\n').length).toBe(EN_SOURCE.split('\n').length);
  });

  it('renders the English source in Slovenian', () => {
    const sl = translateLolo(EN_SOURCE, 'sl');
    expect(sl).toContain('aplikacija Shop');
    expect(sl).toContain('entiteta Product [trajno: products]');
  });

  it('is the identity for English', () => {
    expect(translateLolo(EN_SOURCE, 'en')).toBe(EN_SOURCE);
  });

  it('translates .orb keys and effect heads, string in / string out', () => {
    const orb = JSON.stringify({ orbitals: [{ name: 'Shop', effects: [['persist', 'create', '@entity.id']] }] });
    const ar = translateOrb(orb, 'ar');
    expect(typeof ar).toBe('string');
    if (typeof ar !== 'string') throw new Error('unreachable');
    const parsed: unknown = JSON.parse(ar);
    expect(Object.keys(parsed as Record<string, unknown>)).toEqual(['مدارات']);
    expect(ar).toContain('"حفظ"');
  });

  it('translates a parsed .orb value in place', () => {
    const out = translateOrb({ orbitals: [] }, 'sl');
    expect(out).toEqual({ orbitale: [] });
  });

  it('returns unparseable .orb text verbatim rather than throwing', () => {
    expect(translateOrb('{ not json', 'ar')).toBe('{ not json');
  });
});

describe('multilingual word lists', () => {
  it('carries the ar and sl spelling of a .lolo keyword', () => {
    expect(multilingualWords(['entity'])).toEqual(expect.arrayContaining(['entity', 'كيان', 'entiteta']));
  });

  it('leaves symbolic operators as their sign', () => {
    // The renderer keeps `+` in every language, so its word translation must
    // never enter a grammar pattern.
    expect(multilingualWords(['+'])).toEqual(['+']);
  });

  it('carries .orb key spellings, which live outside the .lolo vocabulary', () => {
    expect(multilingualOrbKeys(['orbitals'])).toEqual(expect.arrayContaining(['orbitals', 'مدارات', 'orbitale']));
  });
});

describe('lolo grammar highlights native text', () => {
  const grammar = loloGrammar();
  const pairs: ReadonlyArray<readonly [string, string, string]> = [
    ['app', 'تطبيق', 'aplikacija'],
    ['entity', 'كيان', 'entiteta'],
    ['trait', 'سمة', 'znacilnost'],
    ['state', 'حالة', 'stanje'],
    ['persist', 'حفظ', 'shrani'],
    ['emit', 'بث', 'oddaj'],
    ['number', 'رقم', 'stevilo'],
    ['persistent', 'دائم', 'trajno'],
    ['interaction', 'تفاعل', 'interakcija'],
    ['true', 'صحيح', 'drzi'],
  ];

  for (const [en, ar, sl] of pairs) {
    it(`${en} / ${ar} / ${sl} share one token class`, () => {
      const expected = grammarClassOf(grammar, en);
      expect(expected).toBeDefined();
      expect(grammarClassOf(grammar, ar)).toBe(expected);
      expect(grammarClassOf(grammar, sl)).toBe(expected);
    });

    it(`${en} / ${ar} / ${sl} classify alike`, () => {
      const expected = classifyLoloToken(en);
      expect(classifyLoloToken(ar)).toBe(expected);
      expect(classifyLoloToken(sl)).toBe(expected);
    });
  }

  it('tokenizes an Arabic snippet: every word keeps its English class', () => {
    const ar = translateLolo(EN_SOURCE, 'ar');
    // `on` is absent from the English keyword list too (a pre-existing gap in
    // tokens.json, not an i18n one) — parity is the invariant, not coverage.
    const words: ReadonlyArray<readonly [string, string]> = [
      ['app', 'تطبيق'], ['entity', 'كيان'], ['persistent', 'دائم'], ['number', 'رقم'],
      ['trait', 'سمة'], ['for', 'من_أجل'], ['interaction', 'تفاعل'], ['initial', 'أولي'],
      ['state', 'حالة'], ['on', 'عند'], ['persist', 'حفظ'], ['emit', 'بث'],
    ];
    for (const [en, word] of words) {
      expect(ar).toContain(word);
      expect(grammarClassOf(grammar, word)).toBe(grammarClassOf(grammar, en));
    }
  });

  it('an Arabic binding sigil is a binding', () => {
    expect(grammarClassOf(grammar, '@كيان')).toBe('lolo-binding');
    expect(grammarClassOf(grammar, '@كيان.المعرف')).toBe('lolo-binding');
    expect(classifyLoloToken('@كيان')).toBe('binding');
  });

  it('a hyphenated English effect still matches (no \\b regression)', () => {
    expect(grammarClassOf(grammar, 'render-ui')).toBe('lolo-effect');
  });
});

// A real compilable program — `orb` requires every declaration inside an
// `orbital { }` block, and language detection (`Lang::for_lolo_first_token`)
// reads the FIRST token, so a header-less file can never be recognized as
// Arabic/Slovenian (the file would open with `orbital`, common to every
// language). `EN_SOURCE` above is flat/header-less on purpose — it only
// exercises text rendering and grammar tokenization, never the parser.
const ROUNDTRIP_SOURCE = `app OrderApp

orbital OrderOrbital {
  entity Order [persistent: orders] {
    id : string!
    status : string
  }
  trait OrderLifecycle -> Order [interaction] {
    initial: pending
    state pending {
      CONFIRM -> confirmed
        (set @status "confirmed")
      CANCEL -> cancelled
        (set @status "cancelled")
    }
    state confirmed {
      SHIP -> shipped
        (set @status "shipped")
    }
    state shipped {
      DELIVER -> delivered
        (set @status "delivered")
    }
    state delivered {
    }
    state cancelled {
    }
  }
}
`;

/** Same shape as `orbital-lolo/tests/i18n_round_trip.rs::canonicalize` — V4
 * identity fields (ids/ledger/schemaVersion) are minted fresh per lowering,
 * not semantic content. */
function canonicalizeOrb(value: unknown): unknown {
  const isIdentityKey = (k: string) =>
    k === 'id' || k === 'ledger' || k === 'schemaVersion' || k.endsWith('Id') || k.endsWith('Ids');
  if (Array.isArray(value)) return value.map(canonicalizeOrb);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (isIdentityKey(key)) continue;
      out[key] = canonicalizeOrb((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function resolveOrbBin(): string | undefined {
  const fromEnv = process.env.ORB_BIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const home = join(homedir(), 'bin/orb');
  if (existsSync(home)) return home;
  return undefined;
}

describe('translateLolo round-trips through the Rust parser', () => {
  const orbBin = resolveOrbBin();
  if (!orbBin) {
    console.log('[i18n.test] ORB_BIN not set and ~/bin/orb missing — skipping the Rust parser round-trip.');
  }

  it.skipIf(!orbBin)('ar and sl renderings lower to the same .orb as the English source', () => {
    const dir = mkdtempSync(join(tmpdir(), 'almadar-syntax-i18n-'));
    const emit = (name: string, source: string): unknown => {
      const loloPath = join(dir, `${name}.lolo`);
      writeFileSync(loloPath, source, 'utf-8');
      const outPath = join(dir, `${name}.orb.json`);
      execFileSync(orbBin as string, ['emit', 'orb', loloPath, '--format', 'json', '-o', outPath]);
      return JSON.parse(readFileSync(outPath, 'utf-8'));
    };

    const en = canonicalizeOrb(emit('en', ROUNDTRIP_SOURCE));
    const ar = canonicalizeOrb(emit('ar', translateLolo(ROUNDTRIP_SOURCE, 'ar')));
    const sl = canonicalizeOrb(emit('sl', translateLolo(ROUNDTRIP_SOURCE, 'sl')));

    expect(ar).toEqual(en);
    expect(sl).toEqual(en);
  });
});

describe('every operator translation the binding emits canonicalizes back', () => {
  // Mirrors `checkI18nCoverage` rule 3 (no two English words share a native
  // spelling within `effects ∪ operators` — one s-expression head position),
  // but against the table the BINDING actually produces (baked
  // `tokens.json`, routed through `stdOperatorTables`) rather than the raw
  // JSON file — this is what would catch a bake/snapshot corruption that the
  // core-side coverage gate never sees.
  for (const lang of ['ar', 'sl'] as const) {
    it(`${lang}: every effect + operator native spelling maps back to exactly one English word`, () => {
      const effects = getVocabulary(lang).effects;
      const operators = stdOperatorTables(lang).operators;
      const reverse = new Map<string, string>();
      for (const [english, native] of [...Object.entries(effects), ...Object.entries(operators)]) {
        const existing = reverse.get(native);
        if (existing !== undefined && existing !== english) {
          throw new Error(`"${native}" is both "${existing}" and "${english}" in ${lang}`);
        }
        reverse.set(native, english);
      }
      // A word-shaped operator's translation, read back through the same
      // table it came from, is the operator it started as.
      for (const [english, native] of Object.entries(operators)) {
        if (!/^[A-Za-z_][A-Za-z0-9_/-]*$/.test(english)) continue; // symbolic (`+`, `==`) — notation, not word
        expect(reverse.get(native)).toBe(english);
      }
    });
  }
});

describe('orb grammar highlights native text', () => {
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ['"orbitals"', '"مدارات"'],
    ['"persist"', '"حفظ"'],
    ['"@entity"', '"@كيان"'],
  ];
  for (const [en, ar] of pairs) {
    it(`${en} / ${ar} classify alike`, () => {
      expect(classifyOrbToken(ar)).toBe(classifyOrbToken(en));
    });
  }

  it('registers an orb grammar whose inside patterns match native strings', () => {
    const json = { property: {}, string: {} };
    const prism: { languages: Record<string, unknown> } = { languages: { json } };
    registerOrbLanguage(prism);
    const orb = prism.languages.orb;
    if (orb === null || typeof orb !== 'object' || !('string' in orb)) throw new Error('orb grammar not registered');
    const stringToken = orb.string;
    if (stringToken === null || typeof stringToken !== 'object' || !('inside' in stringToken)) {
      throw new Error('orb string token has no inside grammar');
    }
    const inside = stringToken.inside;
    if (inside === null || typeof inside !== 'object') throw new Error('orb inside grammar missing');
    expect(grammarClassOf({ ...inside }, '"حفظ"')).toBe('orb-effect');
    expect(grammarClassOf({ ...inside }, '"مدارات"')).toBe('orb-structural');
  });
});
