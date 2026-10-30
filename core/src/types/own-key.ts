/** Writes `key` as an own data property, so `"__proto__"` is an ordinary key and never the prototype setter. */
export function setOwn<T>(target: { [key in string]: T }, key: string, value: T): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}
