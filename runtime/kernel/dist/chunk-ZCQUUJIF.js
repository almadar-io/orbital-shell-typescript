import { detectLayoutStrategy } from './chunk-EV56K4GB.js';
import { applyEventWiring } from './chunk-MHYSHSRG.js';

// src/runtime/effects/composition/compose-behaviors.ts
function isSchema(input) {
  return "orbitals" in input && Array.isArray(input.orbitals);
}
function asDefinitions(inputs) {
  return inputs.flatMap(
    (input) => isSchema(input) ? input.orbitals : [input]
  );
}
function mergeLedgers(inputs) {
  const merged = /* @__PURE__ */ new Map();
  let sawLedger = false;
  for (const input of inputs) {
    if (!isSchema(input) || input.ledger === void 0) continue;
    sawLedger = true;
    for (const [id, entry] of Object.entries(input.ledger.entries)) {
      if (!merged.has(id)) merged.set(id, entry);
    }
  }
  if (!sawLedger) return void 0;
  const entries = {};
  for (const [id, entry] of [...merged.entries()].sort(
    ([a], [b]) => a < b ? -1 : a > b ? 1 : 0
  )) {
    entries[id] = entry;
  }
  return { schemaVersion: 1, entries };
}
function mergeSchemaVersions(inputs) {
  let max;
  for (const input of inputs) {
    if (!isSchema(input) || input.schemaVersion === void 0) continue;
    max = max === void 0 ? input.schemaVersion : Math.max(max, input.schemaVersion);
  }
  return max;
}
function toKebabCase(name) {
  return name.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[\s_]+/g, "-").toLowerCase();
}
function generatePages(orbitals, strategy) {
  switch (strategy) {
    case "single": {
      const orbital = orbitals[0];
      const name = orbital?.name ?? "Main";
      return [
        {
          name: `${name}Page`,
          path: "/",
          isInitial: true,
          primaryEntity: getEntityName(orbital)
        }
      ];
    }
    case "dashboard": {
      return [
        {
          name: "DashboardPage",
          path: "/",
          viewType: "dashboard",
          isInitial: true
        }
      ];
    }
    case "sidebar":
    case "tabs":
    case "wizard-flow": {
      return orbitals.map((orbital, index) => ({
        name: `${orbital.name}Page`,
        path: index === 0 ? "/" : `/${toKebabCase(orbital.name)}`,
        isInitial: index === 0,
        primaryEntity: getEntityName(orbital)
      }));
    }
  }
}
function getEntityName(orbital) {
  if (!orbital) return void 0;
  const entity = orbital.entity;
  if (typeof entity === "string") {
    return entity.replace(".entity", "");
  }
  return entity.name;
}
function composeBehaviors(input) {
  const {
    appName,
    orbitals: rawInputs,
    layoutStrategy: strategyInput,
    eventWiring
  } = input;
  const rawOrbitals = asDefinitions(rawInputs);
  const wiredOrbitals = eventWiring && eventWiring.length > 0 ? applyEventWiring(rawOrbitals, eventWiring) : rawOrbitals;
  const strategy = !strategyInput || strategyInput === "auto" ? detectLayoutStrategy(wiredOrbitals, eventWiring) : strategyInput;
  const pages = generatePages(wiredOrbitals, strategy);
  const orbitalsWithPages = wiredOrbitals.map((orbital, index) => {
    if (orbital.pages && orbital.pages.length > 0) {
      return orbital;
    }
    const page = strategy === "dashboard" || strategy === "single" ? pages[0] : pages[index];
    return {
      ...orbital,
      pages: page ? [page] : []
    };
  });
  const ledger = mergeLedgers(rawInputs);
  const schemaVersion = mergeSchemaVersions(rawInputs);
  const schema = {
    name: appName,
    version: "1.0.0",
    orbitals: orbitalsWithPages,
    ...schemaVersion !== void 0 ? { schemaVersion } : {},
    ...ledger !== void 0 ? { ledger } : {}
  };
  return {
    schema,
    layout: {
      strategy,
      pageCount: pages.length
    },
    wiring: {
      connections: eventWiring?.length ?? 0
    }
  };
}

export { composeBehaviors };
