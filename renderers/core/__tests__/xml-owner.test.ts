import { describe, expect, it, vi } from 'vitest';
import { parseXml, xmlValid, XmlSyntaxError, type XmlValue } from '../index.js';

describe('canonical XML owner', () => {
  it('exports the pure parser, validity predicate and syntax-error class from core', () => {
    expect(typeof parseXml).toBe('function');
    expect(typeof xmlValid).toBe('function');
    expect(typeof XmlSyntaxError).toBe('function');
  });

  it('distinguishes complete XML syntax from malformed documents without testing value truthiness', () => {
    for (const text of ['<a/>', '<a>0</a>', '<a>false</a>', '<a>null</a>', '<a>  </a>']) {
      expect(xmlValid(text), text).toBe(true);
    }
    for (const text of ['', 'null', '<a>', '<a></b>', '<a/><b/>', '<a/>tail', '<a>&missing;</a>']) {
      expect(xmlValid(text), text).toBe(false);
    }
  });

  it('preserves empty and scalar-text values and XML-only whitespace collapsing', () => {
    expect(parseXml('<a/>')).toBe('');
    expect(parseXml('<a>0</a>')).toBe('0');
    expect(parseXml('<a>false</a>')).toBe('false');
    expect(parseXml('<a>null</a>')).toBe('null');
    expect(parseXml('<a>  x\n\t y  </a>')).toBe('x y');
    expect(parseXml('<a> x </a>')).toBe(' x ');
  });

  it('preserves attributes, repeated children, descendant text and local namespace names', () => {
    const expected: XmlValue = {
      '@id': '7',
      child: ['one', 'two'],
      '#text': 'before onetwo after',
    };
    expect(parseXml('<x:r xmlns:x="urn:x" id="7">before <x:child>one</x:child><x:child>two</x:child> after</x:r>')).toEqual(expected);
    expect(parseXml('<x:r xmlns:x="urn:x"><x:child>value</x:child></x:r>')).toEqual({ child: 'value' });
  });

  it('wraps a lone child of a declared list path at every depth and leaves undeclared fields alone', () => {
    const paths = [['entry'], ['entry', 'author']];
    const xml = '<feed><entry><id>1</id><author><name>A</name></author></entry></feed>';
    expect(parseXml(xml, paths)).toEqual({ entry: [{ id: '1', author: [{ name: 'A' }] }] });
    expect(parseXml(xml)).toEqual({ entry: { id: '1', author: { name: 'A' } } });
    expect(parseXml(xml, [['entry']])).toEqual({ entry: [{ id: '1', author: { name: 'A' } }] });
    expect(parseXml('<feed><title>t</title></feed>', paths)).toEqual({ title: 't' });
    expect(parseXml('<feed><entry/></feed>', paths)).toEqual({ entry: [''] });
    expect(parseXml('<feed>text</feed>', paths)).toBe('text');
  });

  it('preserves entity decoding, CDATA and ignored declarations', () => {
    expect(parseXml('<?xml version="1.0"?><!--comment--><a>&amp;&#65;&#x1f600;<![CDATA[<x>]]></a>')).toBe('&A😀<x>');
    expect(parseXml('<!DOCTYPE a><a>value</a>')).toBe('value');
  });

  it('keeps prototype-looking element names as own fields', () => {
    const value = parseXml('<r><__proto__>one</__proto__><b>two</b></r>');
    expect(Object.keys(value)).toEqual(['__proto__', 'b']);
    expect(Object.prototype.hasOwnProperty.call(value, '__proto__')).toBe(true);
  });

  it('throws the canonical syntax error with the unchanged xml/parse message', () => {
    expect(() => parseXml('<a>')).toThrow(XmlSyntaxError);
    expect(() => parseXml('<a>')).toThrow('xml/parse: unclosed element');
    expect(() => parseXml('<a></b>')).toThrow('xml/parse: mismatched closing tag for `a`');
    expect(() => parseXml('<a>&#0;</a>')).toThrow('xml/parse: invalid character reference `&#0;`');
    try {
      parseXml('<a>');
      throw new Error('malformed XML was accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(XmlSyntaxError);
      if (!(error instanceof XmlSyntaxError)) throw error;
      expect(error.name).toBe('XmlSyntaxError');
      expect(error.message).toBe('xml/parse: unclosed element');
    }
  });

  it('does not swallow dependency faults in either pure function', () => {
    const failure = new Error('unexpected character conversion defect');
    const conversion = vi.spyOn(String, 'fromCodePoint').mockImplementation(() => { throw failure; });
    try {
      expect(() => xmlValid('<a>&#65;</a>')).toThrow(failure);
      expect(() => parseXml('<a>&#65;</a>')).toThrow(failure);
    } finally {
      conversion.mockRestore();
    }
  });

  it('validates deep syntax and rejects an unclosed trailing element', () => {
    const text = `${'<a>'.repeat(256)}value${'</a>'.repeat(256)}`;
    expect(xmlValid(text)).toBe(true);
    expect(xmlValid(`${text}<a>`)).toBe(false);
  });

  it('validates object-shaped XML without invoking tree-to-value conversion', () => {
    const text = '<r><a>v</a></r>';
    const failure = new Error('unexpected XML value conversion defect');
    let valid: boolean | undefined;
    let parseError: Error | undefined;
    const conversion = vi.spyOn(Object, 'fromEntries').mockImplementation(() => { throw failure; });
    try {
      valid = xmlValid(text);
      try {
        parseXml(text);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        parseError = error;
      }
    } finally {
      conversion.mockRestore();
    }
    expect(valid).toBe(true);
    expect(parseError).toBe(failure);
  });
});
