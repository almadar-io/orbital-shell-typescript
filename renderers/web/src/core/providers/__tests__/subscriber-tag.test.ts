import { afterEach, describe, expect, it, vi } from 'vitest';
import { setNamespaceLevel } from '@almadar/logger';
import { subscriberTag } from '../subscriber-tag';

const NAMESPACES = ['almadar:eventbus', 'almadar:eventbus:subscribe'];

afterEach(() => {
  for (const ns of NAMESPACES) setNamespaceLevel(ns, null);
  vi.restoreAllMocks();
});

describe('subscriberTag', () => {
  it('reads no stack and gives no tag when neither bus namespace logs at debug', () => {
    for (const ns of NAMESPACES) setNamespaceLevel(ns, 'INFO');
    const made = vi.spyOn(globalThis, 'Error');
    expect(subscriberTag(() => undefined)).toBeUndefined();
    expect(made).not.toHaveBeenCalled();
  });

  it('control: tags an anonymous listener from its subscriber when the subscribe namespace logs at debug', () => {
    setNamespaceLevel('almadar:eventbus', 'INFO');
    setNamespaceLevel('almadar:eventbus:subscribe', 'DEBUG');
    const made = vi.spyOn(globalThis, 'Error');
    const tag = subscriberTag(() => undefined);
    expect(made).toHaveBeenCalled();
    expect(typeof tag).toBe('string');
    expect(tag).not.toBe('');
  });

  it('control: a named listener is tagged by its name when the emit namespace logs at debug', () => {
    setNamespaceLevel('almadar:eventbus', 'DEBUG');
    function onSaved(): void {}
    expect(subscriberTag(onSaved)).toBe('onSaved');
  });
});
