// src/runtime/effects/composition/layout-strategy.ts
function hasSequentialChain(wiring) {
  if (wiring.length < 2) {
    return false;
  }
  const adjacency = /* @__PURE__ */ new Map();
  const allTargets = /* @__PURE__ */ new Set();
  for (const entry of wiring) {
    let targets = adjacency.get(entry.from);
    if (!targets) {
      targets = /* @__PURE__ */ new Set();
      adjacency.set(entry.from, targets);
    }
    targets.add(entry.to);
    allTargets.add(entry.to);
  }
  const roots = [];
  for (const from of adjacency.keys()) {
    if (!allTargets.has(from)) {
      roots.push(from);
    }
  }
  const starts = roots.length > 0 ? roots : [...adjacency.keys()];
  for (const start of starts) {
    let current = start;
    let length = 1;
    const visited = /* @__PURE__ */ new Set([current]);
    while (true) {
      const nexts = adjacency.get(current);
      if (!nexts || nexts.size === 0) break;
      let advanced = false;
      for (const next of nexts) {
        if (!visited.has(next)) {
          visited.add(next);
          current = next;
          length++;
          advanced = true;
          break;
        }
      }
      if (!advanced) break;
    }
    if (length >= 3) {
      return true;
    }
  }
  return false;
}
function detectLayoutStrategy(orbitals, eventWiring) {
  if (eventWiring && eventWiring.length > 0 && hasSequentialChain(eventWiring)) {
    return "wizard-flow";
  }
  const count = orbitals.length;
  if (count <= 1) {
    return "single";
  }
  if (count <= 4) {
    return "tabs";
  }
  return "sidebar";
}

export { detectLayoutStrategy };
