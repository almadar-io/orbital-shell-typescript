import { describe, it, expect } from 'vitest';
import { translateLolo, multilingualWords, NativeLanguagesNotInstalledError } from '../i18n.js';
import { registerOrbLanguage } from '../prism-orb.js';

describe('before installNativeLanguages', () => {
  it('a native-word reader throws the typed not-installed error, never an empty list', () => {
    expect(() => multilingualWords(['entity'])).toThrow(NativeLanguagesNotInstalledError);
    expect(() => translateLolo('app Shop', 'ar')).toThrow(NativeLanguagesNotInstalledError);
    expect(() => registerOrbLanguage({ languages: { json: { property: {}, string: {} } } })).toThrow(NativeLanguagesNotInstalledError);
  });

  it('control: English needs no pack, so translating to en is unchanged', () => {
    expect(translateLolo('app Shop', 'en')).toBe('app Shop');
  });
});
