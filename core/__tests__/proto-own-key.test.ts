import { describe, expect, it } from 'vitest';
import { toWireValue } from '../src/kernel-evaluator';
import { toProgramData } from '../src/types/expression';
import { setOwn } from '../src/types/own-key';

const kernelAnswer = '{"__proto__": {"x": 1}, "a": 2}';

describe('"__proto__" is an own key wherever a kernel value becomes a JS object', () => {
  it('a kernel answer decoded from the wire keeps the key and the prototype', () => {
    const value = JSON.parse(kernelAnswer) as { [key in string]: unknown };
    expect(Object.prototype.hasOwnProperty.call(value, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.keys(value)).toEqual(['__proto__', 'a']);
  });

  it('setOwn writes the key as an own data property and leaves the prototype alone', () => {
    const out: { [key in string]: object } = {};
    setOwn(out, '__proto__', { x: 1 });
    expect(Object.keys(out)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toEqual({ x: 1 });
  });

  it('toWireValue copies a value carrying the key without invoking the prototype setter', () => {
    const input = JSON.parse(kernelAnswer) as { [key in string]: number | { x: number } };
    const out = toWireValue(input);
    expect(Object.keys(out as object)).toEqual(['__proto__', 'a']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(JSON.stringify(out)).toBe('{"__proto__":{"x":1},"a":2}');
  });

  it('toProgramData keeps the key as program data', () => {
    const out = toProgramData(JSON.parse(kernelAnswer));
    expect(Object.keys(out as object)).toEqual(['__proto__', 'a']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it('control: an ordinary key is copied the same way', () => {
    expect(toWireValue({ b: 1 })).toEqual({ b: 1 });
  });
});
