/**
 * The attribute namespaces a layout/text primitive forwards to its element:
 * `aria-*`, `data-*`, `role`, `id`, `lang`, `dir` and `tabIndex` (HTML's own
 * global-attribute contract; @almadar/core A11yProps).
 * The runtime renderer spreads schema props onto components, so anything else
 * stays off the DOM.
 */
export type DomPassthrough = Record<string, string | number | boolean | undefined>;

const GLOBAL_ATTRIBUTES = new Set(['role', 'id', 'lang', 'dir', 'tabIndex']);

export function domPassthrough(props: object): DomPassthrough {
  const out: DomPassthrough = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('aria-') || key.startsWith('data-') || GLOBAL_ATTRIBUTES.has(key)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === undefined) {
        out[key] = value;
      }
    }
  }
  return out;
}
