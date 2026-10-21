/**
 * Render-time prop shape check against the pattern registry's declared
 * `types`. It flags only a value whose SHAPE no declared type can accept — a
 * primitive where only structures are declared (an unresolved binding string
 * reaching an `array` prop), or a plain object where only an array is — so
 * the renderer reports that element instead of the component throwing.
 * Loose types (`node`, `icon`, `component`, …) accept what they can render.
 */

/** A prop's declared registry types, as `propsSchema` carries them. */
export interface DeclaredPropTypes {
  types?: ReadonlyArray<string>;
  required?: boolean;
}

export interface PropTypeMismatch {
  prop: string;
  expected: ReadonlyArray<string>;
  got: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'missing';
}

const ACCEPTS_PRIMITIVE = new Set(['string', 'number', 'boolean', 'icon', 'asset', 'date', 'node', 'component', 'sexpr', 'function']);
const ACCEPTS_ARRAY = new Set(['array', 'node', 'sexpr']);
const ACCEPTS_OBJECT = new Set(['object', 'node', 'component', 'sexpr', 'icon', 'asset', 'date']);

type Shape = Exclude<PropTypeMismatch['got'], 'missing'>;
const STRUCTURE = new Set(['array', 'object']);

function shapeOf<V>(value: V): Shape | null {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return 'object';
  return null;
}

function accepts(types: ReadonlyArray<string>, shape: Shape): boolean {
  const set = shape === 'array' ? ACCEPTS_ARRAY : shape === 'object' ? ACCEPTS_OBJECT : ACCEPTS_PRIMITIVE;
  return types.some((t) => set.has(t));
}

/**
 * Props whose value shape none of their declared types accept, plus required
 * structure-only props (every declared type is `array`/`object`) that are
 * missing — components dereference those unconditionally. Optional absent,
 * null and undeclared props never count.
 */
export function propTypeMismatches<V>(
  propsSchema: Readonly<Record<string, DeclaredPropTypes>> | undefined,
  props: Readonly<Record<string, V>>,
  /** Props delivered through another channel (JSX children) — present, not checked. */
  delivered: ReadonlyArray<string> = [],
): PropTypeMismatch[] {
  if (!propsSchema) return [];
  const out: PropTypeMismatch[] = [];
  for (const [prop, def] of Object.entries(propsSchema)) {
    if (delivered.includes(prop)) continue;
    const types = def.types;
    const value = props[prop];
    if (value === undefined || value === null) {
      if (def.required && types && types.length > 0 && types.every((t) => STRUCTURE.has(t))) {
        out.push({ prop, expected: types, got: 'missing' });
      }
      continue;
    }
  }
  for (const [prop, value] of Object.entries(props)) {
    if (delivered.includes(prop)) continue;
    const types = propsSchema[prop]?.types;
    if (!types || types.length === 0) continue;
    const shape = shapeOf(value);
    if (shape === null || accepts(types, shape)) continue;
    out.push({ prop, expected: types, got: shape });
  }
  return out;
}
