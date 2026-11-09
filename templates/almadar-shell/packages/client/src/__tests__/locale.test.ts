import { describe, it, expect } from 'vitest';
import type { OrbitalSchema } from '@almadar/core';
import { localeValue } from '../locale';

const program = (messages: Record<string, Record<string, string>>): OrbitalSchema => ({ name: 'App', orbitals: [], messages });

describe('localeValue', () => {
  it('a built-in label the program does not carry comes from the UI catalog of the page locale', () => {
    const { t } = localeValue(program({ sl: {} }), 'sl');
    expect(t('agentChat.emptyDescription')).toBe('Vprašajte s svojimi besedami — pomočnik lahko poišče podatke in namesto vas naredi spremembe.');
  });

  it('control: the program catalog wins over the UI catalog', () => {
    const { t } = localeValue(program({ sl: { 'agentChat.emptyDescription': 'Lastno besedilo' } }), 'sl');
    expect(t('agentChat.emptyDescription')).toBe('Lastno besedilo');
  });

  it('edge: a locale the UI has no catalog for reads English built-in labels', () => {
    const { t, direction } = localeValue(program({}), 'de');
    expect(t('agentChat.emptyDescription')).toBe('Ask in your own words — the assistant can look things up and make changes for you.');
    expect(direction).toBe('ltr');
  });
});
