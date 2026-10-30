import { describe, expect, it } from 'vitest';
import { FIELD_TYPES, TYPE_POSITION_ONLY } from '../src/types/field.js';
import {
  aliasMap,
  getVocabulary,
  installedLanguages,
  lexLolo,
  localizeLoloSource,
  localizeMap,
  localizeOrbValue,
  vocabularyOperators,
  type LanguageCode,
  type OperatorTables,
} from '../src/i18n/index.js';
import { installFirstPartyPacks } from './language-packs.js';

installFirstPartyPacks();

function operatorsFor(lang: LanguageCode): OperatorTables | undefined {
  return vocabularyOperators(lang);
}

const SAMPLE = `app TaskApp "1.0.0"

orbital TaskManager {
  entity Task [persistent: tasks] {
    id : string!
    title : string
    completed : boolean = false
  }
  trait TaskBrowser -> Task [interaction] {
    initial: active
    state active {
      INIT -> active
        (fetch Task)
        (render-ui main { type: "data-list", entity: "Task", fields: ["title", "completed"] })
      COMPLETE -> active
        (set @entity.completed true)
    }
  }
  page "/tasks" -> TaskBrowser
}
`;

describe('lexLolo', () => {
  it('keeps a namespaced operator and a hyphenated effect as one token', () => {
    const texts = lexLolo('(str/upper (render-ui main null))')
      .filter((t) => t.kind === 'identifier')
      .map((t) => t.text);
    expect(texts).toEqual(['str/upper', 'render-ui', 'main']);
  });

  it('splits a sigil into prefix and name, and never enters a string or comment', () => {
    const tokens = lexLolo(';; @entity.x\n(set @entity.title "@entity.nope")');
    expect(tokens.filter((t) => t.kind === 'comment')).toHaveLength(1);
    expect(tokens.filter((t) => t.kind === 'sigil').map((t) => t.text)).toEqual(['entity.title']);
    expect(tokens.filter((t) => t.kind === 'string').map((t) => t.text)).toEqual(['"@entity.nope"']);
  });

  it('reads a payload sigil separately from a binding sigil', () => {
    const kinds = lexLolo('(set @entity.id ?row)').map((t) => t.kind);
    expect(kinds).toContain('sigil');
    expect(kinds).toContain('payload-sigil');
  });
});

describe('localizeMap', () => {
  it('is the identity for English', () => {
    for (const [english, native] of localizeMap('en')) expect(native).toBe(english);
  });

  it('omits a translation the parser would read back as a different word', () => {
    // Arabic has no letter case: `event` and `Event` are both `حدث`, and
    // `canon_any` resolves that to the keyword. See G-i18n-1.
    const ar = localizeMap('ar');
    expect(ar.get('event')).toBe(getVocabulary('ar').keywords.event);
    expect(ar.get('Event')).toBeUndefined();
    // Slovenian keeps the case distinction, so the shape survives.
    expect(localizeMap('sl').get('Event')).toBe(getVocabulary('sl').shapes.Event);
  });
});

