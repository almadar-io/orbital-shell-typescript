import type { PatternsRegistry } from '../src/patterns/index.js';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const ENTRY_DESIGN_TIME_KEYS: ReadonlySet<string> = new Set(['description', 'suggestedFor', 'typicalSize', 'sourceFile']);
const PROP_DESIGN_TIME_KEYS: ReadonlySet<string> = new Set(['description', 'example', 'enumValues', 'numericEnumValues']);
const SCHEMA_CHILD_KEYS: ReadonlySet<string> = new Set(['items', 'mapValue', 'schema']);
const SCHEMA_MAP_KEYS: ReadonlySet<string> = new Set(['properties']);
const SCHEMA_LIST_KEYS: ReadonlySet<string> = new Set(['callbackArgs']);

function isRecord(value: Json): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripProp(def: Json): Json {
  if (!isRecord(def)) return def;
  const out: { [key: string]: Json } = {};
  for (const [key, value] of Object.entries(def)) {
    if (PROP_DESIGN_TIME_KEYS.has(key)) continue;
    if (SCHEMA_CHILD_KEYS.has(key)) out[key] = stripProp(value);
    else if (SCHEMA_MAP_KEYS.has(key) && isRecord(value)) out[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, stripProp(child)]));
    else if (SCHEMA_LIST_KEYS.has(key) && Array.isArray(value)) out[key] = value.map(stripProp);
    else out[key] = value;
  }
  return out;
}

/** The registry minus the design-time fields no running client reads: descriptions, examples, enum value lists, source paths, recommender hints. */
export function projectRuntimeContract(registry: PatternsRegistry): Json {
  const patterns: { [key: string]: Json } = {};
  for (const [name, entry] of Object.entries(registry.patterns)) {
    const out: { [key: string]: Json } = {};
    for (const [key, value] of Object.entries(entry)) {
      if (ENTRY_DESIGN_TIME_KEYS.has(key)) continue;
      if (key === 'propsSchema' && isRecord(value as Json)) {
        out[key] = Object.fromEntries(Object.entries(value as { [key: string]: Json }).map(([prop, def]) => [prop, stripProp(def)]));
      } else out[key] = value as Json;
    }
    patterns[name] = out;
  }
  return { patterns };
}
