import { beforeAll, describe, expect, it } from 'vitest';
import {
  getVocabulary,
  installedLanguages,
  languageOfLoloFirstToken,
  parseVocabularyPack,
  registerVocabulary,
  vocabularyOperators,
} from '../src/i18n/index.js';
import { KernelEvaluatorNotInstalledError } from '../src/kernel-evaluator.js';
import { installTestKernel } from './kernel-glue.js';

function pack(code: string, words: { app: string; orbital: string; orbitals: string; set?: string }) {
  return parseVocabularyPack(
    {
      meta: { code, name: `Lang ${code}`, rtl: false },
      keywords: { app: words.app, orbital: words.orbital },
      effects: words.set === undefined ? {} : { set: words.set },
      orb: { orbitals: words.orbitals },
      operators: { 'math/abs': `${code}-abs` },
    },
    `${code}.json`,
  );
}

describe('vocabulary registry without a kernel', () => {
  it('registering a pack before a kernel is installed throws KernelEvaluatorNotInstalledError', () => {
    expect(() => registerVocabulary(pack('xz', { app: 'xzapp', orbital: 'xzorbital', orbitals: 'xzorbitals' }))).toThrow(KernelEvaluatorNotInstalledError);
    expect(installedLanguages()).not.toContain('xz');
  });
});

describe('vocabulary registry', () => {
  beforeAll(async () => {
    await installTestKernel();
  });

  it('has English built in and nothing else until a pack is registered', () => {
    expect(installedLanguages()).toContain('en');
    expect(getVocabulary('en').keywords.orbital).toBe('orbital');
    expect(() => getVocabulary('zz')).toThrow(/zz.*not installed/);
  });

  it('a registered pack is a language: its words select it and its operators are served', () => {
    registerVocabulary(pack('xa', { app: 'xapp', orbital: 'xorbital', orbitals: 'xorbitals' }));
    expect(installedLanguages()).toContain('xa');
    expect(getVocabulary('xa').keywords.app).toBe('xapp');
    expect(languageOfLoloFirstToken('xorbital')).toBe('xa');
    expect(vocabularyOperators('xa')?.operators['math/abs']).toBe('xa-abs');
    expect(vocabularyOperators('en')).toBeUndefined();
  });

  it('control: registering the same pack again is a no-op', () => {
    const p = pack('xb', { app: 'xbapp', orbital: 'xborbital', orbitals: 'xborbitals' });
    registerVocabulary(p);
    expect(() => registerVocabulary(p)).not.toThrow();
  });

  it('a different pack claiming an installed code is refused', () => {
    registerVocabulary(pack('xc', { app: 'xcapp', orbital: 'xcorbital', orbitals: 'xcorbitals' }));
    expect(() => registerVocabulary(pack('xc', { app: 'other', orbital: 'xcorbital', orbitals: 'xcorbitals' }))).toThrow(/xc.*already installed/);
  });

  it('twin of the kernel pack check (`validate_packs`): one English word spelled two ways across sections is refused naming section and word; same spelling or one section loads', () => {
    const http = (keyword: string, effect: string | undefined) =>
      parseVocabularyPack(
        {
          meta: { code: 'xi', name: 'Lang xi', rtl: false },
          keywords: { orbital: 'xi-orbital', http: keyword },
          effects: effect === undefined ? {} : { http: effect },
          orb: { orbitals: 'xi-orbitals' },
          operators: { 'math/abs': 'xi-abs' },
        },
        'xi.json',
      );
    expect(() => registerVocabulary(http('qi-http-a', 'qi-http-b'))).toThrow(/xi[\s\S]*Inconsistent effects\.http[\s\S]*qi-http-a[\s\S]*qi-http-b/);
    expect(installedLanguages()).not.toContain('xi');
    expect(() => registerVocabulary(http('qi-http', undefined))).not.toThrow();
  });

  it('English cannot be replaced by a pack', () => {
    expect(() => registerVocabulary(pack('en', { app: 'a', orbital: 'b', orbitals: 'c' }))).toThrow(/English is built in/);
  });

  it('a pack whose language selector another pack already uses is refused, naming both', () => {
    registerVocabulary(pack('xd', { app: 'xdapp', orbital: 'shared-orbital', orbitals: 'xdorbitals' }));
    expect(() => registerVocabulary(pack('xe', { app: 'xeapp', orbital: 'shared-orbital', orbitals: 'xeorbitals' }))).toThrow(/xe[\s\S]*SelectorNotUnique/);
    expect(installedLanguages()).not.toContain('xe');
  });

  it('a pack with two English words on one native spelling is refused', () => {
    expect(() =>
      registerVocabulary(
        parseVocabularyPack(
          { meta: { code: 'xf', name: 'F', rtl: false }, keywords: { app: 'same', orbital: 'same' }, orb: { orbitals: 'xforbitals' }, operators: {} },
          'xf.json',
        ),
      ),
    ).toThrow(/xf[\s\S]*Collision/);
  });

  it('edge: a pack missing words is accepted — English spellings stay legal there', () => {
    expect(() => registerVocabulary(pack('xg', { app: 'xgapp', orbital: 'xgorbital', orbitals: 'xgorbitals' }))).not.toThrow();
  });

  it('edge: a malformed pack fails naming its source', () => {
    expect(() => parseVocabularyPack({ meta: { code: 'xh', name: 'H', rtl: false }, keywords: {} }, 'xh.json')).toThrow(/xh\.json.*operators/);
    expect(() => parseVocabularyPack({ meta: { code: 'X Y', name: 'H', rtl: false }, operators: {} }, 'bad.json')).toThrow(/bad\.json.*meta/);
  });
});