describe('localizeLoloSource', () => {
  it('returns English unchanged', () => {
    expect(localizeLoloSource(SAMPLE, 'en')).toBe(SAMPLE);
  });

  it.each(['ar', 'sl'] as const)('translates the vocabulary of %s', (lang) => {
    const out = localizeLoloSource(SAMPLE, lang, { operators: operatorsFor(lang) });
    const t = getVocabulary(lang);
    expect(out).toContain(t.keywords.app);
    expect(out).toContain(t.keywords.orbital);
    expect(out).toContain(t.keywords.entity);
    expect(out).toContain(t.keywords.trait);
    expect(out).toContain(t.keywords.state);
    expect(out).toContain(t.keywords.page);
    expect(out).toContain(t.tags.persistent);
    expect(out).toContain(t.types.string);
    expect(out).toContain(t.effects.fetch);
    expect(out).toContain(t.effects['render-ui']);
    expect(out).toContain(t.effects.set);
    expect(out).toContain(t.sigils.entity);
    expect(out).toContain(t.literals.true);
    expect(out).toContain(t.reservedEvents.INIT);
  });

  it.each(['ar', 'sl'] as const)('leaves every author identifier alone in %s', (lang) => {
    const out = localizeLoloSource(SAMPLE, lang, { operators: operatorsFor(lang) });
    for (const name of ['TaskApp', 'TaskManager', 'Task', 'tasks', 'TaskBrowser', 'active', 'COMPLETE']) {
      expect(out).toContain(name);
    }
  });

  it.each(['ar', 'sl'] as const)('leaves pattern props opaque in %s', (lang) => {
    // `parse_object_literal` reads object keys verbatim, so a prop that spells
    // a keyword (`type`, `entity`, `fields`) must survive untranslated.
    const out = localizeLoloSource(SAMPLE, lang, { operators: operatorsFor(lang) });
    expect(out).toContain('{ type: "data-list", entity: "Task", fields: ["title", "completed"] }');
  });

  it.each(['ar', 'sl'] as const)('never translates a field name that spells a keyword (%s)', (lang) => {
    const source = 'app A "1"\norbital O {\n  entity E [runtime] {\n    state : string\n    name : string\n    event : string\n  }\n}\n';
    const out = localizeLoloSource(source, lang, { operators: operatorsFor(lang) });
    expect(out).toContain('state : ');
    expect(out).toContain('name : ');
    expect(out).toContain('event : ');
  });

  it.each(['ar', 'sl'] as const)('never translates a let binding name that spells an effect (%s)', (lang) => {
    // `(let ((match …)) …)` — `match` is the author's variable, not the
    // match operator, even though it sits right after a `(`.
    const source = 'app A "1"\norbital O {\n  entity E [runtime] { id : string }\n  trait T -> E [interaction] {\n    initial: s\n    state s {\n      INIT -> s\n        (let ((match (array/first @items))) (set @entity.id @match))\n    }\n  }\n}\n';
    const out = localizeLoloSource(source, lang, { operators: operatorsFor(lang) });
    expect(out).toContain('(match ');
    expect(out).toContain('@match');
  });

  it.each(['ar', 'sl'] as const)('keeps symbolic operators as symbols in %s', (lang) => {
    const source = 'app A "1"\norbital O {\n  entity E [runtime] { n : number }\n  trait T -> E [interaction] {\n    initial: s\n    state s {\n      INIT -> s when (>= @entity.n 1)\n        (set @entity.n (+ @entity.n 1))\n    }\n  }\n}\n';
    const out = localizeLoloSource(source, lang, { operators: operatorsFor(lang) });
    expect(out).toContain('(>= ');
    expect(out).toContain('(+ ');
  });

  it.each(['ar', 'sl'] as const)('preserves comments, blank lines and alignment in %s', (lang) => {
    const source = ';; a comment about state\napp A "1"\n\norbital O {\n  entity E [runtime] {\n    id    : string\n    title : string\n  }\n}\n';
    const out = localizeLoloSource(source, lang, { operators: operatorsFor(lang) });
    expect(out).toContain(';; a comment about state');
    expect(out.split('\n')).toHaveLength(source.split('\n').length);
    expect(out).toMatch(/id {4}: /);
  });
});

describe('localizeOrbValue', () => {
  it.each(['ar', 'sl'] as const)('rewrites keys, type values, heads and sigil roots for %s', (lang) => {
    const t = getVocabulary(lang);
    const out = localizeOrbValue(
      { orbitals: [{ name: 'Demo', entity: { name: 'Task', fields: [{ name: 'title', type: 'string' }] } }] },
      lang,
    );
    const json = JSON.stringify(out);
    expect(json).toContain(t.orb.orbitals);
    expect(json).toContain(t.types.string);
    // A user's name is a value, not a key — untouched.
    expect(json).toContain('"Demo"');
    expect(json).toContain('"Task"');
  });

  it('translates an s-expression head but not its arguments', () => {
    const out = localizeOrbValue({ effects: [['set', '@entity.title', 'set']] }, 'sl');
    expect(JSON.stringify(out)).toContain(getVocabulary('sl').effects.set);
    // The trailing "set" is a string VALUE and must survive.
    expect(JSON.stringify(out)).toContain('"set"');
  });

  it('returns English unchanged', () => {
    const value = { orbitals: [{ name: 'Demo' }] };
    expect(localizeOrbValue(value, 'en')).toBe(value);
  });
});

