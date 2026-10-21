import { describe, it, expect } from 'vitest';
import { createTranslate } from '../../index';
import ar from '../../locales/ar.json';
import sl from '../../locales/sl.json';
import en from '../../locales/en.json';

// Built-in component labels follow the page's locale: app message, then the
// UI catalog of that locale, then English, then the key itself.
describe('createTranslate locale fallback', () => {
  it('a UI label missing from the app catalog comes from the UI catalog of the locale', () => {
    expect(createTranslate({}, 'ar')('agentChat.today')).toBe(ar['agentChat.today']);
    expect(createTranslate({}, 'sl')('agentChat.today')).toBe(sl['agentChat.today']);
  });

  it('control: the app catalog wins over the UI catalog', () => {
    expect(createTranslate({ 'agentChat.today': 'اليوم!' }, 'ar')('agentChat.today')).toBe('اليوم!');
  });

  it('control: without a locale the English UI catalog is the fallback, as before', () => {
    expect(createTranslate({})('agentChat.today')).toBe(en['agentChat.today']);
  });

  it('edge: an unknown locale falls back to English, an unknown key to itself', () => {
    expect(createTranslate({}, 'xx')('agentChat.today')).toBe(en['agentChat.today']);
    expect(createTranslate({}, 'ar')('no.such.key')).toBe('no.such.key');
  });

  it('edge: params interpolate into a UI-catalog message', () => {
    const t = createTranslate({}, 'en');
    const key = Object.keys(en).find((k) => typeof en[k as keyof typeof en] === 'string' && String(en[k as keyof typeof en]).includes('{{count}}'));
    expect(key).toBeDefined();
    if (key !== undefined) expect(t(key, { count: 7 })).toContain('7');
  });
});
