import { getStdEffectOperators, getOperatorRunsOn } from '@almadar/std/registry';

// src/runtime/types.ts
function isEffectTuple(value) {
  return Array.isArray(value) && typeof value[0] === "string";
}
var EFFECT_ALIASES = { render: "render-ui" };
function withAliases(ops) {
  const aliases = Object.keys(EFFECT_ALIASES).filter((alias) => ops.includes(EFFECT_ALIASES[alias]));
  return [...ops, ...aliases].sort();
}
function effectsNotOn(site) {
  return withAliases(getStdEffectOperators().filter((op) => getOperatorRunsOn(op) !== site));
}
var HANDLER_MANIFEST = {
  client: effectsNotOn("server"),
  server: effectsNotOn("client"),
  test: withAliases(getStdEffectOperators()),
  ssr: withAliases(["render-ui", "fetch", "emit", "set", "log", "ref", "deref"])
};

export { HANDLER_MANIFEST, isEffectTuple };
