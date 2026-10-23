// src/kernel/program-effects.ts
var PROGRAM_EFFECTS = [
  "behavior/catalog",
  "behavior/describe",
  "behavior/source",
  "behavior/resolve",
  "behavior/dependencies",
  "program/read",
  "program/print",
  "program/eval",
  "program/validate",
  "program/compose",
  "program/step"
];
function isProgramEffect(name) {
  return PROGRAM_EFFECTS.includes(name);
}

export { PROGRAM_EFFECTS, isProgramEffect };