/**
 * The `types` section is the vocabulary for a type POSITION, so every value a
 * field may declare has to be spellable in every language. Nothing enforced
 * that before: `checkI18nCoverage` compares ar/sl against `en.json`, and
 * `i18n-orb-universe` pins the `.orb` KEY universe — neither compares
 * `en.json.types` against the type list core actually accepts. Five valid
 * field types (`array`, `enum`, `relation`, `node`, `union`) had drifted out
 * of the table, so `x : enum` could not be written in Arabic or Slovenian at
 * all. See docs/Almadar_i18n_Gaps.md.
 *
 * The reverse containment is deliberately NOT asserted: `types` also carries
 * words that are legal in a type position without being a FIELD type
 * (`int`, `void`, `any`, `Map`, `SExpr`, `component`, `secret`, …).
 */
describe('types vocabulary vs the field-type universe', () => {
  it('every FIELD_TYPES member is translatable in every language', () => {
    const missing: string[] = [];
    for (const fieldType of FIELD_TYPES) {
      for (const lang of installedLanguages()) {
        if (getVocabulary(lang).types[fieldType] === undefined) {
          missing.push(`${lang}.types.${fieldType}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  // Derive rather than pin (G-i18n-5): the `types` vocabulary section is
  // exactly FIELD_TYPES (entity field types) ∪ TYPE_POSITION_ONLY (words
  // legal in a type position that aren't field types) — nothing more,
  // nothing less. This catches an unexplained extra key too, which the
  // one-directional check above cannot.
  it('en.json "types" section is exactly FIELD_TYPES ∪ TYPE_POSITION_ONLY, for every language', () => {
    const expected = [...FIELD_TYPES, ...TYPE_POSITION_ONLY].slice().sort();
    for (const lang of installedLanguages()) {
      const actual = Object.keys(getVocabulary(lang).types).sort();
      expect(actual, `${lang}.json "types" section`).toEqual(expected);
    }
  });

  it('each one round-trips — the emitted spelling reads back as the same type', () => {
    for (const lang of installedLanguages()) {
      const forward = localizeMap(lang);
      for (const fieldType of FIELD_TYPES) {
        const native = forward.get(fieldType);
        // `undefined` means the guard withheld it (an ambiguous spelling);
        // anything emitted must canonicalize back.
        if (native === undefined) continue;
        expect(aliasMap(lang, 'types').get(native)).toBe(fieldType);
      }
    }
  });
});

/**
 * These three defects all round-trip — the inbound walker applied the same
 * rule as the outbound one, so `orb emit orb` matched and the corpus gate
 * stayed green while the output was wrong. A symmetric error is invisible to a
 * symmetric gate, so each needs an assertion of its own.
 */
describe('the `type` overload, resolved by position', () => {
  const RENDER_UI = {
    effects: [
      ['render-ui', 'main', { type: 'icon', name: 'shopping-cart', size: 'lg' }],
    ],
  };

  it.each(['ar', 'sl'] as const)('leaves a pattern name alone inside an s-expression (%s)', (lang) => {
    // `icon` is the one pattern name (of 279) that collides with a field-type
    // word, and it appears 483 times in the docs corpus.
    const json = JSON.stringify(localizeOrbValue(RENDER_UI, lang));
    expect(json).toContain('"icon"');
    expect(json).not.toContain(getVocabulary(lang).types.icon);
  });

  it.each(['ar', 'sl'] as const)('still translates a field type outside one (%s)', (lang) => {
    const out = localizeOrbValue(
      { orbitals: [{ entity: { fields: [{ name: 'avatar', type: 'icon' }] } }] },
      lang,
    );
    expect(JSON.stringify(out)).toContain(getVocabulary(lang).types.icon);
  });

  it.each(['ar', 'sl'] as const)('does not mistake a plain string list for an expression (%s)', (lang) => {
    // `["title", "completed"]` has a string head but is not an s-expression.
    const out = localizeOrbValue(
      { orbitals: [{ entity: { fields: [{ name: 'a', type: 'date' }] } }], values: ['title', 'completed'] },
      lang,
    );
    const json = JSON.stringify(out);
    expect(json).toContain('"title"');
    expect(json).toContain(getVocabulary(lang).types.date);
  });
});

describe('persistence values', () => {
  it.each(['ar', 'sl'] as const)('translates the persistence tag in %s', (lang) => {
    const out = localizeOrbValue({ orbitals: [{ entity: { persistence: 'persistent' } }] }, lang);
    expect(JSON.stringify(out)).toContain(getVocabulary(lang).tags.persistent);
  });

  it.each(['ar', 'sl'] as const)('round-trips through the inbound alias map (%s)', (lang) => {
    const native = getVocabulary(lang).tags.persistent;
    expect(aliasMap(lang, 'tags').get(native)).toBe('persistent');
  });
});
