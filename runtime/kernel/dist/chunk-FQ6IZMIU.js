// src/runtime/effects/composition/pipe.ts
function pipeBehaviors(seed, ...steps) {
  let current = seed;
  for (const step of steps) {
    current = step(current);
  }
  return current;
}

export { pipeBehaviors };
